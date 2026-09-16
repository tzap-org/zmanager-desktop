use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};

use crate::constants;
use crate::error::ErrorSeverityDto;
#[cfg(test)]
use crate::job_dto::TestJobEventsSnapshot;
use crate::job_dto::{
    CancelJobResponseDto, DesktopJobSnapshotDto, JobAvailableActionDto, JobCatalogDescriptorDto, JobCatalogSnapshotDto, JobControlResponseDto, JobEventDto,
    JobEventKindDto, JobKindDto, JobOutputArtifactDto, JobPhaseDto, JobProgressFactsDto, JobRecordSnapshot, JobRetryDescriptorDto, JobStatusDto,
    JobTerminalSummaryDto, StartJobResponseDto,
};
#[cfg(test)]
use zmanager_core::jobs::JobKind;
use zmanager_core::{jobs::CancellationToken, jobs::JobEvent, jobs::JobEventSink, jobs::JobPhase, jobs::JobProgressState};

#[cfg(test)]
const MAX_EVENTS_TO_KEEP: usize = 256;
pub const MAX_RETAINED_TERMINAL_JOBS: usize = 100;
pub const MAX_ADMITTED_JOBS: usize = 256;
pub const MAX_SUBSCRIBERS_PER_JOB: usize = 16;
pub const MAX_PROCESS_SUBSCRIBERS: usize = 512;
const MAX_NOTICES_TO_KEEP: usize = 32;
static NEXT_TERMINAL_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
struct JobRecord {
    id: String,
    kind: JobKindDto,
    created_at: String,
    status: JobStatusDto,
    paused_from_status: Option<JobStatusDto>,
    #[cfg(test)]
    test_events: VecDeque<JobEventDto>,
    terminal_summary: Option<JobTerminalSummaryDto>,
    cancellation_token: Option<CancellationToken>,
    pause_control: PauseControl,
    processed_entries: usize,
    total_entries: Option<usize>,
    revision: u64,
    updated_at: String,
    progress: JobProgressFactsDto,
    notices: VecDeque<JobEventDto>,
    latest_failure: Option<JobEventDto>,
    available_actions: Vec<JobAvailableActionDto>,
    output_artifacts: Vec<JobOutputArtifactDto>,
    retry_descriptor: Option<JobRetryDescriptorDto>,
    terminal_sequence: Option<u64>,
    publication_closed: bool,
    started_at: Instant,
    paused_at: Option<Instant>,
    paused_duration: Duration,
    finished_at: Option<Instant>,
    phase_started_at: Option<Instant>,
    phase_paused_duration: Duration,
    snapshot_sender: watch::Sender<Arc<DesktopJobSnapshotDto>>,
    core_progress: JobProgressState,
}

#[derive(Debug)]
struct PauseState {
    paused: Mutex<bool>,
    changed: Condvar,
}

#[derive(Debug, Clone)]
struct PauseControl {
    state: Arc<PauseState>,
}

impl PauseControl {
    fn new() -> Self {
        Self { state: Arc::new(PauseState { paused: Mutex::new(false), changed: Condvar::new() }) }
    }

    fn pause(&self) {
        let mut paused = self.state.paused.lock().unwrap_or_else(|error| error.into_inner());
        *paused = true;
    }

    fn resume(&self) {
        let mut paused = self.state.paused.lock().unwrap_or_else(|error| error.into_inner());
        *paused = false;
        self.state.changed.notify_all();
    }

    fn wait_if_paused(&self) {
        let mut paused = self.state.paused.lock().unwrap_or_else(|error| error.into_inner());
        while *paused {
            paused = self.state.changed.wait(paused).unwrap_or_else(|error| error.into_inner());
        }
    }
}

struct RegistryState {
    next_job_id: u64,
    catalog_revision: u64,
    catalog_publication_closed: bool,
    jobs: HashMap<String, JobRecord>,
    preview_roots: VecDeque<PathBuf>,
    catalog_sender: watch::Sender<Arc<JobCatalogSnapshotDto>>,
    next_subscription_id: u64,
    subscriptions: HashMap<String, SubscriptionRecord>,
}

#[derive(Debug)]
struct SubscriptionRecord {
    owner: String,
    job_id: Option<String>,
    commands: mpsc::Sender<SubscriptionCommand>,
    flow: Arc<Mutex<SubscriptionFlowState>>,
}

#[derive(Debug, Default)]
pub(crate) struct SubscriptionFlowState {
    pub(crate) in_flight: Option<u64>,
    pub(crate) ack_queued: bool,
}

#[derive(Debug)]
pub(crate) enum SubscriptionCommand {
    Ack(u64),
    Stop,
}

pub(crate) async fn forward_latest_values<T, FRevision, FSend>(
    mut snapshots: watch::Receiver<Arc<T>>,
    mut commands: mpsc::Receiver<SubscriptionCommand>,
    flow: Arc<Mutex<SubscriptionFlowState>>,
    revision_of: FRevision,
    mut send: FSend,
) where
    T: Send + Sync + 'static,
    FRevision: Fn(&T) -> Option<u64>,
    FSend: FnMut(Arc<T>) -> Result<(), ()>,
{
    let mut current = snapshots.borrow_and_update().clone();
    let Some(mut in_flight) = revision_of(&current) else {
        return;
    };
    {
        let mut state = flow.lock().unwrap_or_else(|error| error.into_inner());
        state.in_flight = Some(in_flight);
        state.ack_queued = false;
    }
    if send(current.clone()).is_err() {
        return;
    }

    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(SubscriptionCommand::Stop) | None => break,
                Some(SubscriptionCommand::Ack(revision)) if revision == in_flight => {
                    flow.lock().unwrap_or_else(|error| error.into_inner()).ack_queued = false;
                    let Some(newest) = revision_of(&current) else { break };
                    if newest > revision {
                        in_flight = newest;
                        flow.lock().unwrap_or_else(|error| error.into_inner()).in_flight = Some(in_flight);
                        if send(current.clone()).is_err() { break }
                    } else {
                        flow.lock().unwrap_or_else(|error| error.into_inner()).in_flight = None;
                    }
                }
                Some(SubscriptionCommand::Ack(_)) => {}
            },
            changed = snapshots.changed() => {
                if changed.is_err() { break }
                current = snapshots.borrow_and_update().clone();
                let should_send = flow
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .in_flight
                    .is_none();
                if should_send {
                    let Some(revision) = revision_of(&current) else { break };
                    in_flight = revision;
                    flow.lock().unwrap_or_else(|error| error.into_inner()).in_flight = Some(in_flight);
                    if send(current.clone()).is_err() { break }
                }
            }
        }
    }
}

impl RegistryState {
    fn new() -> Self {
        let (catalog_sender, _) = watch::channel(Arc::new(JobCatalogSnapshotDto { catalog_revision: "0".to_string(), jobs: Vec::new() }));
        Self {
            next_job_id: 0,
            catalog_revision: 0,
            catalog_publication_closed: false,
            jobs: HashMap::new(),
            preview_roots: VecDeque::new(),
            catalog_sender,
            next_subscription_id: 0,
            subscriptions: HashMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct JobRegistry {
    state: Arc<Mutex<RegistryState>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self { state: Arc::new(Mutex::new(RegistryState::new())) }
    }

    fn with_lock<R>(&self, operation: impl FnOnce(&mut RegistryState) -> R) -> R {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());

        operation(&mut state)
    }

    #[cfg(test)]
    pub fn create_job(&self, kind: JobKindDto) -> (StartJobResponseDto, CancellationToken) {
        self.try_create_job(kind).expect("job registry capacity exceeded")
    }

    pub fn try_create_job(&self, kind: JobKindDto) -> Result<(StartJobResponseDto, CancellationToken), &'static str> {
        self.with_lock(|state| {
            let job_id = state.next_job_id.saturating_add(1).to_string();
            state.next_job_id = state.next_job_id.saturating_add(1);

            let token = CancellationToken::new();
            let created_at = now_timestamp();
            evict_oldest_terminal_jobs(state);
            if state.jobs.len() >= MAX_ADMITTED_JOBS {
                return Err("job_capacity");
            }
            let progress = JobProgressFactsDto::default();
            let initial_snapshot = Arc::new(DesktopJobSnapshotDto {
                revision: "1".to_string(),
                job_id: job_id.clone(),
                kind,
                status: JobStatusDto::Queued,
                created_at: created_at.clone(),
                updated_at: created_at.clone(),
                can_pause: true,
                can_resume: false,
                can_cancel: true,
                can_dismiss: false,
                progress_facts: progress.clone(),
                latest_failure: None,
                bounded_notices: Vec::new(),
                available_actions: Vec::new(),
                output_artifacts: Vec::new(),
                retry_descriptor: None,
                terminal_summary: None,
            });
            let (snapshot_sender, _) = watch::channel(initial_snapshot);
            state.jobs.insert(
                job_id.clone(),
                JobRecord {
                    id: job_id.clone(),
                    kind,
                    created_at: created_at.clone(),
                    status: JobStatusDto::Queued,
                    paused_from_status: None,
                    #[cfg(test)]
                    test_events: VecDeque::new(),
                    terminal_summary: None,
                    cancellation_token: Some(token.clone()),
                    pause_control: PauseControl::new(),
                    processed_entries: 0,
                    total_entries: None,
                    revision: 1,
                    updated_at: created_at.clone(),
                    progress,
                    notices: VecDeque::new(),
                    latest_failure: None,
                    available_actions: Vec::new(),
                    output_artifacts: Vec::new(),
                    retry_descriptor: None,
                    terminal_sequence: None,
                    publication_closed: false,
                    started_at: Instant::now(),
                    paused_at: None,
                    paused_duration: Duration::ZERO,
                    finished_at: None,
                    phase_started_at: None,
                    phase_paused_duration: Duration::ZERO,
                    snapshot_sender,
                    core_progress: JobProgressState::default(),
                },
            );
            if let Err(error) = publish_catalog(state) {
                state.jobs.remove(&job_id);
                return Err(error);
            }

            Ok((StartJobResponseDto { job_id: job_id.clone(), kind, status: JobStatusDto::Queued, created_at }, token))
        })
    }

