//! Windows OLE drag-out of archive entries.
//!
//! The lifecycle follows 7-Zip File Manager's archive drag (`PanelDrag.cpp`):
//!
//! 1. Before `DoDragDrop` only an empty temporary root exists. `CF_HDROP`
//!    names that root, so Explorer can compute copy/move feedback while the
//!    pointer moves without anything being extracted.
//! 2. When the button is released over a target that accepted the drag,
//!    `QueryContinueDrag` returns `DRAGDROP_S_DROP` immediately. Nothing is
//!    extracted inside the drag loop: the loop still owns mouse capture there,
//!    so extracting in it freezes pointer input for the whole desktop.
//! 3. The target's `IDropTarget::Drop` asks for `CF_HDROP` again. Only then is
//!    the destination known to want the payload: the Job's disposable task
//!    window is presented, the selected entries are extracted into the root
//!    (with Job progress and cancellation), and the final names are returned
//!    so the target copies or moves them into the destination folder.
//! 4. After `DoDragDrop` returns the root is retained briefly for file
//!    managers that finish their copy asynchronously, then removed.
//!
//! `DoDragDrop` runs on a dedicated STA thread so the Tauri main thread keeps
//! dispatching events (the task window is created there) while the target
//! waits for extraction. That thread shares the UI thread's input state for
//! the duration of the pointer drag, so capture and button state follow the
//! gesture that started in the webview.

use std::{
    mem::{ManuallyDrop, size_of},
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    ptr::null_mut,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread,
};

use ::windows::{
    Win32::{
        Foundation::{
            DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC, DV_E_TYMED, E_FAIL, E_NOTIMPL, OLE_E_ADVISENOTSUPPORTED, S_OK,
        },
        System::{
            Com::{
                DATADIR_GET, DVASPECT_CONTENT, FORMATETC, IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, STGMEDIUM, STGMEDIUM_0,
                TYMED_HGLOBAL,
            },
            Memory::{GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock},
            Ole::{
                CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE, DROPEFFECT_NONE, DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize,
                OleUninitialize, ReleaseStgMedium,
            },
            SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
        },
        UI::Shell::{DROPFILES, SHCreateStdEnumFmtEtc},
    },
    core::{BOOL, Error as WindowsError, HRESULT, Ref, Result as WindowsResult, implement},
};
use windows_sys::Win32::{
    System::Threading::{AttachThreadInput, GetCurrentThreadId},
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON},
        WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON},
    },
};

use super::{NativeFileDragError, NativeFileDragItem, NativeFileDragOutcome, NativeFileDragStreamProvider};
use crate::platform::staged_file_drag::StagedFileDrag;

pub(super) type DestinationNotifier = Arc<dyn Fn() + Send + Sync>;

/// Runs one drag-out to completion and reports what the destination did.
///
/// `ui_thread_id` is the thread that owns the window where the gesture
/// started. Blocking here is expected: callers run this off the Tauri main
/// thread.
pub(super) fn start_drag(
    ui_thread_id: Option<u32>,
    staged_drag: StagedFileDrag,
    items: Vec<NativeFileDragItem>,
    stream_provider: NativeFileDragStreamProvider,
    notify_destination: DestinationNotifier,
) -> Result<NativeFileDragOutcome, NativeFileDragError> {
    let payload = Arc::new(DragPayload::new(staged_drag, items, stream_provider, notify_destination));
    let worker_payload = Arc::clone(&payload);
    let worker = thread::Builder::new()
        .name("zmanager-windows-ole-drag".to_string())
        .spawn(move || run_drag_loop(&worker_payload, ui_thread_id))
        .map_err(|error| NativeFileDragError::new(format!("Unable to start Windows drag worker: {error}"), Some("Try dragging again.")))?;
    let loop_result = worker.join().map_err(|_| NativeFileDragError::new("Windows drag worker panicked.", Some("Try dragging again.")))?;
    payload.settle(loop_result)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DragLoopResult {
    Dropped,
    Cancelled,
}

fn run_drag_loop(payload: &Arc<DragPayload>, ui_thread_id: Option<u32>) -> Result<DragLoopResult, NativeFileDragError> {
    // Declared first so COM objects below are released before OLE shuts down.
    let _ole = OleApartment::initialize()?;
    let data_object: IDataObject = FileDragDataObject { payload: Arc::clone(payload) }.into();
    let drop_source: IDropSource = FileDropSource { payload: Arc::clone(payload), input: Mutex::new(InputAttachment::attach(ui_thread_id)) }.into();
    let mut effect = DROPEFFECT_NONE;
    // Like 7-Zip, allow move as well as copy: Explorer then renames the
    // extracted files out of the temporary root when it shares the volume.
    let result = unsafe { DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY | DROPEFFECT_MOVE, &mut effect) };

    if result == DRAGDROP_S_CANCEL {
        return Ok(DragLoopResult::Cancelled);
    }
    if result.is_err() {
        return Err(NativeFileDragError::new(
            format!("Windows native drag failed: 0x{:08X}", result.0 as u32),
            Some("Try extracting normally while native drag-out is being checked."),
        ));
    }
    Ok(DragLoopResult::Dropped)
}

