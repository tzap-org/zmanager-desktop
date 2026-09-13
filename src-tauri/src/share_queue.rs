use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::account::AccountRuntime;
use crate::commands;
use crate::diagnostics::DiagnosticLog;
use crate::dto::StartCreateRequest;
use crate::error::{CommandErrorDto, ErrorSeverityDto};
use crate::job_dto::{JobEventDto, JobStatusDto};
use crate::job_registry::JobRegistry;
use crate::localsend::{LocalSendDeviceInfoDto, LocalSendEventDto, LocalSendState};

pub const MAX_SHARE_RECORDS: usize = 128;
pub const SHARE_QUEUE_CHANGED_EVENT: &str = "zmanager-share-queue-changed";

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum EnqueueShareRequest {
    CompressAndShare { client_request_id: String, sender_alias: String, create_request: Box<StartCreateRequest>, receiver: Option<LocalSendDeviceInfoDto> },
    DirectShare { client_request_id: String, sender_alias: String, artifact_path: String, receiver: Option<LocalSendDeviceInfoDto> },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareErrorSummary {
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShareMode {
    CompressAndShare,
    DirectShare,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompressionState {
    NotRequired,
    Compressing,
    Cancelling,
    Complete,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransferState {
    NotStarted,
    Waiting,
    Sending,
    Cancelling,
    Sent,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SharingIntent {
    Pending,
    Skipped,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ShareLifecycle {
    Active,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionProgressSummary {
    pub processed_bytes: u64,
    pub total_bytes: Option<u64>,
    pub processed_entries: u64,
    pub total_entries: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRecordSnapshot {
    pub share_id: String,
    pub client_request_id: String,
    pub enqueue_sequence: String,
    pub mode: ShareMode,
    pub source_paths: Vec<String>,
    pub sender_alias: String,
    pub compression_job_id: Option<String>,
    pub artifact_path: Option<String>,
    pub receiver: Option<LocalSendDeviceInfoDto>,
    pub receiver_generation: String,
    pub send_id: Option<String>,
    pub compression_state: CompressionState,
    pub compression_progress: Option<CompressionProgressSummary>,
    pub transfer_state: TransferState,
    pub sharing_intent: SharingIntent,
    pub lifecycle: ShareLifecycle,
    pub attempt: u32,
    pub bytes_sent: u64,
    pub total_bytes: Option<u64>,
    pub delivery_uncertain: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_error: Option<ShareErrorSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRegistrySnapshot {
    pub queue_revision: String,
    pub items: Vec<ShareRecordSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueShareResponse {
    pub item: ShareRecordSnapshot,
    pub deduplicated: bool,
}

#[derive(Debug, Clone)]
struct ShareRecord {
    share_id: String,
    client_request_id: String,
    enqueue_sequence: u64,
    mode: ShareMode,
    source_paths: Vec<PathBuf>,
    sender_alias: String,
    compression_job_id: Option<String>,
    artifact_path: Option<PathBuf>,
    receiver: Option<LocalSendDeviceInfoDto>,
    receiver_generation: u64,
    send_id: Option<String>,
    compression_state: CompressionState,
    compression_progress: Option<CompressionProgressSummary>,
    transfer_state: TransferState,
    sharing_intent: SharingIntent,
    lifecycle: ShareLifecycle,
    attempt: u32,
    bytes_sent: u64,
    total_bytes: Option<u64>,
    delivery_uncertain: bool,
    created_at: String,
    updated_at: String,
    last_error: Option<ShareErrorSummary>,
}

impl ShareRecord {
    // This transition is shared by the command path and state-machine tests.
    // Selection commits a destination even while compression or another send is pending.
    fn select_receiver(&mut self, receiver: LocalSendDeviceInfoDto) -> Result<(), CommandErrorDto> {
        if self.receiver.is_some() {
            return Err(error("share_receiver_locked", "The receiver is fixed for this share. Create a new share to send elsewhere.", false));
        }
        if self.lifecycle != ShareLifecycle::Active
            || self.sharing_intent != SharingIntent::Pending
            || !matches!(self.transfer_state, TransferState::NotStarted | TransferState::Waiting)
            || matches!(self.compression_state, CompressionState::Cancelling | CompressionState::Cancelled | CompressionState::Failed)
        {
            return Err(error("share_invalid_state", "This share no longer accepts a receiver", false));
        }
        self.receiver = Some(receiver);
        self.receiver_generation = self.receiver_generation.saturating_add(1).max(1);
        self.last_error = None;
        self.updated_at = timestamp();
        Ok(())
    }

    fn ensure_cancellable(&self) -> Result<(), CommandErrorDto> {
        if self.transfer_state == TransferState::Sent {
            return Err(error("share_already_completed", "This share has already completed", false));
        }
        Ok(())
    }

    fn ensure_removable(&self) -> Result<(), CommandErrorDto> {
        if matches!(self.transfer_state, TransferState::Sending | TransferState::Cancelling)
            || matches!(self.compression_state, CompressionState::Compressing | CompressionState::Cancelling)
            || is_send_eligible(self)
        {
            return Err(error("share_busy", "Cancel the active share before dismissing it", true));
        }
        Ok(())
    }

    fn snapshot(&self) -> ShareRecordSnapshot {
        ShareRecordSnapshot {
            share_id: self.share_id.clone(),
            client_request_id: self.client_request_id.clone(),
            enqueue_sequence: self.enqueue_sequence.to_string(),
            mode: self.mode,
            source_paths: self.source_paths.iter().map(|path| path.to_string_lossy().into_owned()).collect(),
            sender_alias: self.sender_alias.clone(),
            compression_job_id: self.compression_job_id.clone(),
            artifact_path: self.artifact_path.as_ref().map(|path| path.to_string_lossy().into_owned()),
            receiver: self.receiver.clone(),
            receiver_generation: self.receiver_generation.to_string(),
            send_id: self.send_id.clone(),
            compression_state: self.compression_state,
            compression_progress: self.compression_progress.clone(),
            transfer_state: self.transfer_state,
            sharing_intent: self.sharing_intent,
            lifecycle: self.lifecycle,
            attempt: self.attempt,
            bytes_sent: self.bytes_sent,
            total_bytes: self.total_bytes,
            delivery_uncertain: self.delivery_uncertain,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            last_error: self.last_error.clone(),
        }
    }
}

fn mark_waiting_items(state: &mut QueueState) -> bool {
    let mut changed = false;
    for item in &mut state.items {
        let ready = is_send_eligible(item);
        if ready && item.transfer_state != TransferState::Waiting {
            item.transfer_state = TransferState::Waiting;
            item.updated_at = timestamp();
            changed = true;
        }
    }
    changed
}

fn is_send_eligible(item: &ShareRecord) -> bool {
    item.lifecycle == ShareLifecycle::Active
        && item.sharing_intent == SharingIntent::Pending
        && item.receiver.is_some()
        && item.artifact_path.is_some()
        && matches!(item.transfer_state, TransferState::NotStarted | TransferState::Waiting)
}

fn next_eligible_index(items: &[ShareRecord]) -> Option<usize> {
    items.iter().enumerate().filter(|(_, item)| is_send_eligible(item)).min_by_key(|(_, item)| item.enqueue_sequence).map(|(index, _)| index)
}

fn resolve_transfer_result(was_cancelled: bool, completed: bool, cancelled: bool) -> (TransferState, bool) {
    if was_cancelled {
        (TransferState::Cancelled, true)
    } else if completed {
        (TransferState::Sent, false)
    } else if cancelled {
        (TransferState::Cancelled, true)
    } else {
        (TransferState::Failed, true)
    }
}

struct QueueState {
    next_sequence: u64,
    revision: u64,
    next_id: u64,
    items: Vec<ShareRecord>,
    active_send: Option<(String, String, u64)>,
    last_progress_emit: Option<Instant>,
    shutting_down: bool,
}

pub struct ShareRegistry {
    state: Arc<Mutex<QueueState>>,
    jobs: JobRegistry,
    localsend: LocalSendState,
    account: AccountRuntime,
    app: tauri::AppHandle,
    diagnostics: DiagnosticLog,
    send_workers: Arc<Mutex<Vec<thread::JoinHandle<()>>>>,
}

impl Clone for ShareRegistry {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            jobs: self.jobs.clone(),
            localsend: self.localsend.clone(),
            account: self.account.clone(),
            app: self.app.clone(),
            diagnostics: self.diagnostics.clone(),
            send_workers: self.send_workers.clone(),
        }
    }
}

impl ShareRegistry {
    pub fn new(jobs: JobRegistry, localsend: LocalSendState, account: AccountRuntime, app: tauri::AppHandle, diagnostics: DiagnosticLog) -> Self {
        Self {
            state: Arc::new(Mutex::new(QueueState {
                next_sequence: 0,
                revision: 0,
                next_id: 0,
                items: Vec::new(),
                active_send: None,
                last_progress_emit: None,
                shutting_down: false,
            })),
            jobs,
            localsend,
            account,
            app,
            diagnostics,
            send_workers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub(crate) fn request_shutdown(&self) {
        let (send_id, job_ids) = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.shutting_down = true;
            let send_id = state.active_send.as_ref().map(|active| active.1.clone());
            let job_ids = state
                .items
                .iter()
                .filter_map(|item| (item.lifecycle == ShareLifecycle::Active).then_some(item.compression_job_id.clone()).flatten())
                .collect::<Vec<_>>();
            (send_id, job_ids)
        };
        if let Some(send_id) = send_id {
            let _ = self.localsend.cancel_send_for_share(&send_id);
        }
        for job_id in job_ids {
            let _ = self.jobs.request_cancel(&job_id);
        }
    }

    pub(crate) fn join_workers(&self) {
        let workers = std::mem::take(&mut *self.send_workers.lock().unwrap_or_else(|error| error.into_inner()));
        for worker in workers {
            let _ = worker.join();
        }
    }

    pub fn snapshot(&self) -> ShareRegistrySnapshot {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        ShareRegistrySnapshot { queue_revision: state.revision.to_string(), items: state.items.iter().map(ShareRecord::snapshot).collect() }
    }

    pub fn enqueue(&self, request: EnqueueShareRequest) -> Result<EnqueueShareResponse, CommandErrorDto> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.shutting_down {
            return Err(error("share_invalid_state", "Share queue is shutting down", false));
        }
        let (client_request_id, sender_alias, receiver) = match &request {
            EnqueueShareRequest::CompressAndShare { client_request_id, sender_alias, receiver, .. } => {
                (client_request_id.clone(), sender_alias.clone(), receiver.clone())
            }
            EnqueueShareRequest::DirectShare { client_request_id, sender_alias, receiver, .. } => {
                (client_request_id.clone(), sender_alias.clone(), receiver.clone())
            }
        };
        validate_client_request_id(&client_request_id)?;
        let sender_alias = sender_alias.trim().to_owned();
        if sender_alias.is_empty() {
            return Err(error("share_invalid_state", "sender alias must not be blank", false));
        }
        if let Some(existing) = state.items.iter().find(|item| item.client_request_id == client_request_id) {
            let snapshot = existing.snapshot();
            drop(state);
            self.record_diagnostic(
                "deduplicated",
                [("clientRequestId", serde_json::json!(client_request_id)), ("shareId", serde_json::json!(snapshot.share_id))],
            );
            return Ok(EnqueueShareResponse { item: snapshot, deduplicated: true });
        }
        if state.items.len() >= MAX_SHARE_RECORDS {
            return Err(error("share_queue_full", "The share queue is full", false));
        }
        if let Some(receiver) = receiver.as_ref()
            && receiver.fingerprint.trim().is_empty()
        {
            return Err(error("share_invalid_state", "receiver fingerprint must not be blank", false));
        }

        let (mode, source_paths, artifact_path, job_response) = match request {
            EnqueueShareRequest::DirectShare { artifact_path, .. } => {
                let path = validate_direct_artifact(&artifact_path)?;
                (ShareMode::DirectShare, vec![path.clone()], Some(path), None)
            }
            EnqueueShareRequest::CompressAndShare { create_request, .. } => {
                let create_request = *create_request;
                if create_request.volume_size.is_some_and(|value| value > 0) {
                    return Err(error("multi_file_output_not_supported", "Compressed sharing requires one output file", false));
                }
                if create_request.sources.is_empty() {
                    return Err(error("share_invalid_state", "at least one source is required", false));
                }
                let source_paths = create_request.sources.iter().map(PathBuf::from).collect::<Vec<_>>();
                let response = commands::start_create_service(create_request, &self.app, &self.account, &self.jobs, Some(self.diagnostics.clone()))?;
                (ShareMode::CompressAndShare, source_paths, None, Some(response))
            }
        };
        state.next_sequence = state.next_sequence.saturating_add(1);
        state.next_id = state.next_id.saturating_add(1);
        let now = timestamp();
        let receiver_generation = u64::from(receiver.is_some());
        let response = ShareRecord {
            share_id: format!("share-{}", state.next_id),
            client_request_id,
            enqueue_sequence: state.next_sequence,
            mode,
            source_paths,
            sender_alias,
            compression_job_id: job_response.as_ref().map(|job| job.job_id.clone()),
            artifact_path,
            receiver,
            receiver_generation,
            send_id: None,
            compression_state: if mode == ShareMode::DirectShare { CompressionState::NotRequired } else { CompressionState::Compressing },
            compression_progress: None,
            transfer_state: TransferState::NotStarted,
            sharing_intent: SharingIntent::Pending,
            lifecycle: ShareLifecycle::Active,
            attempt: 0,
            bytes_sent: 0,
            total_bytes: None,
            delivery_uncertain: false,
            created_at: now.clone(),
            updated_at: now,
            last_error: None,
        };
        let item = response.snapshot();
        let job_id = response.compression_job_id.clone();
        state.items.push(response);
        self.bump_and_publish_locked(&mut state, true);
        drop(state);
        if let Some(job_id) = job_id {
            self.watch_job(item.share_id.clone(), job_id);
        }
        self.record_diagnostic(
            "admitted",
            [
                ("shareId", serde_json::json!(item.share_id)),
                ("mode", serde_json::json!(format!("{:?}", item.mode))),
                ("sourceCount", serde_json::json!(item.source_paths.len())),
                ("hasReceiver", serde_json::json!(item.receiver.is_some())),
            ],
        );
        self.schedule();
        Ok(EnqueueShareResponse { item, deduplicated: false })
    }

    pub fn set_receiver(&self, share_id: &str, receiver: LocalSendDeviceInfoDto) -> Result<ShareRecordSnapshot, CommandErrorDto> {
        if receiver.fingerprint.trim().is_empty() {
            return Err(error("share_invalid_state", "receiver fingerprint must not be blank", false));
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.active_send.as_ref().is_some_and(|(active_share_id, _, _)| active_share_id == share_id) {
            return Err(error("share_busy", "The transfer is already sending", true));
        }
        let item = find_item_mut(&mut state, share_id)?;
        if matches!(item.transfer_state, TransferState::Sending | TransferState::Cancelling) {
            return Err(error("share_busy", "The transfer is already sending", true));
        }
        item.select_receiver(receiver)?;
        let snapshot = item.snapshot();
        self.bump_and_publish_locked(&mut state, true);
        drop(state);
        self.record_diagnostic("receiverSelected", [("shareId", serde_json::json!(share_id))]);
        self.schedule();
        Ok(snapshot)
    }

    pub fn start_share(&self, share_id: &str, acknowledge_delivery_uncertainty: bool) -> Result<ShareRecordSnapshot, CommandErrorDto> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.active_send.as_ref().is_some_and(|(active_share_id, _, _)| active_share_id == share_id) {
            return Err(error("share_busy", "The transfer is still stopping", true));
        }
        let item = find_item_mut(&mut state, share_id)?;
        if item.lifecycle == ShareLifecycle::Cancelled {
            return Err(error("share_invalid_state", "Cancelled shares cannot be restarted", false));
        }
        if item.transfer_state == TransferState::Sent {
            return Err(error("share_already_completed", "This share has already completed", false));
        }
        if item.delivery_uncertain && !acknowledge_delivery_uncertainty {
            return Err(error("delivery_confirmation_required", "The receiver may already contain this file", true));
        }
        if item.receiver.is_none() {
            return Err(error("share_invalid_state", "Select a receiver before sharing", true));
        }
        validate_item_artifact(item)?;
        item.sharing_intent = SharingIntent::Pending;
        item.transfer_state = TransferState::NotStarted;
        item.delivery_uncertain = false;
        item.last_error = None;
        item.updated_at = timestamp();
        let snapshot = item.snapshot();
        self.bump_and_publish_locked(&mut state, true);
        drop(state);
        if snapshot.attempt > 0 {
            self.record_diagnostic("retryRequested", [("shareId", serde_json::json!(share_id))]);
        }
        self.schedule();
        Ok(snapshot)
    }

    pub fn skip_share(&self, share_id: &str) -> Result<ShareRecordSnapshot, CommandErrorDto> {
        let (send_id, snapshot) = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let active_send_id =
                state.active_send.as_ref().and_then(|(active_share_id, active_send_id, _)| (active_share_id == share_id).then_some(active_send_id.clone()));
            let item = find_item_mut(&mut state, share_id)?;
            if item.transfer_state == TransferState::Sent {
                return Err(error("share_already_completed", "This share has already completed", false));
            }
            item.sharing_intent = SharingIntent::Skipped;
            let send_id = active_send_id.or_else(|| item.send_id.clone().filter(|_| item.transfer_state == TransferState::Sending));
            if send_id.is_some() {
                item.transfer_state = TransferState::Cancelling;
                item.delivery_uncertain = true;
            } else if item.transfer_state == TransferState::Waiting {
                item.transfer_state = TransferState::NotStarted;
            }
            item.updated_at = timestamp();
            let snapshot = item.snapshot();
            self.bump_and_publish_locked(&mut state, true);
            (send_id, snapshot)
        };
        if let Some(send_id) = send_id {
            let _ = self.localsend.cancel_send_for_share(&send_id);
        }
        self.schedule();
        Ok(snapshot)
    }

    pub fn cancel_share(&self, share_id: &str) -> Result<ShareRecordSnapshot, CommandErrorDto> {
        let (send_id, job_id, snapshot) = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let active_send_id =
                state.active_send.as_ref().and_then(|(active_share_id, active_send_id, _)| (active_share_id == share_id).then_some(active_send_id.clone()));
            let item = find_item_mut(&mut state, share_id)?;
            item.ensure_cancellable()?;
            if item.lifecycle == ShareLifecycle::Cancelled {
                return Ok(item.snapshot());
            }
            item.lifecycle = ShareLifecycle::Cancelled;
            let send_id = active_send_id.or_else(|| item.send_id.clone().filter(|_| item.transfer_state == TransferState::Sending));
            let job_id = item.compression_job_id.clone().filter(|_| !item.compression_state_is_terminal());
            if send_id.is_some() {
                item.transfer_state = TransferState::Cancelling;
            } else {
                item.transfer_state = TransferState::Cancelled;
            }
            if send_id.is_some() {
                item.delivery_uncertain = true;
            }
            item.compression_state = if item.mode == ShareMode::CompressAndShare && !item.compression_state_is_terminal() {
                CompressionState::Cancelling
            } else {
                item.compression_state
            };
            item.updated_at = timestamp();
            let snapshot = item.snapshot();
            self.bump_and_publish_locked(&mut state, true);
            (send_id, job_id, snapshot)
        };
        if let Some(send_id) = send_id {
            let _ = self.localsend.cancel_send_for_share(&send_id);
        }
        if let Some(job_id) = job_id {
            let _ = self.jobs.request_cancel(&job_id);
        }
        self.schedule();
        Ok(snapshot)
    }

    pub fn remove_share(&self, share_id: &str) -> Result<(), CommandErrorDto> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let index = state.items.iter().position(|item| item.share_id == share_id).ok_or_else(|| error("share_not_found", "Share was not found", false))?;
        let item = &state.items[index];
        item.ensure_removable()?;
        if state.active_send.as_ref().is_some_and(|(active_share_id, _, _)| active_share_id == share_id) {
            return Err(error("share_busy", "The share is still active", true));
        }
        state.items.remove(index);
        self.bump_and_publish_locked(&mut state, true);
        Ok(())
    }

    pub(crate) fn on_localsend_event(&self, event: LocalSendEventDto) {
        let LocalSendEventDto::FileSendProgress { send_id, bytes_sent, total_bytes, .. } = event else {
            return;
        };
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some((share_id, active_send_id, generation)) = state.active_send.clone() else {
            return;
        };
        if active_send_id != send_id {
            return;
        }
        let Some(item) = state
            .items
            .iter_mut()
            .find(|item| item.share_id == share_id && item.send_id.as_deref() == Some(send_id.as_str()) && item.receiver_generation == generation)
        else {
            return;
        };
        item.bytes_sent = bytes_sent;
        item.total_bytes = Some(total_bytes);
        item.updated_at = timestamp();
        self.bump_and_publish_locked(&mut state, false);
    }

    fn watch_job(&self, share_id: String, job_id: String) {
        let Some(mut receiver) = self.jobs.subscribe_job_snapshot(&job_id) else {
            return;
        };
        let registry = self.clone();
        thread::spawn(move || {
            loop {
                let snapshot = receiver.borrow_and_update().clone();
                registry.on_job_snapshot(&share_id, &job_id, &snapshot);
                if snapshot.status.is_terminal() {
                    break;
                }
                loop {
                    match receiver.has_changed() {
                        Ok(true) => break,
                        Ok(false) => thread::sleep(Duration::from_millis(25)),
                        Err(_) => return,
                    }
                }
            }
        });
    }

    fn on_job_snapshot(&self, share_id: &str, job_id: &str, snapshot: &crate::job_dto::DesktopJobSnapshotDto) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some(item) = state.items.iter_mut().find(|item| item.share_id == share_id && item.compression_job_id.as_deref() == Some(job_id)) else {
            return;
        };
        let cancellation_requested = item.lifecycle == ShareLifecycle::Cancelled && item.compression_state == CompressionState::Cancelling;
        if item.lifecycle == ShareLifecycle::Cancelled && !cancellation_requested {
            return;
        }
        item.compression_progress = Some(CompressionProgressSummary {
            processed_bytes: snapshot.progress_facts.processed_bytes,
            total_bytes: snapshot.progress_facts.total_bytes,
            processed_entries: snapshot.progress_facts.processed_entries,
            total_entries: snapshot.progress_facts.total_entries,
        });
        match snapshot.status {
            JobStatusDto::Completed if cancellation_requested => {
                item.compression_state = CompressionState::Cancelled;
            }
            JobStatusDto::Completed => {
                let Some(artifact) = snapshot
                    .output_artifacts
                    .iter()
                    .find(|artifact| artifact.artifact_id == "output" && matches!(&artifact.kind, crate::job_dto::JobArtifactKindDto::Archive))
                else {
                    item.compression_state = CompressionState::Failed;
                    item.last_error =
                        Some(ShareErrorSummary { code: "share_artifact_missing".into(), message: "The archive output was not found".into(), hint: None });
                    item.updated_at = timestamp();
                    self.bump_and_publish_locked(&mut state, true);
                    return;
                };
                let path = PathBuf::from(&artifact.path);
                if !path.is_file() {
                    item.compression_state = CompressionState::Failed;
                    item.last_error = Some(ShareErrorSummary {
                        code: "share_artifact_invalid".into(),
                        message: "The archive output is not a regular file".into(),
                        hint: None,
                    });
                } else {
                    item.artifact_path = Some(path);
                    item.compression_state = CompressionState::Complete;
                }
            }
            JobStatusDto::Failed if cancellation_requested => {
                item.compression_state = CompressionState::Cancelled;
            }
            JobStatusDto::Failed => {
                item.compression_state = CompressionState::Failed;
                item.last_error = snapshot
                    .latest_failure
                    .as_ref()
                    .map(job_error_summary)
                    .or_else(|| Some(ShareErrorSummary { code: "create_failed".into(), message: "Archive creation failed".into(), hint: None }));
            }
            JobStatusDto::Cancelled if cancellation_requested => {
                item.compression_state = CompressionState::Cancelled;
            }
            JobStatusDto::Cancelled => {
                item.compression_state = CompressionState::Cancelled;
            }
            _ => {}
        }
        item.updated_at = timestamp();
        self.bump_and_publish_locked(&mut state, true);
        drop(state);
        self.schedule();
    }

    fn schedule(&self) {
        let send = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            if state.shutting_down {
                return;
            }
            if state.active_send.is_some() {
                if mark_waiting_items(&mut state) {
                    self.bump_and_publish_locked(&mut state, true);
                }
                return;
            }
            let Some(index) = next_eligible_index(&state.items) else {
                return;
            };
            let item = &mut state.items[index];
            let send_id = format!("send-{}", uuid_like());
            item.send_id = Some(send_id.clone());
            item.attempt = item.attempt.saturating_add(1);
            item.transfer_state = TransferState::Sending;
            item.bytes_sent = 0;
            item.total_bytes = None;
            item.updated_at = timestamp();
            let target = item.receiver.clone().expect("eligible share has receiver");
            let path = item.artifact_path.clone().expect("eligible share has artifact");
            let generation = item.receiver_generation;
            let share_id = item.share_id.clone();
            let alias = item.sender_alias.clone();
            state.active_send = Some((share_id.clone(), send_id.clone(), generation));
            mark_waiting_items(&mut state);
            self.bump_and_publish_locked(&mut state, true);
            Some((share_id, send_id, generation, alias, target, path))
        };
        let Some((share_id, send_id, generation, alias, target, path)) = send else {
            return;
        };
        let diagnostic_share_id = share_id.clone();
        let registry = self.clone();
        let mut workers = self.send_workers.lock().unwrap_or_else(|error| error.into_inner());
        let worker = thread::spawn(move || {
            let result = registry.localsend.send_file_for_share(&send_id, &alias, target, &path);
            registry.finish_send(&share_id, &send_id, generation, result);
        });
        workers.push(worker);
        drop(workers);
        self.record_diagnostic(
            "sendStarted",
            [
                ("shareId", serde_json::json!(diagnostic_share_id)),
                ("attempt", serde_json::json!(self.snapshot().items.iter().find(|item| item.share_id == diagnostic_share_id).map_or(0, |item| item.attempt))),
            ],
        );
    }

    fn finish_send(&self, share_id: &str, send_id: &str, generation: u64, result: Result<crate::localsend::LocalSendSendFileResultDto, CommandErrorDto>) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some((active_share_id, active_send_id, active_generation)) = state.active_send.clone() else {
            return;
        };
        if active_share_id != share_id || active_send_id != send_id || active_generation != generation {
            return;
        }
        let Some(item) =
            state.items.iter_mut().find(|item| item.share_id == share_id && item.send_id.as_deref() == Some(send_id) && item.receiver_generation == generation)
        else {
            return;
        };
        let was_cancelled = matches!(item.transfer_state, TransferState::Cancelling | TransferState::Cancelled);
        let completed = result.is_ok();
        let cancelled = result.as_ref().is_err_and(|error| error.code == "cancelled");
        let (next_state, uncertain) = resolve_transfer_result(was_cancelled, completed, cancelled);
        if was_cancelled {
            item.transfer_state = next_state;
            item.delivery_uncertain = true;
            if let Err(error) = result {
                item.last_error = Some(ShareErrorSummary { code: error.code.to_string(), message: error.message, hint: error.hint });
            }
        } else {
            item.transfer_state = next_state;
            item.delivery_uncertain = uncertain;
            match result {
                Ok(_) => {
                    item.last_error = None;
                }
                Err(error) => {
                    item.last_error = Some(ShareErrorSummary { code: error.code.to_string(), message: error.message, hint: error.hint });
                }
            }
        }
        item.updated_at = timestamp();
        state.active_send = None;
        self.bump_and_publish_locked(&mut state, true);
        drop(state);
        self.record_diagnostic("sendFinished", [("shareId", serde_json::json!(share_id)), ("sendId", serde_json::json!(send_id))]);
        self.schedule();
    }

    fn bump_and_publish_locked(&self, state: &mut QueueState, immediate: bool) {
        state.revision = state.revision.saturating_add(1);
        let should_emit = immediate || state.last_progress_emit.is_none_or(|last| last.elapsed() >= Duration::from_millis(75));
        if should_emit {
            state.last_progress_emit = Some(Instant::now());
            let revision = state.revision.to_string();
            let _ = tauri::Emitter::emit(&self.app, SHARE_QUEUE_CHANGED_EVENT, revision);
        }
    }

    fn record_diagnostic<const N: usize>(&self, name: &str, fields: [(&str, serde_json::Value); N]) {
        let _ = self.diagnostics.record("shareQueue", name, crate::diagnostics::fields(fields));
    }
}

impl ShareRecord {
    fn compression_state_is_terminal(&self) -> bool {
        matches!(self.compression_state, CompressionState::Complete | CompressionState::Failed | CompressionState::Cancelled | CompressionState::NotRequired)
    }
}

fn find_item_mut<'a>(state: &'a mut QueueState, share_id: &str) -> Result<&'a mut ShareRecord, CommandErrorDto> {
    state.items.iter_mut().find(|item| item.share_id == share_id).ok_or_else(|| error("share_not_found", "Share was not found", false))
}

