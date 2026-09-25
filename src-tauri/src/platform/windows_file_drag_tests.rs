use std::{
    collections::HashMap,
    fs,
    mem::{size_of, zeroed},
    path::{Path, PathBuf},
    process::Command,
    ptr::null_mut,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use ::windows::{
    Win32::{
        Foundation::{E_FAIL, HWND, POINTL},
        System::{
            Com::{DVASPECT_CONTENT, FORMATETC, IDataObject, TYMED_HGLOBAL},
            Ole::{DROPEFFECT, IDropTarget, IDropTarget_Impl, RegisterDragDrop, RevokeDragDrop},
            SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
        },
        UI::Shell::{BHID_SFUIObject, IShellItem, SHCreateItemFromParsingName},
    },
    core::{HSTRING, Ref, Result as WindowsResult, implement},
};
use windows_sys::Win32::{
    Foundation::HWND as SysHwnd,
    System::Threading::GetCurrentThreadId,
    UI::{
        Input::KeyboardAndMouse::{
            INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEINPUT, SendInput,
        },
        Shell::DragQueryFileW,
        WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, EnumWindows, GUITHREADINFO, GetClassNameW, GetGUIThreadInfo, GetMessageW,
            GetSystemMetrics, GetWindowRect, GetWindowTextW, IsWindowVisible, MSG, MoveWindow, PM_REMOVE, PeekMessageW, PostMessageW, PostThreadMessageW,
            RegisterClassW, SM_CXSCREEN, SM_CYSCREEN, SMTO_ABORTIFHUNG, SendMessageTimeoutW, SetForegroundWindow, TranslateMessage, WM_CLOSE, WM_NULL, WM_QUIT,
            WNDCLASSW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
        },
    },
};

use super::*;
use crate::platform::staged_file_drag::cleanup_retained_drag_roots;

const FIXTURE: &[(&str, &str, &[u8])] =
    &[("archive/docs/readme.txt", "docs\\readme.txt", b"nested payload"), ("archive/root.txt", "root.txt", b"root payload")];

fn fixture_items() -> Vec<NativeFileDragItem> {
    FIXTURE
        .iter()
        .map(|(entry_path, display_path, bytes)| NativeFileDragItem {
            entry_path: (*entry_path).to_owned(),
            display_path: (*display_path).to_owned(),
            size: Some(bytes.len() as u64),
            modified_unix_seconds: None,
        })
        .collect()
}

type StreamProbe = Arc<dyn Fn() + Send + Sync>;

/// Serves fixture bytes, counting calls and running `probe` before each entry
/// so tests can observe the desktop while extraction is in progress.
fn fixture_provider(delay: Duration, probe: Option<StreamProbe>) -> (NativeFileDragStreamProvider, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let provider_calls = Arc::clone(&calls);
    let payloads = FIXTURE.iter().map(|(entry_path, _, bytes)| ((*entry_path).to_owned(), bytes.to_vec())).collect::<HashMap<_, _>>();
    let provider: NativeFileDragStreamProvider = Arc::new(move |entry_path, writer| {
        provider_calls.fetch_add(1, Ordering::SeqCst);
        if let Some(probe) = &probe {
            probe();
        }
        thread::sleep(delay);
        let bytes = payloads.get(entry_path).ok_or_else(|| NativeFileDragError::new(format!("missing fixture {entry_path}"), None::<String>))?;
        writer.write_all(bytes).map_err(|error| NativeFileDragError::new(error.to_string(), None::<String>))?;
        Ok(bytes.len() as u64)
    });
    (provider, calls)
}

fn counting_notifier() -> (DestinationNotifier, Arc<AtomicUsize>) {
    let count = Arc::new(AtomicUsize::new(0));
    let notifier_count = Arc::clone(&count);
    let notifier: DestinationNotifier = Arc::new(move || {
        notifier_count.fetch_add(1, Ordering::SeqCst);
    });
    (notifier, count)
}

fn new_payload(provider: NativeFileDragStreamProvider, notify: DestinationNotifier) -> Arc<DragPayload> {
    let items = fixture_items();
    let staged = StagedFileDrag::prepare("Windows", &items).expect("prepare drag root");
    Arc::new(DragPayload::new(staged, items, provider, notify))
}