struct OleApartment;

impl OleApartment {
    fn initialize() -> Result<Self, NativeFileDragError> {
        unsafe { OleInitialize(None) }.map_err(|error| {
            NativeFileDragError::new(format!("Unable to initialize Windows OLE drag/drop: {error}"), Some("Restart ZManager and try the drag again."))
        })?;
        Ok(Self)
    }
}

impl Drop for OleApartment {
    fn drop(&mut self) {
        unsafe {
            OleUninitialize();
        }
    }
}

/// Shares the UI thread's input state with the drag thread while the pointer
/// gesture is in progress, so `DoDragDrop` can capture the mouse the webview
/// pressed and observe its release.
struct InputAttachment {
    drag_thread_id: u32,
    ui_thread_id: u32,
}

impl InputAttachment {
    fn attach(ui_thread_id: Option<u32>) -> Option<Self> {
        let ui_thread_id = ui_thread_id.filter(|id| *id != 0)?;
        let drag_thread_id = unsafe { GetCurrentThreadId() };
        if drag_thread_id == ui_thread_id {
            return None;
        }
        (unsafe { AttachThreadInput(drag_thread_id, ui_thread_id, 1) } != 0).then_some(Self { drag_thread_id, ui_thread_id })
    }
}

impl Drop for InputAttachment {
    fn drop(&mut self) {
        unsafe {
            AttachThreadInput(self.drag_thread_id, self.ui_thread_id, 0);
        }
    }
}

struct PayloadState {
    staged: Option<StagedFileDrag>,
    destination_notified: bool,
    materialized: bool,
    error: Option<NativeFileDragError>,
}

/// State shared by the data object and drop source of one drag.
struct DragPayload {
    state: Mutex<PayloadState>,
    released: AtomicBool,
    effect: AtomicU32,
    items: Vec<NativeFileDragItem>,
    stream_provider: NativeFileDragStreamProvider,
    notify_destination: DestinationNotifier,
}

impl DragPayload {
    fn new(
        staged: StagedFileDrag,
        items: Vec<NativeFileDragItem>,
        stream_provider: NativeFileDragStreamProvider,
        notify_destination: DestinationNotifier,
    ) -> Self {
        Self {
            state: Mutex::new(PayloadState { staged: Some(staged), destination_notified: false, materialized: false, error: None }),
            released: AtomicBool::new(false),
            effect: AtomicU32::new(DROPEFFECT_NONE.0),
            items,
            stream_provider,
            notify_destination,
        }
    }

    fn lock_state(&self) -> MutexGuard<'_, PayloadState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Called by the drop source when the button is released: accept the drop
    /// only if the target under the pointer accepted the drag. No extraction
    /// happens here.
    fn release(&self) -> HRESULT {
        if self.effect.load(Ordering::Acquire) == DROPEFFECT_NONE.0 {
            return DRAGDROP_S_CANCEL;
        }
        self.released.store(true, Ordering::Release);
        DRAGDROP_S_DROP
    }

