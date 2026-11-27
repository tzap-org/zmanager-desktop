//! Tauri command surface over `zmanager-localsend`'s `LocalSendRegistry`.
//!
//! The registry's own public API (`poll_events`) is a drain-a-queue call,
//! not a subscribable stream, so this module runs its own short-interval
//! poll loop in a background thread and re-emits each event to the
//! frontend as a push (`zmanager-localsend-event`) — the frontend never
//! polls. The loop auto-extracts received archives via the same internal
//! entry point as `start_extract` when the user enables that option.

use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use localsend_rs::client::client::ProgressCallback;
use localsend_rs::{DeviceInfo, DeviceInfoBuilder, LocalSendClient, Protocol, TlsCertificate, TlsTrustPolicy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

use crate::diagnostics::DiagnosticLog;
use crate::dto::{DestinationCollisionStrategyDto, OverwritePolicyDto, StartExtractRequest, TzapRestorePolicyDto};
use crate::error::CommandErrorDto;
use crate::job_registry::JobRegistry;

const LOCALSEND_EVENT_NAME: &str = "zmanager-localsend-event";
const LEGACY_DEFAULT_ALIAS: &str = "ZManager Desktop";
const EVENT_POLL_INTERVAL: Duration = Duration::from_millis(150);

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
    receive_config: Arc<Mutex<Option<ReceiveConfig>>>,
    poll_stop: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    poll_thread: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    send_certificate: Option<Arc<TlsCertificate>>,
}

impl LocalSendState {
    pub fn new(app_data_dir: PathBuf, diagnostics: &DiagnosticLog) -> Self {
        let registry = zmanager_localsend::registry();
        let default_alias = default_device_alias();
        // Receive, discovery, and send use the same persisted TLS identity.
        let send_certificate = registry
            .set_identity_dir(&app_data_dir)
            .and_then(|()| {
                localsend_rs::load_or_generate_tls_certificate(app_data_dir.join("certificate.pem"), app_data_dir.join("private-key.pem")).map_err(Into::into)
            })
            .inspect_err(|_| {
                let _ = diagnostics.record("localSend", "identityUnavailable", crate::diagnostics::fields([]));
            })
            .ok()
            .or_else(|| localsend_rs::generate_tls_certificate().ok())
            .map(Arc::new);

        Self {
            registry,
            default_alias,
            receive_config: Arc::new(Mutex::new(None)),
            poll_stop: Arc::new(Mutex::new(None)),
            poll_thread: Arc::new(Mutex::new(None)),
            send_certificate,
        }
    }

    pub(crate) fn start_event_pump(&self, app: AppHandle, job_registry: JobRegistry, diagnostics: DiagnosticLog) {
        let mut stop_guard = self.poll_stop.lock().unwrap_or_else(|error| error.into_inner());
        if stop_guard.is_some() {
            return;
        }
        let stop_flag = Arc::new(AtomicBool::new(false));
        *stop_guard = Some(stop_flag.clone());
        drop(stop_guard);
        let shared = self.clone();
        let thread = thread::spawn(move || spawn_event_pump(app, shared, job_registry, diagnostics, stop_flag));
        *self.poll_thread.lock().unwrap_or_else(|error| error.into_inner()) = Some(thread);
    }

    pub(crate) async fn send_file_for_share(
        &self,
        alias: &str,
        target: LocalSendDeviceInfoDto,
        file_path: &Path,
        cancelled: watch::Receiver<bool>,
        progress: ProgressCallback,
    ) -> Result<(), CommandErrorDto> {
        // The queue owns cancellation before the future can be polled.
        // Await the transport directly so dropping the future stops the send
        // without relying on an abort registration inside a blocking bridge.
        cancellable_send(cancelled, async {
            if !file_path.is_file() {
                return Err(CommandErrorDto::not_found("share artifact is no longer a regular file", None));
            }
            let target = DeviceInfo::from(zmanager_localsend::DeviceInfoDto::from(target));
            let sender = DeviceInfoBuilder::new(self.advertised_alias(alias), default_localsend_port()).protocol(Protocol::Https).build();
            let client = if target.protocol == Protocol::Https {
                let policy = TlsTrustPolicy::PinnedFingerprint(target.fingerprint.clone());
                match self.send_certificate.as_deref() {
                    Some(certificate) => LocalSendClient::with_trust_policy_and_client_certificate(sender, policy, certificate),
                    None => LocalSendClient::with_trust_policy(sender, policy),
                }
                .map_err(map_transport_error)?
            } else {
                LocalSendClient::new(sender)
            };
            let metadata = localsend_rs::build_file_metadata(file_path).await.map_err(map_transport_error)?;
            let file_id = metadata.id.clone();
            let prepared = client.prepare_upload(&target, HashMap::from([(file_id.clone(), metadata)]), None).await.map_err(map_transport_error)?;
            let token =
                prepared.files.get(&file_id).ok_or_else(|| CommandErrorDto::invalid_request("receiver did not return an upload token for the offered file"))?;
            client
                .upload_file_with_rate_limit(&target, &prepared.session_id, &file_id, token, file_path, Some(progress), None)
                .await
                .map_err(map_transport_error)
        })
        .await
    }