fn staged_root(payload: &DragPayload) -> PathBuf {
    payload.lock_state().staged.as_ref().expect("staged root").root_path().to_path_buf()
}

fn nonce() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or_default()
}

fn unique_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("zmanager-drag-test-{label}-{}-{}", std::process::id(), nonce()));
    fs::create_dir_all(&path).expect("create test directory");
    path
}

fn assert_fixture_extracted_into(directory: &Path) {
    for (_, display_path, bytes) in FIXTURE {
        let path = directory.join(display_path);
        assert_eq!(fs::read(&path).unwrap_or_else(|error| panic!("read {path:?}: {error}")), *bytes, "{path:?}");
    }
}

fn fixture_extracted_into(directory: &Path) -> bool {
    FIXTURE.iter().all(|(_, display_path, bytes)| fs::read(directory.join(display_path)).is_ok_and(|content| content == *bytes))
}

/// Pumps this thread's messages until `done` holds, so shell drop targets
/// that finish on a background thread can call back into this apartment.
fn pump_until(timeout: Duration, mut done: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if done() {
            return true;
        }
        unsafe {
            let mut message: MSG = zeroed();
            while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        thread::sleep(Duration::from_millis(20));
    }
    done()
}

fn file_drop_format_request() -> FORMATETC {
    FORMATETC { cfFormat: CF_HDROP.0, ptd: null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 }
}

fn hdrop_paths(data_object: &IDataObject) -> WindowsResult<Vec<PathBuf>> {
    let mut medium = unsafe { data_object.GetData(&file_drop_format_request())? };
    let hdrop = unsafe { medium.u.hGlobal.0 };
    let count = unsafe { DragQueryFileW(hdrop, u32::MAX, null_mut(), 0) };
    let paths = (0..count)
        .map(|index| {
            let length = unsafe { DragQueryFileW(hdrop, index, null_mut(), 0) } as usize;
            let mut buffer = vec![0_u16; length + 1];
            unsafe { DragQueryFileW(hdrop, index, buffer.as_mut_ptr(), buffer.len() as u32) };
            PathBuf::from(String::from_utf16_lossy(&buffer[..length]))
        })
        .collect();
    unsafe { ReleaseStgMedium(&mut medium) };
    Ok(paths)
}

#[test]
fn file_drop_names_are_utf16_and_double_terminated() {
    let names = file_drop_names(&[PathBuf::from(r"C:\temp\資料📦.txt")]);

    assert_eq!(names.last(), Some(&0));
    assert_eq!(names.iter().filter(|value| **value == 0).count(), 2);
    assert_eq!(String::from_utf16(&names[..names.len() - 2]).unwrap(), r"C:\temp\資料📦.txt");
}

#[test]
fn hovering_targets_only_see_the_empty_root() {
    let (provider, stream_calls) = fixture_provider(Duration::ZERO, None);
    let (notify, notifications) = counting_notifier();
    let payload = new_payload(provider, notify);
    let root = staged_root(&payload);

    assert_eq!(payload.file_drop_paths().unwrap(), vec![root.clone()]);
    assert_eq!(payload.file_drop_paths().unwrap(), vec![root.clone()]);
    assert_eq!(stream_calls.load(Ordering::SeqCst), 0);
    assert_eq!(notifications.load(Ordering::SeqCst), 0);
    assert_eq!(fs::read_dir(&root).unwrap().count(), 0, "nothing may be extracted while the pointer is moving");
}

#[test]
fn release_accepts_the_drop_without_extracting_inside_the_drag_loop() {
    let (provider, stream_calls) = fixture_provider(Duration::ZERO, None);
    let (notify, notifications) = counting_notifier();
    let payload = new_payload(provider, notify);

    assert_eq!(payload.release(), DRAGDROP_S_CANCEL, "a release over a refusing target cancels");
    assert!(!payload.released.load(Ordering::SeqCst));

    payload.effect.store(DROPEFFECT_COPY.0, Ordering::SeqCst);
    assert_eq!(payload.release(), DRAGDROP_S_DROP);
    assert!(payload.released.load(Ordering::SeqCst));
    assert_eq!(stream_calls.load(Ordering::SeqCst), 0, "the drag loop must not extract");
    assert_eq!(notifications.load(Ordering::SeqCst), 0, "the task window opens only when the destination asks for data");
}

