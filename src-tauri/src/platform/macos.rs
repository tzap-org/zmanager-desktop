use std::ffi::c_void;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use serde::Serialize;
use tauri::menu::MenuItem;
use tauri::{Builder, Emitter, Manager, Wry};

use super::{
    CapabilityInspector, DefaultHandlerController, DefaultHandlerEntry, DefaultHandlerRequest, DiagnosticLogPolicy, MainWindowConfigurator,
    NativeCapabilityOperationError, NativeFileDragAdapter, NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem, NativeFileDragStart,
    NativeFileDragStreamProvider, SecureFileProtector, SystemFileIconProvider,
    staged_file_drag::{PosixDragPathPolicy, prepare_posix_drag_items},
};
use crate::dto::{SystemFileIconDto, SystemFileIconRequestEntry};
use crate::native_drag_session::NativeDragSessionRegistry;

pub struct MacOsPlatform;

impl DiagnosticLogPolicy for MacOsPlatform {
    fn prefer_user_log_directory() -> bool {
        true
    }
}

static HOST_CALLBACK_RECEIVED: AtomicBool = AtomicBool::new(false);
static APP_GROUP_AVAILABLE: AtomicBool = AtomicBool::new(false);
static NATIVE_LAUNCH_INBOX: OnceLock<crate::native_launch_inbox::NativeLaunchInbox> = OnceLock::new();
static NATIVE_DIAGNOSTICS: OnceLock<crate::diagnostics::DiagnosticLog> = OnceLock::new();

const FINDER_EXTENSION_BUNDLE_ID: &str = "org.tzap-org.zmanager.finder-extension";
const QUICKLOOK_PREVIEW_BUNDLE_ID: &str = "org.tzap-org.zmanager.quicklook-preview";
const QUICKLOOK_THUMBNAIL_BUNDLE_ID: &str = "org.tzap-org.zmanager.quicklook-thumbnail";

#[derive(Clone, Debug)]
struct MacOsExtensionProbe {
    is_installed: bool,
    is_enabled: bool,
}

static EXTENSION_PROBES: OnceLock<MacOsExtensionProbes> = OnceLock::new();

#[derive(Clone, Debug)]
struct MacOsExtensionProbes {
    finder: MacOsExtensionProbe,
    quicklook: MacOsExtensionProbe,
    spotlight: MacOsExtensionProbe,
}

fn probe_extension_status() -> &'static MacOsExtensionProbes {
    EXTENSION_PROBES.get_or_init(|| {
        let finder = probe_plugin_kit(FINDER_EXTENSION_BUNDLE_ID);
        let quicklook_preview = probe_plugin_kit(QUICKLOOK_PREVIEW_BUNDLE_ID);
        let quicklook_thumbnail = probe_plugin_kit(QUICKLOOK_THUMBNAIL_BUNDLE_ID);
        let spotlight = probe_spotlight();

        MacOsExtensionProbes {
            finder,
            quicklook: MacOsExtensionProbe {
                is_installed: quicklook_preview.is_installed || quicklook_thumbnail.is_installed,
                is_enabled: quicklook_preview.is_enabled || quicklook_thumbnail.is_enabled,
            },
            spotlight,
        }
    })
}

fn probe_plugin_kit(bundle_id: &str) -> MacOsExtensionProbe {
    probe_plugin_kit_with("/usr/bin/pluginkit", bundle_id)
}

fn probe_plugin_kit_with(pluginkit: &str, bundle_id: &str) -> MacOsExtensionProbe {
    // Use absolute path — GUI app PATH may not include /usr/bin.
    let installed = Command::new(pluginkit).args(["-m", "-A", "-i", bundle_id]).output().map(|output| !output.stdout.is_empty()).unwrap_or(false);

    // Check if user-enabled (without -A, only shows enabled extensions)
    let enabled =
        if installed { Command::new(pluginkit).args(["-m", "-i", bundle_id]).output().map(|output| !output.stdout.is_empty()).unwrap_or(false) } else { false };

    MacOsExtensionProbe { is_installed: installed, is_enabled: enabled }
}