    pub fn remove_job_if_terminal(&self, job_id: &str) -> Option<JobKindDto> {
        self.with_lock(|state| {
            let record = state.jobs.get(job_id)?;
            if !record.status.is_terminal() {
                return None;
            }

            cancel_job_subscriptions(state, job_id);
            let removed = state.jobs.remove(job_id).map(|record| record.kind);
            if removed.is_some() {
                let _ = publish_catalog(state);
            }
            removed
        })
    }

    pub fn snapshot(&self, job_id: &str) -> Option<JobRecordSnapshot> {
        self.with_lock(|state| {
            state.jobs.get(job_id).map(|record| JobRecordSnapshot {
                kind: record.kind,
                created_at: record.created_at.clone(),
                status: record.status,
                #[cfg(test)]
                events: record.test_events.iter().cloned().collect(),
                terminal_summary: record.terminal_summary.clone(),
            })
        })
    }

    /// One-shot read of a Job's current full snapshot, without opening a live
    /// subscription. Lets a window that does not own the Job's subscription
    /// (e.g. the Main Window, after handing a Job off to its task window)
    /// read a single fact about it, such as its output artifacts.
    pub fn current_job_snapshot(&self, job_id: &str) -> Option<Arc<DesktopJobSnapshotDto>> {
        self.with_lock(|state| state.jobs.get(job_id).map(|record| record.snapshot_sender.borrow().clone()))
    }