#[test]
fn the_destinations_drop_request_extracts_once_and_presents_the_task_once() {
    let (provider, stream_calls) = fixture_provider(Duration::ZERO, None);
    let (notify, notifications) = counting_notifier();
    let payload = new_payload(provider, notify);
    let root = staged_root(&payload);
    payload.effect.store(DROPEFFECT_MOVE.0, Ordering::SeqCst);
    assert_eq!(payload.release(), DRAGDROP_S_DROP);

    let expected = vec![root.join("docs"), root.join("root.txt")];
    assert_eq!(payload.file_drop_paths().unwrap(), expected);
    assert_eq!(payload.file_drop_paths().unwrap(), expected);
    assert_eq!(stream_calls.load(Ordering::SeqCst), FIXTURE.len());
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
    assert_fixture_extracted_into(&root);

    assert_eq!(payload.settle(Ok(DragLoopResult::Dropped)).unwrap(), NativeFileDragOutcome::Dropped);
    assert!(root.exists(), "a delivered root is retained for the destination's copy");
    cleanup_retained_drag_roots();
    assert!(!root.exists());
}

#[test]
fn a_delivered_payload_is_dropped_even_when_the_loop_reports_no_effect() {
    // Explorer returns DROPEFFECT_NONE from DoDragDrop after an optimized move.
    let (provider, _) = fixture_provider(Duration::ZERO, None);
    let (notify, _) = counting_notifier();
    let payload = new_payload(provider, notify);
    payload.effect.store(DROPEFFECT_MOVE.0, Ordering::SeqCst);
    assert_eq!(payload.release(), DRAGDROP_S_DROP);
    payload.file_drop_paths().unwrap();

    assert_eq!(payload.settle(Ok(DragLoopResult::Cancelled)).unwrap(), NativeFileDragOutcome::Dropped);
    cleanup_retained_drag_roots();
}

#[test]
fn undelivered_drags_settle_without_leaving_the_root_behind() {
    for (loop_result, expected) in [(DragLoopResult::Cancelled, NativeFileDragOutcome::Cancelled), (DragLoopResult::Dropped, NativeFileDragOutcome::NoDrop)] {
        let (provider, stream_calls) = fixture_provider(Duration::ZERO, None);
        let (notify, _) = counting_notifier();
        let payload = new_payload(provider, notify);
        let root = staged_root(&payload);

        assert_eq!(payload.settle(Ok(loop_result)).unwrap(), expected);
        assert_eq!(stream_calls.load(Ordering::SeqCst), 0);
        assert!(!root.exists(), "{loop_result:?} leaked {root:?}");
    }
}

#[test]
fn extraction_failure_fails_the_drop_request_and_the_job() {
    let provider: NativeFileDragStreamProvider = Arc::new(|_, _| Err(NativeFileDragError::new("intentional extraction failure", None::<String>)));
    let (notify, notifications) = counting_notifier();
    let payload = new_payload(provider, notify);
    let root = staged_root(&payload);
    payload.effect.store(DROPEFFECT_COPY.0, Ordering::SeqCst);
    assert_eq!(payload.release(), DRAGDROP_S_DROP);

    assert_eq!(payload.file_drop_paths(), Err(E_FAIL));
    assert_eq!(payload.file_drop_paths(), Err(E_FAIL), "a failed extraction is not retried by a second request");
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
    let error = payload.settle(Ok(DragLoopResult::Dropped)).expect_err("extraction failure must surface");
    assert!(error.message.contains("intentional extraction failure"), "{}", error.message);
    assert!(!root.exists());
}