    fn advertised_alias(&self, alias: &str) -> String {
        let alias = alias.trim();
        if alias.is_empty() || alias.eq_ignore_ascii_case(LEGACY_DEFAULT_ALIAS) { self.default_alias.clone() } else { alias.to_owned() }
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
    /// When this peer last confirmed itself, for devices that came from discovery.
    ///
    /// `None` where the device is not a discovery result — an event's sender,
    /// or a send target the caller handed back to us.
    pub last_seen_unix_seconds: Option<u64>,
}

impl From<zmanager_localsend::DeviceInfoDto> for LocalSendDeviceInfoDto {
    fn from(value: zmanager_localsend::DeviceInfoDto) -> Self {
        Self {
            alias: value.alias,
            fingerprint: value.fingerprint,
            port: value.port,
            protocol: value.protocol,
            ip: value.ip,
            device_model: value.device_model,
            last_seen_unix_seconds: value.last_seen_unix_seconds,
        }
    }
}

impl From<LocalSendDeviceInfoDto> for zmanager_localsend::DeviceInfoDto {
    fn from(value: LocalSendDeviceInfoDto) -> Self {
        Self {
            alias: value.alias,
            fingerprint: value.fingerprint,
            port: value.port,
            protocol: value.protocol,
            ip: value.ip,
            device_model: value.device_model,
            last_seen_unix_seconds: value.last_seen_unix_seconds,
        }
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

async fn cancellable_send<T>(mut cancelled: watch::Receiver<bool>, send: impl Future<Output = Result<T, CommandErrorDto>>) -> Result<T, CommandErrorDto> {
    tokio::select! {
        biased;
        _ = cancelled.wait_for(|cancelled| *cancelled) => Err(CommandErrorDto::cancelled("The LAN transfer was cancelled")),
        result = send => result,
    }
}

fn map_transport_error(error: localsend_rs::LocalSendError) -> CommandErrorDto {
    map_localsend_error(error.into())
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
    let receive_folder = resolve_receive_folder(&app, &request.receive_folder_path)?;
    fs::create_dir_all(&receive_folder).map_err(|error| crate::commands::map_io_error(receive_folder.to_string_lossy().into_owned(), error))?;

    state
        .registry
        .start_receiver(zmanager_localsend::StartReceiverRequest {
            alias: state.advertised_alias(&request.alias),
            port: request.port,
            https: request.https,
            save_dir: receive_folder.clone(),
            // The receiver cannot authenticate the identity in an incoming
            // offer. Always ask for consent before accepting files.
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

// ---------------------------------------------------------------------
// Event pump: bridges the registry's poll-a-queue API to a frontend push
// event and starts auto-extraction after a file has been received.
// ---------------------------------------------------------------------

fn spawn_event_pump(app: AppHandle, shared: LocalSendState, job_registry: JobRegistry, diagnostics: DiagnosticLog, stop_flag: Arc<AtomicBool>) {
    while !stop_flag.load(Ordering::Relaxed) {
        let drained = shared.registry.poll_events();
        for event in drained.events {
            handle_queued_event(&app, &shared, &job_registry, &diagnostics, event);
        }
        thread::sleep(EVENT_POLL_INTERVAL);
    }
}

fn handle_queued_event(
    app: &AppHandle,
    shared: &LocalSendState,
    job_registry: &JobRegistry,
    diagnostics: &DiagnosticLog,
    event: zmanager_localsend::QueuedEvent,
) {
    if let zmanager_localsend::QueuedEvent::FileReceived { path, .. } = &event {
        maybe_auto_extract(shared, job_registry, diagnostics, path);
    }

    let dto = LocalSendEventDto::from(event);
    let _ = app.emit(LOCALSEND_EVENT_NAME, &dto);
}

fn maybe_auto_extract(shared: &LocalSendState, job_registry: &JobRegistry, diagnostics: &DiagnosticLog, received_path: &Path) {
    let config = shared.receive_config.lock().unwrap_or_else(|error| error.into_inner()).clone();
    let Some(config) = config else {
        return;
    };
    if !job_registry.has_live_handoff_coordinator() {
        let _ = diagnostics.record(
            "localSend",
            "autoExtractDeferredNoCoordinator",
            crate::diagnostics::fields([(
                "archiveExtension",
                serde_json::Value::String(received_path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_owned()),
            )]),
        );
        return;
    }
    let Some(request) = build_auto_extract_request(&config, received_path) else {
        return;
    };

    if let Err(error) = crate::commands::start_extract_internal_with_recipient_key_and_origin(
        request,
        job_registry,
        None,
        crate::job_dto::AcceptedJobOriginDto::LocalSendAutoExtract,
        None,
    ) {
        let _ = diagnostics.record(
            "localSend",
            "autoExtractRejected",
            crate::diagnostics::fields([("errorCode", serde_json::Value::String(error.code.to_owned()))]),
        );
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
        select_all: false,
        excluded_entry_paths: Vec::new(),
        strip_components: 0,
        flatten_paths: false,
        deduplicate_root: false,
        tzap_restore_policy: TzapRestorePolicyDto::default(),
        // Always allow degraded restore for auto-extract: a received archive
        // with attributes that can't be projected onto this OS should still
        // land its files rather than abort the whole receive.
        tzap_allow_degraded: true,
        ignore_symlinks: false,
        locale: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_before_worker_start_does_not_poll_the_transport() {
        let (cancel, cancelled) = watch::channel(false);
        cancel.send_replace(true);

        let result: Result<(), CommandErrorDto> = cancellable_send(cancelled, async { panic!("cancelled transport must never start") }).await;
        assert_eq!(result.unwrap_err().code, "cancelled");
    }

    #[tokio::test]
    async fn cancelling_an_in_flight_send_drops_its_transport() {
        let (cancel, cancelled) = watch::channel(false);
        let (started, ready) = tokio::sync::oneshot::channel();
        let transport = tokio::spawn(cancellable_send(cancelled, async {
            started.send(()).unwrap();
            std::future::pending::<Result<(), CommandErrorDto>>().await
        }));
        ready.await.unwrap();
        cancel.send_replace(true);
        assert_eq!(transport.await.unwrap().unwrap_err().code, "cancelled");
    }

    #[tokio::test]
    async fn share_transport_sends_an_approved_file_over_pinned_tls() {
        let root = std::env::temp_dir().join(format!("zmanager-lan-loopback-{}", std::process::id()));
        let source = root.join("example.txt");
        fs::create_dir_all(&root).unwrap();
        fs::write(&source, "LocalSend test payload").unwrap();
        let receive_dir = root.join("received");
        fs::create_dir_all(&receive_dir).unwrap();
        let (mut receiver, mut events) =
            localsend_rs::LocalSendServer::builder().port(0).protocol(Protocol::Https).save_dir(&receive_dir).build().await.unwrap();
        let mut target = receiver.device().clone();
        target.ip = Some("127.0.0.1".into());
        let target = LocalSendDeviceInfoDto::from(zmanager_localsend::DeviceInfoDto::from(target));
        let sender = LocalSendState::new(root.join("sender-identity"), &DiagnosticLog::new());
        let (_cancel, cancelled) = watch::channel(false);
        let payload_progress = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let progress = payload_progress.clone();

        let result = tokio::time::timeout(Duration::from_secs(5), async {
            let send = sender.send_file_for_share(
                "Desktop QA",
                target,
                &source,
                cancelled,
                Box::new(move |bytes, _, _| {
                    progress.store(bytes, Ordering::Relaxed);
                }),
            );
            let approve = async {
                while let Some(event) = events.recv().await {
                    if let localsend_rs::server::ServerEvent::TransferRequest(request) = event {
                        assert_eq!(request.sender().alias, "Desktop QA");
                        request.accept();
                        return;
                    }
                }
            };
            let (result, ()) = tokio::join!(send, approve);
            result
        })
        .await;

        receiver.stop().await;
        let contents = fs::read(receive_dir.join("example.txt"));
        let _ = fs::remove_dir_all(root);
        result.expect("loopback transport should finish").expect("approved transfer should succeed");
        assert_eq!(contents.unwrap(), b"LocalSend test payload");
        assert_eq!(payload_progress.load(Ordering::Relaxed), 22);
    }

    #[test]
    fn default_device_alias_identifies_platform_user_and_host_without_control_characters() {
        assert_eq!(default_device_alias_for("macos", Some("Frank"), Some("Frank's MacBook")), "ZManager macOS · Frank · Frank's MacBook");
        assert_eq!(default_device_alias_for("linux", Some("frank"), None), "ZManager Linux · frank");
        assert_eq!(default_device_alias_for("windows", None, Some("Office-PC")), "ZManager Windows · Office-PC");
        assert_eq!(clean_alias_component("  Frank\n\tDesktop  "), Some("Frank Desktop".to_owned()));
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
