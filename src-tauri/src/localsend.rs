//! Tauri command surface over `zmanager-localsend`'s `LocalSendRegistry`.
//!
//! The registry's own public API (`poll_events`) is a drain-a-queue call,
//! not a subscribable stream, so this module runs its own short-interval
//! poll loop in a background thread and re-emits each event to the
//! frontend as a push (`zmanager-localsend-event`) — the frontend never
//! polls. The loop also owns two decisions that don't belong on the
//! frontend: auto-accepting transfers from devices in the `TrustStore`, and
//! auto-extracting received archives via the same internal entry point
//! `start_extract` itself uses.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::dto::{DestinationCollisionStrategyDto, OverwritePolicyDto, StartExtractRequest, TzapRestorePolicyDto};
use crate::error::CommandErrorDto;
use crate::job_registry::JobRegistry;

const LOCALSEND_EVENT_NAME: &str = "zmanager-localsend-event";
const TRUST_STORE_FILE_NAME: &str = "localsend-trusted-fingerprints.json";
const LEGACY_DEFAULT_ALIAS: &str = "ZManager Desktop";
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(150);

type LocalSendEventSink = Arc<dyn Fn(LocalSendEventDto) + Send + Sync>;

// ---------------------------------------------------------------------
// Trust store — a small, LocalSend-specific fingerprint allowlist. Mirrors
// the design already proven in the sibling zmanager-mobile repo's
// rust/zmanager-mobile-core/src/trust_store.rs; kept as an independent copy
// here rather than a shared dependency (small enough that duplicating it is
// simpler than coupling to a private crate in a different repo). This is
// deliberately unrelated to the Identity & Contacts signing-certificate
// system in account.rs, which is about encrypted-archive recipients, not
// LAN peers.
// ---------------------------------------------------------------------

#[derive(Clone)]
pub struct TrustStore {
    path: PathBuf,
    // Serializes remember/forget's read-modify-write cycle so two concurrent
    // Tauri command invocations (trust-device and untrust-device can both
    // run on the async runtime's blocking pool at once) can't race and lose
    // an update.
    write_lock: Arc<Mutex<()>>,
}

impl TrustStore {
    pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self { path: app_data_dir.into().join(TRUST_STORE_FILE_NAME), write_lock: Arc::new(Mutex::new(())) }
    }

    pub fn is_trusted(&self, fingerprint: &str) -> bool {
        self.fingerprints().iter().any(|existing| existing == fingerprint)
    }

    pub fn remember(&self, fingerprint: impl Into<String>) -> Result<(), CommandErrorDto> {
        let _guard = self.write_lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut fingerprints = self.fingerprints();
        let fingerprint = fingerprint.into();
        if !fingerprints.contains(&fingerprint) {
            fingerprints.push(fingerprint);
        }
        self.write(fingerprints)
    }

    pub fn forget(&self, fingerprint: &str) -> Result<(), CommandErrorDto> {
        let _guard = self.write_lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut fingerprints = self.fingerprints();
        fingerprints.retain(|existing| existing != fingerprint);
        self.write(fingerprints)
    }

    pub fn fingerprints(&self) -> Vec<String> {
        let Ok(text) = fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        let mut fingerprints = serde_json::from_str::<Vec<String>>(&text).unwrap_or_default();
        fingerprints.sort();
        fingerprints.dedup();
        fingerprints
    }

    fn write(&self, mut fingerprints: Vec<String>) -> Result<(), CommandErrorDto> {
        fingerprints.sort();
        fingerprints.dedup();
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| crate::commands::map_io_error(parent.to_string_lossy().into_owned(), error))?;
        }
        let temporary_path = self.path.with_extension(format!("json.{}.tmp", std::process::id()));
        let text = serde_json::to_string_pretty(&fingerprints).map_err(|error| CommandErrorDto::invalid_request(error.to_string()))?;
        fs::write(&temporary_path, &text).map_err(|error| crate::commands::map_io_error(temporary_path.to_string_lossy().into_owned(), error))?;
        fs::rename(&temporary_path, &self.path).map_err(|error| crate::commands::map_io_error(self.path.to_string_lossy().into_owned(), error))?;
        Ok(())
    }
}