#[test]
fn com_objects_follow_the_ole_drag_contract() {
    let _ole = OleApartment::initialize().expect("initialize OLE");
    let (provider, stream_calls) = fixture_provider(Duration::ZERO, None);
    let (notify, notifications) = counting_notifier();
    let payload = new_payload(provider, notify);
    let root = staged_root(&payload);
    let data_object: IDataObject = FileDragDataObject { payload: Arc::clone(&payload) }.into();
    let drop_source: IDropSource = FileDropSource { payload: Arc::clone(&payload), input: Mutex::new(None) }.into();

    assert_eq!(unsafe { data_object.QueryGetData(&file_drop_format_request()) }, S_OK);
    assert_eq!(hdrop_paths(&data_object).unwrap(), vec![root.clone()]);
    assert_eq!(unsafe { drop_source.QueryContinueDrag(true, MK_LBUTTON) }, DRAGDROP_S_CANCEL, "escape cancels");
    assert_eq!(unsafe { drop_source.GiveFeedback(DROPEFFECT_COPY) }, DRAGDROP_S_USEDEFAULTCURSORS);
    assert_eq!(unsafe { drop_source.QueryContinueDrag(false, MODIFIERKEYS_FLAGS(0)) }, DRAGDROP_S_DROP);
    assert_eq!(stream_calls.load(Ordering::SeqCst), 0);

    assert_eq!(hdrop_paths(&data_object).unwrap(), vec![root.join("docs"), root.join("root.txt")]);
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
    assert_fixture_extracted_into(&root);
    drop((data_object, drop_source));
    payload.settle(Ok(DragLoopResult::Dropped)).unwrap();
    cleanup_retained_drag_roots();
}

fn folder_drop_target(folder: &Path) -> IDropTarget {
    let item: IShellItem = unsafe { SHCreateItemFromParsingName(&HSTRING::from(folder.as_os_str()), None) }.expect("parse folder shell item");
    unsafe { item.BindToHandler(None, &BHID_SFUIObject) }.expect("bind folder drop target")
}

/// Drives Explorer's own file-system folder drop target (the object an
/// Explorer window delegates a folder drop to) through the OLE drop sequence.
#[test]
fn explorer_folder_drop_target_receives_the_selected_entries() {
    let _ole = OleApartment::initialize().expect("initialize OLE");
    let destination = unique_dir("shell-target");
    let (provider, stream_calls) = fixture_provider(Duration::ZERO, None);
    let (notify, notifications) = counting_notifier();
    let payload = new_payload(provider, notify);
    let data_object: IDataObject = FileDragDataObject { payload: Arc::clone(&payload) }.into();
    let drop_source: IDropSource = FileDropSource { payload: Arc::clone(&payload), input: Mutex::new(None) }.into();
    let target = folder_drop_target(&destination);
    let point = POINTL { x: 0, y: 0 };

    let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE;
    unsafe { target.DragEnter(&data_object, MK_LBUTTON, point, &mut effect) }.expect("DragEnter");
    assert_ne!(effect, DROPEFFECT_NONE, "Explorer's folder target should accept the drag");
    let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE;
    unsafe { target.DragOver(MK_LBUTTON, point, &mut effect) }.expect("DragOver");
    assert_eq!(stream_calls.load(Ordering::SeqCst), 0, "hovering must not extract");

    assert_eq!(unsafe { drop_source.GiveFeedback(effect) }, DRAGDROP_S_USEDEFAULTCURSORS);
    assert_eq!(unsafe { drop_source.QueryContinueDrag(false, MODIFIERKEYS_FLAGS(0)) }, DRAGDROP_S_DROP);
    let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE;
    unsafe { target.Drop(&data_object, MODIFIERKEYS_FLAGS(0), point, &mut effect) }.expect("Drop");

    assert!(pump_until(Duration::from_secs(60), || fixture_extracted_into(&destination)), "Explorer did not place the entries in {destination:?}");
    assert_fixture_extracted_into(&destination);
    assert_eq!(stream_calls.load(Ordering::SeqCst), FIXTURE.len());
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
    drop((target, data_object, drop_source));
    assert_eq!(payload.settle(Ok(DragLoopResult::Dropped)).unwrap(), NativeFileDragOutcome::Dropped);
    cleanup_retained_drag_roots();
    let _ = fs::remove_dir_all(destination);
}

