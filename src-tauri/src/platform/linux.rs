use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use gio::prelude::*;
use gtk::prelude::*;
use tauri::Wry;

use super::{
    CapabilityInspector, DefaultHandlerController, DefaultHandlerEntry, DefaultHandlerRequest, DiagnosticLogPolicy, MainWindowConfigurator,
    NativeCapabilityOperationError, NativeFileDragAdapter, NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem, NativeFileDragJobContext,
    NativeFileDragOutcome, NativeFileDragStart, NativeFileDragStreamProvider, SecureFileProtector, SystemFileIconProvider,
    staged_file_drag::{PosixDragPathPolicy, StagedFileDrag, prepare_posix_drag_items},
};
use crate::dto::{SystemFileIconDto, SystemFileIconRequestEntry};

/// Linux-specific shell integration surface.
///
/// This module is intentionally isolated so MIME and desktop packaging concerns
/// stay platform-owned and out of command payload handling.
pub struct LinuxPlatform;

impl DiagnosticLogPolicy for LinuxPlatform {
    fn prefer_user_log_directory() -> bool {
        false
    }
}

impl CapabilityInspector for LinuxPlatform {
    fn capability_observations()
    -> std::collections::HashMap<crate::native_integration::NativeCapabilityId, crate::native_integration::NativeCapabilityObservation> {
        use crate::native_integration::{NativeCapabilityId, NativeCapabilityObservation, NativeCapabilityPackageState, NativeCapabilityRuntimeState};
        [NativeCapabilityId::ShellSelectedItemActions, NativeCapabilityId::ShellBackgroundActions, NativeCapabilityId::SecureLocalFileProtection]
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

impl MainWindowConfigurator for LinuxPlatform {
    fn configure_main_window(window: &tauri::WebviewWindow<Wry>) -> Result<(), tauri::Error> {
        install_lenient_x11_error_handler();
        window.set_decorations(false)
    }
}

/// Xlib assumes single-threaded use of a display connection unless told
/// otherwise. Tauri drives X11 from more than one thread (the GTK main loop
/// alongside the WebKitGTK and embedded-WebDriver threads), so once an X
/// error handler returns instead of aborting, a reply that was already in
/// flight on another thread can land out of order. libX11's XCB layer
/// treats that as unrecoverable and hard-aborts the process itself ("Unknown
/// sequence number while processing queue... XInitThreads has not been
/// called"), bypassing any error handler entirely. Must run before the X11
/// display is opened, so this is called at process startup rather than from
/// [`MainWindowConfigurator::configure_main_window`].
pub(crate) fn init_x11_threading() {
    unsafe {
        x11::xlib::XInitThreads();
    }
}

/// GDK's default X11 error handler treats any unhandled error as fatal and
/// aborts the process. Some window managers and X servers (observed with the
/// Xvfb builds on GitHub's Linux runners) reply BadImplementation to
/// otherwise-benign property queries GDK issues for window-state round trips
/// (resizable flag, position, min-size). Replacing the handler after GTK has
/// opened the display keeps a single noncompliant X reply from crashing the
/// whole app; the request that failed simply has no effect. Safe to do this
/// only because [`init_x11_threading`] has already run.
fn install_lenient_x11_error_handler() {
    use std::sync::Once;

    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| unsafe {
        x11::xlib::XSetErrorHandler(Some(log_and_ignore_x11_error));
    });
}

unsafe extern "C" fn log_and_ignore_x11_error(_display: *mut x11::xlib::Display, event: *mut x11::xlib::XErrorEvent) -> std::os::raw::c_int {
    if let Some(event) = unsafe { event.as_ref() } {
        eprintln!(
            "Ignoring X11 error from the display server (request {}, minor {}, error code {}) instead of aborting",
            event.request_code, event.minor_code, event.error_code
        );
    }
    0
}

impl SystemFileIconProvider for LinuxPlatform {
    fn system_file_icons(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto> {
        entries
            .iter()
            .map(|entry| SystemFileIconDto {
                key: entry.key.clone(),
                // Linux file managers/theme icons are resolved by the shell. Touch the
                // request fields so DTO drift is caught even though we do not return
                // per-file icon bitmaps on this platform.
                data_url: linux_system_file_icon_data_url(entry),
            })
            .collect()
    }
}

impl DefaultHandlerController for LinuxPlatform {
    fn default_handlers(_request: &DefaultHandlerRequest) -> Result<Vec<DefaultHandlerEntry>, NativeCapabilityOperationError> {
        Err(NativeCapabilityOperationError::not_applicable("defaultHandlerControl"))
    }
}

impl SecureFileProtector for LinuxPlatform {
    fn set_owner_only_file_permissions(file: &std::fs::File) -> Result<(), NativeCapabilityOperationError> {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| NativeCapabilityOperationError::failed("secureLocalFileProtection", "permissionUpdateFailed"))
    }
}

impl NativeFileDragAdapter for LinuxPlatform {
    fn prepare_native_file_drag(candidates: &[NativeFileDragCandidate], strip_components: usize) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
        prepare_posix_drag_items(
            candidates,
            strip_components,
            PosixDragPathPolicy { platform_label: "Linux", collision_case_sensitive: true, max_component_bytes: Some(255) },
        )
    }