fn probe_spotlight() -> MacOsExtensionProbe {
    // mdimport -L lists paths, not bundle IDs. Grep for the importer name instead.
    let installed = Command::new("/usr/bin/mdimport")
        .args(["-L"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("ZManagerSpotlight"))
        .unwrap_or(false);

    MacOsExtensionProbe { is_installed: installed, is_enabled: true }
}

fn probe_file_associations() -> bool {
    // File associations are registered via lsregister -f, not pluginkit.
    // Check if the app bundle ID appears in the Launch Services database.
    let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    Command::new(lsregister).args(["-dump"]).output().map(|output| String::from_utf8_lossy(&output.stdout).contains("org.tzap-org.zmanager")).unwrap_or(false)
}

include!("../generated/macos_ffi.generated.rs");

extern "C" fn host_callback(bytes: *const u8, length: usize, _context: *mut c_void) {
    if bytes.is_null() || length > MAX_REQUEST_BYTES {
        return;
    }
    let payload = unsafe { std::slice::from_raw_parts(bytes, length) };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(payload) else {
        record_shell_action_stage("hostPayloadRejected", None, None, Some("invalidJson"));
        return;
    };
    if value["kind"] == "hostStarted" && value["mainThread"] == true {
        HOST_CALLBACK_RECEIVED.store(true, Ordering::Release);
        APP_GROUP_AVAILABLE.store(value["appGroupAvailable"] == true, Ordering::Release);
        record_shell_action_stage("nativeHostReady", None, None, if value["appGroupAvailable"] == true { None } else { Some("appGroupUnavailable") });
        if value["appGroupSelfTest"] == true && value["filePromiseSelfTest"] == true && value["iconSelfTest"] == true && value["defaultHandlerSelfTest"] == true
        {
            if value["serviceSelfTest"] != true {
                eprintln!("ZMANAGER_MACOS_INSTALLED_SERVICE_SELF_TEST_UNAVAILABLE");
            }
            eprintln!("ZMANAGER_MACOS_INSTALLED_LINKAGE_SELF_TEST_OK");
        }
        return;
    }
    if let Ok(event) = serde_json::from_value::<crate::native_launch_inbox::NativeInboundEvent>(value)
        && let Some(inbox) = NATIVE_LAUNCH_INBOX.get()
    {
        ingest_macos_native_event(event, inbox);
    }
}

pub(super) fn initialize_native_host(
    inbox: crate::native_launch_inbox::NativeLaunchInbox,
    diagnostics: crate::diagnostics::DiagnosticLog,
) -> Result<(), String> {
    let _ = NATIVE_LAUNCH_INBOX.set(inbox);
    let _ = NATIVE_DIAGNOSTICS.set(diagnostics);
    let result = unsafe { zmanager_macos_host_start(Some(host_callback), std::ptr::null_mut()) };
    if result != 0 && result != 2 {
        return Err(format!("macOS Native Host failed to start: {result}"));
    }
    Ok(())
}

pub(super) fn register_services(builder: Builder<Wry>) -> Builder<Wry> {
    builder.menu(build_macos_menu).on_menu_event(|app, event| {
        let Some(command_id) = event.id().0.strip_prefix("command:") else {
            return;
        };
        let _ = app.emit("zmanager-native-menu-command", NativeMenuCommandEvent { command_id });
    })
}

impl CapabilityInspector for MacOsPlatform {
    fn capability_observations()
    -> std::collections::HashMap<crate::native_integration::NativeCapabilityId, crate::native_integration::NativeCapabilityObservation> {
        use crate::native_integration::{
            NativeCapabilityFailureCategory, NativeCapabilityId, NativeCapabilityInstalledState, NativeCapabilityObservation, NativeCapabilityPackageState,
            NativeCapabilityRuntimeState, NativeCapabilityUserEnabledState,
        };
        let app_group_runtime =
            if APP_GROUP_AVAILABLE.load(Ordering::Acquire) { NativeCapabilityRuntimeState::Ready } else { NativeCapabilityRuntimeState::Unavailable };

        let probes = probe_extension_status();
        let file_assoc_installed = probe_file_associations();
        let finder_installed =
            if probes.finder.is_installed { NativeCapabilityInstalledState::Registered } else { NativeCapabilityInstalledState::Unregistered };
        let finder_enabled = if !probes.finder.is_installed {
            NativeCapabilityUserEnabledState::NotInspected
        } else if probes.finder.is_enabled {
            NativeCapabilityUserEnabledState::Enabled
        } else {
            NativeCapabilityUserEnabledState::Disabled
        };
        let finder_failure = (!probes.finder.is_installed).then_some(NativeCapabilityFailureCategory::NotRegistered);

        let mut observations =
            [NativeCapabilityId::ShellSelectedItemActions, NativeCapabilityId::ShellBackgroundActions, NativeCapabilityId::FinderTokenTransport]
                .into_iter()
                .map(|id| {
                    (
                        id,
                        NativeCapabilityObservation {
                            package_state: Some(NativeCapabilityPackageState::Included),
                            installed_state: Some(finder_installed),
                            user_enabled_state: Some(finder_enabled),
                            runtime_state: Some(app_group_runtime),
                            failure_category: finder_failure,
                            ..NativeCapabilityObservation::default()
                        },
                    )
                })
                .collect::<std::collections::HashMap<_, _>>();

        observations.insert(
            NativeCapabilityId::NativeHostLifecycle,
            NativeCapabilityObservation {
                runtime_state: Some(if HOST_CALLBACK_RECEIVED.load(Ordering::Acquire) {
                    NativeCapabilityRuntimeState::Ready
                } else {
                    NativeCapabilityRuntimeState::Unavailable
                }),
                ..NativeCapabilityObservation::default()
            },
        );
        observations.insert(
            NativeCapabilityId::SecureLocalFileProtection,
            NativeCapabilityObservation { runtime_state: Some(NativeCapabilityRuntimeState::Ready), ..NativeCapabilityObservation::default() },
        );

        // File associations are registered together with the app bundle
        // via lsregister, not pluginkit. Probe Launch Services directly.
        let fa_failure = (!file_assoc_installed).then_some(NativeCapabilityFailureCategory::NotRegistered);
        observations.insert(
            NativeCapabilityId::FileAssociations,
            NativeCapabilityObservation {
                package_state: Some(NativeCapabilityPackageState::Included),
                installed_state: Some(if file_assoc_installed {
                    NativeCapabilityInstalledState::Registered
                } else {
                    NativeCapabilityInstalledState::Unregistered
                }),
                failure_category: fa_failure,
                ..NativeCapabilityObservation::default()
            },
        );

        let ql_installed =
            if probes.quicklook.is_installed { NativeCapabilityInstalledState::Registered } else { NativeCapabilityInstalledState::Unregistered };
        let ql_runtime = if probes.quicklook.is_installed { NativeCapabilityRuntimeState::Ready } else { NativeCapabilityRuntimeState::Unavailable };
        let ql_failure = (!probes.quicklook.is_installed).then_some(NativeCapabilityFailureCategory::NotRegistered);

        observations.insert(
            NativeCapabilityId::QuickLook,
            NativeCapabilityObservation {
                package_state: Some(NativeCapabilityPackageState::Included),
                installed_state: Some(ql_installed),
                runtime_state: Some(ql_runtime),
                failure_category: ql_failure,
                ..NativeCapabilityObservation::default()
            },
        );

        let sp_installed =
            if probes.spotlight.is_installed { NativeCapabilityInstalledState::Registered } else { NativeCapabilityInstalledState::Unregistered };
        let sp_runtime = if probes.spotlight.is_installed { NativeCapabilityRuntimeState::Ready } else { NativeCapabilityRuntimeState::Unavailable };
        let sp_failure = (!probes.spotlight.is_installed).then_some(NativeCapabilityFailureCategory::NotRegistered);

        observations.insert(
            NativeCapabilityId::Spotlight,
            NativeCapabilityObservation {
                package_state: Some(NativeCapabilityPackageState::Included),
                installed_state: Some(sp_installed),
                runtime_state: Some(sp_runtime),
                failure_category: sp_failure,
                ..NativeCapabilityObservation::default()
            },
        );

        observations
    }
}

impl MainWindowConfigurator for MacOsPlatform {
    fn configure_main_window(_window: &tauri::WebviewWindow<Wry>) -> Result<(), tauri::Error> {
        if HOST_CALLBACK_RECEIVED.load(Ordering::Acquire) {
            eprintln!("ZMANAGER_MACOS_HOST_CALLBACK_OK");
        }
        Ok(())
    }
}

impl SystemFileIconProvider for MacOsPlatform {
    fn system_file_icons(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto> {
        let Ok(input) = serde_json::to_vec(entries) else {
            return icon_fallback(entries);
        };
        let mut output = Vec::<u8>::new();
        let result =
            unsafe { zmanager_macos_system_file_icons(input.as_ptr(), input.len(), Some(icon_operation_callback), (&mut output as *mut Vec<u8>).cast()) };
        if result != 0 {
            return icon_fallback(entries);
        }
        serde_json::from_slice(&output).unwrap_or_else(|_| icon_fallback(entries))
    }
}

impl DefaultHandlerController for MacOsPlatform {
    fn default_handlers(request: &DefaultHandlerRequest) -> Result<Vec<DefaultHandlerEntry>, NativeCapabilityOperationError> {
        let input = serde_json::to_vec(request).map_err(|_| NativeCapabilityOperationError::failed("defaultHandlerControl", "requestEncodingFailed"))?;
        let mut output = Vec::<u8>::new();
        let result =
            unsafe { zmanager_macos_default_handlers(input.as_ptr(), input.len(), Some(icon_operation_callback), (&mut output as *mut Vec<u8>).cast()) };
        if result != 0 {
            return Err(NativeCapabilityOperationError::failed("defaultHandlerControl", "nativeOperationFailed"));
        }
        serde_json::from_slice(&output).map_err(|_| NativeCapabilityOperationError::failed("defaultHandlerControl", "responseDecodeFailed"))
    }
}

impl SecureFileProtector for MacOsPlatform {
    fn set_owner_only_file_permissions(file: &std::fs::File) -> Result<(), NativeCapabilityOperationError> {
        use std::os::unix::fs::PermissionsExt as _;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|_| NativeCapabilityOperationError::failed("secureLocalFileProtection", "permissionUpdateFailed"))
    }
}

impl MacOsPlatform {
    fn consume_shell_action_request(token: &str) -> Result<Vec<u8>, String> {
        let mut output = Vec::<u8>::new();
        let result = unsafe {
            zmanager_macos_consume_shell_action_request(token.as_ptr(), token.len(), Some(icon_operation_callback), (&mut output as *mut Vec<u8>).cast())
        };
        if result != 0 {
            return Err(format!("macOS shell-action request could not be consumed: {result}"));
        }
        Ok(output)
    }
}

impl NativeFileDragAdapter for MacOsPlatform {
    fn prepare_native_file_drag(candidates: &[NativeFileDragCandidate], strip_components: usize) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
        prepare_posix_drag_items(
            candidates,
            strip_components,
            PosixDragPathPolicy {
                platform_label: "macOS",
                // Finder destinations are commonly case-insensitive. Rejecting the
                // collision before staging gives deterministic behavior on both APFS modes.
                collision_case_sensitive: false,
                max_component_bytes: Some(255),
            },
        )
    }

    fn start_native_file_drag(
        window: &tauri::WebviewWindow<Wry>,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        registry: &NativeDragSessionRegistry,
    ) -> Result<NativeFileDragStart, NativeFileDragError> {
        if items.is_empty() {
            return Err(NativeFileDragError::invalid_request("No archive files are available to drag."));
        }
        start_macos_file_promise_drag(window, items, stream_provider, registry)
    }
}