    /// Names returned for `CF_HDROP`. While the pointer is still moving the
    /// target only sees the empty root; after release the request comes from
    /// the target's drop, so the selected entries are extracted once and their
    /// top-level names returned.
    fn file_drop_paths(&self) -> Result<Vec<PathBuf>, HRESULT> {
        let mut state = self.lock_state();
        let Some(staged) = state.staged.as_ref() else {
            return Err(E_FAIL);
        };
        if !self.released.load(Ordering::Acquire) {
            return Ok(vec![staged.root_path().to_path_buf()]);
        }
        if state.materialized {
            return Ok(staged.drag_paths().to_vec());
        }
        if state.error.is_some() {
            return Err(E_FAIL);
        }

        if !state.destination_notified {
            state.destination_notified = true;
            (self.notify_destination)();
        }
        let state = &mut *state;
        let staged = state.staged.as_mut().expect("staged drag checked above");
        match staged.stage_items(&self.items, Arc::clone(&self.stream_provider)) {
            Ok(()) => {
                state.materialized = true;
                Ok(staged.drag_paths().to_vec())
            }
            Err(error) => {
                state.error = Some(error);
                Err(E_FAIL)
            }
        }
    }

    /// Converts the finished drag loop into the Job outcome and decides the
    /// temporary root's lifetime.
    fn settle(&self, loop_result: Result<DragLoopResult, NativeFileDragError>) -> Result<NativeFileDragOutcome, NativeFileDragError> {
        let mut state = self.lock_state();
        let staged = state.staged.take();
        if let Some(error) = state.error.take() {
            return Err(error);
        }
        let loop_result = loop_result?;
        // A target that received the extracted names owns the transfer, even
        // when `DoDragDrop` reports no effect: Explorer returns
        // DROPEFFECT_NONE after an optimized move.
        let outcome = if state.materialized {
            NativeFileDragOutcome::Dropped
        } else if loop_result == DragLoopResult::Cancelled {
            NativeFileDragOutcome::Cancelled
        } else {
            NativeFileDragOutcome::NoDrop
        };
        if outcome == NativeFileDragOutcome::Dropped
            && let Some(staged) = staged
        {
            staged.keep_for_file_manager_copy();
        }
        Ok(outcome)
    }
}

#[implement(IDataObject)]
struct FileDragDataObject {
    payload: Arc<DragPayload>,
}

impl IDataObject_Impl for FileDragDataObject_Impl {
    fn GetData(&self, pformatetcin: *const FORMATETC) -> WindowsResult<STGMEDIUM> {
        let format = unsafe { pformatetcin.as_ref() }.ok_or_else(|| WindowsError::from_hresult(DV_E_FORMATETC))?;
        if !is_file_drop_format(format) {
            return Err(WindowsError::from_hresult(DV_E_FORMATETC));
        }
        let paths = self.payload.file_drop_paths().map_err(WindowsError::from_hresult)?;
        file_drop_medium(&paths)
    }

    fn GetDataHere(&self, _pformatetc: *const FORMATETC, _pmedium: *mut STGMEDIUM) -> WindowsResult<()> {
        Err(WindowsError::from_hresult(E_NOTIMPL))
    }

    fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
        let Some(format) = (unsafe { pformatetc.as_ref() }) else {
            return DV_E_FORMATETC;
        };
        if is_file_drop_format(format) {
            S_OK
        } else if format.cfFormat == CF_HDROP.0 {
            DV_E_TYMED
        } else {
            DV_E_FORMATETC
        }
    }

    fn GetCanonicalFormatEtc(&self, _pformatectin: *const FORMATETC, pformatetcout: *mut FORMATETC) -> HRESULT {
        if let Some(output) = unsafe { pformatetcout.as_mut() } {
            output.ptd = null_mut();
        }
        E_NOTIMPL
    }

    fn SetData(&self, _pformatetc: *const FORMATETC, pmedium: *const STGMEDIUM, frelease: BOOL) -> WindowsResult<()> {
        // Explorer reports drop effects and drag-image state through SetData
        // with fRelease = TRUE and does not free the medium itself on failure.
        // Take ownership and release it, as 7-Zip does, to avoid leaking it.
        if !frelease.as_bool() {
            return Err(WindowsError::from_hresult(E_NOTIMPL));
        }
        if !pmedium.is_null() {
            unsafe { ReleaseStgMedium(pmedium.cast_mut()) };
        }
        Ok(())
    }

    fn EnumFormatEtc(&self, dwdirection: u32) -> WindowsResult<IEnumFORMATETC> {
        if dwdirection != DATADIR_GET.0 as u32 {
            return Err(WindowsError::from_hresult(E_NOTIMPL));
        }
        unsafe { SHCreateStdEnumFmtEtc(&[file_drop_format()]) }
    }

    fn DAdvise(&self, _pformatetc: *const FORMATETC, _advf: u32, _padvsink: Ref<'_, IAdviseSink>) -> WindowsResult<u32> {
        Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
    }

    fn DUnadvise(&self, _dwconnection: u32) -> WindowsResult<()> {
        Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
    }

    fn EnumDAdvise(&self) -> WindowsResult<IEnumSTATDATA> {
        Err(WindowsError::from_hresult(OLE_E_ADVISENOTSUPPORTED))
    }
}