// ---- Interactive tests: real mouse input through the full DoDragDrop loop ----

#[implement(IDropTarget)]
struct ForwardingDropTarget {
    inner: IDropTarget,
    entered: Arc<AtomicBool>,
}

impl IDropTarget_Impl for ForwardingDropTarget_Impl {
    fn DragEnter(&self, pdataobj: Ref<'_, IDataObject>, grfkeystate: MODIFIERKEYS_FLAGS, pt: &POINTL, pdweffect: *mut DROPEFFECT) -> WindowsResult<()> {
        self.entered.store(true, Ordering::SeqCst);
        unsafe { self.inner.DragEnter(pdataobj.as_ref(), grfkeystate, *pt, pdweffect) }
    }

    fn DragOver(&self, grfkeystate: MODIFIERKEYS_FLAGS, pt: &POINTL, pdweffect: *mut DROPEFFECT) -> WindowsResult<()> {
        unsafe { self.inner.DragOver(grfkeystate, *pt, pdweffect) }
    }

    fn DragLeave(&self) -> WindowsResult<()> {
        unsafe { self.inner.DragLeave() }
    }

    fn Drop(&self, pdataobj: Ref<'_, IDataObject>, grfkeystate: MODIFIERKEYS_FLAGS, pt: &POINTL, pdweffect: *mut DROPEFFECT) -> WindowsResult<()> {
        unsafe { self.inner.Drop(pdataobj.as_ref(), grfkeystate, *pt, pdweffect) }
    }
}

type ScreenRect = (i32, i32, i32, i32);
type FolderDropWindow = (ScreenRect, PathBuf, Arc<AtomicBool>);

/// A UI thread standing in for the Tauri main thread: it owns the window the
/// gesture starts in and keeps dispatching messages throughout the drag.
struct UiThread {
    thread_id: u32,
    source: usize,
    drop_window: Option<usize>,
    worker: Option<thread::JoinHandle<()>>,
}