// ---------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------

#[derive(Clone)]
struct ReceiveConfig {
    receive_folder: PathBuf,
    auto_extract: bool,
}

#[derive(Clone)]
pub struct LocalSendState {
    registry: Arc<zmanager_localsend::LocalSendRegistry>,
    default_alias: String,
    trust_store: TrustStore,
    receive_config: Arc<Mutex<Option<ReceiveConfig>>>,
    poll_stop: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    poll_thread: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    outgoing_event_sink: Arc<Mutex<Option<LocalSendEventSink>>>,
}

impl LocalSendState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let registry = zmanager_localsend::registry();
        let default_alias = default_device_alias();
        // A LocalSend device is its certificate fingerprint, so this identity
        // has to outlive the process: without it we are a new device to every
        // peer on every launch, and the trust store beside it — which is keyed
        // by fingerprint — would never match after a restart. A failure here
        // is not fatal; the registry falls back to a per-process identity and
        // LocalSend still works, minus the stable identity.
        if let Err(error) = registry.set_identity_dir(&app_data_dir) {
            eprintln!("zmanager-localsend: LocalSend identity will not persist across restarts: {error}");
        }

        Self {
            registry,
            default_alias,
            trust_store: TrustStore::new(app_data_dir),
            receive_config: Arc::new(Mutex::new(None)),
            poll_stop: Arc::new(Mutex::new(None)),
            poll_thread: Arc::new(Mutex::new(None)),
            outgoing_event_sink: Arc::new(Mutex::new(None)),
        }
    }

    pub(crate) fn register_outgoing_event_sink(&self, sink: LocalSendEventSink) {
        *self.outgoing_event_sink.lock().unwrap_or_else(|error| error.into_inner()) = Some(sink);
    }

    pub(crate) fn start_event_pump(&self, app: AppHandle, job_registry: JobRegistry) {
        let mut stop_guard = self.poll_stop.lock().unwrap_or_else(|error| error.into_inner());
        if stop_guard.is_some() {
            return;
        }
        let stop_flag = Arc::new(AtomicBool::new(false));
        *stop_guard = Some(stop_flag.clone());
        drop(stop_guard);
        let shared = self.clone();
        let thread = thread::spawn(move || spawn_event_pump(app, shared, job_registry, stop_flag));
        *self.poll_thread.lock().unwrap_or_else(|error| error.into_inner()) = Some(thread);
    }

    pub(crate) fn send_file_for_share(
        &self,
        send_id: &str,
        alias: &str,
        target: LocalSendDeviceInfoDto,
        file_path: &Path,
    ) -> Result<LocalSendSendFileResultDto, CommandErrorDto> {
        if !file_path.is_file() {
            return Err(CommandErrorDto::not_found("share artifact is no longer a regular file", None));
        }
        let request = zmanager_localsend::SendFileRequest {
            send_id: send_id.to_string(),
            alias: self.advertised_alias(alias),
            self_port: default_localsend_port(),
            https: true,
            target: target.into(),
            file_path: file_path.to_path_buf(),
            pin: None,
        };
        self.registry.send_file(request).map(LocalSendSendFileResultDto::from).map_err(map_localsend_error)
    }

    fn advertised_alias(&self, alias: &str) -> String {
        let alias = alias.trim();
        if alias.is_empty() || alias.eq_ignore_ascii_case(LEGACY_DEFAULT_ALIAS) { self.default_alias.clone() } else { alias.to_owned() }
    }

    pub(crate) fn cancel_send_for_share(&self, send_id: &str) -> Result<(), CommandErrorDto> {
        self.registry.cancel_send(&zmanager_localsend::CancelSendRequest { send_id: send_id.to_string() }).map_err(map_localsend_error)
    }

    /// Stops the event pump and the receiver, if either is running. Safe to
    /// call unconditionally on app shutdown.
    pub fn shutdown(&self) {
        if let Some(stop_flag) = self.poll_stop.lock().unwrap_or_else(|error| error.into_inner()).take() {
            stop_flag.store(true, Ordering::Relaxed);
        }
        if let Some(thread) = self.poll_thread.lock().unwrap_or_else(|error| error.into_inner()).take() {
            let _ = thread.join();
        }
        let _ = self.registry.stop_receiver();
    }
}