    fn start_native_file_drag(
        _window: &tauri::WebviewWindow<Wry>,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        _context: NativeFileDragJobContext<'_>,
    ) -> Result<NativeFileDragStart, NativeFileDragError> {
        if items.is_empty() {
            return Err(NativeFileDragError::new("No archive files are available to drag.", None::<String>));
        }

        let staged_drag = StagedFileDrag::create("Linux", items, stream_provider)?;
        Ok(NativeFileDragStart::Settled { outcome: linux_file_drag::start_drag(staged_drag)? })
    }
}

fn linux_system_file_icon_data_url(entry: &SystemFileIconRequestEntry) -> Option<String> {
    let _lookup_key = if entry.is_directory { "inode/directory" } else { entry.path.trim() };

    None
}

mod linux_file_drag {
    use super::*;

    const URI_LIST_TARGET_INFO: u32 = 1;
    const GNOME_COPIED_FILES_TARGET_INFO: u32 = 2;
    const URI_LIST_TARGET: &str = "text/uri-list";
    const GNOME_COPIED_FILES_TARGET: &str = "x-special/gnome-copied-files";

    fn gnome_copied_files_payload(uris: &[String]) -> String {
        format!("copy\n{}\n", uris.join("\n"))
    }

    fn drag_selected_copy_action(selected_action: gdk::DragAction) -> bool {
        selected_action.contains(gdk::DragAction::COPY)
    }