impl UiThread {
    fn spawn(source_rect: ScreenRect, drop_window: Option<FolderDropWindow>) -> Self {
        let (sender, receiver) = mpsc::channel();
        let worker = thread::spawn(move || {
            let _ole = OleApartment::initialize().expect("initialize UI thread OLE");
            let class_name = wide(&format!("ZManagerDragTest{}", nonce()));
            let class = WNDCLASSW { lpfnWndProc: Some(DefWindowProcW), lpszClassName: class_name.as_ptr(), ..unsafe { zeroed() } };
            assert_ne!(unsafe { RegisterClassW(&class) }, 0, "register test window class");
            let create = |(x, y, width, height): ScreenRect| unsafe {
                CreateWindowExW(
                    WS_EX_TOPMOST,
                    class_name.as_ptr(),
                    class_name.as_ptr(),
                    WS_POPUP | WS_VISIBLE,
                    x,
                    y,
                    width,
                    height,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null_mut(),
                )
            };
            let source = create(source_rect);
            assert!(!source.is_null(), "create source window");
            let drop_window = drop_window.map(|(rect, folder, entered)| {
                let window = create(rect);
                assert!(!window.is_null(), "create drop window");
                let target: IDropTarget = ForwardingDropTarget { inner: folder_drop_target(&folder), entered }.into();
                unsafe { RegisterDragDrop(HWND(window), &target) }.expect("register drop window");
                window
            });
            unsafe { SetForegroundWindow(source) };
            sender.send((unsafe { GetCurrentThreadId() }, source as usize, drop_window.map(|window| window as usize))).unwrap();

            let mut message: MSG = unsafe { zeroed() };
            while unsafe { GetMessageW(&mut message, null_mut(), 0, 0) } > 0 {
                unsafe {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            if let Some(window) = drop_window {
                let _ = unsafe { RevokeDragDrop(HWND(window)) };
                unsafe { DestroyWindow(window) };
            }
            unsafe { DestroyWindow(source) };
        });
        let (thread_id, source, drop_window) = receiver.recv_timeout(Duration::from_secs(30)).expect("UI thread started");
        Self { thread_id, source, drop_window, worker: Some(worker) }
    }
}

fn window_responds_within(window: usize, timeout: Duration) -> bool {
    let mut result = 0;
    unsafe { SendMessageTimeoutW(window as SysHwnd, WM_NULL, 0, 0, SMTO_ABORTIFHUNG, timeout.as_millis() as u32, &mut result) != 0 }
}

fn capture_window(thread_id: u32) -> usize {
    let mut info = GUITHREADINFO { cbSize: size_of::<GUITHREADINFO>() as u32, ..unsafe { zeroed() } };
    if unsafe { GetGUIThreadInfo(thread_id, &mut info) } == 0 {
        return 0;
    }
    info.hwndCapture as usize
}

impl Drop for UiThread {
    fn drop(&mut self) {
        unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0) };
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

fn send_mouse(flags: u32, (x, y): (i32, i32)) {
    let width = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(2);
    let height = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(2);
    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: x * 65535 / (width - 1),
                dy: y * 65535 / (height - 1),
                mouseData: 0,
                dwFlags: flags | MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    assert_eq!(unsafe { SendInput(1, &input, size_of::<INPUT>() as i32) }, 1, "SendInput needs an interactive desktop");
}

fn glide(from: (i32, i32), to: (i32, i32)) {
    const STEPS: i32 = 25;
    for step in 1..=STEPS {
        send_mouse(0, (from.0 + (to.0 - from.0) * step / STEPS, from.1 + (to.1 - from.1) * step / STEPS));
        thread::sleep(Duration::from_millis(25));
    }
}

fn center((x, y, width, height): ScreenRect) -> (i32, i32) {
    (x + width / 2, y + height / 2)
}

struct DesktopProbe {
    samples: Mutex<Vec<(bool, usize)>>,
}

/// Performs a real left-button drag from a UI-thread window to `drop_point`
/// and checks the lifecycle end to end: no extraction while dragging, an
/// uncaptured and responsive UI thread while the destination waits for
/// extraction, and the entries delivered to `destination`.
fn run_interactive_drag(ui: &UiThread, source_rect: ScreenRect, drop_point: (i32, i32), destination: &Path) {
    let probe = Arc::new(DesktopProbe { samples: Mutex::new(Vec::new()) });
    let probe_for_stream = Arc::clone(&probe);
    let ui_thread_id = ui.thread_id;
    let ui_source = ui.source;
    let stream_probe: StreamProbe = Arc::new(move || {
        let responsive = window_responds_within(ui_source, Duration::from_secs(2));
        let capture = capture_window(ui_thread_id);
        probe_for_stream.samples.lock().unwrap().push((responsive, capture));
    });
    let (provider, stream_calls) = fixture_provider(Duration::from_millis(500), Some(stream_probe));
    let (notify, notifications) = counting_notifier();
    let items = fixture_items();
    let staged = StagedFileDrag::prepare("Windows", &items).expect("prepare drag root");

    let start = center(source_rect);
    send_mouse(0, start);
    thread::sleep(Duration::from_millis(200));
    send_mouse(MOUSEEVENTF_LEFTDOWN, start);
    thread::sleep(Duration::from_millis(100));
    let drag = thread::spawn(move || start_drag(Some(ui_thread_id), staged, items, provider, notify));
    thread::sleep(Duration::from_millis(300));
    glide(start, drop_point);
    thread::sleep(Duration::from_millis(700));
    assert_eq!(stream_calls.load(Ordering::SeqCst), 0, "entries were extracted before the button was released");
    assert_eq!(notifications.load(Ordering::SeqCst), 0, "the task window was presented before the drop");
    send_mouse(MOUSEEVENTF_LEFTUP, drop_point);

    let deadline = Instant::now() + Duration::from_secs(90);
    while !drag.is_finished() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(drag.is_finished(), "DoDragDrop did not finish after the button was released");
    let outcome = drag.join().expect("drag thread").expect("drag outcome");
    assert_eq!(outcome, NativeFileDragOutcome::Dropped);
    assert_eq!(notifications.load(Ordering::SeqCst), 1);
    assert_eq!(stream_calls.load(Ordering::SeqCst), FIXTURE.len());

    let samples = probe.samples.lock().unwrap().clone();
    assert_eq!(samples.len(), FIXTURE.len());
    for (responsive, capture) in samples {
        assert!(responsive, "the UI thread stopped dispatching messages during extraction");
        assert_eq!(capture, 0, "mouse capture was still held while extracting");
    }
    let deadline = Instant::now() + Duration::from_secs(60);
    while !fixture_extracted_into(destination) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(100));
    }
    assert_fixture_extracted_into(destination);
    cleanup_retained_drag_roots();
}

