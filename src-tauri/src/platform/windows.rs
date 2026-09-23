use std::{ffi::OsStr, mem::size_of, os::windows::ffi::OsStrExt, ptr::null_mut, slice, sync::Arc};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use tauri::{Emitter, Wry};
use windows_sys::Win32::{
    Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, HBRUSH, HGDIOBJ, ReleaseDC,
        SelectObject,
    },
    Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL},
    UI::{
        Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_USEFILEATTRIBUTES, SHGetFileInfoW},
        WindowsAndMessaging::{DI_NORMAL, DestroyIcon, DrawIconEx, HICON},
    },
};

use super::windows_drag_path::prepare_windows_drag_items;
use super::{
    CapabilityInspector, DefaultHandlerController, DefaultHandlerEntry, DefaultHandlerRequest, DiagnosticLogPolicy, MainWindowConfigurator,
    NativeCapabilityOperationError, NativeFileDragAdapter, NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem, NativeFileDragJobContext,
    NativeFileDragOutcome, NativeFileDragStart, NativeFileDragStreamProvider, SecureFileProtector, SystemFileIconProvider,
};
use crate::dto::{SystemFileIconDto, SystemFileIconRequestEntry};

pub struct WindowsPlatform;

impl DiagnosticLogPolicy for WindowsPlatform {
    fn prefer_user_log_directory() -> bool {
        false
    }
}

impl CapabilityInspector for WindowsPlatform {
    fn capability_observations()
    -> std::collections::HashMap<crate::native_integration::NativeCapabilityId, crate::native_integration::NativeCapabilityObservation> {
        use crate::native_integration::{NativeCapabilityId, NativeCapabilityObservation, NativeCapabilityPackageState, NativeCapabilityRuntimeState};
        [NativeCapabilityId::ShellSelectedItemActions, NativeCapabilityId::ShellBackgroundActions]
            .into_iter()
            .map(|id| {
                (
                    id,
                    NativeCapabilityObservation {
                        package_state: Some(NativeCapabilityPackageState::Included),
                        runtime_state: Some(NativeCapabilityRuntimeState::Ready),
                        ..NativeCapabilityObservation::default()
                    },
                )
            })
            .collect()
    }
}

impl MainWindowConfigurator for WindowsPlatform {
    fn configure_main_window(window: &tauri::WebviewWindow<Wry>) -> Result<(), tauri::Error> {
        window.set_decorations(true)
    }
}

impl SystemFileIconProvider for WindowsPlatform {
    fn system_file_icons(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto> {
        entries.iter().map(|entry| SystemFileIconDto { key: entry.key.clone(), data_url: system_file_icon_data_url(entry) }).collect()
    }
}

impl DefaultHandlerController for WindowsPlatform {
    fn default_handlers(_request: &DefaultHandlerRequest) -> Result<Vec<DefaultHandlerEntry>, NativeCapabilityOperationError> {
        Err(NativeCapabilityOperationError::not_applicable("defaultHandlerControl"))
    }
}

impl SecureFileProtector for WindowsPlatform {
    fn set_owner_only_file_permissions(_file: &std::fs::File) -> Result<(), NativeCapabilityOperationError> {
        Err(NativeCapabilityOperationError::unavailable("secureLocalFileProtection", "aclImplementationUnavailable"))
    }
}

impl NativeFileDragAdapter for WindowsPlatform {
    fn prepare_native_file_drag(candidates: &[NativeFileDragCandidate], strip_components: usize) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
        prepare_windows_drag_items(candidates, strip_components)
    }