    pub fn start_drag(staged_drag: StagedFileDrag) -> Result<NativeFileDragOutcome, NativeFileDragError> {
        if gtk::init().is_err() {
            return Err(NativeFileDragError::new(
                "Unable to initialize Linux drag-out.",
                Some("Start ZManager from a graphical desktop session and try again."),
            ));
        }

        let uris = staged_drag.drag_paths().iter().map(|path| gio::File::for_path(path).uri().to_string()).collect::<Vec<_>>();
        if uris.is_empty() {
            return Err(NativeFileDragError::new("No staged files are available to drag.", None::<String>));
        }

        let drag_finished = Rc::new(Cell::new(false));
        let drag_failed = Rc::new(Cell::new(false));
        let dropped = Rc::new(Cell::new(false));
        let staged_drag = Rc::new(RefCell::new(Some(staged_drag)));
        let window = gtk::Window::new(gtk::WindowType::Popup);
        window.set_default_size(1, 1);
        window.set_decorated(false);
        window.set_keep_above(true);

        let source = gtk::EventBox::new();
        source.set_visible_window(false);
        window.add(&source);
        window.show_all();

        source.drag_source_set(
            gdk::ModifierType::BUTTON1_MASK,
            &[
                gtk::TargetEntry::new(URI_LIST_TARGET, gtk::TargetFlags::OTHER_APP, URI_LIST_TARGET_INFO),
                gtk::TargetEntry::new(GNOME_COPIED_FILES_TARGET, gtk::TargetFlags::OTHER_APP, GNOME_COPIED_FILES_TARGET_INFO),
            ],
            gdk::DragAction::COPY,
        );
        source.drag_source_add_uri_targets();
        source.drag_source_set_icon_name("zmanager-desktop");

        let data_uris = uris.clone();
        source.connect_drag_data_get(move |_source, _context, selection_data, info, _time| {
            if info == GNOME_COPIED_FILES_TARGET_INFO {
                selection_data.set(&gdk::Atom::intern(GNOME_COPIED_FILES_TARGET), 8, gnome_copied_files_payload(&data_uris).as_bytes());
                return;
            }

            let uri_refs = data_uris.iter().map(String::as_str).collect::<Vec<_>>();
            selection_data.set_uris(&uri_refs);
        });

        let drag_finished_for_end = Rc::clone(&drag_finished);
        let drag_failed_for_end = Rc::clone(&drag_failed);
        let dropped_for_end = Rc::clone(&dropped);
        let staged_drag_for_end = Rc::clone(&staged_drag);
        source.connect_drag_end(move |_source, context| {
            let was_dropped = !drag_failed_for_end.get() && drag_selected_copy_action(context.selected_action());
            dropped_for_end.set(was_dropped);
            drag_finished_for_end.set(true);
            if let Some(staged_drag) = staged_drag_for_end.borrow_mut().take()
                && was_dropped
            {
                staged_drag.keep_for_file_manager_copy();
            }
        });

        let drag_finished_for_failed = Rc::clone(&drag_finished);
        let drag_failed_for_failed = Rc::clone(&drag_failed);
        let staged_drag_for_failed = Rc::clone(&staged_drag);
        source.connect_drag_failed(move |_source, _context, _result| {
            drag_failed_for_failed.set(true);
            drag_finished_for_failed.set(true);
            let _ = staged_drag_for_failed.borrow_mut().take();
            glib::Propagation::Proceed
        });

        let target_list = gtk::TargetList::new(&[
            gtk::TargetEntry::new(URI_LIST_TARGET, gtk::TargetFlags::OTHER_APP, URI_LIST_TARGET_INFO),
            gtk::TargetEntry::new(GNOME_COPIED_FILES_TARGET, gtk::TargetFlags::OTHER_APP, GNOME_COPIED_FILES_TARGET_INFO),
        ]);
        let current_event = gtk::current_event();
        let Some(_context) = source.drag_begin_with_coordinates(&target_list, gdk::DragAction::COPY, 1, current_event.as_ref(), -1, -1) else {
            let _ = staged_drag.borrow_mut().take();
            window.close();
            return Err(NativeFileDragError::new(
                "Linux file drag-out could not be started.",
                Some("Try dragging again, or use Extract... if the file manager rejects the drag."),
            ));
        };

        while !drag_finished.get() {
            gtk::main_iteration_do(true);
        }

        let _ = staged_drag.borrow_mut().take();
        window.close();

        if dropped.get() { Ok(NativeFileDragOutcome::Dropped) } else { Ok(NativeFileDragOutcome::NoDrop) }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn linux_drag_success_requires_selected_copy_action() {
            assert!(drag_selected_copy_action(gdk::DragAction::COPY));
            assert!(!drag_selected_copy_action(gdk::DragAction::empty()));
            assert!(!drag_selected_copy_action(gdk::DragAction::MOVE));
        }

        #[test]
        fn gnome_copied_files_payload_uses_copy_header_and_uri_lines() {
            let payload = gnome_copied_files_payload(&["file:///tmp/zmanager/a.txt".to_string(), "file:///tmp/zmanager/b.txt".to_string()]);

            assert_eq!(payload, "copy\nfile:///tmp/zmanager/a.txt\nfile:///tmp/zmanager/b.txt\n");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, fs, sync::Arc};

    use super::*;

    #[test]
    fn linux_staged_drag_writes_nested_files_and_cleans_up() {
        let payloads = Arc::new(HashMap::from([("docs/readme.txt".to_string(), b"drag payload".to_vec()), ("root.txt".to_string(), b"root payload".to_vec())]));
        let provider_payloads = Arc::clone(&payloads);
        let provider: NativeFileDragStreamProvider = Arc::new(move |entry_path, writer| {
            let bytes =
                provider_payloads.get(entry_path).ok_or_else(|| NativeFileDragError::new(format!("missing test payload for {entry_path}"), None::<String>))?;
            writer.write_all(bytes).map_err(|error| NativeFileDragError::new(format!("unable to write test payload: {error}"), None::<String>))?;
            Ok(bytes.len() as u64)
        });

        let staged = StagedFileDrag::create(
            "Linux",
            &[
                NativeFileDragItem {
                    entry_path: "docs/readme.txt".to_string(),
                    display_path: "docs\\readme.txt".to_string(),
                    size: Some(12),
                    modified_unix_seconds: None,
                },
                NativeFileDragItem { entry_path: "root.txt".to_string(), display_path: "root.txt".to_string(), size: Some(12), modified_unix_seconds: None },
            ],
            provider,
        )
        .expect("stage drag files");
        let root = staged.root().expect("test staged root").to_path_buf();
        let nested_file_path = root.join("docs/readme.txt");
        let root_file_path = root.join("root.txt");

        assert_eq!(fs::read(&nested_file_path).expect("read staged nested file"), b"drag payload");
        assert_eq!(fs::read(&root_file_path).expect("read staged root file"), b"root payload");
        assert_eq!(staged.drag_paths(), vec![root.join("docs"), root.join("root.txt")]);
        drop(staged);
        assert!(!root.exists(), "staged drag root should be cleaned up");
    }

    #[test]
    fn linux_drag_policy_rejects_traversal_but_allows_windows_specific_names() {
        let items =
            LinuxPlatform::prepare_native_file_drag(&[candidate("root/folder/report?.txt")], 1).expect("Linux should allow question marks in file names");
        assert_eq!(items[0].display_path, "folder/report?.txt");

        for (path, strip_components) in [("../escape.txt", 0), ("folder/./file.txt", 0), ("folder/file.txt", 2), ("folder/\0file.txt", 0)] {
            assert!(LinuxPlatform::prepare_native_file_drag(&[candidate(path)], strip_components,).is_err(), "{path} should be rejected");
        }
    }

    #[test]
    fn linux_drag_policy_uses_case_sensitive_collisions() {
        let case_distinct = LinuxPlatform::prepare_native_file_drag(&[candidate("one/Foo.txt"), candidate("two/foo.txt")], 1)
            .expect("case-distinct Linux paths should coexist");
        assert_eq!(case_distinct.iter().map(|item| item.display_path.as_str()).collect::<Vec<_>>(), vec!["Foo.txt", "foo.txt"]);

        assert!(LinuxPlatform::prepare_native_file_drag(&[candidate("one/file.txt"), candidate("two/file.txt")], 1,).is_err());
    }

    fn candidate(path: &str) -> NativeFileDragCandidate {
        NativeFileDragCandidate { entry_path: path.to_string(), size: Some(1), modified_unix_seconds: None }
    }
}