pub(super) fn handle_run_event(event: &tauri::RunEvent, inbox: &crate::native_launch_inbox::NativeLaunchInbox) {
    let tauri::RunEvent::Opened { urls } = event else {
        return;
    };
    let pid = std::process::id();
    let timestamp_ms = SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64;

    let mut file_paths = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        if url.scheme() == "file" {
            if let Ok(path) = url.to_file_path()
                && let Some(path_str) = path.to_str()
            {
                file_paths.push(path_str.to_string());
            }
        } else if let Some(event) = shell_action_event_from_url(url, pid, timestamp_ms, index) {
            ingest_macos_native_event(event, inbox);
        }
    }

    if !file_paths.is_empty() {
        let event = crate::native_launch_inbox::NativeInboundEvent {
            version: crate::native_launch_inbox::NATIVE_INBOUND_EVENT_VERSION,
            event_id: format!("tauri-url-{pid}-{timestamp_ms}-openpaths"),
            kind: crate::native_launch_inbox::NativeInboundEventKind::OpenPaths,
            timestamp_unix_ms: timestamp_ms,
            idempotency_key: None,
            payload: crate::native_launch_inbox::NativeInboundPayload::OpenPaths(crate::native_launch_inbox::OpenPathsPayload { paths: file_paths }),
        };
        ingest_macos_native_event(event, inbox);
    }
}