    fn start_native_file_drag(
        window: &tauri::WebviewWindow<Wry>,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        context: NativeFileDragJobContext<'_>,
    ) -> Result<NativeFileDragStart, NativeFileDragError> {
        if items.is_empty() {
            return Err(NativeFileDragError::new("No archive files are available to drag.", None::<String>));
        }

        // Prepare only the temporary root before DoDragDrop. Like 7-Zip, the
        // actual archive extraction starts when the destination requests the
        // final data, not while the pointer is still being dragged.
        let staged_drag = crate::platform::staged_file_drag::StagedFileDrag::prepare("Windows", items)?;
        let job_id = context.job_id.to_owned();
        let window = window.clone();
        let outcome = windows_file_drag::start_drag(
            staged_drag,
            items.to_vec(),
            stream_provider,
            Arc::new(move || {
                let _ = window.emit("native-file-drag-destination", NativeFileDragDestinationEvent { job_id: job_id.clone() });
            }),
        )?;
        Ok(NativeFileDragStart::Settled { outcome })
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeFileDragDestinationEvent {
    job_id: String,
}

fn system_file_icon_data_url(entry: &SystemFileIconRequestEntry) -> Option<String> {
    let lookup_path = if entry.is_directory { "folder" } else { entry.path.trim() };
    let lookup_path = if lookup_path.is_empty() { "file" } else { lookup_path };

    let wide_path = wide_null(lookup_path);
    let attributes = if entry.is_directory { FILE_ATTRIBUTE_DIRECTORY } else { FILE_ATTRIBUTE_NORMAL };
    let mut file_info = SHFILEINFOW::default();
    let result =
        unsafe { SHGetFileInfoW(wide_path.as_ptr(), attributes, &mut file_info, size_of::<SHFILEINFOW>() as u32, SHGFI_ICON | SHGFI_USEFILEATTRIBUTES) };

    if result == 0 || file_info.hIcon.is_null() {
        return None;
    }

    let data_url = unsafe { hicon_to_png_data_url(file_info.hIcon) };
    unsafe {
        DestroyIcon(file_info.hIcon);
    }
    data_url
}

#[cfg(test)]
mod system_file_icon_tests {
    use std::io::Cursor;

    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

    use super::{reconstruct_rgba_from_composites, system_file_icon_data_url};
    use crate::dto::SystemFileIconRequestEntry;

    #[test]
    fn returns_the_windows_shell_icon_for_an_unknown_extension() {
        let icon = system_file_icon_data_url(&SystemFileIconRequestEntry {
            key: "file:.zmanager-unknown".to_string(),
            path: ".zmanager-unknown".to_string(),
            is_directory: false,
        });

        let data_url = icon.expect("Windows should return its generic shell icon");
        let encoded = data_url.strip_prefix("data:image/png;base64,").expect("system icon should be a PNG data URL");
        let png_bytes = BASE64_STANDARD.decode(encoded).expect("decode system icon PNG");
        let decoder = png::Decoder::new(Cursor::new(png_bytes));
        let reader = decoder.read_info().expect("read system icon PNG");

        assert_eq!((reader.info().width, reader.info().height), (32, 32));
    }

    #[test]
    fn reconstructs_transparent_opaque_and_partially_transparent_pixels() {
        let black = [
            0, 0, 0, 255, // transparent
            0, 0, 0, 255, // opaque black
            30, 20, 10, 255, // opaque RGB(10, 20, 30)
            0, 0, 128, 255, // 50% red
        ];
        let white = [255, 255, 255, 255, 0, 0, 0, 255, 30, 20, 10, 255, 127, 127, 255, 255];

        assert_eq!(reconstruct_rgba_from_composites(&black, &white), Some(vec![0, 0, 0, 0, 0, 0, 0, 255, 10, 20, 30, 255, 255, 0, 0, 128,]));
    }

    #[test]
    fn preserves_opaque_black_right_and_bottom_edges() {
        // A 2x2 icon with a transparent top-left pixel and an opaque black
        // right/bottom border exercises the strokes that previously vanished.
        let black = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
        let white = [255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];

        assert_eq!(reconstruct_rgba_from_composites(&black, &white), Some(vec![0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,]));
    }

    #[test]
    fn rejects_mismatched_or_incomplete_composite_buffers() {
        assert_eq!(reconstruct_rgba_from_composites(&[0; 4], &[0; 8]), None);
        assert_eq!(reconstruct_rgba_from_composites(&[0; 3], &[0; 3]), None);
    }
}

unsafe fn hicon_to_png_data_url(icon: HICON) -> Option<String> {
    const ICON_SIZE: i32 = 32;

    let black_composite = unsafe { draw_hicon_bgra(icon, ICON_SIZE, [0, 0, 0]) }?;
    let white_composite = unsafe { draw_hicon_bgra(icon, ICON_SIZE, [255, 255, 255]) }?;
    let rgba = reconstruct_rgba_from_composites(&black_composite, &white_composite)?;
    encode_rgba_png_data_url(&rgba, ICON_SIZE as u32, ICON_SIZE as u32)
}

unsafe fn draw_hicon_bgra(icon: HICON, icon_size: i32, background_bgr: [u8; 3]) -> Option<Vec<u8>> {
    const BYTES_PER_PIXEL: usize = 4;

    let screen_dc = unsafe { GetDC(null_mut()) };
    if screen_dc.is_null() {
        return None;
    }

    let memory_dc = unsafe { CreateCompatibleDC(screen_dc) };
    if memory_dc.is_null() {
        unsafe {
            ReleaseDC(null_mut(), screen_dc);
        }
        return None;
    }

    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: icon_size,
            biHeight: -icon_size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: (icon_size * icon_size * BYTES_PER_PIXEL as i32) as u32,
            ..BITMAPINFOHEADER::default()
        },
        ..BITMAPINFO::default()
    };
    let mut bits = null_mut();
    let bitmap = unsafe { CreateDIBSection(screen_dc, &bitmap_info, DIB_RGB_COLORS, &mut bits, null_mut(), 0) };