fn validate_client_request_id(value: &str) -> Result<(), CommandErrorDto> {
    if value.is_empty() || value.chars().count() > 256 || value.chars().any(char::is_control) {
        return Err(error("share_invalid_state", "client request id is invalid", false));
    }
    Ok(())
}

fn validate_direct_artifact(value: &str) -> Result<PathBuf, CommandErrorDto> {
    let path = PathBuf::from(value.trim());
    if path.as_os_str().is_empty() || path.to_string_lossy().contains('\0') {
        return Err(error("share_invalid_state", "artifact path is invalid", false));
    }
    if !path.is_file() {
        return Err(CommandErrorDto::not_found(format!("artifact is not a regular file: {path:?}"), None));
    }
    Ok(path)
}

fn validate_item_artifact(item: &ShareRecord) -> Result<(), CommandErrorDto> {
    let Some(path) = &item.artifact_path else {
        return Err(error("share_invalid_state", "share artifact is not ready", true));
    };
    if !path.is_file() {
        return Err(CommandErrorDto::not_found("share artifact is no longer a regular file", None));
    }
    Ok(())
}

fn job_error_summary(event: &JobEventDto) -> ShareErrorSummary {
    ShareErrorSummary {
        code: event.code.unwrap_or("create_failed").to_string(),
        message: event.message.clone().unwrap_or_else(|| "Archive creation failed".into()),
        hint: event.hint.as_deref().map(str::to_owned),
    }
}