pub(super) fn shutdown() {
    unsafe { zmanager_macos_host_shutdown() };
    eprintln!("ZMANAGER_MACOS_HOST_SHUTDOWN_OK");
}

fn ingest_macos_native_event(event: crate::native_launch_inbox::NativeInboundEvent, inbox: &crate::native_launch_inbox::NativeLaunchInbox) {
    let event = match normalize_macos_inbound_event(event, MacOsPlatform::consume_shell_action_request) {
        Ok(event) => event,
        Err(error_code) => {
            record_shell_action_stage("requestRejected", None, None, Some(error_code));
            return;
        }
    };
    let (action, path_count) = shell_action_diagnostic_fields(&event);
    let disposition = shell_action_disposition(&event);
    match inbox.ingest(event) {
        Ok(()) => record_shell_action_stage_with_disposition("inboxAccepted", action.as_deref(), path_count, None, disposition),
        Err(error) => record_shell_action_stage_with_disposition("inboxRejected", action.as_deref(), path_count, Some(inbox_error_code(&error)), disposition),
    }
}

fn normalize_macos_inbound_event(
    mut event: crate::native_launch_inbox::NativeInboundEvent,
    consume_token: impl FnOnce(&str) -> Result<Vec<u8>, String>,
) -> Result<crate::native_launch_inbox::NativeInboundEvent, &'static str> {
    if event.kind != crate::native_launch_inbox::NativeInboundEventKind::ShellActionRequest {
        return Ok(event);
    }
    let request = match &event.payload {
        crate::native_launch_inbox::NativeInboundPayload::ShellActionToken(payload) => {
            record_shell_action_stage("tokenReceived", None, None, None);
            let content = consume_token(&payload.request_token).map_err(|_| "requestConsumeFailed")?;
            record_shell_action_stage("requestConsumed", None, None, None);
            crate::quick_action::parse_app_group_shell_action_request(&content).map_err(|_| "requestValidationFailed")?
        }
        crate::native_launch_inbox::NativeInboundPayload::ShellActionRequest(payload) => {
            crate::quick_action::validate_ingested_shell_action_request(payload.request.clone()).map_err(|_| "requestValidationFailed")?
        }
        _ => return Err("payloadKindMismatch"),
    };
    record_shell_action_stage_with_disposition(
        "requestValidated",
        shell_action_name(request.kind).as_deref(),
        Some(request.paths.len()),
        None,
        Some(request.kind.window_disposition().as_str()),
    );
    event.idempotency_key = None;
    event.payload = crate::native_launch_inbox::NativeInboundPayload::ShellActionRequest(crate::native_launch_inbox::ShellActionRequestPayload { request });
    Ok(event)
}