    if bitmap.is_null() || bits.is_null() {
        unsafe {
            DeleteDC(memory_dc);
            ReleaseDC(null_mut(), screen_dc);
        }
        return None;
    }

    let previous_object = unsafe { SelectObject(memory_dc, bitmap as HGDIOBJ) };
    let pixel_count = icon_size as usize * icon_size as usize;
    let bgra = unsafe { slice::from_raw_parts_mut(bits as *mut u8, pixel_count * BYTES_PER_PIXEL) };
    for pixel in bgra.chunks_exact_mut(BYTES_PER_PIXEL) {
        pixel.copy_from_slice(&[background_bgr[0], background_bgr[1], background_bgr[2], u8::MAX]);
    }

    let drawn = unsafe { DrawIconEx(memory_dc, 0, 0, icon, icon_size, icon_size, 0, null_mut::<HBRUSH>() as HBRUSH, DI_NORMAL) } != 0;

    let rendered = drawn.then(|| bgra.to_vec());

    if !previous_object.is_null() {
        unsafe {
            SelectObject(memory_dc, previous_object);
        }
    }
    unsafe {
        DeleteObject(bitmap as HGDIOBJ);
        DeleteDC(memory_dc);
        ReleaseDC(null_mut(), screen_dc);
    }

    rendered
}

fn reconstruct_rgba_from_composites(black: &[u8], white: &[u8]) -> Option<Vec<u8>> {
    if black.len() != white.len() || !black.len().is_multiple_of(4) {
        return None;
    }

    let mut rgba = Vec::with_capacity(black.len());
    for (black_pixel, white_pixel) in black.chunks_exact(4).zip(white.chunks_exact(4)) {
        let transparency = (0..3).map(|channel| white_pixel[channel].saturating_sub(black_pixel[channel]) as u16).sum::<u16>().div_ceil(3) as u8;
        let alpha = u8::MAX - transparency;

        for channel in [2, 1, 0] {
            let color =
                if alpha == 0 { 0 } else { ((black_pixel[channel] as u32 * u8::MAX as u32 + alpha as u32 / 2) / alpha as u32).min(u8::MAX as u32) as u8 };
            rgba.push(color);
        }
        rgba.push(alpha);
    }

    Some(rgba)
}

fn encode_rgba_png_data_url(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    if rgba.len() != width as usize * height as usize * 4 {
        return None;
    }

    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }

    Some(format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png_bytes)))
}

