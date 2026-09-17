use serde::{Deserialize, Serialize};

use crate::dto::{DestinationCollisionStrategyDto, OverwritePolicyDto, TzapRestorePolicyDto};
use crate::error::{CommandErrorDto, ErrorSeverityDto};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobArtifactKindDto {
    Archive,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobOutputArtifactDto {
    pub artifact_id: String,
    pub kind: JobArtifactKindDto,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobActionKindDto {
    Open,
    Reveal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobAvailableActionDto {
    pub action_id: String,
    pub kind: JobActionKindDto,
    pub artifact_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "retryKind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum JobRetryDescriptorDto {
    ExtractArchive {
        action_id: String,
        archive_path: String,
        destination_path: String,
        overwrite: OverwritePolicyDto,
        destination_collision_strategy: DestinationCollisionStrategyDto,
        entry_paths: Vec<String>,
        select_all: bool,
        excluded_entry_paths: Vec<String>,
        strip_components: usize,
        tzap_restore_policy: TzapRestorePolicyDto,
        tzap_allow_degraded: bool,
        tzap_allow_absolute_symlinks: bool,
        ignore_symlinks: bool,
    },
    TestArchive {
        action_id: String,
        archive_path: String,
        entry_paths: Vec<String>,
    },
    NativeDrag {
        action_id: String,
        archive_path: String,
        entry_paths: Vec<String>,
        select_all: bool,
        excluded_entry_paths: Vec<String>,
        strip_components: usize,
    },
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobStatusDto {
    Queued,
    Running,
    Paused,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatusDto {
    pub const fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled,)
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobKindDto {
    ZipCreate,
    ZipExtract,
    SevenZCreate,
    SevenZExtract,
    RarExtract,
    TarGzCreate,
    TarZstdCreate,
    TarZstdExtract,
    TzapCreate,
    TzapExtract,
    AppleArchiveCreate,
    AppleArchiveExtract,
    ArchiveExtract,
    RawStreamExtract,
    TestArchive,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobEventKindDto {
    Started,
    EntryStarted,
    BytesProcessed,
    PhaseStarted,
    PhaseBytesProcessed,
    EntryFinished,
    Paused,
    Resumed,
    Warning,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobPhaseDto {
    PlanningPayload,
    PlanningMetadata,
    EmittingPayload,
    EmittingMetadata,
    CommittingOutput,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgressFactsDto {
    pub processed_bytes: u64,
    pub total_bytes: Option<u64>,
    pub processed_entries: u64,
    pub total_entries: Option<u64>,
    pub current_path: Option<String>,
    pub recent_paths: Vec<String>,
    pub active_phase: Option<JobPhaseDto>,
    pub phase_processed_bytes: u64,
    pub phase_total_bytes: Option<u64>,
    pub warning_count: u64,
    pub active_elapsed_millis: u64,
    pub phase_elapsed_millis: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopJobSnapshotDto {
    pub revision: String,
    pub job_id: String,
    pub kind: JobKindDto,
    pub status: JobStatusDto,
    pub created_at: String,
    pub updated_at: String,
    pub can_pause: bool,
    pub can_resume: bool,
    pub can_cancel: bool,
    pub can_dismiss: bool,
    pub progress_facts: JobProgressFactsDto,
    pub latest_failure: Option<JobEventDto>,
    pub bounded_notices: Vec<JobEventDto>,
    pub available_actions: Vec<JobAvailableActionDto>,
    pub output_artifacts: Vec<JobOutputArtifactDto>,
    pub retry_descriptor: Option<JobRetryDescriptorDto>,
    pub terminal_summary: Option<JobTerminalSummaryDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshotEnvelopeDto {
    pub subscription_id: String,
    pub revision: String,
    pub payload: DesktopJobSnapshotDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCatalogDescriptorDto {
    pub job_id: String,
    pub revision: String,
    pub kind: JobKindDto,
    pub status: JobStatusDto,
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCatalogSnapshotDto {
    pub catalog_revision: String,
    pub jobs: Vec<JobCatalogDescriptorDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobCatalogEnvelopeDto {
    pub subscription_id: String,
    pub revision: String,
    pub payload: JobCatalogSnapshotDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobEventDto {
    pub event_type: JobEventKindDto,
    pub job_kind: Option<JobKindDto>,
    pub phase: Option<JobPhaseDto>,
    pub code: Option<&'static str>,
    pub hint: Option<String>,
    pub severity: Option<ErrorSeverityDto>,
    pub retryable: Option<bool>,
    pub path: Option<String>,
    pub bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub total_bytes_processed: Option<u64>,
    pub entries: Option<usize>,
    pub total_entries: Option<usize>,
    pub message: Option<String>,
}

impl JobEventDto {
    pub fn cancelled(job_kind: Option<JobKindDto>, message: impl Into<String>) -> Self {
        Self {
            event_type: JobEventKindDto::Cancelled,
            job_kind,
            phase: None,
            code: Some(crate::constants::COMMAND_ERROR_CANCELLED),
            hint: None,
            severity: Some(ErrorSeverityDto::Info),
            retryable: Some(true),
            path: None,
            bytes: None,
            total_bytes: None,
            total_bytes_processed: None,
            entries: None,
            total_entries: None,
            message: Some(message.into()),
        }
    }

    pub fn failed_from_command_error(job_kind: JobKindDto, error: CommandErrorDto) -> Self {
        Self {
            event_type: if error.code == crate::constants::COMMAND_ERROR_CANCELLED { JobEventKindDto::Cancelled } else { JobEventKindDto::Failed },
            job_kind: Some(job_kind),
            phase: None,
            code: Some(error.code),
            hint: error.hint,
            severity: Some(error.severity),
            retryable: Some(error.retryable),
            path: None,
            bytes: None,
            total_bytes: None,
            total_bytes_processed: None,
            entries: None,
            total_entries: None,
            message: Some(error.message),
        }
    }
}

#[cfg(test)]
impl JobEventDto {
    pub fn new(event_type: JobEventKindDto) -> Self {
        Self {
            event_type,
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
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobTerminalSummaryDto {
    pub written_entries: usize,
    pub skipped_entries: Option<usize>,
    pub written_bytes: u64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobResponseDto {
    pub job_id: String,
    pub kind: JobKindDto,
    pub status: JobStatusDto,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AcceptedJobOriginDto {
    MainWindow,
    QuickAction,
    LocalSendAutoExtract,
    NativeDrag,
    PasswordRetry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedJobEnvelopeDto {
    pub acceptance_revision: String,
    pub job: StartJobResponseDto,
    pub origin: AcceptedJobOriginDto,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestJobEventsSnapshot {
    pub job_id: String,
    pub kind: JobKindDto,
    pub status: JobStatusDto,
    pub created_at: String,
    pub can_dismiss: bool,
    pub events: Vec<JobEventDto>,
    pub terminal_summary: Option<JobTerminalSummaryDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelJobResponseDto {
    pub job_id: String,
    pub status: JobStatusDto,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobControlResponseDto {
    pub job_id: String,
    pub status: JobStatusDto,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecordSnapshot {
    pub kind: JobKindDto,
    pub created_at: String,
    pub status: JobStatusDto,
    #[cfg(test)]
    pub events: Vec<JobEventDto>,
    pub terminal_summary: Option<JobTerminalSummaryDto>,
}