#[test]
#[ignore = "moves the real mouse; run on an interactive Windows desktop with --ignored"]
fn interactive_drag_to_a_folder_drop_window_extracts_the_selection() {
    let destination = unique_dir("window-target");
    let entered = Arc::new(AtomicBool::new(false));
    let source_rect = (80, 120, 320, 320);
    let drop_rect = (560, 120, 420, 420);
    let ui = UiThread::spawn(source_rect, Some((drop_rect, destination.clone(), Arc::clone(&entered))));
    assert!(ui.drop_window.is_some());
    thread::sleep(Duration::from_millis(500));

    run_interactive_drag(&ui, source_rect, center(drop_rect), &destination);
    assert!(entered.load(Ordering::SeqCst), "the drag never reached the drop window");
    drop(ui);
    let _ = fs::remove_dir_all(destination);
}

fn find_explorer_window(folder_name: &str) -> Option<usize> {
    struct Search {
        title: String,
        found: Option<usize>,
    }
    unsafe extern "system" fn visit(window: SysHwnd, state: isize) -> i32 {
        let search = unsafe { &mut *(state as *mut Search) };
        let mut class = [0_u16; 64];
        let class_length = unsafe { GetClassNameW(window, class.as_mut_ptr(), class.len() as i32) } as usize;
        let mut title = [0_u16; 512];
        let title_length = unsafe { GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32) } as usize;
        if String::from_utf16_lossy(&class[..class_length]) == "CabinetWClass"
            && unsafe { IsWindowVisible(window) } != 0
            && String::from_utf16_lossy(&title[..title_length]).contains(&search.title)
        {
            search.found = Some(window as usize);
            return 0;
        }
        1
    }
    let mut search = Search { title: folder_name.to_owned(), found: None };
    unsafe { EnumWindows(Some(visit), &mut search as *mut Search as isize) };
    search.found
}

#[test]
#[ignore = "moves the real mouse and opens File Explorer; run on an interactive Windows desktop with --ignored"]
fn interactive_drag_into_file_explorer_extracts_the_selection() {
    let destination = unique_dir("explorer-target");
    let folder_name = destination.file_name().unwrap().to_string_lossy().into_owned();
    // explorer.exe hands the window to the running shell and exits.
    let _ = Command::new("explorer.exe").arg(&destination).status().expect("launch File Explorer");
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut explorer = None;
    while explorer.is_none() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(250));
        explorer = find_explorer_window(&folder_name);
    }
    let explorer = explorer.expect("File Explorer window for the destination") as SysHwnd;
    let explorer_rect = (560, 120, 760, 560);
    unsafe {
        MoveWindow(explorer, explorer_rect.0, explorer_rect.1, explorer_rect.2, explorer_rect.3, 1);
        SetForegroundWindow(explorer);
    }
    thread::sleep(Duration::from_secs(2));
    let mut rect = unsafe { zeroed() };
    unsafe { GetWindowRect(explorer, &mut rect) };
    // Aim below the command bar, inside the folder's item view.
    let drop_point = ((rect.left + rect.right) / 2, rect.top + (rect.bottom - rect.top) * 2 / 3);

    let source_rect = (80, 120, 320, 320);
    let ui = UiThread::spawn(source_rect, None);
    thread::sleep(Duration::from_millis(500));
    run_interactive_drag(&ui, source_rect, drop_point, &destination);
    drop(ui);
    unsafe { PostMessageW(explorer, WM_CLOSE, 0, 0) };
    let _ = fs::remove_dir_all(destination);
}