    pub fn configure_recovery_facts(
        &self,
        job_id: &str,
        retry_descriptor: Option<JobRetryDescriptorDto>,
        output_artifacts: Vec<JobOutputArtifactDto>,
        available_actions: Vec<JobAvailableActionDto>,
    ) -> Result<(), &'static str> {
        self.with_lock(|state| {
            let record = state.jobs.get_mut(job_id).ok_or("job_not_found")?;
            if record.status.is_terminal() || record.publication_closed {
                return Err("job_immutable");
            }
            record.retry_descriptor = retry_descriptor;
            record.output_artifacts = output_artifacts;
            record.available_actions = available_actions;
            publish_record(record)?;
            publish_catalog(state)?;
            Ok(())
        })
    }

    pub(crate) fn subscribe_job_snapshot(&self, job_id: &str) -> Option<watch::Receiver<Arc<DesktopJobSnapshotDto>>> {
        self.with_lock(|state| state.jobs.get(job_id).map(|record| record.snapshot_sender.subscribe()))
    }

    #[cfg(test)]
    pub fn subscribe_catalog_snapshot(&self) -> watch::Receiver<Arc<JobCatalogSnapshotDto>> {
        self.with_lock(|state| state.catalog_sender.subscribe())
    }

    #[allow(clippy::type_complexity)]
    pub fn register_job_subscription(
        &self,
        owner: &str,
        job_id: &str,
    ) -> Result<(String, watch::Receiver<Arc<DesktopJobSnapshotDto>>, mpsc::Receiver<SubscriptionCommand>, Arc<Mutex<SubscriptionFlowState>>), &'static str>
    {
        self.with_lock(|state| {
            if owner != format!("task-{job_id}") {
                return Err("job_subscription_forbidden");
            }
            if state.subscriptions.len() >= MAX_PROCESS_SUBSCRIBERS {
                return Err("subscription_capacity");
            }
            if state.subscriptions.values().filter(|sub| sub.job_id.as_deref() == Some(job_id)).count() >= MAX_SUBSCRIBERS_PER_JOB {
                return Err("job_subscription_capacity");
            }
            let receiver = state.jobs.get(job_id).ok_or("job_not_found")?.snapshot_sender.subscribe();
            state.next_subscription_id = state.next_subscription_id.checked_add(1).ok_or("subscription_id_exhausted")?;
            let id = format!("subscription-{}", state.next_subscription_id);
            let (commands, receiver_commands) = mpsc::channel(4);
            let flow = Arc::new(Mutex::new(SubscriptionFlowState::default()));
            state
                .subscriptions
                .insert(id.clone(), SubscriptionRecord { owner: owner.to_owned(), job_id: Some(job_id.to_owned()), commands, flow: flow.clone() });
            Ok((id, receiver, receiver_commands, flow))
        })
    }

    #[allow(clippy::type_complexity)]
    pub fn register_catalog_subscription(
        &self,
        owner: &str,
    ) -> Result<(String, watch::Receiver<Arc<JobCatalogSnapshotDto>>, mpsc::Receiver<SubscriptionCommand>, Arc<Mutex<SubscriptionFlowState>>), &'static str>
    {
        self.with_lock(|state| {
            if owner != "main" {
                return Err("catalog_forbidden");
            }
            if state.subscriptions.len() >= MAX_PROCESS_SUBSCRIBERS {
                return Err("subscription_capacity");
            }
            state.next_subscription_id = state.next_subscription_id.checked_add(1).ok_or("subscription_id_exhausted")?;
            let id = format!("subscription-{}", state.next_subscription_id);
            let (commands, receiver_commands) = mpsc::channel(4);
            let flow = Arc::new(Mutex::new(SubscriptionFlowState::default()));
            state.subscriptions.insert(id.clone(), SubscriptionRecord { owner: owner.to_owned(), job_id: None, commands, flow: flow.clone() });
            Ok((id, state.catalog_sender.subscribe(), receiver_commands, flow))
        })
    }

    pub fn acknowledge_subscription(&self, owner: &str, id: &str, revision: u64) -> Result<(), &'static str> {
        self.with_lock(|state| {
            let subscription = state.subscriptions.get(id).ok_or("subscription_not_found")?;
            if subscription.owner != owner {
                return Err("subscription_forbidden");
            }
            let mut flow = subscription.flow.lock().unwrap_or_else(|error| error.into_inner());
            match flow.in_flight {
                Some(sent) if revision > sent => return Err("ack_revision_newer_than_in_flight"),
                Some(sent) if revision < sent => return Ok(()),
                None => return Ok(()),
                Some(_) if flow.ack_queued => return Ok(()),
                Some(_) => flow.ack_queued = true,
            }
            if subscription.commands.try_send(SubscriptionCommand::Ack(revision)).is_err() {
                flow.ack_queued = false;
                return Err("subscription_busy");
            }
            Ok(())
        })
    }

    pub fn unsubscribe(&self, owner: &str, id: &str) -> Result<(), &'static str> {
        self.with_lock(|state| {
            let subscription = state.subscriptions.get(id).ok_or("subscription_not_found")?;
            if subscription.owner != owner {
                return Err("subscription_forbidden");
            }
            let subscription = state.subscriptions.remove(id).expect("checked subscription exists");
            let _ = subscription.commands.try_send(SubscriptionCommand::Stop);
            Ok(())
        })
    }

    pub fn cleanup_subscription(&self, id: &str) {
        self.with_lock(|state| {
            state.subscriptions.remove(id);
        });
    }

    pub fn cleanup_owner_subscriptions(&self, owner: &str) {
        self.with_lock(|state| {
            let ids =
                state.subscriptions.iter().filter(|&(_id, subscription)| subscription.owner == owner).map(|(id, _subscription)| id.clone()).collect::<Vec<_>>();
            for id in ids {
                if let Some(subscription) = state.subscriptions.remove(&id) {
                    let _ = subscription.commands.try_send(SubscriptionCommand::Stop);
                }
            }
        });
    }

    pub fn request_cancel(&self, job_id: &str) -> Option<CancelJobResponseDto> {
        self.with_lock(|state| {
            let record = state.jobs.get_mut(job_id)?;
            if record.status.is_terminal() {
                return Some(CancelJobResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
            }
            if record.publication_closed {
                return None;
            }

            if let Some(token) = record.cancellation_token.as_ref() {
                token.cancel();
                record.pause_control.resume();
                {
                    record.status = JobStatusDto::Cancelling;
                    let kind = record.kind;
                    let processed_entries = record.processed_entries;
                    let total_entries = record.total_entries;
                    record_test_event(
                        record,
                        JobEventDto {
                            event_type: JobEventKindDto::Warning,
                            job_kind: Some(kind),
                            phase: None,
                            code: None,
                            hint: None,
                            severity: None,
                            retryable: Some(false),
                            path: None,
                            bytes: None,
                            total_bytes: None,
                            total_bytes_processed: None,
                            entries: Some(processed_entries),
                            total_entries,
                            message: Some("Cancellation requested.".to_string()),
                        },
                    );
                }
                publish_record(record).ok()?;
                let response = Some(CancelJobResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
                publish_catalog(state).ok()?;
                response
            } else {
                None
            }
        })
    }

    pub fn request_pause(&self, job_id: &str) -> Option<JobControlResponseDto> {
        self.with_lock(|state| {
            let record = state.jobs.get_mut(job_id)?;
            if record.status.is_terminal() || record.publication_closed {
                return Some(JobControlResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
            }

            if !matches!(record.status, JobStatusDto::Queued | JobStatusDto::Running) {
                return Some(JobControlResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
            }
            {
                record.paused_from_status = Some(record.status);
                record.status = JobStatusDto::Paused;
                record.pause_control.pause();
                let kind = record.kind;
                let processed_entries = record.processed_entries;
                let total_entries = record.total_entries;
                record_test_event(
                    record,
                    JobEventDto {
                        event_type: JobEventKindDto::Paused,
                        job_kind: Some(kind),
                        phase: None,
                        code: None,
                        hint: None,
                        severity: None,
                        retryable: Some(true),
                        path: None,
                        bytes: None,
                        total_bytes: None,
                        total_bytes_processed: None,
                        entries: Some(processed_entries),
                        total_entries,
                        message: Some("Paused.".to_string()),
                    },
                );
            }

            publish_record(record).ok()?;
            let response = Some(JobControlResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
            publish_catalog(state).ok()?;
            response
        })
    }

    pub fn request_resume(&self, job_id: &str) -> Option<JobControlResponseDto> {
        self.with_lock(|state| {
            let record = state.jobs.get_mut(job_id)?;
            if record.status != JobStatusDto::Paused || record.publication_closed {
                return Some(JobControlResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
            }
            {
                record.pause_control.resume();
                record.status = record.paused_from_status.take().unwrap_or(JobStatusDto::Running);
                let kind = record.kind;
                let processed_entries = record.processed_entries;
                let total_entries = record.total_entries;
                record_test_event(
                    record,
                    JobEventDto {
                        event_type: JobEventKindDto::Resumed,
                        job_kind: Some(kind),
                        phase: None,
                        code: None,
                        hint: None,
                        severity: None,
                        retryable: Some(true),
                        path: None,
                        bytes: None,
                        total_bytes: None,
                        total_bytes_processed: None,
                        entries: Some(processed_entries),
                        total_entries,
                        message: Some("Resumed.".to_string()),
                    },
                );
            }

            publish_record(record).ok()?;
            let response = Some(JobControlResponseDto { job_id: job_id.to_string(), status: record.status, revision: record.revision.to_string() });
            publish_catalog(state).ok()?;
            response
        })
    }

    pub fn wait_if_paused(&self, job_id: &str) {
        let pause_control = self.with_lock(|state| state.jobs.get(job_id).map(|record| record.pause_control.clone()));

        if let Some(pause_control) = pause_control {
            pause_control.wait_if_paused();
        }
    }

    #[cfg(test)]
    pub fn take_test_events(&self, job_id: &str) -> Option<TestJobEventsSnapshot> {
        self.with_lock(|state| {
            let record = state.jobs.get_mut(job_id)?;
            let events = record.test_events.drain(..).collect::<Vec<_>>();

            Some(TestJobEventsSnapshot {
                job_id: record.id.clone(),
                kind: record.kind,
                status: record.status,
                created_at: record.created_at.clone(),
                can_dismiss: record.status.is_terminal(),
                events,
                terminal_summary: record.terminal_summary.clone(),
            })
        })
    }

    pub fn emit_job_event(&self, job_id: &str, event: JobEvent) {
        let mapped_kind = match &event {
            JobEvent::Started { kind, .. } => Some(*kind),
            _ => None,
        };

        let mut event_dto = match &event {
            JobEvent::Started { kind: _, total_bytes } => JobEventDto {
                event_type: JobEventKindDto::Started,
                job_kind: mapped_kind.map(JobKindDto::from),
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: None,
                bytes: None,
                total_bytes: *total_bytes,
                total_bytes_processed: None,
                entries: None,
                total_entries: None,
                message: None,
            },
            JobEvent::EntryStarted { path, bytes } => JobEventDto {
                event_type: JobEventKindDto::EntryStarted,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: Some(path.clone()),
                bytes: *bytes,
                total_bytes: None,
                total_bytes_processed: None,
                entries: None,
                total_entries: None,
                message: None,
            },
            JobEvent::BytesProcessed { path, recent_paths, bytes, total_bytes_processed, total_entries_processed, .. } => JobEventDto {
                event_type: JobEventKindDto::BytesProcessed,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: recent_paths.last().cloned().or_else(|| path.clone()),
                bytes: Some(*bytes),
                total_bytes: None,
                total_bytes_processed: Some(*total_bytes_processed),
                entries: Some(usize::try_from(*total_entries_processed).unwrap_or(usize::MAX)),
                total_entries: None,
                message: None,
            },
            JobEvent::PhaseStarted { phase, total_bytes } => JobEventDto {
                event_type: JobEventKindDto::PhaseStarted,
                job_kind: None,
                phase: Some(JobPhaseDto::from(*phase)),
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: None,
                bytes: None,
                total_bytes: *total_bytes,
                total_bytes_processed: Some(0),
                entries: None,
                total_entries: None,
                message: None,
            },
            JobEvent::PhaseBytesProcessed { phase, path, recent_paths, bytes, total_bytes_processed, total_bytes, .. } => JobEventDto {
                event_type: JobEventKindDto::PhaseBytesProcessed,
                job_kind: None,
                phase: Some(JobPhaseDto::from(*phase)),
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: recent_paths.last().cloned().or_else(|| path.clone()),
                bytes: Some(*bytes),
                total_bytes: *total_bytes,
                total_bytes_processed: Some(*total_bytes_processed),
                entries: None,
                total_entries: None,
                message: None,
            },
            JobEvent::EntryFinished { path, bytes } => JobEventDto {
                event_type: JobEventKindDto::EntryFinished,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: Some(path.clone()),
                bytes: Some(*bytes),
                total_bytes: None,
                total_bytes_processed: None,
                entries: None,
                total_entries: None,
                message: None,
            },
            JobEvent::Warning { message } => JobEventDto {
                event_type: JobEventKindDto::Warning,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: None,
                bytes: None,
                total_bytes: None,
                total_bytes_processed: None,
                entries: None,
                total_entries: None,
                message: Some(message.clone()),
            },
            JobEvent::Completed { entries, bytes } => JobEventDto {
                event_type: JobEventKindDto::Completed,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: None,
                bytes: Some(*bytes),
                total_bytes: None,
                total_bytes_processed: None,
                entries: Some(*entries),
                total_entries: Some(*entries),
                message: None,
            },
            JobEvent::Failed { message } => JobEventDto {
                event_type: JobEventKindDto::Failed,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: None,
                bytes: None,
                total_bytes: None,
                total_bytes_processed: None,
                entries: None,
                total_entries: None,
                message: Some(message.clone()),
            },
            JobEvent::Cancelled { message } => JobEventDto {
                event_type: JobEventKindDto::Cancelled,
                job_kind: None,
                phase: None,
                code: None,
                hint: None,
                severity: None,
                retryable: None,
                path: None,
                bytes: None,
                total_bytes: None,
                total_bytes_processed: None,
                entries: None,
                total_entries: None,
                message: Some(message.clone()),
            },
        };

        self.with_lock(|state| {
            let Some(record) = state.jobs.get_mut(job_id) else {
                return;
            };
            if record.status.is_terminal() || record.publication_closed {
                return;
            }
            record.core_progress.apply(&event);
            sync_core_progress(record);

            if matches!(event, JobEvent::EntryFinished { .. }) {
                record.processed_entries = record.processed_entries.saturating_add(1);
            }
            if matches!(event, JobEvent::Completed { .. })
                && let Some(entries) = event_dto.entries
            {
                record.processed_entries = record.processed_entries.max(entries);
            }
            if event_dto.entries.is_none() && record.processed_entries > 0 {
                event_dto.entries = Some(record.processed_entries);
            }
            if event_dto.total_entries.is_none() {
                event_dto.total_entries = record.total_entries;
            }

            if let Some(kind) = mapped_kind {
                let dto_kind = JobKindDto::from(kind);
                record.kind = dto_kind;
            }

            if matches!(event, JobEvent::Completed { .. } | JobEvent::Failed { .. }) {
                apply_event_to_progress(record, &event_dto);
                if publish_record(record).is_ok() {
                    let _ = publish_catalog(state);
                }
                return;
            }

            let previous_status = record.status;
            match event {
                JobEvent::Started { .. } => {
                    if matches!(record.status, JobStatusDto::Queued | JobStatusDto::Running) {
                        record.status = JobStatusDto::Running;
                    }
                }
                JobEvent::Completed { .. } if !record.status.is_terminal() => {
                    record.status = JobStatusDto::Completed;
                }
                JobEvent::Failed { .. } if !record.status.is_terminal() => record.status = JobStatusDto::Failed,
                JobEvent::Cancelled { .. } if !record.status.is_terminal() => record.status = JobStatusDto::Cancelled,
                _ => {}
            }

            apply_event_to_progress(record, &event_dto);
            sync_core_progress(record);
            record_test_event(record, event_dto);
            if record.status.is_terminal() && record.terminal_sequence.is_none() {
                let Ok(sequence) = allocate_terminal_sequence() else {
                    record.publication_closed = true;
                    return;
                };
                record.terminal_sequence = Some(sequence);
            }
            let status_changed = record.status != previous_status;
            if publish_record(record).is_ok() && (status_changed || record.status.is_terminal()) {
                let _ = publish_catalog(state);
            }
        });
    }

    pub fn emit_direct_event(&self, job_id: &str, event: JobEventDto) {
        self.with_lock(|state| {
            let Some(record) = state.jobs.get_mut(job_id) else {
                return;
            };
            if record.status.is_terminal() || record.publication_closed {
                return;
            }

            let mut event = event;
            if record.status == JobStatusDto::Cancelling && matches!(event.event_type, JobEventKindDto::Completed | JobEventKindDto::Failed) {
                let job_kind = event.job_kind;
                record.terminal_summary = None;
                event = JobEventDto {
                    event_type: JobEventKindDto::Cancelled,
                    job_kind,
                    phase: None,
                    code: Some(constants::COMMAND_ERROR_CANCELLED),
                    hint: None,
                    severity: Some(ErrorSeverityDto::Info),
                    retryable: Some(true),
                    path: None,
                    bytes: None,
                    total_bytes: None,
                    total_bytes_processed: None,
                    entries: None,
                    total_entries: None,
                    message: Some("Archive job cancelled.".to_string()),
                };
            }
            if matches!(event.event_type, JobEventKindDto::EntryFinished) {
                record.processed_entries = record.processed_entries.saturating_add(1);
            }
            if let Some(entries) = event.entries {
                record.processed_entries = record.processed_entries.max(entries);
            }
            if let Some(total_entries) = event.total_entries {
                record.total_entries = Some(total_entries);
            }
            if event.entries.is_none() && record.processed_entries > 0 {
                event.entries = Some(record.processed_entries);
            }
            if event.total_entries.is_none() {
                event.total_entries = record.total_entries;
            }

            let previous_status = record.status;
            match event.event_type {
                JobEventKindDto::Started => {
                    if matches!(record.status, JobStatusDto::Queued | JobStatusDto::Running) {
                        record.status = JobStatusDto::Running;
                    }
                }
                JobEventKindDto::Completed if !record.status.is_terminal() => {
                    record.status = JobStatusDto::Completed;
                }
                JobEventKindDto::Failed if !record.status.is_terminal() => record.status = JobStatusDto::Failed,
                JobEventKindDto::Cancelled if !record.status.is_terminal() => {
                    record.terminal_summary = None;
                    record.status = JobStatusDto::Cancelled;
                }
                JobEventKindDto::Paused => record.status = JobStatusDto::Paused,
                JobEventKindDto::Resumed if record.status == JobStatusDto::Paused => {
                    record.status = JobStatusDto::Running;
                }
                _ => {}
            }

            apply_event_to_progress(record, &event);
            record_test_event(record, event);
            if record.status.is_terminal() && record.terminal_sequence.is_none() {
                let Ok(sequence) = allocate_terminal_sequence() else {
                    record.publication_closed = true;
                    return;
                };
                record.terminal_sequence = Some(sequence);
            }
            let status_changed = record.status != previous_status;
            if publish_record(record).is_ok() && (status_changed || record.status.is_terminal()) {
                let _ = publish_catalog(state);
            }
        });
    }

    pub fn commit_completed(&self, job_id: &str, kind: JobKindDto, summary: JobTerminalSummaryDto) -> Result<(), &'static str> {
        self.with_lock(|state| {
            let record = state.jobs.get_mut(job_id).ok_or("job_not_found")?;
            if record.status.is_terminal() {
                return Ok(());
            }
            if record.publication_closed {
                return Err("revision_exhausted");
            }
            let cancellation_requested = record.status == JobStatusDto::Cancelling;
            let event = JobEventDto {
                event_type: if cancellation_requested { JobEventKindDto::Cancelled } else { JobEventKindDto::Completed },
                job_kind: Some(kind),
                phase: None,
                code: cancellation_requested.then_some(constants::COMMAND_ERROR_CANCELLED),
                hint: None,
                severity: cancellation_requested.then_some(ErrorSeverityDto::Info),
                retryable: cancellation_requested.then_some(true),
                path: None,
                bytes: (!cancellation_requested).then_some(summary.written_bytes),
                total_bytes: None,
                total_bytes_processed: (!cancellation_requested).then_some(summary.written_bytes),
                entries: (!cancellation_requested).then_some(summary.written_entries),
                total_entries: (!cancellation_requested).then_some(summary.written_entries),
                message: cancellation_requested.then(|| "Archive job cancelled.".to_string()),
            };
            record.terminal_summary = (!cancellation_requested).then_some(summary);
            record.status = if cancellation_requested { JobStatusDto::Cancelled } else { JobStatusDto::Completed };
            record.processed_entries = record.processed_entries.max(event.entries.unwrap_or(0));
            if event.total_entries.is_some() {
                record.total_entries = event.total_entries;
            }
            apply_event_to_progress(record, &event);
            record_test_event(record, event);
            record.terminal_sequence = Some(allocate_terminal_sequence()?);
            publish_record(record)?;
            publish_catalog(state)?;
            Ok(())
        })
    }

    pub fn replace_preview_root(&self, path: PathBuf) {
        self.with_lock(|state| {
            while let Some(root) = state.preview_roots.pop_front() {
                let _ = fs::remove_dir_all(root);
            }
            state.preview_roots.push_back(path);
        });
    }

    pub fn cleanup_preview_roots(&self) {
        self.with_lock(|state| {
            while let Some(root) = state.preview_roots.pop_front() {
                let _ = fs::remove_dir_all(root);
            }
        });
    }
}

#[cfg(test)]
fn record_test_event(record: &mut JobRecord, event: JobEventDto) {
    match event.event_type {
        JobEventKindDto::EntryStarted => {
            record.test_events.retain(|existing| existing.event_type != JobEventKindDto::EntryStarted);
        }
        JobEventKindDto::EntryFinished => {
            record.test_events.retain(|existing| existing.event_type != JobEventKindDto::EntryFinished);
        }
        JobEventKindDto::BytesProcessed => {
            record.test_events.retain(|existing| existing.event_type != JobEventKindDto::BytesProcessed);
        }
        JobEventKindDto::PhaseBytesProcessed => {
            record.test_events.retain(|existing| existing.event_type != JobEventKindDto::PhaseBytesProcessed || existing.phase != event.phase);
        }
        _ => {}
    }

    while record.test_events.len() >= MAX_EVENTS_TO_KEEP {
        let _ = record.test_events.pop_front();
    }
    record.test_events.push_back(event);
}

#[cfg(not(test))]
fn record_test_event(_record: &mut JobRecord, _event: JobEventDto) {}

fn apply_event_to_progress(record: &mut JobRecord, event: &JobEventDto) {
    if let Some(total) = event.total_bytes {
        record.progress.total_bytes = Some(total);
    }
    if let Some(processed) = event.total_bytes_processed {
        if matches!(event.event_type, JobEventKindDto::PhaseStarted | JobEventKindDto::PhaseBytesProcessed) {
            record.progress.phase_processed_bytes = record.progress.phase_processed_bytes.max(processed);
            record.progress.phase_total_bytes = event.total_bytes;
        } else {
            record.progress.processed_bytes = record.progress.processed_bytes.max(processed);
        }
    }
    if let Some(entries) = event.entries {
        record.progress.processed_entries = record.progress.processed_entries.max(entries as u64);
    }
    if let Some(total) = event.total_entries {
        record.progress.total_entries = Some(total as u64);
    }
    if let Some(path) = event.path.as_ref() {
        record.progress.recent_paths.retain(|existing| existing != path);
        record.progress.recent_paths.push(path.clone());
        if record.progress.recent_paths.len() > 10 {
            record.progress.recent_paths.remove(0);
        }
        record.progress.current_path = Some(path.clone());
    }
    if matches!(event.event_type, JobEventKindDto::PhaseStarted) {
        record.progress.active_phase = event.phase;
        record.progress.phase_processed_bytes = 0;
        record.progress.phase_total_bytes = event.total_bytes;
        record.progress.phase_elapsed_millis = 0;
        record.phase_started_at = Some(Instant::now());
        record.phase_paused_duration = Duration::ZERO;
    }
    if matches!(event.event_type, JobEventKindDto::Warning) {
        record.progress.warning_count = record.progress.warning_count.saturating_add(1);
        while record.notices.len() >= MAX_NOTICES_TO_KEEP {
            record.notices.pop_front();
        }
        record.notices.push_back(event.clone());
    }
    if matches!(event.event_type, JobEventKindDto::Failed) {
        record.latest_failure = Some(event.clone());
    }
}

fn sync_core_progress(record: &mut JobRecord) {
    let core = &record.core_progress;
    record.progress.processed_bytes = core.processed_bytes;
    record.progress.total_bytes = core.total_bytes;
    record.progress.processed_entries = core.processed_entries;
    record.progress.total_entries = core.total_entries;
    record.progress.current_path = core.current_path.clone();
    record.progress.recent_paths = core.recent_paths.clone();
    record.progress.active_phase = core.active_phase.map(JobPhaseDto::from);
    record.progress.phase_processed_bytes = core.phase_processed_bytes;
    record.progress.phase_total_bytes = core.phase_total_bytes;
    record.progress.warning_count = core.warning_count;
}

fn publish_record(record: &mut JobRecord) -> Result<(), &'static str> {
    if record.publication_closed {
        return Err("revision_exhausted");
    }
    let now = Instant::now();
    if record.status == JobStatusDto::Paused {
        record.paused_at.get_or_insert(now);
    } else if let Some(paused_at) = record.paused_at.take() {
        let paused = now.saturating_duration_since(paused_at);
        record.paused_duration = record.paused_duration.saturating_add(paused);
        record.phase_paused_duration = record.phase_paused_duration.saturating_add(paused);
    }
    if record.status.is_terminal() {
        record.finished_at.get_or_insert(now);
    }
    record.revision = match next_revision(record.revision) {
        Ok(revision) => revision,
        Err(error) => {
            record.publication_closed = true;
            return Err(error);
        }
    };
    record.updated_at = now_timestamp();
    let _ = record.snapshot_sender.send_replace(Arc::new(snapshot_dto(record)));
    Ok(())
}

fn next_revision(current: u64) -> Result<u64, &'static str> {
    current.checked_add(1).ok_or("revision_exhausted")
}

fn allocate_terminal_sequence() -> Result<u64, &'static str> {
    NEXT_TERMINAL_SEQUENCE
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| current.checked_add(1))
        .map(|previous| previous + 1)
        .map_err(|_| "terminal_sequence_exhausted")
}