fn shell_action_diagnostic_fields(event: &crate::native_launch_inbox::NativeInboundEvent) -> (Option<String>, Option<usize>) {
    match &event.payload {
        crate::native_launch_inbox::NativeInboundPayload::ShellActionRequest(payload) => {
            (shell_action_name(payload.request.kind), Some(payload.request.paths.len()))
        }
        crate::native_launch_inbox::NativeInboundPayload::OpenPaths(payload) => (Some("open".to_string()), Some(payload.paths.len())),
        _ => (None, None),
    }
}

fn shell_action_disposition(event: &crate::native_launch_inbox::NativeInboundEvent) -> Option<&'static str> {
    match &event.payload {
        crate::native_launch_inbox::NativeInboundPayload::ShellActionRequest(payload) => Some(payload.request.kind.window_disposition().as_str()),
        _ => None,
    }
}

fn shell_action_name(kind: crate::dto::QuickActionKindDto) -> Option<String> {
    serde_json::to_value(kind).ok().and_then(|value| value.as_str().map(str::to_owned))
}

fn inbox_error_code(error: &crate::native_launch_inbox::NativeLaunchInboxError) -> &'static str {
    use crate::native_launch_inbox::NativeLaunchInboxError;
    match error {
        NativeLaunchInboxError::Shutdown => "shutdown",
        NativeLaunchInboxError::UnsupportedVersion(_) => "unsupportedVersion",
        NativeLaunchInboxError::InvalidEvent(_) => "invalidEvent",
        NativeLaunchInboxError::Oversized => "oversized",
        NativeLaunchInboxError::Duplicate => "duplicate",
        NativeLaunchInboxError::QueueFull => "queueFull",
        NativeLaunchInboxError::UnknownEvent => "unknownEvent",
        NativeLaunchInboxError::WrongWindow => "wrongWindow",
    }
}