fn error(code: &'static str, message: impl Into<String>, retryable: bool) -> CommandErrorDto {
    CommandErrorDto::new(code, message, None::<String>, ErrorSeverityDto::Warning, retryable)
}

fn timestamp() -> String {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().to_string()
}

fn uuid_like() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    format!("{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetShareReceiverRequest {
    pub share_id: String,
    pub receiver: LocalSendDeviceInfoDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartShareRequest {
    pub share_id: String,
    #[serde(default)]
    pub acknowledge_delivery_uncertainty: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareIdRequest {
    pub share_id: String,
}

#[tauri::command]
pub fn enqueue_share(request: EnqueueShareRequest, state: tauri::State<'_, ShareRegistry>) -> Result<EnqueueShareResponse, CommandErrorDto> {
    state.enqueue(request)
}

#[tauri::command]
pub fn set_share_receiver(request: SetShareReceiverRequest, state: tauri::State<'_, ShareRegistry>) -> Result<ShareRecordSnapshot, CommandErrorDto> {
    state.set_receiver(&request.share_id, request.receiver)
}

#[tauri::command]
pub fn start_share(request: StartShareRequest, state: tauri::State<'_, ShareRegistry>) -> Result<ShareRecordSnapshot, CommandErrorDto> {
    state.start_share(&request.share_id, request.acknowledge_delivery_uncertainty)
}

#[tauri::command]
pub fn get_share_queue(state: tauri::State<'_, ShareRegistry>) -> ShareRegistrySnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn skip_share(request: ShareIdRequest, state: tauri::State<'_, ShareRegistry>) -> Result<ShareRecordSnapshot, CommandErrorDto> {
    state.skip_share(&request.share_id)
}

#[tauri::command]
pub fn cancel_share(request: ShareIdRequest, state: tauri::State<'_, ShareRegistry>) -> Result<ShareRecordSnapshot, CommandErrorDto> {
    state.cancel_share(&request.share_id)
}

#[tauri::command]
pub fn remove_share(request: ShareIdRequest, state: tauri::State<'_, ShareRegistry>) -> Result<(), CommandErrorDto> {
    state.remove_share(&request.share_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receiver() -> LocalSendDeviceInfoDto {
        LocalSendDeviceInfoDto {
            alias: "Peer".into(),
            fingerprint: "fingerprint".into(),
            port: 53317,
            protocol: "https".into(),
            ip: Some("192.168.1.20".into()),
            device_model: None,
            last_seen_unix_seconds: None,
        }
    }

    fn record(sequence: u64, transfer_state: TransferState, with_receiver: bool, with_artifact: bool) -> ShareRecord {
        ShareRecord {
            share_id: format!("share-{sequence}"),
            client_request_id: format!("request-{sequence}"),
            enqueue_sequence: sequence,
            mode: ShareMode::DirectShare,
            source_paths: vec![PathBuf::from("artifact.zip")],
            sender_alias: "ZManager Desktop".into(),
            compression_job_id: None,
            artifact_path: with_artifact.then(|| PathBuf::from("artifact.zip")),
            receiver: with_receiver.then(receiver),
            receiver_generation: u64::from(with_receiver),
            send_id: None,
            compression_state: CompressionState::NotRequired,
            compression_progress: None,
            transfer_state,
            sharing_intent: SharingIntent::Pending,
            lifecycle: ShareLifecycle::Active,
            attempt: 0,
            bytes_sent: 0,
            total_bytes: None,
            delivery_uncertain: false,
            created_at: "0".into(),
            updated_at: "0".into(),
            last_error: None,
        }
    }

    #[test]
    fn receiver_selection_commits_identity_before_sending_and_after_completion() {
        let mut item = record(1, TransferState::NotStarted, false, false);
        item.compression_state = CompressionState::Compressing;
        item.select_receiver(receiver()).unwrap();
        for state in [
            TransferState::NotStarted,
            TransferState::Waiting,
            TransferState::Sending,
            TransferState::Cancelling,
            TransferState::Sent,
            TransferState::Failed,
            TransferState::Cancelled,
        ] {
            item.transfer_state = state;
            let mut other = receiver();
            other.fingerprint = "other".into();
            assert_eq!(item.select_receiver(other).unwrap_err().code, "share_receiver_locked");
            assert_eq!(item.receiver.as_ref().unwrap().fingerprint, "fingerprint");
            assert_eq!(item.receiver_generation, 1);
        }
    }

    #[test]
    fn stale_selection_cannot_revive_cancelled_skipped_or_failed_work() {
        let mut item = record(1, TransferState::NotStarted, false, true);
        item.lifecycle = ShareLifecycle::Cancelled;
        assert!(item.select_receiver(receiver()).is_err());
        item.lifecycle = ShareLifecycle::Active;
        item.sharing_intent = SharingIntent::Skipped;
        assert!(item.select_receiver(receiver()).is_err());
        item.sharing_intent = SharingIntent::Pending;
        item.compression_state = CompressionState::Failed;
        assert!(item.select_receiver(receiver()).is_err());
        assert!(item.receiver.is_none());
    }

    #[test]
    fn completed_result_rejects_late_cancel_and_waiting_work_cannot_be_dismissed() {
        let mut item = record(1, TransferState::Sent, true, true);
        assert_eq!(item.ensure_cancellable().unwrap_err().code, "share_already_completed");
        assert!(item.ensure_removable().is_ok());
        item.transfer_state = TransferState::Waiting;
        assert_eq!(item.ensure_removable().unwrap_err().code, "share_busy");
        item.transfer_state = TransferState::Cancelled;
        item.lifecycle = ShareLifecycle::Cancelled;
        assert!(item.ensure_removable().is_ok());
        item.compression_state = CompressionState::Cancelling;
        assert!(item.ensure_removable().is_err());
    }

    #[test]
    fn waiting_state_marks_only_ready_pending_records() {
        let mut state = QueueState {
            next_sequence: 0,
            revision: 0,
            next_id: 0,
            items: vec![
                record(1, TransferState::NotStarted, true, true),
                record(2, TransferState::NotStarted, false, true),
                record(3, TransferState::Failed, true, true),
            ],
            active_send: None,
            last_progress_emit: None,
            shutting_down: false,
        };

        assert!(mark_waiting_items(&mut state));
        assert_eq!(state.items[0].transfer_state, TransferState::Waiting);
        assert_eq!(state.items[1].transfer_state, TransferState::NotStarted);
        assert_eq!(state.items[2].transfer_state, TransferState::Failed);
    }

    #[test]
    fn scheduler_selects_fifo_and_does_not_auto_retry_failed_transfers() {
        let items =
            vec![record(1, TransferState::Failed, true, true), record(2, TransferState::Waiting, true, true), record(3, TransferState::NotStarted, true, true)];

        assert_eq!(next_eligible_index(&items), Some(1));
    }

    #[test]
    fn cancelled_completion_cannot_overwrite_skip_or_cancel() {
        assert_eq!(resolve_transfer_result(true, true, false), (TransferState::Cancelled, true));
        assert_eq!(resolve_transfer_result(true, false, true), (TransferState::Cancelled, true));
        assert_eq!(resolve_transfer_result(false, true, false), (TransferState::Sent, false));
        assert_eq!(resolve_transfer_result(false, false, false), (TransferState::Failed, true));
    }

    #[test]
    fn cancellation_states_are_not_terminal_until_the_worker_finishes() {
        assert!(!matches!(
            CompressionState::Cancelling,
            CompressionState::Complete | CompressionState::Failed | CompressionState::Cancelled | CompressionState::NotRequired
        ));
        assert!(!matches!(TransferState::Cancelling, TransferState::Sent | TransferState::Failed | TransferState::Cancelled));
    }

    #[test]
    fn cancellation_requested_transfer_finishes_as_cancelled() {
        assert_eq!(resolve_transfer_result(true, true, false), (TransferState::Cancelled, true));
        assert_eq!(resolve_transfer_result(true, false, true), (TransferState::Cancelled, true));
    }

    #[test]
    fn client_request_id_limit_counts_unicode_characters() {
        assert!(validate_client_request_id(&"界".repeat(256)).is_ok());
        assert!(validate_client_request_id(&"界".repeat(257)).is_err());
        assert!(validate_client_request_id("request\nreplayed").is_err());
    }
}