fn snapshot_dto(record: &JobRecord) -> DesktopJobSnapshotDto {
    let (can_pause, can_resume, can_cancel, can_dismiss) = match record.status {
        JobStatusDto::Queued | JobStatusDto::Running => (true, false, true, false),
        JobStatusDto::Paused => (false, true, true, false),
        JobStatusDto::Cancelling => (false, false, false, false),
        JobStatusDto::Completed | JobStatusDto::Failed | JobStatusDto::Cancelled => (false, false, false, true),
    };
    let mut progress = record.progress.clone();
    let now = record.finished_at.unwrap_or_else(Instant::now);
    let current_pause = record.paused_at.map(|paused_at| now.saturating_duration_since(paused_at)).unwrap_or_default();
    let paused_duration = record.paused_duration.saturating_add(current_pause);
    progress.active_elapsed_millis =
        now.saturating_duration_since(record.started_at).saturating_sub(paused_duration).as_millis().min(u128::from(u64::MAX)) as u64;
    progress.phase_elapsed_millis = record
        .phase_started_at
        .map(|started_at| {
            now.saturating_duration_since(started_at)
                .saturating_sub(record.phase_paused_duration.saturating_add(current_pause))
                .as_millis()
                .min(u128::from(u64::MAX)) as u64
        })
        .unwrap_or(0);
    DesktopJobSnapshotDto {
        revision: record.revision.to_string(),
        job_id: record.id.clone(),
        kind: record.kind,
        status: record.status,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        can_pause,
        can_resume,
        can_cancel,
        can_dismiss,
        progress_facts: progress,
        latest_failure: record.latest_failure.clone(),
        bounded_notices: record.notices.iter().cloned().collect(),
        available_actions: if record.status == JobStatusDto::Completed { record.available_actions.clone() } else { Vec::new() },
        output_artifacts: if record.status == JobStatusDto::Completed { record.output_artifacts.clone() } else { Vec::new() },
        retry_descriptor: record.latest_failure.as_ref().and_then(|failure| failure.retryable.filter(|value| *value).and(record.retry_descriptor.clone())),
        terminal_summary: record.terminal_summary.clone(),
    }
}