fn wide_null(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

mod windows_file_drag {
    use std::{
        mem::{ManuallyDrop, size_of},
        os::windows::ffi::OsStrExt,
        path::PathBuf,
        ptr::null_mut,
        sync::{
            Arc, Mutex,
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
                    DATADIR_GET, DVASPECT_CONTENT, FORMATETC, IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, STGMEDIUM,
                    STGMEDIUM_0, TYMED_HGLOBAL,
                },
                Memory::{GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock},
                Ole::{CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize},
            },
            UI::Shell::{DROPFILES, SHCreateStdEnumFmtEtc},
        },
        core::{BOOL, Error as WindowsError, HRESULT, Ref, Result as WindowsResult, implement},
    };

    use super::{NativeFileDragError, NativeFileDragItem, NativeFileDragOutcome, NativeFileDragStreamProvider};
    use crate::platform::staged_file_drag::StagedFileDrag;

    type DestinationNotifier = Arc<dyn Fn() + Send + Sync>;
    type FinalizeDrag = Arc<dyn Fn() -> Result<(), NativeFileDragError> + Send + Sync>;

    pub fn start_drag(
        staged_drag: StagedFileDrag,
        items: Vec<NativeFileDragItem>,
        stream_provider: NativeFileDragStreamProvider,
        notify_destination: DestinationNotifier,
    ) -> Result<NativeFileDragOutcome, NativeFileDragError> {
        let staged_state = Arc::new(Mutex::new(Some(staged_drag)));
        let drag_state = Arc::new(DragState::default());
        let worker_staged_state = Arc::clone(&staged_state);
        let worker_drag_state = Arc::clone(&drag_state);
        let worker = thread::Builder::new()
            .name("zmanager-windows-ole-drag".to_string())
            .spawn(move || start_drag_on_ole_thread(worker_staged_state, worker_drag_state, items, stream_provider, notify_destination))
            .map_err(|error| NativeFileDragError::new(format!("Unable to start Windows drag worker: {error}"), Some("Try dragging again.")))?;
        let result = worker.join().map_err(|_| NativeFileDragError::new("Windows drag worker panicked.", Some("Try dragging again.")))?;

        if let Some(error) = drag_state.stage_error.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            return Err(error);
        }

        let outcome = result?;
        if matches!(outcome, NativeFileDragOutcome::Dropped) {
            let staged_drag = staged_state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
            if let Some(staged_drag) = staged_drag {
                staged_drag.keep_for_file_manager_copy();
            }
        }
        Ok(outcome)
    }

    fn start_drag_on_ole_thread(
        staged_state: Arc<Mutex<Option<StagedFileDrag>>>,
        drag_state: Arc<DragState>,
        items: Vec<NativeFileDragItem>,
        stream_provider: NativeFileDragStreamProvider,
        notify_destination: DestinationNotifier,
    ) -> Result<NativeFileDragOutcome, NativeFileDragError> {
        let _ole = OleApartment::initialize()?;
        let finalize_drag = create_finalize_drag(Arc::clone(&staged_state), Arc::clone(&drag_state), items.clone(), Arc::clone(&stream_provider));
        let drop_notify_destination = Arc::clone(&notify_destination);
        let data_object: IDataObject =
            LazyPathFileDragDataObject { staged_state, drag_state: Arc::clone(&drag_state), notify_destination, finalize_drag: Arc::clone(&finalize_drag) }
                .into();
        let drop_source: IDropSource = FileDropSource { drag_state, notify_destination: drop_notify_destination, finalize_drag }.into();
        let mut effect = DROPEFFECT(0);
        let result = unsafe { DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY, &mut effect as *mut DROPEFFECT) };

        if result == DRAGDROP_S_CANCEL {
            return Ok(NativeFileDragOutcome::Cancelled);
        }
        if result.is_err() {
            return Err(NativeFileDragError::new(
                format!("Windows native drag failed: 0x{:08X}", result.0 as u32),
                Some("Try extracting normally while native drag-out is being checked."),
            ));
        }

        if result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE { Ok(NativeFileDragOutcome::Dropped) } else { Ok(NativeFileDragOutcome::NoDrop) }
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

    #[derive(Default)]
    struct DragState {
        released: AtomicBool,
        destination_notified: AtomicBool,
        staged: AtomicBool,
        effect: AtomicU32,
        stage_error: Mutex<Option<NativeFileDragError>>,
    }

    fn create_finalize_drag(
        staged_state: Arc<Mutex<Option<StagedFileDrag>>>,
        drag_state: Arc<DragState>,
        items: Vec<NativeFileDragItem>,
        stream_provider: NativeFileDragStreamProvider,
    ) -> FinalizeDrag {
        Arc::new(move || {
            let mut staged_state = staged_state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let staged_drag = staged_state.as_mut().ok_or_else(|| NativeFileDragError::new("Windows drag staging state is unavailable.", None::<String>))?;
            if !drag_state.staged.load(Ordering::Acquire) {
                staged_drag.stage_items(&items, Arc::clone(&stream_provider))?;
                drag_state.staged.store(true, Ordering::Release);
            }
            Ok(())
        })
    }

    #[implement(IDataObject)]
    struct LazyPathFileDragDataObject {
        staged_state: Arc<Mutex<Option<StagedFileDrag>>>,
        drag_state: Arc<DragState>,
        notify_destination: DestinationNotifier,
        finalize_drag: FinalizeDrag,
    }

    impl IDataObject_Impl for LazyPathFileDragDataObject_Impl {
        fn GetData(&self, pformatetcin: *const FORMATETC) -> WindowsResult<STGMEDIUM> {
            let format = unsafe { pformatetcin.as_ref() }.ok_or_else(|| WindowsError::from_hresult(DV_E_FORMATETC))?;
            if !is_file_drop_format(format) {
                return Err(WindowsError::from_hresult(DV_E_FORMATETC));
            }

            let paths = self.paths_for_request().map_err(|error| {
                *self.drag_state.stage_error.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(error);
                WindowsError::from_hresult(E_FAIL)
            })?;
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

        fn SetData(&self, _pformatetc: *const FORMATETC, _pmedium: *const STGMEDIUM, _frelease: BOOL) -> WindowsResult<()> {
            Err(WindowsError::from_hresult(E_NOTIMPL))
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

    impl LazyPathFileDragDataObject {
        fn paths_for_request(&self) -> Result<Vec<PathBuf>, NativeFileDragError> {
            if !self.drag_state.released.load(Ordering::Acquire) {
                let staged_state = self.staged_state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let staged_drag =
                    staged_state.as_ref().ok_or_else(|| NativeFileDragError::new("Windows drag staging state is unavailable.", None::<String>))?;
                return Ok(vec![staged_drag.root_path().to_path_buf()]);
            }

            if !self.drag_state.destination_notified.swap(true, Ordering::AcqRel) {
                (self.notify_destination)();
            }
            (self.finalize_drag)()?;
            let staged_state = self.staged_state.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let staged_drag = staged_state.as_ref().ok_or_else(|| NativeFileDragError::new("Windows drag staging state is unavailable.", None::<String>))?;
            Ok(staged_drag.drag_paths().to_vec())
        }
    }

    #[implement(IDropSource)]
    struct FileDropSource {
        drag_state: Arc<DragState>,
        notify_destination: DestinationNotifier,
        finalize_drag: FinalizeDrag,
    }

    impl IDropSource_Impl for FileDropSource_Impl {
        fn QueryContinueDrag(&self, fescapepressed: BOOL, grfkeystate: ::windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS) -> HRESULT {
            if fescapepressed.as_bool() {
                return DRAGDROP_S_CANCEL;
            }
            if (grfkeystate & ::windows::Win32::System::SystemServices::MK_LBUTTON).0 == 0 {
                return self.complete_drop();
            }
            S_OK
        }

        fn GiveFeedback(&self, dweffect: DROPEFFECT) -> HRESULT {
            self.drag_state.effect.store(dweffect.0, Ordering::Release);
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    impl FileDropSource {
        fn complete_drop(&self) -> HRESULT {
            if self.drag_state.effect.load(Ordering::Acquire) == DROPEFFECT_NONE.0 {
                return DRAGDROP_S_CANCEL;
            }
            self.drag_state.released.store(true, Ordering::Release);
            if !self.drag_state.destination_notified.swap(true, Ordering::AcqRel) {
                (self.notify_destination)();
            }
            if let Err(error) = (self.finalize_drag)() {
                *self.drag_state.stage_error.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(error);
                return DRAGDROP_S_CANCEL;
            }
            DRAGDROP_S_DROP
        }
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
    mod tests {
        use super::{
            DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DROPEFFECT_COPY, DragState, FileDropSource, LazyPathFileDragDataObject, create_finalize_drag, file_drop_names,
        };
        use crate::platform::{NativeFileDragError, NativeFileDragItem, NativeFileDragStreamProvider, staged_file_drag::StagedFileDrag};
        use std::{
            path::PathBuf,
            sync::{
                Arc, Mutex,
                atomic::{AtomicUsize, Ordering},
            },
        };

        #[test]
        fn file_drop_names_are_utf16_and_double_terminated() {
            let names = file_drop_names(&[PathBuf::from(r"C:\temp\資料📦.txt")]);

            assert_eq!(names.last(), Some(&0));
            assert_eq!(names.iter().filter(|value| **value == 0).count(), 2);
            assert_eq!(String::from_utf16(&names[..names.len() - 2]).unwrap(), r"C:\temp\資料📦.txt");
        }

        #[test]
        fn drag_data_does_not_stage_until_the_destination_requests_it() {
            let stream_calls = Arc::new(AtomicUsize::new(0));
            let stream_calls_for_provider = Arc::clone(&stream_calls);
            let provider: NativeFileDragStreamProvider = Arc::new(move |_, output| {
                stream_calls_for_provider.fetch_add(1, Ordering::Relaxed);
                output.write_all(b"payload").map_err(|error| NativeFileDragError::new(error.to_string(), None::<String>))?;
                Ok(7)
            });
            let items = vec![NativeFileDragItem {
                entry_path: "entry.txt".to_owned(),
                display_path: "entry.txt".to_owned(),
                size: Some(7),
                modified_unix_seconds: None,
            }];
            let staged = StagedFileDrag::prepare("Windows", &items).expect("prepare drag root");
            let root = staged.root_path().to_path_buf();
            let staged_state = Arc::new(Mutex::new(Some(staged)));
            let drag_state = Arc::new(DragState::default());
            let finalize_drag = create_finalize_drag(Arc::clone(&staged_state), Arc::clone(&drag_state), items.clone(), Arc::clone(&provider));
            let object = LazyPathFileDragDataObject { staged_state, drag_state, notify_destination: Arc::new(|| {}), finalize_drag };

            assert_eq!(object.paths_for_request().unwrap(), vec![root.clone()]);
            assert_eq!(stream_calls.load(Ordering::Relaxed), 0);
            object.drag_state.released.store(true, Ordering::Release);
            let final_paths = object.paths_for_request().unwrap();

            assert_eq!(final_paths, vec![root.join("entry.txt")]);
            assert_eq!(stream_calls.load(Ordering::Relaxed), 1);
            assert_eq!(std::fs::read(root.join("entry.txt")).unwrap(), b"payload");
        }

        #[test]
        fn accepted_drop_stages_before_drag_returns() {
            let stream_calls = Arc::new(AtomicUsize::new(0));
            let stream_calls_for_provider = Arc::clone(&stream_calls);
            let provider: NativeFileDragStreamProvider = Arc::new(move |_, output| {
                stream_calls_for_provider.fetch_add(1, Ordering::Relaxed);
                output.write_all(b"payload").map_err(|error| NativeFileDragError::new(error.to_string(), None::<String>))?;
                Ok(7)
            });
            let items = vec![NativeFileDragItem {
                entry_path: "entry.txt".to_owned(),
                display_path: "entry.txt".to_owned(),
                size: Some(7),
                modified_unix_seconds: None,
            }];
            let staged = StagedFileDrag::prepare("Windows", &items).expect("prepare drag root");
            let root = staged.root_path().to_path_buf();
            let staged_state = Arc::new(Mutex::new(Some(staged)));
            let drag_state = Arc::new(DragState::default());
            let finalize_drag = create_finalize_drag(Arc::clone(&staged_state), Arc::clone(&drag_state), items, Arc::clone(&provider));
            let notifications = Arc::new(AtomicUsize::new(0));
            let notifications_for_callback = Arc::clone(&notifications);
            let source = FileDropSource {
                drag_state: Arc::clone(&drag_state),
                notify_destination: Arc::new(move || {
                    notifications_for_callback.fetch_add(1, Ordering::Relaxed);
                }),
                finalize_drag,
            };

            assert_eq!(source.complete_drop(), DRAGDROP_S_CANCEL);
            drag_state.effect.store(DROPEFFECT_COPY.0, Ordering::Release);
            assert_eq!(source.complete_drop(), DRAGDROP_S_DROP);
            assert_eq!(notifications.load(Ordering::Relaxed), 1);
            assert_eq!(stream_calls.load(Ordering::Relaxed), 1);
            assert!(drag_state.released.load(Ordering::Acquire));
            assert!(drag_state.staged.load(Ordering::Acquire));
            assert_eq!(std::fs::read(root.join("entry.txt")).unwrap(), b"payload");
        }
    }
}