fn record_shell_action_stage(name: &str, action: Option<&str>, path_count: Option<usize>, error_code: Option<&str>) {
    record_shell_action_stage_with_disposition(name, action, path_count, error_code, None);
}

fn record_shell_action_stage_with_disposition(
    name: &str,
    action: Option<&str>,
    path_count: Option<usize>,
    error_code: Option<&str>,
    window_disposition: Option<&str>,
) {
    let Some(diagnostics) = NATIVE_DIAGNOSTICS.get() else {
        return;
    };
    let mut fields = std::collections::BTreeMap::new();
    if let Some(action) = action {
        fields.insert("action".to_string(), serde_json::Value::String(action.to_string()));
    }
    if let Some(path_count) = path_count {
        fields.insert("pathCount".to_string(), serde_json::Value::Number(path_count.into()));
    }
    if let Some(error_code) = error_code {
        fields.insert("errorCode".to_string(), serde_json::Value::String(error_code.to_string()));
    }
    if let Some(disposition) = window_disposition {
        fields.insert("windowDisposition".to_string(), serde_json::Value::String(disposition.to_string()));
    }
    let _ = diagnostics.record("shellActionIngress", name, fields);
}

fn shell_action_event_from_url(url: &tauri::Url, pid: u32, timestamp_ms: u64, index: usize) -> Option<crate::native_launch_inbox::NativeInboundEvent> {
    if url.scheme() != "zmanager" || url.host_str() != Some("shell-request") {
        return None;
    }
    let token = url.path().trim_start_matches('/').to_string();
    if token.is_empty() {
        return None;
    }
    Some(crate::native_launch_inbox::NativeInboundEvent {
        version: crate::native_launch_inbox::NATIVE_INBOUND_EVENT_VERSION,
        event_id: format!("tauri-url-{pid}-{timestamp_ms}-{index}"),
        kind: crate::native_launch_inbox::NativeInboundEventKind::ShellActionRequest,
        timestamp_unix_ms: timestamp_ms,
        idempotency_key: Some(token.clone()),
        payload: crate::native_launch_inbox::NativeInboundPayload::ShellActionToken(crate::native_launch_inbox::ShellActionTokenPayload {
            request_token: token,
        }),
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuCommandEvent<'a> {
    command_id: &'a str,
}

fn menu_command(app: &tauri::AppHandle<Wry>, command_id: &str, label: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, format!("command:{command_id}"), label, true, accelerator)
}

include!("../generated/macos_menu.generated.rs");

extern "C" fn icon_operation_callback(bytes: *const u8, length: usize, context: *mut c_void) {
    if bytes.is_null() || context.is_null() || length > MAX_RESPONSE_BYTES {
        return;
    }
    let output = unsafe { &mut *context.cast::<Vec<u8>>() };
    output.extend_from_slice(unsafe { std::slice::from_raw_parts(bytes, length) });
}

fn icon_fallback(entries: &[SystemFileIconRequestEntry]) -> Vec<SystemFileIconDto> {
    entries.iter().map(|entry| SystemFileIconDto { key: entry.key.clone(), data_url: None }).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PromiseDragItemDto {
    entry_path: String,
    promised_name: String,
    file_type: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PromiseDragOutcomeEvent {
    session_id: String,
    outcome: &'static str,
}

struct PromiseDragContext {
    registry: NativeDragSessionRegistry,
    session_id: String,
    app_handle: tauri::AppHandle<Wry>,
}

extern "C" fn promise_write_callback(
    entry_bytes: *const u8,
    entry_length: usize,
    destination_bytes: *const u8,
    destination_length: usize,
    context: *mut c_void,
) -> i32 {
    if context.is_null()
        || entry_bytes.is_null()
        || destination_bytes.is_null()
        || entry_length == 0
        || entry_length > 4_096
        || destination_length == 0
        || destination_length > 32_768
    {
        return 1;
    }
    let context = unsafe { &*context.cast::<PromiseDragContext>() };
    let entry = unsafe { std::slice::from_raw_parts(entry_bytes, entry_length) };
    let destination = unsafe { std::slice::from_raw_parts(destination_bytes, destination_length) };
    let (Ok(entry), Ok(destination)) = (std::str::from_utf8(entry), std::str::from_utf8(destination)) else {
        return 2;
    };
    match context.registry.write_promise(&context.session_id, entry, Path::new(destination)) {
        Ok(_) => 0,
        Err(_) => 3,
    }
}

extern "C" fn promise_outcome_callback(outcome: i32, context: *mut c_void) {
    if context.is_null() {
        return;
    }
    let context = unsafe { &*context.cast::<PromiseDragContext>() };
    let outcome = if outcome == 0 { "dropped" } else { "cancelled" };
    if outcome == "cancelled" {
        context.registry.cancel(&context.session_id);
    }
    let _ = context.app_handle.emit("native-file-drag-outcome", PromiseDragOutcomeEvent { session_id: context.session_id.clone(), outcome });
}

extern "C" fn promise_release_callback(context: *mut c_void) {
    if context.is_null() {
        return;
    }
    let context = unsafe { Box::from_raw(context.cast::<PromiseDragContext>()) };
    context.registry.cancel(&context.session_id);
}

fn start_macos_file_promise_drag(
    window: &tauri::WebviewWindow<Wry>,
    items: &[NativeFileDragItem],
    stream_provider: NativeFileDragStreamProvider,
    registry: &NativeDragSessionRegistry,
) -> Result<NativeFileDragStart, NativeFileDragError> {
    let descriptors = NativeDragSessionRegistry::descriptors(items)?;
    let session_id = registry.create(items, stream_provider)?;
    let promise_items = descriptors
        .into_iter()
        .map(|descriptor| PromiseDragItemDto {
            entry_path: descriptor.promise_path,
            promised_name: descriptor.promised_name,
            file_type: if descriptor.is_directory { "public.folder" } else { "public.data" },
        })
        .collect::<Vec<_>>();
    let item_json = serde_json::to_vec(&promise_items)
        .map_err(|error| NativeFileDragError::new(format!("Unable to describe macOS file promises: {error}"), None::<String>))?;
    let view = window.ns_view().map_err(|error| NativeFileDragError::new(format!("Unable to access the macOS drag source view: {error}"), None::<String>))?;
    let context = Box::new(PromiseDragContext { registry: registry.clone(), session_id: session_id.clone(), app_handle: window.app_handle().clone() });
    let context = Box::into_raw(context).cast::<c_void>();
    let result = unsafe {
        zmanager_macos_start_promise_drag(
            view,
            session_id.as_ptr(),
            session_id.len(),
            item_json.as_ptr(),
            item_json.len(),
            Some(promise_write_callback),
            Some(promise_outcome_callback),
            Some(promise_release_callback),
            context,
        )
    };
    if result != 0 {
        let context = unsafe { Box::from_raw(context.cast::<PromiseDragContext>()) };
        context.registry.cancel(&context.session_id);
        return Err(NativeFileDragError::new(
            format!("macOS file-promise drag could not be started: {result}"),
            Some("Try dragging again, or use Extract... if Finder rejects the drag."),
        ));
    }
    Ok(NativeFileDragStart::Pending { session_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(path: &str) -> NativeFileDragCandidate {
        NativeFileDragCandidate { entry_path: path.to_string(), size: Some(1), modified_unix_seconds: None }
    }

    #[test]
    fn macos_drag_policy_uses_posix_paths_and_allows_windows_specific_names() {
        let items = MacOsPlatform::prepare_native_file_drag(&[candidate("docs/report?.txt")], 0).expect("macOS should allow question marks in file names");

        assert_eq!(items[0].display_path, "docs/report?.txt");
    }

    #[test]
    fn macos_drag_policy_rejects_case_insensitive_collisions_after_stripping() {
        assert!(MacOsPlatform::prepare_native_file_drag(&[candidate("one/Readme.txt"), candidate("two/README.txt")], 1,).is_err());
    }

    #[test]
    fn opened_shell_request_url_maps_to_the_native_inbound_contract() {
        let url = tauri::Url::parse("zmanager://shell-request/request-token").expect("valid callback URL");

        let event = shell_action_event_from_url(&url, 41, 1_234, 2).expect("shell request callback should map");

        assert_eq!(event.event_id, "tauri-url-41-1234-2");
        assert_eq!(event.timestamp_unix_ms, 1_234);
        assert_eq!(event.idempotency_key.as_deref(), Some("request-token"));
        assert!(matches!(
            event.payload,
            crate::native_launch_inbox::NativeInboundPayload::ShellActionToken(
                crate::native_launch_inbox::ShellActionTokenPayload { request_token }
            ) if request_token == "request-token"
        ));
    }

    #[test]
    fn opened_urls_reject_unrelated_and_empty_shell_requests() {
        let unrelated = tauri::Url::parse("https://example.com/request-token").expect("valid URL");
        let empty = tauri::Url::parse("zmanager://shell-request/").expect("valid callback URL");

        assert!(shell_action_event_from_url(&unrelated, 1, 2, 3).is_none());
        assert!(shell_action_event_from_url(&empty, 1, 2, 3).is_none());
    }

    #[test]
    fn finder_token_is_consumed_and_validated_before_inbox_delivery() {
        let url = tauri::Url::parse("zmanager://shell-request/request-token").expect("valid callback URL");
        let event = shell_action_event_from_url(&url, 41, 1_234, 2).expect("shell request callback should map");

        let normalized = normalize_macos_inbound_event(event, |token| {
            assert_eq!(token, "request-token");
            Ok(br#"{"version":1,"action":"compressZip","paths":["/tmp/one","/tmp/two"]}"#.to_vec())
        })
        .expect("valid request should normalize");

        assert_eq!(normalized.idempotency_key, None);
        assert!(matches!(
            normalized.payload,
            crate::native_launch_inbox::NativeInboundPayload::ShellActionRequest(
                crate::native_launch_inbox::ShellActionRequestPayload { request }
            ) if request.kind == crate::dto::QuickActionKindDto::CompressZip
                && request.paths == ["/tmp/one", "/tmp/two"]
        ));
    }

    #[test]
    fn finder_token_consume_and_request_validation_fail_closed() {
        let event = shell_action_event_from_url(&tauri::Url::parse("zmanager://shell-request/request-token").unwrap(), 41, 1_234, 2).unwrap();
        assert_eq!(normalize_macos_inbound_event(event.clone(), |_| Err("missing".to_string())), Err("requestConsumeFailed"));
        assert_eq!(
            normalize_macos_inbound_event(event, |_| { Ok(br#"{"version":1,"action":"open","paths":["/tmp/one","/tmp/two"]}"#.to_vec()) }),
            Err("requestValidationFailed")
        );
    }
}