fn publish_catalog(state: &mut RegistryState) -> Result<(), &'static str> {
    if state.catalog_publication_closed {
        return Err("catalog_revision_exhausted");
    }
    state.catalog_revision = match state.catalog_revision.checked_add(1) {
        Some(revision) => revision,
        None => {
            state.catalog_publication_closed = true;
            return Err("catalog_revision_exhausted");
        }
    };
    let mut jobs = state
        .jobs
        .values()
        .map(|record| JobCatalogDescriptorDto {
            job_id: record.id.clone(),
            revision: record.revision.to_string(),
            kind: record.kind,
            status: record.status,
            terminal: record.status.is_terminal(),
        })
        .collect::<Vec<_>>();
    jobs.sort_by(|left, right| left.job_id.cmp(&right.job_id));
    let _ = state.catalog_sender.send_replace(Arc::new(JobCatalogSnapshotDto { catalog_revision: state.catalog_revision.to_string(), jobs }));
    Ok(())
}

fn evict_oldest_terminal_jobs(state: &mut RegistryState) {
    while state.jobs.values().filter(|record| record.status.is_terminal()).count() >= MAX_RETAINED_TERMINAL_JOBS {
        let oldest = state
            .jobs
            .values()
            .filter_map(|record| record.terminal_sequence.map(|sequence| (sequence, record.id.clone())))
            .min_by(|left, right| left.cmp(right));
        let Some((_, id)) = oldest else { break };
        cancel_job_subscriptions(state, &id);
        state.jobs.remove(&id);
    }
}

fn cancel_job_subscriptions(state: &mut RegistryState, job_id: &str) {
    let ids = state
        .subscriptions
        .iter()
        .filter(|&(_id, subscription)| subscription.job_id.as_deref() == Some(job_id))
        .map(|(id, _subscription)| id.clone())
        .collect::<Vec<_>>();
    for id in ids {
        if let Some(subscription) = state.subscriptions.remove(&id) {
            let _ = subscription.commands.try_send(SubscriptionCommand::Stop);
        }
    }
}

impl Drop for JobRegistry {
    fn drop(&mut self) {
        self.cleanup_preview_roots();
    }
}

pub struct JobEventCollector {
    registry: JobRegistry,
    job_id: String,
}

impl JobEventCollector {
    pub fn new(registry: &JobRegistry, job_id: String) -> Self {
        Self { registry: registry.clone(), job_id }
    }

    pub fn emit_direct(&mut self, event: JobEventDto) {
        self.registry.wait_if_paused(&self.job_id);
        self.registry.emit_direct_event(&self.job_id, event);
    }
}

impl JobEventSink for JobEventCollector {
    fn emit(&mut self, event: JobEvent) {
        self.registry.wait_if_paused(&self.job_id);
        self.registry.emit_job_event(&self.job_id, event);
    }
}

impl From<JobPhase> for JobPhaseDto {
    fn from(phase: JobPhase) -> Self {
        match phase {
            JobPhase::PlanningPayload => JobPhaseDto::PlanningPayload,
            JobPhase::PlanningMetadata => JobPhaseDto::PlanningMetadata,
            JobPhase::EmittingPayload => JobPhaseDto::EmittingPayload,
            JobPhase::EmittingMetadata => JobPhaseDto::EmittingMetadata,
            JobPhase::CommittingOutput => JobPhaseDto::CommittingOutput,
        }
    }
}