// ---------------------------------------------------------------------
// JSON-facing DTOs (camelCase, matching this codebase's Tauri command
// convention) over the crate's own snake_case-serialized types.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendDeviceInfoDto {
    pub alias: String,
    pub fingerprint: String,
    pub port: u16,
    pub protocol: String,
    pub ip: Option<String>,
    pub device_model: Option<String>,
}

impl From<zmanager_localsend::DeviceInfoDto> for LocalSendDeviceInfoDto {
    fn from(value: zmanager_localsend::DeviceInfoDto) -> Self {
        Self { alias: value.alias, fingerprint: value.fingerprint, port: value.port, protocol: value.protocol, ip: value.ip, device_model: value.device_model }
    }
}

impl From<LocalSendDeviceInfoDto> for zmanager_localsend::DeviceInfoDto {
    fn from(value: LocalSendDeviceInfoDto) -> Self {
        Self { alias: value.alias, fingerprint: value.fingerprint, port: value.port, protocol: value.protocol, ip: value.ip, device_model: value.device_model }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendTransferFileDto {
    pub id: String,
    pub file_name: String,
    pub size: u64,
    pub file_type: String,
}

impl From<zmanager_localsend::TransferFile> for LocalSendTransferFileDto {
    fn from(value: zmanager_localsend::TransferFile) -> Self {
        Self { id: value.id, file_name: value.file_name, size: value.size, file_type: value.file_type }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LocalSendTransferDecisionDto {
    Accept,
    AcceptFiles,
    Decline,
    Refuse,
}

impl From<LocalSendTransferDecisionDto> for zmanager_localsend::TransferDecisionKind {
    fn from(value: LocalSendTransferDecisionDto) -> Self {
        match value {
            LocalSendTransferDecisionDto::Accept => Self::Accept,
            LocalSendTransferDecisionDto::AcceptFiles => Self::AcceptFiles,
            LocalSendTransferDecisionDto::Decline => Self::Decline,
            LocalSendTransferDecisionDto::Refuse => Self::Refuse,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LocalSendEventDto {
    PeerRegistered {
        device: LocalSendDeviceInfoDto,
    },
    TransferRequest {
        request_id: String,
        sender: LocalSendDeviceInfoDto,
        files: Vec<LocalSendTransferFileDto>,
    },
    TextReceived {
        session_id: String,
        text: String,
        sender_alias: String,
    },
    FileReceiveProgress {
        session_id: String,
        file_id: String,
        file_name: String,
        sender_alias: String,
        bytes_received: u64,
        total_bytes: u64,
        file_count: usize,
    },
    FileReceived {
        session_id: String,
        file_id: String,
        file_name: String,
        path: String,
    },
    SessionDone {
        session_id: String,
    },
    FileSendProgress {
        send_id: String,
        session_id: String,
        file_id: String,
        file_name: String,
        bytes_sent: u64,
        total_bytes: u64,
        rate_bytes_per_second: f64,
    },
}

impl From<zmanager_localsend::QueuedEvent> for LocalSendEventDto {
    fn from(value: zmanager_localsend::QueuedEvent) -> Self {
        match value {
            zmanager_localsend::QueuedEvent::PeerRegistered { device } => Self::PeerRegistered { device: device.into() },
            zmanager_localsend::QueuedEvent::TransferRequest { request_id, sender, files } => {
                Self::TransferRequest { request_id, sender: sender.into(), files: files.into_iter().map(Into::into).collect() }
            }
            zmanager_localsend::QueuedEvent::TextReceived { session_id, text, sender_alias } => Self::TextReceived { session_id, text, sender_alias },
            zmanager_localsend::QueuedEvent::FileReceiveProgress { session_id, file_id, file_name, sender_alias, bytes_received, total_bytes, file_count } => {
                Self::FileReceiveProgress { session_id, file_id, file_name, sender_alias, bytes_received, total_bytes, file_count }
            }
            zmanager_localsend::QueuedEvent::FileReceived { session_id, file_id, file_name, path } => {
                Self::FileReceived { session_id, file_id, file_name, path: path.to_string_lossy().into_owned() }
            }
            zmanager_localsend::QueuedEvent::SessionDone { session_id } => Self::SessionDone { session_id },
            zmanager_localsend::QueuedEvent::FileSendProgress { send_id, session_id, file_id, file_name, bytes_sent, total_bytes, rate_bytes_per_second } => {
                Self::FileSendProgress { send_id, session_id, file_id, file_name, bytes_sent, total_bytes, rate_bytes_per_second }
            }
        }
    }
}

fn default_localsend_port() -> u16 {
    zmanager_localsend::protocol::DEFAULT_HTTP_PORT
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendDiscoverRequestDto {
    pub alias: String,
    #[serde(default = "default_localsend_port")]
    pub port: u16,
    #[serde(default)]
    pub https: bool,
    #[serde(default = "default_discover_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_discover_timeout_ms() -> u64 {
    3_000
}

fn environment_value(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| std::env::var(name).ok().and_then(|value| clean_alias_component(&value)))
}

fn clean_alias_component(value: &str) -> Option<String> {
    let normalized = value
        .chars()
        .map(|character| if character.is_control() { ' ' } else { character })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let component = normalized.trim();
    (!component.is_empty()).then(|| component.chars().take(32).collect())
}

fn default_device_alias() -> String {
    let username = environment_value(&["USER", "USERNAME"]);
    let hostname = environment_value(&["HOSTNAME", "COMPUTERNAME"]);
    default_device_alias_for(std::env::consts::OS, username.as_deref(), hostname.as_deref())
}

fn default_device_alias_for(platform: &str, username: Option<&str>, hostname: Option<&str>) -> String {
    let platform = match platform {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    };
    match (username, hostname) {
        (Some(username), Some(hostname)) => format!("ZManager {platform} · {username} · {hostname}"),
        (Some(username), None) => format!("ZManager {platform} · {username}"),
        (None, Some(hostname)) => format!("ZManager {platform} · {hostname}"),
        (None, None) => format!("ZManager {platform}"),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendStartReceiverRequestDto {
    pub alias: String,
    #[serde(default = "default_localsend_port")]
    pub port: u16,
    #[serde(default)]
    pub https: bool,
    #[serde(default)]
    pub pin: Option<String>,
    pub receive_folder_path: String,
    #[serde(default = "default_true")]
    pub auto_extract: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendRespondToTransferRequestDto {
    pub request_id: String,
    pub decision: LocalSendTransferDecisionDto,
    #[serde(default)]
    pub file_ids: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

impl From<LocalSendRespondToTransferRequestDto> for zmanager_localsend::RespondToTransferRequest {
    fn from(value: LocalSendRespondToTransferRequestDto) -> Self {
        Self { request_id: value.request_id, decision: value.decision.into(), file_ids: value.file_ids, reason: value.reason }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSendSendFileResultDto {
    pub session_id: String,
    pub file_id: String,
}

impl From<zmanager_localsend::SendFileResult> for LocalSendSendFileResultDto {
    fn from(value: zmanager_localsend::SendFileResult) -> Self {
        Self { session_id: value.session_id, file_id: value.file_id }
    }
}

fn map_localsend_error(error: zmanager_localsend::LocalSendBridgeError) -> CommandErrorDto {
    use zmanager_localsend::LocalSendBridgeError as E;
    match error {
        E::ReceiverAlreadyRunning => CommandErrorDto::invalid_request("A LAN receiver is already running"),
        E::NoReceiverRunning => CommandErrorDto::invalid_request("No LAN receiver is running"),
        E::UnknownRequestId(id) => CommandErrorDto::invalid_request(format!("Unknown transfer request id: {id}")),
        E::UnknownSendId(id) => CommandErrorDto::invalid_request(format!("Unknown send id: {id}")),
        E::InvalidRequest(message) => CommandErrorDto::invalid_request(message),
        E::SendCancelled => CommandErrorDto::cancelled("The LAN transfer was cancelled"),
        E::Io(source) => CommandErrorDto::io_error(source.to_string(), true),
        E::LocalSend(source) => CommandErrorDto::operation_failed(source.to_string()),
    }
}

// ---------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------

#[tauri::command]
pub async fn localsend_discover(
    request: LocalSendDiscoverRequestDto,
    state: State<'_, LocalSendState>,
) -> Result<Vec<LocalSendDeviceInfoDto>, CommandErrorDto> {
    let local_send = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let LocalSendDiscoverRequestDto { alias, port, https, timeout_ms } = request;
        // An empty list preserves the desktop request contract while letting
        // zmanager-localsend resolve the local interfaces through its official
        // discovery path.
        let request = zmanager_localsend::DiscoverRequest { alias: local_send.advertised_alias(&alias), port, https, timeout_ms, interface_ips: Vec::new() };
        local_send.registry.discover(request).map(|devices| devices.into_iter().map(Into::into).collect()).map_err(map_localsend_error)
    })
    .await
    .map_err(|error| CommandErrorDto::operation_failed(format!("LAN discovery task failed: {error}")))?
}

#[tauri::command]
pub fn localsend_respond_to_transfer(request: LocalSendRespondToTransferRequestDto, state: State<'_, LocalSendState>) -> Result<(), CommandErrorDto> {
    state.registry.respond_to_transfer(request.into()).map_err(map_localsend_error)
}

/// Resolves the LAN receive folder: the caller-supplied path if non-blank
/// (the frontend's `lanShareReceiveFolderPath` preference), otherwise
/// `<Downloads>/ZManager LAN`. The preference defaults to blank, so this
/// fallback — not a required field — is what makes "receive with no setup"
/// work.
fn resolve_receive_folder(app: &AppHandle, receive_folder_path: &str) -> Result<PathBuf, CommandErrorDto> {
    if !receive_folder_path.is_empty() {
        return Ok(PathBuf::from(receive_folder_path));
    }
    let download_dir = app.path().download_dir().map_err(|error| CommandErrorDto::io_error(error.to_string(), false))?;
    Ok(download_dir.join("ZManager LAN"))
}

#[tauri::command]
pub fn localsend_start_receiver(
    request: LocalSendStartReceiverRequestDto,
    app: AppHandle,
    state: State<'_, LocalSendState>,
    _job_registry: State<'_, JobRegistry>,
) -> Result<(), CommandErrorDto> {
    let receive_folder = resolve_receive_folder(&app, request.receive_folder_path.trim())?;
    fs::create_dir_all(&receive_folder).map_err(|error| crate::commands::map_io_error(receive_folder.to_string_lossy().into_owned(), error))?;

    state
        .registry
        .start_receiver(zmanager_localsend::StartReceiverRequest {
            alias: state.advertised_alias(&request.alias),
            port: request.port,
            https: request.https,
            save_dir: receive_folder.clone(),
            // Desktop never lets the underlying server auto-accept every
            // transfer; per-fingerprint auto-accept is handled by the event
            // pump below via `TrustStore`, so every other sender still gets
            // the accept/decline prompt.
            auto_accept: false,
            pin: request.pin,
        })
        .map_err(map_localsend_error)?;

    *state.receive_config.lock().unwrap_or_else(|error| error.into_inner()) = Some(ReceiveConfig { receive_folder, auto_extract: request.auto_extract });

    Ok(())
}

#[tauri::command]
pub fn localsend_stop_receiver(state: State<'_, LocalSendState>) -> Result<(), CommandErrorDto> {
    *state.receive_config.lock().unwrap_or_else(|error| error.into_inner()) = None;
    state.registry.stop_receiver().map_err(map_localsend_error)
}

#[tauri::command]
pub fn localsend_list_trusted_devices(state: State<'_, LocalSendState>) -> Vec<String> {
    state.trust_store.fingerprints()
}

#[tauri::command]
pub fn localsend_trust_device(fingerprint: String, state: State<'_, LocalSendState>) -> Result<(), CommandErrorDto> {
    state.trust_store.remember(fingerprint)
}

#[tauri::command]
pub fn localsend_untrust_device(fingerprint: String, state: State<'_, LocalSendState>) -> Result<(), CommandErrorDto> {
    state.trust_store.forget(&fingerprint)
}

// ---------------------------------------------------------------------
// Event pump: bridges the registry's poll-a-queue API to a frontend push
// event, and owns the two receive-side decisions that don't belong on the
// frontend (trusted-fingerprint auto-accept, auto-extract).
// ---------------------------------------------------------------------

fn spawn_event_pump(app: AppHandle, shared: LocalSendState, job_registry: JobRegistry, stop_flag: Arc<AtomicBool>) {
    while !stop_flag.load(Ordering::Relaxed) {
        let drained = shared.registry.poll_events();
        for event in drained.events {
            if let zmanager_localsend::QueuedEvent::FileSendProgress { send_id, session_id, file_id, file_name, bytes_sent, total_bytes, rate_bytes_per_second } =
                &event
                && let Some(sink) = shared.outgoing_event_sink.lock().unwrap_or_else(|error| error.into_inner()).clone()
            {
                sink(LocalSendEventDto::FileSendProgress {
                    send_id: send_id.clone(),
                    session_id: session_id.clone(),
                    file_id: file_id.clone(),
                    file_name: file_name.clone(),
                    bytes_sent: *bytes_sent,
                    total_bytes: *total_bytes,
                    rate_bytes_per_second: *rate_bytes_per_second,
                });
            }
            handle_queued_event(&app, &shared, &job_registry, event);
        }
        thread::sleep(EVENT_POLL_INTERVAL);
    }
}

fn handle_queued_event(app: &AppHandle, shared: &LocalSendState, job_registry: &JobRegistry, event: zmanager_localsend::QueuedEvent) {
    if let zmanager_localsend::QueuedEvent::TransferRequest { request_id, sender, .. } = &event
        && shared.trust_store.is_trusted(&sender.fingerprint)
    {
        let _ = shared.registry.respond_to_transfer(zmanager_localsend::RespondToTransferRequest {
            request_id: request_id.clone(),
            decision: zmanager_localsend::TransferDecisionKind::Accept,
            file_ids: Vec::new(),
            reason: None,
        });
        // Already resolved above — never forward this one to the frontend.
        // The accept/decline prompt only makes sense for a request that's
        // still pending, and responding again would fail with
        // `UnknownRequestId` since the registry already consumed it.
        return;
    }

    if let zmanager_localsend::QueuedEvent::FileReceived { path, .. } = &event {
        maybe_auto_extract(shared, job_registry, path);
    }

    let dto = LocalSendEventDto::from(event);
    let _ = app.emit(LOCALSEND_EVENT_NAME, &dto);
}

fn maybe_auto_extract(shared: &LocalSendState, job_registry: &JobRegistry, received_path: &Path) {
    let config = shared.receive_config.lock().unwrap_or_else(|error| error.into_inner()).clone();
    let Some(config) = config else {
        return;
    };
    let Some(request) = build_auto_extract_request(&config, received_path) else {
        return;
    };

    if let Err(error) = crate::commands::start_extract_internal_with_recipient_key(request, job_registry, None) {
        eprintln!("zmanager-localsend: auto-extract of {} failed: {error:?}", received_path.display());
    }
}

/// Pure request-construction step, split out from [`maybe_auto_extract`] so
/// it's testable without spawning a real extract job. Returns `None` when
/// auto-extract is disabled or the received file isn't a recognized archive
/// format — those files are left in the receive folder as-is.
fn build_auto_extract_request(config: &ReceiveConfig, received_path: &Path) -> Option<StartExtractRequest> {
    if !config.auto_extract {
        return None;
    }

    let format_kind = zmanager_core::archive_format::detect_archive_format(received_path);
    if format_kind == zmanager_core::archive_format::ArchiveFormatKind::Unknown {
        return None;
    }

    let stem = received_path.file_stem().and_then(|value| value.to_str()).unwrap_or("received-archive");
    let destination_path = config.receive_folder.join(stem).to_string_lossy().into_owned();

    Some(StartExtractRequest {
        archive_path: received_path.to_string_lossy().into_owned(),
        destination_path,
        password: None,
        recipient_key_id: None,
        overwrite: OverwritePolicyDto::Rename,
        destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
        entry_paths: None,
        strip_components: 0,
        tzap_restore_policy: TzapRestorePolicyDto::default(),
        tzap_allow_degraded: false,
        tzap_allow_absolute_symlinks: false,
        ignore_symlinks: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_device_alias_identifies_platform_user_and_host_without_control_characters() {
        assert_eq!(default_device_alias_for("macos", Some("Frank"), Some("Frank's MacBook")), "ZManager macOS · Frank · Frank's MacBook");
        assert_eq!(default_device_alias_for("linux", Some("frank"), None), "ZManager Linux · frank");
        assert_eq!(default_device_alias_for("windows", None, Some("Office-PC")), "ZManager Windows · Office-PC");
        assert_eq!(clean_alias_component("  Frank\n\tDesktop  "), Some("Frank Desktop".to_owned()));
    }

    #[test]
    fn trust_store_round_trip_is_sorted_and_deduplicated() {
        let root = std::env::temp_dir().join(format!("zmanager-desktop-localsend-trust-{}-{}", std::process::id(), line!()));
        let _ = std::fs::remove_dir_all(&root);
        let store = TrustStore::new(&root);

        store.remember("zzz").expect("remember zzz");
        store.remember("aaa").expect("remember aaa");
        store.remember("aaa").expect("remember aaa again");

        assert_eq!(store.fingerprints(), ["aaa", "zzz"]);
        assert!(store.is_trusted("aaa"));
        assert!(!store.is_trusted("does-not-exist"));

        store.forget("aaa").expect("forget aaa");
        assert!(!store.is_trusted("aaa"));
        assert_eq!(store.fingerprints(), ["zzz"]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn trust_store_missing_file_reads_as_empty() {
        let root = std::env::temp_dir().join(format!("zmanager-desktop-localsend-trust-missing-{}-{}", std::process::id(), line!()));
        let _ = std::fs::remove_dir_all(&root);
        let store = TrustStore::new(&root);

        assert!(store.fingerprints().is_empty());
        assert!(!store.is_trusted("anything"));
    }

    #[test]
    fn auto_extract_request_targets_receive_folder_sibling_named_for_the_archive() {
        let config = ReceiveConfig { receive_folder: PathBuf::from("/tmp/zmanager-lan-received"), auto_extract: true };
        let received_path = Path::new("/tmp/zmanager-lan-received/vacation-photos.zip");

        let request = build_auto_extract_request(&config, received_path).expect("zip should be a recognized archive format");

        assert_eq!(request.archive_path, "/tmp/zmanager-lan-received/vacation-photos.zip");
        assert_eq!(request.destination_path, config.receive_folder.join("vacation-photos").to_string_lossy());
        assert_eq!(request.destination_collision_strategy, DestinationCollisionStrategyDto::Rename);
        assert_eq!(request.overwrite, OverwritePolicyDto::Rename);
        assert!(request.password.is_none());
        assert!(request.recipient_key_id.is_none());
    }

    #[test]
    fn auto_extract_request_is_none_when_auto_extract_is_disabled() {
        let config = ReceiveConfig { receive_folder: PathBuf::from("/tmp/zmanager-lan-received"), auto_extract: false };
        let received_path = Path::new("/tmp/zmanager-lan-received/vacation-photos.zip");

        assert!(build_auto_extract_request(&config, received_path).is_none());
    }

    #[test]
    fn auto_extract_request_is_none_for_a_non_archive_file() {
        let config = ReceiveConfig { receive_folder: PathBuf::from("/tmp/zmanager-lan-received"), auto_extract: true };
        let received_path = Path::new("/tmp/zmanager-lan-received/notes.txt");

        assert!(build_auto_extract_request(&config, received_path).is_none());
    }
}
