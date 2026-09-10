#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
mod macos;

pub(crate) mod archive_error;
mod job_kind;
mod source_metadata;

pub(crate) use archive_error::map_archive_browser_error;
pub(crate) use source_metadata::{IdentityCache, source_platform_metadata, source_table_column_ids};

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod staged_file_drag;

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows_drag_path;

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
compile_error!("ZManager Desktop requires a NativePlatform adapter for this operating system");

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use tauri::{Builder, Wry};

use crate::dto::{SystemFileIconDto, SystemFileIconRequestEntry};
use crate::native_launch_inbox::NativeLaunchInbox;

pub(crate) fn destination_identity(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    #[cfg(target_os = "windows")]
    {
        value.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        value
    }
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultHandlerRequest {
    pub action: DefaultHandlerAction,
    pub extensions: Vec<String>,
    pub bundle_id: String,
    pub handlers: Option<HashMap<String, String>>,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DefaultHandlerAction {
    Status,
    Set,
    Restore,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultHandlerEntry {
    pub file_extension: String,
    pub content_type: Option<String>,
    pub handler_bundle_id: Option<String>,
    pub is_current_application: bool,
    pub error_code: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct NativeFileDragCandidate {
    pub entry_path: String,
    pub size: Option<u64>,
    pub modified_unix_seconds: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct NativeFileDragItem {
    pub entry_path: String,
    pub display_path: String,
    #[allow(dead_code)]
    pub size: Option<u64>,
    #[allow(dead_code)]
    pub modified_unix_seconds: Option<u64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeFileDragOutcome {
    #[allow(dead_code)]
    Dropped,
    #[allow(dead_code)]
    Cancelled,
    #[allow(dead_code)]
    NoDrop,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeFileDragStart {
    #[allow(dead_code)]
    Pending { session_id: String },
    #[allow(dead_code)]
    Settled { outcome: NativeFileDragOutcome },
}

pub type NativeFileDragStreamProvider = Arc<dyn Fn(&str, &mut dyn Write) -> Result<u64, NativeFileDragError> + Send + Sync>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeFileDragErrorKind {
    InvalidRequest,
    UnsafeArchive,
    OperationFailed,
}

#[derive(Debug)]
pub struct NativeFileDragError {
    pub kind: NativeFileDragErrorKind,
    pub message: String,
    pub hint: Option<String>,
}

impl NativeFileDragError {
    pub fn new(message: impl Into<String>, hint: Option<impl Into<String>>) -> Self {
        Self { kind: NativeFileDragErrorKind::OperationFailed, message: message.into(), hint: hint.map(Into::into) }
    }

    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self { kind: NativeFileDragErrorKind::InvalidRequest, message: message.into(), hint: None }
    }

    pub fn unsafe_archive(message: impl Into<String>) -> Self {
        Self { kind: NativeFileDragErrorKind::UnsafeArchive, message: message.into(), hint: None }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeCapabilityOperationErrorKind {
    #[allow(dead_code)]
    NotApplicable,
    #[allow(dead_code)]
    Unavailable,
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeCapabilityOperationError {
    pub capability: &'static str,
    pub code: &'static str,
    pub kind: NativeCapabilityOperationErrorKind,
}

impl NativeCapabilityOperationError {
    #[allow(dead_code)]
    pub const fn not_applicable(capability: &'static str) -> Self {
        Self { capability, code: "notApplicable", kind: NativeCapabilityOperationErrorKind::NotApplicable }
    }

    #[allow(dead_code)]
    pub const fn unavailable(capability: &'static str, code: &'static str) -> Self {
        Self { capability, code, kind: NativeCapabilityOperationErrorKind::Unavailable }
    }

    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub const fn failed(capability: &'static str, code: &'static str) -> Self {
        Self { capability, code, kind: NativeCapabilityOperationErrorKind::Failed }
    }
}

impl std::fmt::Display for NativeCapabilityOperationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "native capability {} {} ({})",
            self.capability,
            self.code,
            match self.kind {
                NativeCapabilityOperationErrorKind::NotApplicable => "not applicable",
                NativeCapabilityOperationErrorKind::Unavailable => "unavailable",
                NativeCapabilityOperationErrorKind::Failed => "failed",
            }
        )
    }
}

impl std::error::Error for NativeCapabilityOperationError {}

pub(crate) trait CapabilityInspector {
    fn capability_observations() -> HashMap<crate::native_integration::NativeCapabilityId, crate::native_integration::NativeCapabilityObservation>;
}

pub(crate) trait MainWindowConfigurator {
    fn configure_main_window(window: &tauri::WebviewWindow<Wry>) -> Result<(), tauri::Error>;
}

pub(crate) trait SystemFileIconProvider {
    fn system_file_icons(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto>;
}

pub(crate) trait DefaultHandlerController {
    fn default_handlers(request: &DefaultHandlerRequest) -> Result<Vec<DefaultHandlerEntry>, NativeCapabilityOperationError>;
}

pub(crate) trait SecureFileProtector {
    fn set_owner_only_file_permissions(file: &File) -> Result<(), NativeCapabilityOperationError>;
}

pub(crate) trait DiagnosticLogPolicy {
    fn prefer_user_log_directory() -> bool;
}

pub(crate) trait NativeFileDragAdapter {
    fn prepare_native_file_drag(candidates: &[NativeFileDragCandidate], strip_components: usize) -> Result<Vec<NativeFileDragItem>, NativeFileDragError>;
    fn start_native_file_drag(
        window: &tauri::WebviewWindow<Wry>,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        registry: &crate::native_drag_session::NativeDragSessionRegistry,
    ) -> Result<NativeFileDragStart, NativeFileDragError>;
}

#[cfg(target_os = "windows")]
type ActivePlatform = windows::WindowsPlatform;

#[cfg(target_os = "linux")]
type ActivePlatform = linux::LinuxPlatform;

#[cfg(target_os = "macos")]
type ActivePlatform = macos::MacOsPlatform;

/// Must run before any X11 display connection is opened. See
/// [`linux::init_x11_threading`] for why.
pub fn prepare_process() {
    #[cfg(target_os = "linux")]
    linux::init_x11_threading();
}

pub fn register_platform_services(builder: Builder<Wry>) -> Builder<Wry> {
    #[cfg(target_os = "macos")]
    {
        macos::register_services(builder)
    }
    #[cfg(not(target_os = "macos"))]
    builder
}

pub fn initialize_native_host(inbox: NativeLaunchInbox, diagnostics: crate::diagnostics::DiagnosticLog) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::initialize_native_host(inbox, diagnostics)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (inbox, diagnostics);
        Ok(())
    }
}

pub fn capability_observations() -> HashMap<crate::native_integration::NativeCapabilityId, crate::native_integration::NativeCapabilityObservation> {
    ActivePlatform::capability_observations()
}

pub fn configure_main_window(window: &tauri::WebviewWindow<Wry>) -> Result<(), tauri::Error> {
    ActivePlatform::configure_main_window(window)
}

pub fn system_file_icons(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto> {
    ActivePlatform::system_file_icons(entries)
}

pub fn default_handlers(request: &DefaultHandlerRequest) -> Result<Vec<DefaultHandlerEntry>, NativeCapabilityOperationError> {
    ActivePlatform::default_handlers(request)
}

pub fn set_owner_only_file_permissions(file: &File) -> std::io::Result<()> {
    ActivePlatform::set_owner_only_file_permissions(file).map_err(|error| std::io::Error::other(format!("{}:{}", error.capability, error.code)))
}

pub fn prefer_user_diagnostic_log_directory() -> bool {
    ActivePlatform::prefer_user_log_directory()
}

pub fn prepare_native_file_drag(candidates: &[NativeFileDragCandidate], strip_components: usize) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
    ActivePlatform::prepare_native_file_drag(candidates, strip_components)
}

pub fn start_native_file_drag(
    window: &tauri::WebviewWindow<Wry>,
    items: &[NativeFileDragItem],
    stream_provider: NativeFileDragStreamProvider,
    registry: &crate::native_drag_session::NativeDragSessionRegistry,
) -> Result<NativeFileDragStart, NativeFileDragError> {
    ActivePlatform::start_native_file_drag(window, items, stream_provider, registry)
}

pub fn handle_run_event(event: &tauri::RunEvent, inbox: &NativeLaunchInbox) {
    #[cfg(target_os = "macos")]
    macos::handle_run_event(event, inbox);
    #[cfg(not(target_os = "macos"))]
    let _ = (event, inbox);
}

pub fn shutdown() {
    #[cfg(target_os = "macos")]
    macos::shutdown();
    #[cfg(target_os = "linux")]
    staged_file_drag::cleanup_retained_drag_roots();
}

#[allow(dead_code)]
pub fn quick_action_registers_single_instance(is_normal_singleton: bool) -> bool {
    if cfg!(target_os = "linux") { true } else { is_normal_singleton }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_platform_declares_each_cross_platform_capability_family() {
        fn assert_platform<T>()
        where
            T: CapabilityInspector
                + MainWindowConfigurator
                + SystemFileIconProvider
                + DefaultHandlerController
                + SecureFileProtector
                + DiagnosticLogPolicy
                + NativeFileDragAdapter,
        {
        }

        assert_platform::<ActivePlatform>();
    }

    #[cfg(unix)]
    #[test]
    fn successful_secure_file_protection_enforces_owner_only_mode() {
        use std::os::unix::fs::PermissionsExt as _;

        let path = std::env::temp_dir().join(format!("zmanager-secure-file-contract-{}", std::process::id()));
        let file = std::fs::OpenOptions::new().create(true).truncate(true).write(true).open(&path).expect("test file should be created");
        set_owner_only_file_permissions(&file).expect("owner-only protection should succeed");
        let mode = std::fs::metadata(&path).expect("protected file should exist").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_file(path);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_secure_file_protection_never_reports_false_success() {
        let path = std::env::temp_dir().join(format!("zmanager-secure-file-contract-{}", std::process::id()));
        let file = std::fs::File::create(&path).expect("test file should be created");
        let error = ActivePlatform::set_owner_only_file_permissions(&file).expect_err("missing ACL implementation must be explicit");
        assert_eq!(error.kind, NativeCapabilityOperationErrorKind::Unavailable);
        let _ = std::fs::remove_file(path);
    }
}