fn now_timestamp() -> String {
    let since_epoch = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();

    since_epoch.as_secs().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    fn temporary_preview_root() -> std::path::PathBuf {
        let now_nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let root = std::env::temp_dir().join(format!("zmanager-preview-windows-{now_nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temporary preview directory should be available");
        root
    }

    #[cfg(not(windows))]
    fn temporary_preview_root() -> std::path::PathBuf {
        let now_nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let root = std::env::temp_dir().join(format!("zmanager-preview-{now_nanos}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("temporary preview directory should be available");
        root
    }

    #[test]
    fn test_event_capture_drains_exactly_once() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipCreate);

        registry.emit_job_event(&response.job_id, zmanager_core::jobs::JobEvent::Started { kind: zmanager_core::jobs::JobKind::ZipCreate, total_bytes: None });

        let first_poll = registry.take_test_events(&response.job_id).expect("poll should return a snapshot");
        assert_eq!(first_poll.events.len(), 1);
        assert!(matches!(first_poll.events[0].event_type, JobEventKindDto::Started));
        assert!(matches!(first_poll.status, JobStatusDto::Running));

        let second_poll = registry.take_test_events(&response.job_id).expect("poll should continue returning snapshots");
        assert_eq!(second_poll.events.len(), 0);
        assert!(matches!(second_poll.status, JobStatusDto::Running));
    }

    #[test]
    fn fake_job_records_started() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipCreate);

        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::Started { kind: zmanager_core::jobs::JobKind::ZipCreate, total_bytes: Some(1024) },
        );

        let snapshot = registry.snapshot(&response.job_id).expect("job should exist after create");

        assert!(matches!(snapshot.status, JobStatusDto::Running));
        assert_eq!(snapshot.events.len(), 1);
        assert!(matches!(snapshot.events[0].event_type, JobEventKindDto::Started));
        assert_eq!(snapshot.events[0].job_kind, Some(JobKindDto::ZipCreate));
    }

    #[test]
    fn job_progress_events_are_coalesced_without_entry_chatter() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);

        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::Started { kind: zmanager_core::jobs::JobKind::ZipExtract, total_bytes: Some(100) },
        );
        registry.emit_job_event(&response.job_id, zmanager_core::jobs::JobEvent::EntryStarted { path: "docs/one.txt".to_string(), bytes: Some(10) });
        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::BytesProcessed {
                path: Some("docs/one.txt".to_string()),
                recent_paths: vec!["docs/one.txt".to_string()],
                recent_path_identities: vec![[1; 32]],
                bytes: 10,
                total_bytes_processed: 10,
                entries: 0,
                total_entries_processed: 0,
                recent_paths_truncated: false,
            },
        );
        registry.emit_job_event(&response.job_id, zmanager_core::jobs::JobEvent::EntryFinished { path: "docs/one.txt".to_string(), bytes: 10 });
        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::BytesProcessed {
                path: Some("docs/one.txt".to_string()),
                recent_paths: vec!["docs/one.txt".to_string(), "docs/two.txt".to_string()],
                recent_path_identities: vec![[1; 32], [2; 32]],
                bytes: 20,
                total_bytes_processed: 30,
                entries: 0,
                total_entries_processed: 1,
                recent_paths_truncated: false,
            },
        );

        let snapshot = registry.snapshot(&response.job_id).expect("job should exist after progress events");

        assert_eq!(
            snapshot.events.iter().map(|event| event.event_type).collect::<Vec<_>>(),
            [JobEventKindDto::Started, JobEventKindDto::EntryStarted, JobEventKindDto::EntryFinished, JobEventKindDto::BytesProcessed]
        );
        let progress = snapshot.events.last().expect("progress event should remain");
        assert_eq!(progress.path.as_deref(), Some("docs/two.txt"));
        assert_eq!(progress.total_bytes_processed, Some(30));
        let finished = snapshot
            .events
            .iter()
            .find(|event| event.event_type == JobEventKindDto::EntryFinished)
            .expect("latest finished entry should remain for file counts");
        assert_eq!(finished.entries, Some(1));
    }

    #[test]
    fn subscribed_job_progress_reports_job_wide_cumulative_bytes() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);
        let mut snapshots = registry.subscribe_job_snapshot(&response.job_id).expect("job subscription should exist");
        let _ = snapshots.borrow_and_update();

        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::BytesProcessed {
                path: Some("docs/one.txt".to_string()),
                recent_paths: vec!["docs/one.txt".to_string()],
                recent_path_identities: vec![[1; 32]],
                bytes: 10,
                total_bytes_processed: 10,
                entries: 0,
                total_entries_processed: 0,
                recent_paths_truncated: false,
            },
        );
        assert!(snapshots.has_changed().expect("subscription should remain open"));
        assert_eq!(snapshots.borrow_and_update().progress_facts.processed_bytes, 10);

        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::BytesProcessed {
                path: Some("docs/two.txt".to_string()),
                recent_paths: vec!["docs/two.txt".to_string()],
                recent_path_identities: vec![[2; 32]],
                bytes: 20,
                total_bytes_processed: 30,
                entries: 0,
                total_entries_processed: 0,
                recent_paths_truncated: false,
            },
        );
        assert!(snapshots.has_changed().expect("subscription should remain open"));
        assert_eq!(snapshots.borrow_and_update().progress_facts.processed_bytes, 30);
    }

    #[test]
    fn cancel_request_marks_token() {
        let registry = JobRegistry::new();
        let (response, token) = registry.create_job(JobKindDto::ZipExtract);

        let cancel_response = registry.request_cancel(&response.job_id).expect("cancel should target an existing job");

        assert!(matches!(cancel_response.status, JobStatusDto::Cancelling));
        assert!(token.is_cancelled(), "cancel request should set the job cancellation token");
    }

    #[test]
    fn completion_after_cancel_request_is_committed_as_cancelled() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);

        registry.request_cancel(&response.job_id).expect("cancel should target an existing job");
        registry
            .commit_completed(
                &response.job_id,
                JobKindDto::ZipExtract,
                JobTerminalSummaryDto { written_entries: 1, skipped_entries: None, written_bytes: 10, warnings: Vec::new() },
            )
            .expect("cancellation should still finalize the job");

        let terminal = registry.take_test_events(&response.job_id).expect("cancelled job should remain pollable");
        assert_eq!(terminal.status, JobStatusDto::Cancelled);
        assert!(terminal.terminal_summary.is_none());
        assert!(!terminal.events.iter().any(|event| event.event_type == JobEventKindDto::Completed));
        assert!(terminal.events.iter().any(|event| event.event_type == JobEventKindDto::Cancelled));
    }

    #[test]
    fn direct_completion_after_cancel_request_is_committed_as_cancelled() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);

        registry.request_cancel(&response.job_id).expect("cancel should target an existing job");
        registry.emit_direct_event(&response.job_id, JobEventDto::new(JobEventKindDto::Completed));

        let terminal = registry.take_test_events(&response.job_id).expect("cancelled job should remain pollable");
        assert_eq!(terminal.status, JobStatusDto::Cancelled);
        assert!(terminal.events.iter().any(|event| event.event_type == JobEventKindDto::Cancelled));
        assert!(!terminal.events.iter().any(|event| event.event_type == JobEventKindDto::Completed));
    }

    #[test]
    fn cancellation_command_error_is_published_as_cancelled() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);

        registry.emit_direct_event(
            &response.job_id,
            JobEventDto::failed_from_command_error(JobKindDto::ZipExtract, crate::error::CommandErrorDto::cancelled("cancelled")),
        );

        let terminal = registry.take_test_events(&response.job_id).expect("cancelled job should remain pollable");
        assert_eq!(terminal.status, JobStatusDto::Cancelled);
        assert!(terminal.events.iter().any(|event| event.event_type == JobEventKindDto::Cancelled));
        assert!(!terminal.events.iter().any(|event| event.event_type == JobEventKindDto::Failed));
    }

    #[test]
    fn tzap_phase_progress_maps_and_coalesces_per_phase() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::TzapCreate);

        registry.emit_job_event(&response.job_id, JobEvent::PhaseStarted { phase: JobPhase::PlanningPayload, total_bytes: Some(100) });
        for processed in [25, 75] {
            registry.emit_job_event(
                &response.job_id,
                JobEvent::PhaseBytesProcessed {
                    phase: JobPhase::PlanningPayload,
                    path: Some("payload.bin".to_string()),
                    recent_paths: vec!["payload.bin".to_string()],
                    recent_path_identities: vec![[1; 32]],
                    bytes: processed,
                    total_bytes_processed: processed,
                    total_bytes: Some(100),
                    recent_paths_truncated: false,
                },
            );
        }

        let snapshot = registry.snapshot(&response.job_id).expect("job should exist after create");
        assert_eq!(snapshot.events.len(), 2);
        assert_eq!(snapshot.events[0].phase, Some(JobPhaseDto::PlanningPayload));
        assert!(matches!(snapshot.events[0].event_type, JobEventKindDto::PhaseStarted));
        assert_eq!(snapshot.events[1].total_bytes_processed, Some(75));
        assert!(matches!(snapshot.events[1].event_type, JobEventKindDto::PhaseBytesProcessed));
    }

    #[test]
    fn cancel_request_moves_paused_job_to_cancelling_until_core_outcome() {
        let registry = JobRegistry::new();
        let (response, token) = registry.create_job(JobKindDto::ZipExtract);

        registry.request_pause(&response.job_id).expect("pause should target an existing job");

        let cancel_response = registry.request_cancel(&response.job_id).expect("cancel should target a paused job");

        assert!(matches!(cancel_response.status, JobStatusDto::Cancelling));
        assert!(token.is_cancelled(), "cancel request should set the paused job cancellation token");

        let poll = registry.take_test_events(&response.job_id).expect("cancelled job should remain pollable");
        assert!(matches!(poll.status, JobStatusDto::Cancelling));
        assert!(!poll.can_dismiss);
        assert!(!poll.events.iter().any(|event| event.event_type == JobEventKindDto::Cancelled));

        registry.emit_job_event(&response.job_id, JobEvent::Cancelled { message: "cancelled".into() });
        let terminal = registry.take_test_events(&response.job_id).expect("job remains retained");
        assert!(matches!(terminal.status, JobStatusDto::Cancelled));
        assert!(terminal.can_dismiss);
    }

    #[test]
    fn late_and_independent_subscribers_receive_retained_revisions() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipCreate);
        registry.emit_job_event(&response.job_id, JobEvent::Started { kind: JobKind::ZipCreate, total_bytes: Some(100) });
        let first = registry.subscribe_job_snapshot(&response.job_id).expect("job receiver");
        let second = registry.subscribe_job_snapshot(&response.job_id).expect("independent receiver");
        assert_eq!(first.borrow().status, JobStatusDto::Running);
        assert_eq!(first.borrow().revision, second.borrow().revision);
        registry.emit_job_event(&response.job_id, JobEvent::Warning { message: "notice".into() });
        assert!(first.has_changed().expect("sender remains"));
        assert!(second.has_changed().expect("sender remains"));
        assert_eq!(first.borrow().progress_facts.warning_count, 1);
    }

    #[test]
    fn catalog_discovers_creation_and_rejects_task_window_access() {
        let registry = JobRegistry::new();
        let catalog = registry.subscribe_catalog_snapshot();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);
        assert!(catalog.has_changed().expect("catalog sender remains"));
        assert_eq!(catalog.borrow().jobs[0].job_id, response.job_id);
        assert!(matches!(registry.register_catalog_subscription("task-1"), Err("catalog_forbidden")));
        assert!(matches!(registry.register_job_subscription("task-other", &response.job_id), Err("job_subscription_forbidden")));
        assert!(matches!(registry.register_job_subscription("main", &response.job_id), Err("job_subscription_forbidden")));
        assert!(registry.register_job_subscription(&format!("task-{}", response.job_id), &response.job_id,).is_ok());
    }

    #[test]
    fn paused_and_cancelling_states_survive_late_started_event() {
        let registry = JobRegistry::new();
        let (paused, _) = registry.create_job(JobKindDto::ZipCreate);
        registry.request_pause(&paused.job_id);
        registry.emit_job_event(&paused.job_id, JobEvent::Started { kind: JobKind::ZipCreate, total_bytes: None });
        assert_eq!(registry.current_job_snapshot(&paused.job_id).unwrap().status, JobStatusDto::Paused);
        let (cancelling, _) = registry.create_job(JobKindDto::ZipCreate);
        registry.request_cancel(&cancelling.job_id);
        registry.emit_job_event(&cancelling.job_id, JobEvent::Started { kind: JobKind::ZipCreate, total_bytes: None });
        assert_eq!(registry.current_job_snapshot(&cancelling.job_id).unwrap().status, JobStatusDto::Cancelling);
    }

    #[test]
    fn acknowledgement_is_owner_scoped_and_rejects_unsent_revisions() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipCreate);
        let owner = format!("task-{}", response.job_id);
        let (id, snapshots, mut commands, flow) = registry.register_job_subscription(&owner, &response.job_id).unwrap();
        let revision = snapshots.borrow().revision.parse::<u64>().unwrap();
        flow.lock().unwrap().in_flight = Some(revision);
        assert_eq!(registry.acknowledge_subscription("task-other", &id, revision), Err("subscription_forbidden"));
        assert_eq!(registry.acknowledge_subscription(&owner, &id, revision + 1), Err("ack_revision_newer_than_in_flight"));
        assert!(registry.acknowledge_subscription(&owner, &id, revision).is_ok());
        assert!(registry.acknowledge_subscription(&owner, &id, revision).is_ok(), "duplicate acknowledgement is idempotent");
        assert!(matches!(commands.try_recv(), Ok(SubscriptionCommand::Ack(value)) if value == revision));
        assert!(commands.try_recv().is_err(), "duplicate acknowledgement is not queued twice");
    }

    #[tokio::test]
    async fn latest_value_forwarder_keeps_one_message_in_flight_and_conflates_gaps() {
        #[derive(Debug)]
        struct Value(u64);
        let (publisher, receiver) = watch::channel(Arc::new(Value(1)));
        let (commands, command_receiver) = mpsc::channel(4);
        let flow = Arc::new(Mutex::new(SubscriptionFlowState::default()));
        let (sent, mut received) = mpsc::unbounded_channel();
        let task = tokio::spawn(forward_latest_values(
            receiver,
            command_receiver,
            flow.clone(),
            |value| Some(value.0),
            move |value| sent.send(value.0).map_err(|_| ()),
        ));
        assert_eq!(received.recv().await, Some(1));
        publisher.send_replace(Arc::new(Value(2)));
        publisher.send_replace(Arc::new(Value(3)));
        tokio::task::yield_now().await;
        assert!(received.try_recv().is_err(), "no second message before acknowledgement");
        commands.send(SubscriptionCommand::Ack(1)).await.unwrap();
        assert_eq!(received.recv().await, Some(3));
        commands.send(SubscriptionCommand::Stop).await.unwrap();
        task.await.unwrap();
        assert_eq!(flow.lock().unwrap().in_flight, Some(3));
    }

    #[tokio::test]
    async fn latest_value_forwarder_stops_only_the_failed_channel() {
        #[derive(Debug)]
        struct Value(u64);
        let (_publisher, receiver) = watch::channel(Arc::new(Value(1)));
        let (_commands, command_receiver) = mpsc::channel(1);
        let flow = Arc::new(Mutex::new(SubscriptionFlowState::default()));
        forward_latest_values(receiver, command_receiver, flow, |value| Some(value.0), |_| Err(())).await;
    }

    #[test]
    fn explicit_unsubscribe_and_window_cleanup_share_idempotent_removal() {
        let registry = JobRegistry::new();
        let (job, _) = registry.create_job(JobKindDto::ZipCreate);
        let owner = format!("task-{}", job.job_id);
        let (id, _snapshots, _commands, _flow) = registry.register_job_subscription(&owner, &job.job_id).unwrap();
        registry.unsubscribe(&owner, &id).unwrap();
        registry.cleanup_owner_subscriptions(&owner);
        registry.cleanup_subscription(&id);
        registry.with_lock(|state| assert!(state.subscriptions.is_empty()));
    }

    #[test]
    fn long_running_snapshot_state_remains_bounded() {
        let registry = JobRegistry::new();
        let (job, _) = registry.create_job(JobKindDto::ZipExtract);
        for index in 0..10_000 {
            let mut warning = JobEventDto::new(JobEventKindDto::Warning);
            warning.path = Some(format!("entry-{index}"));
            registry.emit_direct_event(&job.job_id, warning);
        }
        let snapshot = registry.current_job_snapshot(&job.job_id).unwrap();
        assert!(snapshot.bounded_notices.len() <= MAX_NOTICES_TO_KEEP);
        assert!(snapshot.progress_facts.recent_paths.len() <= 10);
    }

    #[test]
    fn revision_exhaustion_fails_closed() {
        assert_eq!(next_revision(u64::MAX), Err("revision_exhausted"));
        let registry = JobRegistry::new();
        let (job, _) = registry.create_job(JobKindDto::ZipCreate);
        let before = registry.current_job_snapshot(&job.job_id).unwrap();
        registry.with_lock(|state| state.jobs.get_mut(&job.job_id).unwrap().revision = u64::MAX);
        registry.emit_direct_event(&job.job_id, JobEventDto::new(JobEventKindDto::Warning));
        let after = registry.current_job_snapshot(&job.job_id).unwrap();
        assert_eq!(after.revision, before.revision);
        registry.with_lock(|state| {
            assert!(state.jobs.get(&job.job_id).unwrap().publication_closed);
        });
    }

    #[test]
    fn retention_and_active_admission_are_process_bounded() {
        let registry = JobRegistry::new();
        for _ in 0..=MAX_RETAINED_TERMINAL_JOBS {
            let (job, _) = registry.create_job(JobKindDto::ZipCreate);
            registry.emit_direct_event(&job.job_id, JobEventDto::new(JobEventKindDto::Completed));
        }
        let catalog = registry.subscribe_catalog_snapshot();
        assert!(catalog.borrow().jobs.iter().filter(|job| job.terminal).count() <= MAX_RETAINED_TERMINAL_JOBS);

        let active = JobRegistry::new();
        for _ in 0..MAX_ADMITTED_JOBS {
            active.try_create_job(JobKindDto::ZipCreate).unwrap();
        }
        assert!(matches!(active.try_create_job(JobKindDto::ZipCreate), Err("job_capacity")));
    }

    #[test]
    fn terminal_records_reject_all_late_mutations() {
        let registry = JobRegistry::new();
        let (job, _) = registry.create_job(JobKindDto::ZipCreate);
        registry
            .commit_completed(
                &job.job_id,
                JobKindDto::ZipCreate,
                JobTerminalSummaryDto { written_entries: 1, skipped_entries: None, written_bytes: 2, warnings: Vec::new() },
            )
            .unwrap();
        let terminal = registry.current_job_snapshot(&job.job_id).unwrap();
        let mut failure = JobEventDto::new(JobEventKindDto::Failed);
        failure.message = Some("late failure".into());
        registry.emit_direct_event(&job.job_id, failure);
        registry.emit_job_event(&job.job_id, zmanager_core::jobs::JobEvent::Warning { message: "late warning".into() });
        assert_eq!(registry.current_job_snapshot(&job.job_id).unwrap().revision, terminal.revision);
        assert_eq!(registry.current_job_snapshot(&job.job_id).unwrap().status, JobStatusDto::Completed);
    }

    #[test]
    fn successful_terminal_publication_atomically_contains_summary_and_actions() {
        let registry = JobRegistry::new();
        let (job, _) = registry.create_job(JobKindDto::ZipCreate);
        registry
            .configure_recovery_facts(
                &job.job_id,
                None,
                vec![JobOutputArtifactDto { artifact_id: "output".into(), kind: crate::job_dto::JobArtifactKindDto::Archive, path: "/tmp/archive.zip".into() }],
                vec![JobAvailableActionDto { action_id: "reveal-output".into(), kind: crate::job_dto::JobActionKindDto::Reveal, artifact_id: "output".into() }],
            )
            .unwrap();
        let mut snapshots = registry.subscribe_job_snapshot(&job.job_id).unwrap();
        let _ = snapshots.borrow_and_update();
        registry
            .commit_completed(
                &job.job_id,
                JobKindDto::ZipCreate,
                JobTerminalSummaryDto { written_entries: 1, skipped_entries: None, written_bytes: 10, warnings: Vec::new() },
            )
            .unwrap();
        assert!(snapshots.has_changed().unwrap());
        let terminal = snapshots.borrow_and_update().clone();
        assert_eq!(terminal.status, JobStatusDto::Completed);
        assert!(terminal.terminal_summary.is_some());
        assert_eq!(terminal.output_artifacts.len(), 1);
        assert_eq!(terminal.available_actions.len(), 1);
        assert!(!snapshots.has_changed().unwrap());
    }

    #[test]
    fn retained_retry_descriptor_is_typed_camel_case_and_secret_free() {
        let registry = JobRegistry::new();
        let (job, _) = registry.create_job(JobKindDto::ZipExtract);
        registry
            .configure_recovery_facts(
                &job.job_id,
                Some(JobRetryDescriptorDto::ExtractArchive {
                    action_id: "retry-with-password".into(),
                    archive_path: "/tmp/source.zip".into(),
                    destination_path: "/tmp/output".into(),
                    overwrite: crate::dto::OverwritePolicyDto::Ask,
                    destination_collision_strategy: crate::dto::DestinationCollisionStrategyDto::Refuse,
                    entry_paths: vec!["file.txt".into()],
                    select_all: false,
                    excluded_entry_paths: Vec::new(),
                    strip_components: 0,
                    tzap_restore_policy: crate::dto::TzapRestorePolicyDto::Portable,
                    tzap_allow_degraded: false,
                    tzap_allow_absolute_symlinks: false,
                    ignore_symlinks: false,
                }),
                Vec::new(),
                Vec::new(),
            )
            .unwrap();
        let mut failure = JobEventDto::new(JobEventKindDto::Failed);
        failure.code = Some("password_required");
        failure.retryable = Some(true);
        registry.emit_direct_event(&job.job_id, failure);
        let value = serde_json::to_value(&*registry.current_job_snapshot(&job.job_id).unwrap()).unwrap();
        assert_eq!(value["retryDescriptor"]["retryKind"], "extractArchive");
        assert_eq!(value["retryDescriptor"]["actionId"], "retry-with-password");
        assert_eq!(value["retryDescriptor"]["archivePath"], "/tmp/source.zip");
        assert!(!value.to_string().contains("password\":"));
    }

    #[test]
    fn retention_uses_process_terminal_order_not_per_job_revision() {
        let registry = JobRegistry::new();
        let (oldest, _) = registry.create_job(JobKindDto::ZipCreate);
        for _ in 0..20 {
            registry.emit_direct_event(&oldest.job_id, JobEventDto::new(JobEventKindDto::Warning));
        }
        registry.emit_direct_event(&oldest.job_id, JobEventDto::new(JobEventKindDto::Completed));
        let (newer, _) = registry.create_job(JobKindDto::ZipCreate);
        registry.emit_direct_event(&newer.job_id, JobEventDto::new(JobEventKindDto::Completed));
        for _ in 2..MAX_RETAINED_TERMINAL_JOBS {
            let (job, _) = registry.create_job(JobKindDto::ZipCreate);
            registry.emit_direct_event(&job.job_id, JobEventDto::new(JobEventKindDto::Completed));
        }
        let _ = registry.create_job(JobKindDto::ZipCreate);
        assert!(registry.current_job_snapshot(&oldest.job_id).is_none());
        assert!(registry.current_job_snapshot(&newer.job_id).is_some());
    }

    #[test]
    fn pause_and_resume_update_status_and_emit_events() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);

        registry.emit_job_event(
            &response.job_id,
            zmanager_core::jobs::JobEvent::Started { kind: zmanager_core::jobs::JobKind::ZipExtract, total_bytes: Some(100) },
        );

        let paused = registry.request_pause(&response.job_id).expect("pause should target an existing job");
        assert!(matches!(paused.status, JobStatusDto::Paused));

        let pause_poll = registry.take_test_events(&response.job_id).expect("paused job should remain pollable");
        assert!(matches!(pause_poll.status, JobStatusDto::Paused));
        assert!(pause_poll.events.iter().any(|event| event.event_type == JobEventKindDto::Paused));

        let resumed = registry.request_resume(&response.job_id).expect("resume should target an existing job");
        assert!(matches!(resumed.status, JobStatusDto::Running));

        let resume_poll = registry.take_test_events(&response.job_id).expect("resumed job should remain pollable");
        assert!(matches!(resume_poll.status, JobStatusDto::Running));
        assert!(resume_poll.events.iter().any(|event| event.event_type == JobEventKindDto::Resumed));
    }

    #[test]
    fn dismiss_job_only_removes_terminal_jobs() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipCreate);

        assert!(registry.remove_job_if_terminal(&response.job_id).is_none(), "non-terminal jobs should stay in registry");

        registry.emit_direct_event(&response.job_id, JobEventDto::new(JobEventKindDto::Completed));

        let removed = registry.remove_job_if_terminal(&response.job_id).expect("terminal job should be removable");
        assert!(matches!(removed, JobKindDto::ZipCreate));
        assert!(registry.snapshot(&response.job_id).is_none());
    }

    #[test]
    fn replace_preview_root_cleans_previous_root() {
        let registry = JobRegistry::new();
        let root = temporary_preview_root();
        let first = root.join("first");
        let second = root.join("second");

        fs::create_dir_all(&first).expect("first preview root should be created");
        registry.replace_preview_root(first.clone());
        assert!(first.exists(), "first preview root should exist after registration");

        fs::create_dir_all(&second).expect("second preview root should be created");
        registry.replace_preview_root(second.clone());

        assert!(!first.exists(), "previous preview root should be removed");
        assert!(second.exists(), "current preview root should remain");

        registry.cleanup_preview_roots();
        assert!(!second.exists(), "cleanup should remove remaining preview root");
        let _ = fs::remove_dir_all(&root);
    }
}