#[implement(IDropSource)]
struct FileDropSource {
    payload: Arc<DragPayload>,
    input: Mutex<Option<InputAttachment>>,
}

impl FileDropSource {
    fn detach_input(&self) {
        self.input.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
    }
}

impl IDropSource_Impl for FileDropSource_Impl {
    fn QueryContinueDrag(&self, fescapepressed: BOOL, grfkeystate: MODIFIERKEYS_FLAGS) -> HRESULT {
        if fescapepressed.as_bool() {
            self.detach_input();
            return DRAGDROP_S_CANCEL;
        }
        if (grfkeystate & MK_LBUTTON).0 != 0 && primary_button_is_down() {
            return S_OK;
        }
        // The pointer gesture is over; the target's Drop may now wait on
        // extraction, which must not hold the UI thread's input state.
        self.detach_input();
        self.payload.release()
    }

    fn GiveFeedback(&self, dweffect: DROPEFFECT) -> HRESULT {
        self.payload.effect.store(dweffect.0, Ordering::Release);
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

/// `grfKeyState` comes from the drag thread's view of the input queue. The
/// physical state guards against a release that the queue has not delivered.
fn primary_button_is_down() -> bool {
    let primary = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 { VK_RBUTTON } else { VK_LBUTTON };
    let state = unsafe { GetAsyncKeyState(i32::from(primary)) };
    state < 0
}

fn file_drop_format() -> FORMATETC {
    FORMATETC { cfFormat: CF_HDROP.0, ptd: null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 }
}

fn is_file_drop_format(format: &FORMATETC) -> bool {
    format.cfFormat == CF_HDROP.0 && format.dwAspect == DVASPECT_CONTENT.0 && (format.tymed & TYMED_HGLOBAL.0 as u32) != 0
}

fn file_drop_medium(paths: &[PathBuf]) -> WindowsResult<STGMEDIUM> {
    let names = file_drop_names(paths);

    let allocation_size = size_of::<DROPFILES>() + names.len() * size_of::<u16>();
    let hglobal = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, allocation_size)? };
    let locked = unsafe { GlobalLock(hglobal) };
    if locked.is_null() {
        return Err(WindowsError::from_win32());
    }

    unsafe {
        (locked as *mut DROPFILES).write(DROPFILES { pFiles: size_of::<DROPFILES>() as u32, fWide: BOOL(1), ..DROPFILES::default() });
        std::ptr::copy_nonoverlapping(names.as_ptr().cast::<u8>(), (locked as *mut u8).add(size_of::<DROPFILES>()), names.len() * size_of::<u16>());
        let _ = GlobalUnlock(hglobal);
    }

    Ok(STGMEDIUM { tymed: TYMED_HGLOBAL.0 as u32, u: STGMEDIUM_0 { hGlobal: hglobal }, pUnkForRelease: ManuallyDrop::new(None) })
}

fn file_drop_names(paths: &[PathBuf]) -> Vec<u16> {
    let mut names = Vec::new();
    for path in paths {
        names.extend(path.as_os_str().encode_wide());
        names.push(0);
    }
    names.push(0);
    names
}

#[cfg(test)]
#[path = "windows_file_drag_tests.rs"]
mod tests;
