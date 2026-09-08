use std::{
    ffi::OsString,
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use tauri::Url;

use crate::dto::{QuickActionKindDto, QuickActionRequestDto, QuickActionStartupErrorDto, QuickActionStartupStateDto, QuickActionWindowDispositionDto};
use crate::native_launch_inbox::{
    HostedAuthCallbackPayload, HostedAuthResult, NATIVE_INBOUND_EVENT_VERSION, NativeInboundEvent, NativeInboundEventKind, NativeInboundPayload,
};

const QUICK_ACTION_ARG: &str = "--quick-action";
const QUICK_ACTION_ARG_ALIAS: &str = "--action";
const QUICK_ACTION_REQUEST_ARG: &str = "--quick-action-request";
const SHELL_ACTION_REQUEST_ARG: &str = "--shell-action-request";
const PATH_ARG: &str = "--path";
const PASSWORD_ARG_PREFIXES: &[&str] = &["--password", "--passphrase", "--secret"];
const MAX_SHELL_ACTION_REQUEST_BYTES: usize = 8 * 1024 * 1024;
#[allow(dead_code)]
const MAX_APP_GROUP_SHELL_ACTION_REQUEST_BYTES: usize = 1_048_576;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchInstanceMode {
    NormalSingleton,
    IsolatedQuickAction,
}

impl LaunchInstanceMode {
    pub fn from_startup_env() -> Self {
        let test_mode = cfg!(debug_assertions) && std::env::var("ZMANAGER_GUI_TEST_MODE").is_ok() && std::env::var("ZMANAGER_GUI_TEST_DEEP_LINK").is_err();
        Self::from_args(std::env::args_os().skip(1), std::env::var("ZMANAGER_MACOS_QUICK_ACTION").is_ok() || test_mode)
    }

    fn from_args(args: impl IntoIterator<Item = OsString>, pending_macos_quick_action: bool) -> Self {
        if pending_macos_quick_action
            || args.into_iter().any(|arg| {
                arg.to_str().is_some_and(|value| {
                    value == QUICK_ACTION_ARG
                        || value == QUICK_ACTION_ARG_ALIAS
                        || value == QUICK_ACTION_REQUEST_ARG
                        || value == SHELL_ACTION_REQUEST_ARG
                        || value.starts_with("--quick-action=")
                        || value.starts_with("--action=")
                        || value.starts_with("--quick-action-request=")
                        || value.starts_with("--shell-action-request=")
                })
            })
        {
            Self::IsolatedQuickAction
        } else {
            Self::NormalSingleton
        }
    }

    pub fn registers_single_instance(self) -> bool {
        crate::platform::quick_action_registers_single_instance(self == Self::NormalSingleton)
    }
}
const TZAP_EXTENSION_SUFFIX: &str = ".tzap";
const TZAP_VOLUME_MARKER: &str = ".vol";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QuickActionStartupState {
    NotRequested,
    Requested(QuickActionRequestDto),
    ForwardedToNativeInbox(QuickActionKindDto),
    PendingMacOsQuickAction,
    Invalid(QuickActionError),
}

impl QuickActionStartupState {
    pub fn from_startup_env() -> Self {
        if std::env::var("ZMANAGER_MACOS_QUICK_ACTION").is_ok() {
            return Self::PendingMacOsQuickAction;
        }

        let args = std::env::args_os().skip(1).collect::<Vec<_>>();
        Self::from_args(args)
    }

    fn from_process_or_user_args(args: Vec<OsString>) -> Self {
        if first_arg_is_executable_path(args.first()) {
            return Self::from_args(args.into_iter().skip(1));
        }

        Self::from_args(args)
    }

    pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Self {
        let args = args.into_iter().collect::<Vec<_>>();
        if hosted_auth_callback_event_from_args(args.clone()).is_some() {
            return Self::NotRequested;
        }
        match parse_quick_action_args(args) {
            ParseOutcome::NotRequested => Self::NotRequested,
            ParseOutcome::Requested(result) => match result {
                Ok(request) => Self::Requested(request),
                Err(error) => Self::Invalid(error),
            },
        }
    }

    pub fn forward_requested_to_native_inbox(self, inbox: &crate::native_launch_inbox::NativeLaunchInbox) -> Self {
        match self {
            Self::Requested(request) => {
                let kind = request.kind;
                match inbox.ingest(crate::native_launch_inbox::NativeLaunchInbox::from_quick_action(request)) {
                    Ok(_) => Self::ForwardedToNativeInbox(kind),
                    Err(error) => Self::Invalid(QuickActionError::invalid(format!("Failed to queue startup quick action: {error:?}"))),
                }
            }
            other => other,
        }
    }

    pub fn to_dto(&self) -> QuickActionStartupStateDto {
        match self {
            Self::NotRequested => QuickActionStartupStateDto { launched_for_quick_action: false, window_disposition: None, error: None },
            Self::Requested(request) => {
                QuickActionStartupStateDto { launched_for_quick_action: true, window_disposition: Some(request.kind.window_disposition()), error: None }
            }
            Self::ForwardedToNativeInbox(kind) => {
                QuickActionStartupStateDto { launched_for_quick_action: true, window_disposition: Some(kind.window_disposition()), error: None }
            }
            Self::PendingMacOsQuickAction => QuickActionStartupStateDto { launched_for_quick_action: true, window_disposition: None, error: None },
            Self::Invalid(error) => {
                QuickActionStartupStateDto { launched_for_quick_action: true, window_disposition: error.window_disposition, error: Some(error.to_dto()) }
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct QuickActionLaunchCoordinator {
    inner: Arc<Mutex<QuickActionLaunchState>>,
}

#[derive(Debug)]
struct QuickActionLaunchState {
    startup: QuickActionStartupState,
}

impl QuickActionLaunchCoordinator {
    pub fn from_startup_state(state: QuickActionStartupState) -> Self {
        Self { inner: Arc::new(Mutex::new(QuickActionLaunchState { startup: state })) }
    }

    pub fn startup_state(&self) -> QuickActionStartupState {
        let mut inner = self.inner.lock().expect("quick-action lock poisoned");
        std::mem::replace(&mut inner.startup, QuickActionStartupState::NotRequested)
    }

    pub fn ingest_secondary_process_args(&self, args: Vec<OsString>, inbox: &crate::native_launch_inbox::NativeLaunchInbox) -> QuickActionStartupState {
        if let Some(event) = hosted_auth_callback_event_from_args(args.clone()) {
            let _ = inbox.ingest(event);
            return QuickActionStartupState::NotRequested;
        }
        let state = QuickActionStartupState::from_process_or_user_args(args);
        if let QuickActionStartupState::Requested(request) = &state {
            let _ = inbox.ingest(crate::native_launch_inbox::NativeLaunchInbox::from_quick_action(request.clone()));
        }
        state
    }
}

/// Converts a Windows/Linux process argument carrying a hosted-auth callback
/// into the same native inbox event used by the macOS URL event path. Keeping
/// this parser at the process boundary ensures the callback is delivered even
/// when the app is launched by the OS as a fresh process.
pub fn hosted_auth_callback_event_from_args(args: impl IntoIterator<Item = OsString>) -> Option<NativeInboundEvent> {
    let mut values = args.into_iter().filter_map(|arg| arg.into_string().ok()).collect::<Vec<_>>();
    let first_is_executable = values.first().is_some_and(|value| {
        let argument = OsString::from(value);
        first_arg_is_executable_path(Some(&argument))
    });
    if first_is_executable {
        values.remove(0);
    }
    values.into_iter().find_map(|value| hosted_auth_callback_event_from_url(&value))
}

fn hosted_auth_callback_event_from_url(value: &str) -> Option<NativeInboundEvent> {
    let url = url::Url::parse(value).ok()?;
    let is_current = url.scheme() == "tzap" && url.host_str() == Some("auth") && url.path() == "/callback";
    let is_legacy = url.scheme() == "zmanager" && url.host_str() == Some("auth-callback") && url.path().is_empty();
    if !is_current && !is_legacy {
        return None;
    }

    const FORBIDDEN_KEYS: [&str; 9] =
        ["code", "token", "access_token", "authorization_code", "password", "relay_body", "session_token", "refresh_token", "id_token"];
    if url.query_pairs().any(|(key, _)| FORBIDDEN_KEYS.iter().any(|forbidden| key.eq_ignore_ascii_case(forbidden))) {
        return None;
    }

    let state = url.query_pairs().find(|(key, _)| key == "state").map(|(_, value)| value.into_owned())?;
    if !bounded_auth_token(&state, 16, 256, |byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')) {
        return None;
    }
    let handoff_code = url.query_pairs().find(|(key, _)| key == "handoff_code").map(|(_, value)| value.into_owned());
    let result = match url.query_pairs().find(|(key, _)| key == "result").map(|(_, value)| value.into_owned()) {
        Some(result) => match result.as_str() {
            "completed" => HostedAuthResult::Completed,
            "cancelled" => HostedAuthResult::Cancelled,
            "failed" => HostedAuthResult::Failed,
            _ => return None,
        },
        // The hosted service's approved native callback shape is state plus a
        // one-time handoff code. Treat the presence of a valid handoff code as
        // completion when the optional result discriminator is omitted.
        None if handoff_code.is_some() => HostedAuthResult::Completed,
        None => return None,
    };
    if matches!(result, HostedAuthResult::Completed)
        && !handoff_code
            .as_deref()
            .is_some_and(|code| bounded_auth_token(code, 16, 2048, |byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~')))
    {
        return None;
    }
    if !matches!(result, HostedAuthResult::Completed) && handoff_code.is_some() {
        return None;
    }
    let error_code = url.query_pairs().find(|(key, _)| key == "error_code").map(|(_, value)| value.into_owned());
    if error_code.as_deref().is_some_and(|code| code.len() > 128 || code.bytes().any(|byte| byte.is_ascii_control())) {
        return None;
    }

    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let timestamp_unix_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64;
    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    Some(NativeInboundEvent {
        version: NATIVE_INBOUND_EVENT_VERSION,
        event_id: format!("native-auth-{}-{timestamp_unix_ms}-{counter}", std::process::id()),
        kind: NativeInboundEventKind::HostedAuthCallback,
        timestamp_unix_ms,
        idempotency_key: None,
        payload: NativeInboundPayload::HostedAuthCallback(HostedAuthCallbackPayload {
            state,
            result,
            error_code,
            handoff_code,
            callback_url: Some(if is_current { "tzap://auth/callback" } else { "zmanager://auth-callback" }.to_string()),
        }),
    })
}

fn bounded_auth_token(value: &str, min: usize, max: usize, allowed: impl Fn(u8) -> bool) -> bool {
    (min..=max).contains(&value.len()) && value.bytes().all(allowed)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuickActionError {
    code: &'static str,
    message: String,
    hint: Option<String>,
    window_disposition: Option<QuickActionWindowDispositionDto>,
}

impl QuickActionError {
    fn invalid(message: impl Into<String>) -> Self {
        Self { code: crate::constants::COMMAND_ERROR_INVALID_REQUEST, message: message.into(), hint: None, window_disposition: None }
    }

    fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    fn with_window_disposition(mut self, window_disposition: QuickActionWindowDispositionDto) -> Self {
        self.window_disposition = Some(window_disposition);
        self
    }

    fn to_dto(&self) -> QuickActionStartupErrorDto {
        QuickActionStartupErrorDto { code: self.code.to_string(), message: self.message.clone(), hint: self.hint.clone() }
    }
}

enum ParseOutcome {
    NotRequested,
    Requested(Result<QuickActionRequestDto, QuickActionError>),
}

fn first_arg_is_executable_path(arg: Option<&OsString>) -> bool {
    let Some(arg) = arg.and_then(|value| value.to_str()) else {
        return false;
    };

    let path = Path::new(arg);
    if path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| extension.eq_ignore_ascii_case("exe")) {
        return true;
    }

    let Some(file_name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
        return false;
    };

    if file_name.eq_ignore_ascii_case("zmanager-desktop") || file_name.eq_ignore_ascii_case("zmanager-desktop.exe") {
        return true;
    }

    std::env::current_exe()
        .ok()
        .and_then(|current_exe| current_exe.file_name().map(|name| name.to_owned()))
        .and_then(|current_exe_name| current_exe_name.to_str().map(str::to_owned))
        .is_some_and(|current_exe_name| current_exe_name == file_name)
}

pub fn is_supported_archive_path(path: &str) -> bool {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path).to_ascii_lowercase();

    if is_tzap_volume_archive_name(&name) {
        return true;
    }

    if crate::archive_file_types::split_archive_suffixes().iter().any(|suffix| name.ends_with(suffix.as_str())) {
        return true;
    }

    if crate::archive_file_types::compound_extensions().iter().any(|extension| name.ends_with(&format!(".{extension}"))) {
        return true;
    }

    let Some(extension) = name.rsplit_once('.').map(|(_, extension)| extension) else {
        return false;
    };

    crate::archive_file_types::single_extensions().iter().any(|supported_extension| supported_extension == extension)
}

fn parse_quick_action_args(args: impl IntoIterator<Item = OsString>) -> ParseOutcome {
    let mut requested = false;
    let mut kind: Option<Result<QuickActionKindDto, QuickActionError>> = None;
    let mut paths = Vec::new();
    let mut request_file_path: Option<String> = None;
    let mut pending_path_values = false;
    let mut pending_request_file_value = false;
    let mut saw_unknown_option = false;
    let mut ordinary_open_paths = Vec::new();

    for arg in args {
        let arg = match arg.into_string() {
            Ok(value) => value,
            Err(_) => {
                return ParseOutcome::Requested(Err(QuickActionError::invalid("quick-action arguments must be valid Unicode")));
            }
        };

        if is_password_arg(&arg) {
            return ParseOutcome::Requested(Err(QuickActionError::invalid("passwords cannot be supplied through quick-action arguments")));
        }

        if let Some(value) = arg.strip_prefix("--quick-action=") {
            requested = true;
            kind = Some(parse_kind(value));
            pending_path_values = false;
            continue;
        }

        if let Some(value) = arg.strip_prefix("--action=") {
            requested = true;
            kind = Some(parse_kind(value));
            pending_path_values = false;
            pending_request_file_value = false;
            continue;
        }

        if let Some(value) = arg.strip_prefix("--shell-action-request=").or_else(|| arg.strip_prefix("--quick-action-request=")) {
            requested = true;
            request_file_path = Some(value.to_string());
            pending_path_values = false;
            pending_request_file_value = false;
            continue;
        }

        if arg == QUICK_ACTION_ARG || arg == QUICK_ACTION_ARG_ALIAS {
            requested = true;
            kind = Some(Err(QuickActionError::invalid("--quick-action requires an action value")));
            pending_path_values = false;
            pending_request_file_value = false;
            continue;
        }

        if arg == SHELL_ACTION_REQUEST_ARG || arg == QUICK_ACTION_REQUEST_ARG {
            requested = true;
            pending_request_file_value = true;
            pending_path_values = false;
            continue;
        }

        if arg == PATH_ARG {
            requested = true;
            pending_path_values = true;
            pending_request_file_value = false;
            continue;
        }

        if arg.starts_with("--") {
            pending_path_values = false;
            pending_request_file_value = false;
            if !requested {
                saw_unknown_option = true;
            }
            continue;
        }

        if requested {
            if pending_request_file_value {
                request_file_path = Some(arg);
                pending_request_file_value = false;
            } else if matches!(kind, Some(Err(_))) {
                kind = Some(parse_kind(&arg));
            } else if pending_path_values {
                paths.push(arg);
            }
        } else if !saw_unknown_option {
            ordinary_open_paths.push(arg);
        }
    }

    if !requested {
        if ordinary_open_paths.is_empty() {
            return ParseOutcome::NotRequested;
        }

        return ParseOutcome::Requested(validate_request(QuickActionKindDto::Open, ordinary_open_paths));
    }

    if pending_request_file_value {
        return ParseOutcome::Requested(Err(QuickActionError::invalid("--shell-action-request requires a file path")));
    }

    if let Some(request_file_path) = request_file_path {
        return ParseOutcome::Requested(read_quick_action_request_file(&request_file_path));
    }

    let kind = match kind.unwrap_or_else(|| Err(QuickActionError::invalid("--quick-action is required for quick-action launches"))) {
        Ok(kind) => kind,
        Err(error) => return ParseOutcome::Requested(Err(error)),
    };

    ParseOutcome::Requested(validate_request(kind, paths))
}

fn read_quick_action_request_file(request_file_path: &str) -> Result<QuickActionRequestDto, QuickActionError> {
    let trimmed_path = request_file_path.trim();
    if trimmed_path.is_empty() {
        return Err(QuickActionError::invalid("--shell-action-request requires a file path"));
    }
    if trimmed_path.contains("://") {
        return Err(QuickActionError::invalid(format!("quick-action request path must be local: {trimmed_path}")));
    }

    let content = fs::read(trimmed_path).map_err(|error| QuickActionError::invalid(format!("unable to read quick-action request: {error}")))?;
    let _ = fs::remove_file(trimmed_path);
    if content.len() > MAX_SHELL_ACTION_REQUEST_BYTES {
        return Err(QuickActionError::invalid(format!("shell-action request exceeds the {} byte limit", MAX_SHELL_ACTION_REQUEST_BYTES)));
    }
    let content = String::from_utf8(content).map_err(|error| QuickActionError::invalid(format!("shell-action request must be UTF-8 JSON: {error}")))?;

    let value = serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| QuickActionError::invalid(format!("invalid shell-action request JSON: {error}")))?;
    if value.get("version").is_some() || value.get("action").is_some() {
        let request = zmanager_shell_contract::ShellActionRequest::from_json(&content).map_err(|error| QuickActionError::invalid(error.to_string()))?;
        return validate_request(request.action, request.paths);
    }

    let request = serde_json::from_value::<QuickActionRequestDto>(value)
        .map_err(|error| QuickActionError::invalid(format!("invalid legacy quick-action request JSON: {error}")))?;
    validate_request(request.kind, request.paths)
}

#[allow(dead_code)]
pub fn parse_app_group_shell_action_request(content: &[u8]) -> Result<QuickActionRequestDto, String> {
    if content.is_empty() || content.len() > MAX_APP_GROUP_SHELL_ACTION_REQUEST_BYTES {
        return Err("App Group shell-action request has an invalid size".to_string());
    }
    let content = std::str::from_utf8(content).map_err(|_| "App Group shell-action request must be UTF-8 JSON".to_string())?;
    let request = zmanager_shell_contract::ShellActionRequest::from_json(content).map_err(|error| error.to_string())?;
    validate_request(request.action, request.paths).map_err(|error| error.message)
}

#[allow(dead_code)]
pub fn validate_ingested_shell_action_request(request: QuickActionRequestDto) -> Result<QuickActionRequestDto, String> {
    validate_request(request.kind, request.paths).map_err(|error| error.message)
}

fn parse_kind(value: &str) -> Result<QuickActionKindDto, QuickActionError> {
    let normalized =
        value.trim().chars().filter(|character| *character != '-' && *character != '_' && *character != ' ').flat_map(char::to_lowercase).collect::<String>();

    zmanager_shell_contract::ShellActionKind::from_normalized_compatibility_alias(&normalized)
        .ok_or_else(|| QuickActionError::invalid(format!("unknown quick action: {value}")).with_hint("Use a generated shell action identifier."))
}

fn validate_request(kind: QuickActionKindDto, paths: Vec<String>) -> Result<QuickActionRequestDto, QuickActionError> {
    let window_disposition = kind.window_disposition();
    validate_request_with_known_kind(kind, paths).map_err(|error| error.with_window_disposition(window_disposition))
}

fn validate_request_with_known_kind(kind: QuickActionKindDto, paths: Vec<String>) -> Result<QuickActionRequestDto, QuickActionError> {
    let paths = normalize_local_paths(paths)?;

    match kind {
        QuickActionKindDto::Open => {
            if paths.is_empty() {
                return Err(QuickActionError::invalid("open requires at least one archive path"));
            }
            validate_all_supported_archives(&paths)?;
        }
        QuickActionKindDto::Compress
        | QuickActionKindDto::CompressZip
        | QuickActionKindDto::CompressTzap
        | QuickActionKindDto::CompressSevenZ
        | QuickActionKindDto::CompressTarZst
        | QuickActionKindDto::CompressTarGz
        | QuickActionKindDto::CompressAppleArchive
        | QuickActionKindDto::CompressCleanSource => {
            if paths.is_empty() {
                return Err(QuickActionError::invalid("compress quick actions require at least one path"));
            }
        }
        QuickActionKindDto::CompressShareOnLan => {
            if paths.is_empty() {
                return Err(QuickActionError::invalid("compress-share-on-lan requires at least one path"));
            }
        }
        QuickActionKindDto::ShareOnLan => {
            if paths.len() != 1 {
                return Err(QuickActionError::invalid("share-on-lan requires exactly one file path"));
            }
        }
        QuickActionKindDto::Extract => {
            if paths.is_empty() {
                return Err(QuickActionError::invalid("extract quick actions require at least one archive path"));
            }
            validate_all_supported_archives(&paths)?;
        }
        QuickActionKindDto::ExtractHere => {
            if paths.is_empty() {
                return Err(QuickActionError::invalid("extract-here requires at least one archive path"));
            }
            validate_all_supported_archives(&paths)?;
        }
        QuickActionKindDto::ExtractToFolder => {
            if paths.len() != 1 {
                return Err(QuickActionError::invalid("extract-to-folder requires exactly one archive path"));
            }
            validate_all_supported_archives(&paths)?;
        }
    }

    Ok(QuickActionRequestDto { kind, paths })
}

fn normalize_local_paths(paths: Vec<String>) -> Result<Vec<String>, QuickActionError> {
    let mut normalized = Vec::new();

    for path in paths {
        let path = path.trim();
        if path.is_empty() {
            continue;
        }

        let path = normalize_local_path(path)?;
        normalized.push(path);
    }

    Ok(normalized)
}

fn normalize_local_path(path: &str) -> Result<String, QuickActionError> {
    if path.contains("://") {
        let url = Url::parse(path).map_err(|_| QuickActionError::invalid(format!("quick-action path must be local: {path}")))?;
        if url.scheme() != "file" {
            return Err(QuickActionError::invalid(format!("quick-action path must be local: {path}")));
        }

        return match url.to_file_path() {
            Ok(path) => Ok(path.to_string_lossy().to_string()),
            Err(()) if url.host_str().is_none() && url.path().starts_with('/') => Ok(percent_decode_uri_path(url.path())),
            Err(()) => Err(QuickActionError::invalid(format!("quick-action path must be local: {path}"))),
        };
    }

    Ok(path.to_string())
}

fn percent_decode_uri_path(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) = (hex_digit_value(bytes[index + 1]), hex_digit_value(bytes[index + 2]))
        {
            decoded.push((high << 4) | low);
            index += 3;
            continue;
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).to_string()
}

fn hex_digit_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn validate_all_supported_archives(paths: &[String]) -> Result<(), QuickActionError> {
    for path in paths {
        if !is_supported_archive_path(path) {
            return Err(QuickActionError::invalid(format!("unsupported archive for quick action: {path}")));
        }
    }

    Ok(())
}

fn is_password_arg(arg: &str) -> bool {
    PASSWORD_ARG_PREFIXES.iter().any(|prefix| arg == *prefix || arg.starts_with(&format!("{prefix}=")))
}

fn is_tzap_volume_archive_name(name: &str) -> bool {
    base_name_without_tzap_volume_suffix(name).is_some()
}

fn base_name_without_tzap_volume_suffix(name: &str) -> Option<&str> {
    if !name.ends_with(TZAP_EXTENSION_SUFFIX) {
        return None;
    }

    let stem = &name[..name.len() - TZAP_EXTENSION_SUFFIX.len()];
    let marker_index = stem.rfind(TZAP_VOLUME_MARKER)?;
    let base_name = &stem[..marker_index];
    let digits = &stem[marker_index + TZAP_VOLUME_MARKER.len()..];
    if base_name.is_empty() || digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }

    Some(base_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn state_from_args(args: &[&str]) -> QuickActionStartupState {
        QuickActionStartupState::from_args(args.iter().map(OsString::from))
    }

    #[test]
    fn app_group_shell_action_contract_parses_and_validates_without_paths_in_arguments() {
        let request = parse_app_group_shell_action_request(br#"{"version":1,"action":"compressZip","paths":["/tmp/one","/tmp/two"]}"#).unwrap();
        assert_eq!(request.kind, QuickActionKindDto::CompressZip);
        assert_eq!(request.paths, ["/tmp/one", "/tmp/two"]);
        assert!(parse_app_group_shell_action_request(br#"{"version":2}"#).is_err());
        assert!(parse_app_group_shell_action_request(&vec![b'x'; 1_048_577]).is_err());
    }

    fn requested(args: &[&str]) -> QuickActionRequestDto {
        match state_from_args(args) {
            QuickActionStartupState::Requested(request) => request,
            other => panic!("expected requested quick action, got {other:?}"),
        }
    }

    fn invalid(args: &[&str]) -> QuickActionError {
        match state_from_args(args) {
            QuickActionStartupState::Invalid(error) => error,
            other => panic!("expected invalid quick action, got {other:?}"),
        }
    }

    fn unique_temp_file(name: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).expect("system time should be after unix epoch").as_nanos();
        std::env::temp_dir().join(format!("zmanager-{name}-{nanos}.json"))
    }

    #[test]
    fn parse_without_quick_action_is_not_requested() {
        assert_eq!(state_from_args(&["--ordinary-open", "C:/tmp/archive.zip"]), QuickActionStartupState::NotRequested);
    }

    #[test]
    fn explicit_quick_actions_use_isolated_processes_without_consuming_request_files() {
        for args in [
            vec!["--quick-action", "compress-zip", "--path", "C:/tmp/source"],
            vec!["--action=extract-here", "--path", "C:/tmp/archive.zip"],
            vec!["--quick-action-request", "C:/tmp/request.json"],
            vec!["--shell-action-request=C:/tmp/request.json"],
        ] {
            assert_eq!(LaunchInstanceMode::from_args(args.into_iter().map(OsString::from), false), LaunchInstanceMode::IsolatedQuickAction,);
        }
    }

    #[test]
    fn normal_and_file_association_launches_remain_singleton() {
        for args in [Vec::<&str>::new(), vec!["C:/tmp/archive.zip"], vec!["file:///home/frank/archive.tzap"]] {
            let mode = LaunchInstanceMode::from_args(args.into_iter().map(OsString::from), false);
            assert_eq!(mode, LaunchInstanceMode::NormalSingleton);
            assert!(mode.registers_single_instance());
        }
    }

    #[test]
    fn hosted_auth_callback_arguments_enter_the_native_inbox_contract() {
        let event = hosted_auth_callback_event_from_args(
            [
                OsString::from("C:/Program Files/ZManager/zmanager-desktop.exe"),
                OsString::from("tzap://auth/callback?state=state-1234567890&result=completed&handoff_code=handoff-code-1234567890"),
            ]
            .into_iter(),
        )
        .expect("callback argument should be recognized");
        assert_eq!(event.kind, NativeInboundEventKind::HostedAuthCallback);
        let NativeInboundPayload::HostedAuthCallback(payload) = event.payload else {
            panic!("expected hosted auth payload");
        };
        assert_eq!(payload.state, "state-1234567890");
        assert_eq!(payload.handoff_code.as_deref(), Some("handoff-code-1234567890"));
        assert_eq!(payload.callback_url.as_deref(), Some("tzap://auth/callback"));
        assert!(hosted_auth_callback_event_from_args([OsString::from("tzap://auth/callback?state=state-1234567890&result=completed&code=secret")]).is_none());
    }

    #[test]
    fn hosted_auth_callback_defaults_completion_when_result_is_omitted() {
        let event = hosted_auth_callback_event_from_args([OsString::from("tzap://auth/callback?state=state-1234567890&handoff_code=handoff-code-1234567890")])
            .expect("approved callback shape should be recognized");
        let NativeInboundPayload::HostedAuthCallback(payload) = event.payload else {
            panic!("expected hosted auth payload");
        };
        assert_eq!(payload.result, HostedAuthResult::Completed);
        assert_eq!(payload.handoff_code.as_deref(), Some("handoff-code-1234567890"));
    }

    #[test]
    fn pending_macos_quick_actions_use_isolated_processes() {
        assert_eq!(LaunchInstanceMode::from_args(std::iter::empty(), true), LaunchInstanceMode::IsolatedQuickAction,);
    }

    #[test]
    fn parse_plain_supported_archive_arg_as_open_request() {
        let request = requested(&["C:/tmp/archive.tzap"]);

        assert_eq!(request.kind, QuickActionKindDto::Open);
        assert_eq!(request.paths, ["C:/tmp/archive.tzap"]);
    }

    #[test]
    fn parse_file_uri_archive_arg_as_open_request() {
        let request = requested(&["file:///home/frank/Documents/beeware-tutorial.tzap"]);

        assert_eq!(request.kind, QuickActionKindDto::Open);
        assert_eq!(request.paths, ["/home/frank/Documents/beeware-tutorial.tzap"]);
    }

    #[test]
    fn parse_secondary_process_args_ignores_linux_executable_argv() {
        let state = QuickActionStartupState::from_process_or_user_args(
            ["/usr/bin/zmanager-desktop", "file:///home/frank/Documents/beeware-tutorial.tzap"].into_iter().map(OsString::from).collect(),
        );

        let QuickActionStartupState::Requested(request) = state else {
            panic!("expected open request from secondary process args, got {state:?}");
        };

        assert_eq!(request.kind, QuickActionKindDto::Open);
        assert_eq!(request.paths, ["/home/frank/Documents/beeware-tutorial.tzap"]);
    }

    #[test]
    fn parse_accepts_kebab_and_camel_case_actions() {
        let preferred_compress = requested(&["--quick-action", "compress", "--path", "C:/tmp/source one", "C:/tmp/source two"]);
        assert_eq!(preferred_compress.kind, QuickActionKindDto::Compress);
        assert_eq!(preferred_compress.paths, ["C:/tmp/source one", "C:/tmp/source two"]);

        let preferred_extract = requested(&["--quick-action=extract", "--path", "C:/tmp/archive.tar.zst"]);
        assert_eq!(preferred_extract.kind, QuickActionKindDto::Extract);
        assert_eq!(preferred_extract.paths, ["C:/tmp/archive.tar.zst"]);

        let compress = requested(&["--quick-action", "compress-zip", "--path", "C:/tmp/source one", "C:/tmp/source two"]);
        assert_eq!(compress.kind, QuickActionKindDto::CompressZip);
        assert_eq!(compress.paths, ["C:/tmp/source one", "C:/tmp/source two"]);

        let compress_tzap = requested(&["--quick-action", "compress-tzap", "--path", "C:/tmp/source"]);
        assert_eq!(compress_tzap.kind, QuickActionKindDto::CompressTzap);

        let compress_seven_z = requested(&["--quick-action", "compress-7z", "--path", "C:/tmp/source"]);
        assert_eq!(compress_seven_z.kind, QuickActionKindDto::CompressSevenZ);

        let compress_tzst = requested(&["--quick-action", "compress-tzst", "--path", "C:/tmp/source"]);
        assert_eq!(compress_tzst.kind, QuickActionKindDto::CompressTarZst);

        let compress_tgz = requested(&["--quick-action", "compress-tgz", "--path", "C:/tmp/source"]);
        assert_eq!(compress_tgz.kind, QuickActionKindDto::CompressTarGz);

        let compress_share_on_lan = requested(&["--quick-action", "compress-share-on-lan", "--path", "C:/tmp/one", "C:/tmp/two"]);
        assert_eq!(compress_share_on_lan.kind, QuickActionKindDto::CompressShareOnLan);
        assert_eq!(compress_share_on_lan.paths, ["C:/tmp/one", "C:/tmp/two"]);

        let share_on_lan = requested(&["--quick-action", "share-lan", "--path", "C:/tmp/file.txt"]);
        assert_eq!(share_on_lan.kind, QuickActionKindDto::ShareOnLan);
        assert_eq!(share_on_lan.paths, ["C:/tmp/file.txt"]);

        let unknown_option_compress = requested(&["--quick-action", "compress-tzap", "--ignored-shell-option", "--path", "C:/tmp/source"]);
        assert_eq!(unknown_option_compress.kind, QuickActionKindDto::CompressTzap);
        assert_eq!(unknown_option_compress.paths, ["C:/tmp/source"]);

        let extract = requested(&["--quick-action=extractToFolder", "--path", "C:/tmp/archive.tar.zst"]);
        assert_eq!(extract.kind, QuickActionKindDto::ExtractToFolder);
        assert_eq!(extract.paths, ["C:/tmp/archive.tar.zst"]);
    }

    #[test]
    fn parse_accepts_repeated_path_groups() {
        let request = requested(&["--quick-action", "extract-here", "--path", "C:/tmp/one.zip", "--path", "C:/tmp/two.tzap"]);

        assert_eq!(request.kind, QuickActionKindDto::ExtractHere);
        assert_eq!(request.paths, ["C:/tmp/one.zip", "C:/tmp/two.tzap"]);
    }

    #[test]
    fn direct_share_rejects_multiple_paths() {
        let error = invalid(&["--quick-action", "share-lan", "--path", "C:/tmp/one.txt", "C:/tmp/two.txt"]);

        assert_eq!(error.message, "share-on-lan requires exactly one file path");
    }

    #[test]
    fn parse_accepts_structured_quick_action_request_file() {
        let request_path = unique_temp_file("quick-action-request");
        std::fs::write(&request_path, r#"{"kind":"compressZip","paths":["C:/tmp/source one","C:/tmp/source two"]}"#)
            .expect("quick-action request fixture should write");

        let request_path_text = request_path.to_string_lossy().to_string();
        let request = requested(&["--quick-action-request", &request_path_text]);

        assert_eq!(request.kind, QuickActionKindDto::CompressZip);
        assert_eq!(request.paths, ["C:/tmp/source one", "C:/tmp/source two"]);
        assert!(!request_path.exists(), "consumed request file should be removed");
    }

    #[test]
    fn parse_accepts_versioned_shell_action_request_file() {
        let request_path = unique_temp_file("shell-action-request");
        std::fs::write(&request_path, r#"{"version":1,"action":"compressZip","paths":["C:/tmp/source one","C:/tmp/source two"]}"#)
            .expect("shell-action request fixture should write");

        let request_path_text = request_path.to_string_lossy().to_string();
        let request = requested(&["--shell-action-request", &request_path_text]);

        assert_eq!(request.kind, QuickActionKindDto::CompressZip);
        assert_eq!(request.paths, ["C:/tmp/source one", "C:/tmp/source two"]);
        assert!(!request_path.exists(), "consumed request file should be removed");
    }

    #[test]
    fn versioned_shell_action_request_rejects_unknown_versions() {
        let request_path = unique_temp_file("future-shell-action-request");
        std::fs::write(&request_path, r#"{"version":2,"action":"compressZip","paths":["C:/tmp/source"]}"#)
            .expect("future shell-action request fixture should write");

        let request_path_text = request_path.to_string_lossy().to_string();
        let error = invalid(&["--shell-action-request", &request_path_text]);

        assert_eq!(error.message, "unsupported shell-action request version: 2");
        assert!(!request_path.exists(), "rejected request file should be removed");
    }

    #[test]
    fn malformed_shell_action_request_is_removed_after_reading() {
        let request_path = unique_temp_file("malformed-shell-action-request");
        std::fs::write(&request_path, [0xff, 0xfe, 0xfd]).expect("malformed shell-action request fixture should write");

        let request_path_text = request_path.to_string_lossy().to_string();
        let error = invalid(&["--shell-action-request", &request_path_text]);

        assert!(error.message.contains("must be UTF-8 JSON"));
        assert!(!request_path.exists(), "malformed request file should be removed");
    }

    #[test]
    fn startup_coordinator_returns_one_atomic_shell_request_without_waiting() {
        let coordinator = QuickActionLaunchCoordinator::from_startup_state(QuickActionStartupState::Requested(QuickActionRequestDto {
            kind: QuickActionKindDto::CompressZip,
            paths: vec!["C:/tmp/one".to_string(), "C:/tmp/two".to_string()],
        }));

        let request = match coordinator.startup_state() {
            QuickActionStartupState::Requested(request) => request,
            other => panic!("expected atomic create request, got {other:?}"),
        };

        assert_eq!(request.kind, QuickActionKindDto::CompressZip);
        assert_eq!(request.paths, ["C:/tmp/one", "C:/tmp/two"]);
        assert_eq!(coordinator.startup_state(), QuickActionStartupState::NotRequested);
    }

    #[test]
    fn cold_start_multi_select_exposes_only_the_disposition_marker() {
        let coordinator = QuickActionLaunchCoordinator::from_startup_state(QuickActionStartupState::Requested(QuickActionRequestDto {
            kind: QuickActionKindDto::CompressZip,
            paths: vec!["C:/tmp/folder1".to_string(), "C:/tmp/folder2".to_string()],
        }));

        let response = coordinator.startup_state().to_dto();

        assert_eq!(response.window_disposition, Some(QuickActionWindowDispositionDto::DisposableTask),);
    }

    #[test]
    fn cold_start_forwarding_preserves_disposable_window_disposition_without_duplicate_request() {
        let inbox = crate::native_launch_inbox::NativeLaunchInbox::new();
        let delivered = Arc::new(Mutex::new(Vec::new()));
        let delivered_for_emitter = delivered.clone();
        inbox
            .attach_emitter(Arc::new(move |_window, event| {
                delivered_for_emitter.lock().expect("delivery lock poisoned").push(event.clone());
                Ok(())
            }))
            .unwrap();
        let forwarded =
            QuickActionStartupState::Requested(QuickActionRequestDto { kind: QuickActionKindDto::CompressTzap, paths: vec!["C:/tmp/source".to_string()] })
                .forward_requested_to_native_inbox(&inbox);

        let dto = forwarded.to_dto();
        assert!(dto.launched_for_quick_action);
        assert_eq!(dto.window_disposition, Some(crate::dto::QuickActionWindowDispositionDto::DisposableTask));

        assert_eq!(inbox.frontend_ready("main"), Ok(1));
        let delivered = delivered.lock().expect("delivery lock poisoned");
        assert_eq!(delivered.len(), 1);
        let crate::native_launch_inbox::NativeInboundPayload::ShellActionRequest(payload) = &delivered[0].payload else {
            panic!("expected one forwarded shell action request");
        };
        assert_eq!(payload.request.kind, QuickActionKindDto::CompressTzap);
        assert_eq!(payload.request.paths, ["C:/tmp/source"]);
    }

    #[test]
    fn structured_quick_action_request_file_uses_normal_validation() {
        let request_path = unique_temp_file("invalid-quick-action-request");
        std::fs::write(&request_path, r#"{"kind":"extractHere","paths":["C:/tmp/notes.txt"]}"#).expect("invalid quick-action request fixture should write");

        let request_path_text = request_path.to_string_lossy().to_string();
        let error = invalid(&["--quick-action-request", &request_path_text]);

        assert!(error.message.contains("unsupported archive"));
        assert!(!request_path.exists(), "rejected request file should be removed");
    }

    #[test]
    fn compress_actions_require_at_least_one_local_path() {
        assert_eq!(invalid(&["--quick-action", "compress-zip"]).message, "compress quick actions require at least one path");

        let request = requested(&["--quick-action", "compress-clean-source", "--path", "notes.txt"]);
        assert_eq!(request.kind, QuickActionKindDto::CompressCleanSource);
        assert_eq!(request.paths, ["notes.txt"]);
    }

    #[test]
    fn extract_here_accepts_multiple_supported_archives() {
        let request = requested(&["--quick-action", "extract", "--path", "first.zip", "second.tar", "third.vol001.tzap"]);

        assert_eq!(request.kind, QuickActionKindDto::Extract);
        assert_eq!(request.paths, ["first.zip", "second.tar", "third.vol001.tzap"]);
    }

    #[test]
    fn extract_actions_reject_unsupported_archives() {
        let error = invalid(&["--quick-action", "extract", "--path", "notes.txt"]);

        assert_eq!(error.code, crate::constants::COMMAND_ERROR_INVALID_REQUEST);
        assert!(error.message.contains("unsupported archive"));
    }

    #[test]
    fn extract_to_folder_accepts_exactly_one_archive() {
        let request = requested(&["--quick-action", "extract-to-folder", "--path", "archive.7z.001"]);
        assert_eq!(request.kind, QuickActionKindDto::ExtractToFolder);

        assert_eq!(
            invalid(&["--quick-action", "extract-to-folder", "--path", "one.zip", "two.zip",]).message,
            "extract-to-folder requires exactly one archive path"
        );
    }

    #[test]
    fn quick_actions_reject_remote_urls_and_password_args() {
        assert!(invalid(&["--quick-action", "compress-zip", "--path", "https://example.com/a"]).message.contains("must be local"));
        assert!(invalid(&["--quick-action", "extract", "--password", "secret", "--path", "archive.zip",]).message.contains("passwords cannot be supplied"));
    }

    #[test]
    fn supported_archive_detection_matches_macos_contract() {
        for path in [
            "archive.zip",
            "archive.ZIP",
            "archive.tar",
            "archive.tzap",
            "archive.vol000.tzap",
            "archive.vol001.tzap",
            "archive.tzst",
            "archive.tar.zst",
            "archive.tar.lzma",
            "archive.tar.Z",
            "archive.7z",
            "archive.7z.001",
            "archive.rar",
            "archive.deb",
            "archive.iso",
            "archive.warc",
            "archive.lib",
            r"C:\tmp\bundle.TAR.GZ",
        ] {
            assert!(is_supported_archive_path(path), "{path} should be supported");
        }

        for path in ["notes.txt", "image.png", "archive", "archive.zmanager", "archive.7z.002", "archive.z01"] {
            assert!(!is_supported_archive_path(path), "{path} should not be supported");
        }
    }

    #[test]
    fn startup_state_exposes_tzap_disposition_without_a_second_execution_path() {
        let coordinator = QuickActionLaunchCoordinator::from_startup_state(QuickActionStartupState::Requested(QuickActionRequestDto {
            kind: QuickActionKindDto::CompressTzap,
            paths: vec!["C:/tmp/source".to_string()],
        }));
        let response = coordinator.startup_state().to_dto();

        assert!(response.launched_for_quick_action);
        assert!(response.error.is_none());
        assert_eq!(response.window_disposition, Some(QuickActionWindowDispositionDto::DisposableTask),);
    }

    #[test]
    fn invalid_known_action_preserves_its_window_disposition() {
        let response = state_from_args(&["--quick-action", "compressZip"]).to_dto();

        assert!(response.error.is_some());
        assert_eq!(response.window_disposition, Some(QuickActionWindowDispositionDto::DisposableTask),);
    }
}
