use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthcheckResponse {
    pub engine: &'static str,
    pub version: &'static str,
    pub ready: bool,
    pub summary: String,
    pub shell: &'static str,
    pub status: &'static str,
    pub app_version: &'static str,
    pub build_id: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIntegrationContract {
    pub platform: &'static str,
    pub package_kind: crate::native_integration::NativePackageKind,
    pub capabilities: Vec<crate::native_integration::NativeCapabilitySnapshot>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTableCapabilitiesDto {
    /// CompressTableColumnId values the running implementation can populate.
    /// Must contain the safe base: name, kind, size, modified, sourcePath.
    pub available_column_ids: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceAttributeDto {
    /// Namespace: "windows", "bsd", or "portable"
    pub namespace: String,
    /// Language-neutral allowlisted attribute code
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContract {
    pub commands: &'static [&'static str],
    pub platform_strategy: &'static str,
    pub core_dependency: &'static str,
    pub platform_integration: ProjectIntegrationContract,
    pub source_table_capabilities: SourceTableCapabilitiesDto,
    /// Whether LAN sharing (LocalSend) commands are available in this build.
    /// Not part of `platform_integration.capabilities` — that registry
    /// models native OS shell-integration install/registration state
    /// (Explorer/Finder/Nautilus context menus, file associations), which
    /// LocalSend has nothing to do with; it's a plain runtime/network
    /// feature. Always `true` today, since `zmanager-localsend` is an
    /// unconditional dependency of this crate with no feature-flag split —
    /// this field exists so the frontend never has to hardcode that
    /// assumption if an offline desktop build variant is added later.
    pub local_send_available: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFileIconRequest {
    pub entries: Vec<SystemFileIconRequestEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Serialize)]
pub struct SystemFileIconRequestEntry {
    pub key: String,
    pub path: String,
    #[serde(default)]
    pub is_directory: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFileIconResponse {
    pub icons: Vec<SystemFileIconDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Deserialize)]
pub struct SystemFileIconDto {
    pub key: String,
    pub data_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateDirectoryRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateDirectoryResponse {
    pub exists: bool,
    pub is_directory: bool,
    pub accessible: bool,
}

pub use zmanager_shell_contract::{ShellActionKind as QuickActionKindDto, ShellActionWindowDisposition as QuickActionWindowDispositionDto};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickActionRequestDto {
    pub kind: QuickActionKindDto,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickActionStartupErrorDto {
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickActionStartupStateDto {
    pub launched_for_quick_action: bool,
    pub window_disposition: Option<QuickActionWindowDispositionDto>,
    pub error: Option<QuickActionStartupErrorDto>,
}

#[cfg(test)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveListingResponse {
    pub archive_path: String,
    pub entries: Vec<ArchiveEntryDto>,
    pub entry_count: usize,
    pub total_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntryDto {
    pub path: String,
    pub kind: ArchiveEntryKindDto,
    pub size: Option<u64>,
    pub compressed_size: Option<u64>,
    pub modified: Option<String>,
    pub mode: Option<u32>,
    pub metadata_diagnostics: Vec<String>,
    pub encrypted: Option<bool>,
    pub method: Option<String>,
    pub crc: Option<String>,
    pub comment: Option<String>,
    pub created: Option<String>,
    pub accessed: Option<String>,
    pub solid: Option<bool>,
    pub link_target: Option<String>,
    pub attributes: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveEntryKindDto {
    File,
    Directory,
    Symlink,
    Hardlink,
    Special,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListArchiveRequest {
    pub archive_path: String,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArchiveIndexRequest {
    pub archive_path: String,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveIndexStatusDto {
    Indexing,
    Ready,
    Empty,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveIndexSnapshotDto {
    pub revision: String,
    pub session_id: String,
    pub archive_path: String,
    pub status: ArchiveIndexStatusDto,
    pub discovered_entries: usize,
    pub discovered_bytes: Option<u64>,
    pub final_entry_count: Option<usize>,
    pub final_total_bytes: Option<u64>,
    pub latest_failure: Option<crate::error::CommandErrorDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<ArchiveFormatKindDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectArchiveFormatRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectArchiveFormatResponse {
    pub format: ArchiveFormatKindDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveFormatKindDto {
    Zip,
    SplitZip,
    SevenZ,
    TarZst,
    TarGz,
    Tar,
    TarBz2,
    TarXz,
    TarLzma,
    TarLz,
    TarLzo,
    TarCompress,
    TarLz4,
    TarUu,
    Iso,
    Cab,
    Cpio,
    Rpm,
    Xar,
    Pkg,
    Dmg,
    Lha,
    Ar,
    Warc,
    Mtree,
    Tzap,
    Rar,
    AppleArchive,
    Deb,
    Msi,
    Vhd,
    Vmdk,
    Udf,
    Squashfs,
    AppImage,
    Wim,
    Vdi,
    Nrg,
    Mdf,
    Cdi,
    Isz,
    Ccd,
    Cue,
    Vhdx,
    Qcow2,
    Ewf,
    Ad1,
    Dar,
    Aff4,
    RawDisk,
    RawStream,
    Unknown,
}

impl From<zmanager_core::archive_format::ArchiveFormatKind> for ArchiveFormatKindDto {
    fn from(kind: zmanager_core::archive_format::ArchiveFormatKind) -> Self {
        match kind {
            zmanager_core::archive_format::ArchiveFormatKind::Zip => Self::Zip,
            zmanager_core::archive_format::ArchiveFormatKind::SplitZip => Self::SplitZip,
            zmanager_core::archive_format::ArchiveFormatKind::SevenZ => Self::SevenZ,
            zmanager_core::archive_format::ArchiveFormatKind::TarZst => Self::TarZst,
            zmanager_core::archive_format::ArchiveFormatKind::TarGz => Self::TarGz,
            zmanager_core::archive_format::ArchiveFormatKind::Tar => Self::Tar,
            zmanager_core::archive_format::ArchiveFormatKind::TarBz2 => Self::TarBz2,
            zmanager_core::archive_format::ArchiveFormatKind::TarXz => Self::TarXz,
            zmanager_core::archive_format::ArchiveFormatKind::TarLzma => Self::TarLzma,
            zmanager_core::archive_format::ArchiveFormatKind::TarLz => Self::TarLz,
            zmanager_core::archive_format::ArchiveFormatKind::TarLzo => Self::TarLzo,
            zmanager_core::archive_format::ArchiveFormatKind::TarCompress => Self::TarCompress,
            zmanager_core::archive_format::ArchiveFormatKind::TarLz4 => Self::TarLz4,
            zmanager_core::archive_format::ArchiveFormatKind::TarUu => Self::TarUu,
            zmanager_core::archive_format::ArchiveFormatKind::Iso => Self::Iso,
            zmanager_core::archive_format::ArchiveFormatKind::Cab => Self::Cab,
            zmanager_core::archive_format::ArchiveFormatKind::Cpio => Self::Cpio,
            zmanager_core::archive_format::ArchiveFormatKind::Rpm => Self::Rpm,
            zmanager_core::archive_format::ArchiveFormatKind::Xar => Self::Xar,
            zmanager_core::archive_format::ArchiveFormatKind::Pkg => Self::Pkg,
            zmanager_core::archive_format::ArchiveFormatKind::Dmg => Self::Dmg,
            zmanager_core::archive_format::ArchiveFormatKind::Lha => Self::Lha,
            zmanager_core::archive_format::ArchiveFormatKind::Ar => Self::Ar,
            zmanager_core::archive_format::ArchiveFormatKind::Warc => Self::Warc,
            zmanager_core::archive_format::ArchiveFormatKind::Mtree => Self::Mtree,
            zmanager_core::archive_format::ArchiveFormatKind::Tzap => Self::Tzap,
            zmanager_core::archive_format::ArchiveFormatKind::Rar => Self::Rar,
            zmanager_core::archive_format::ArchiveFormatKind::AppleArchive => Self::AppleArchive,
            zmanager_core::archive_format::ArchiveFormatKind::Deb => Self::Deb,
            zmanager_core::archive_format::ArchiveFormatKind::Msi => Self::Msi,
            zmanager_core::archive_format::ArchiveFormatKind::Vhd => Self::Vhd,
            zmanager_core::archive_format::ArchiveFormatKind::Vmdk => Self::Vmdk,
            zmanager_core::archive_format::ArchiveFormatKind::Udf => Self::Udf,
            zmanager_core::archive_format::ArchiveFormatKind::Squashfs => Self::Squashfs,
            zmanager_core::archive_format::ArchiveFormatKind::AppImage => Self::AppImage,
            zmanager_core::archive_format::ArchiveFormatKind::Wim => Self::Wim,
            zmanager_core::archive_format::ArchiveFormatKind::Vdi => Self::Vdi,
            zmanager_core::archive_format::ArchiveFormatKind::Nrg => Self::Nrg,
            zmanager_core::archive_format::ArchiveFormatKind::Mdf => Self::Mdf,
            zmanager_core::archive_format::ArchiveFormatKind::Cdi => Self::Cdi,
            zmanager_core::archive_format::ArchiveFormatKind::Isz => Self::Isz,
            zmanager_core::archive_format::ArchiveFormatKind::Ccd => Self::Ccd,
            zmanager_core::archive_format::ArchiveFormatKind::Cue => Self::Cue,
            zmanager_core::archive_format::ArchiveFormatKind::Vhdx => Self::Vhdx,
            zmanager_core::archive_format::ArchiveFormatKind::Qcow2 => Self::Qcow2,
            zmanager_core::archive_format::ArchiveFormatKind::Ewf => Self::Ewf,
            zmanager_core::archive_format::ArchiveFormatKind::Ad1 => Self::Ad1,
            zmanager_core::archive_format::ArchiveFormatKind::Dar => Self::Dar,
            zmanager_core::archive_format::ArchiveFormatKind::Aff4 => Self::Aff4,
            zmanager_core::archive_format::ArchiveFormatKind::RawDisk => Self::RawDisk,
            zmanager_core::archive_format::ArchiveFormatKind::RawStream => Self::RawStream,
            zmanager_core::archive_format::ArchiveFormatKind::Unknown => Self::Unknown,
        }
    }
}

impl From<ArchiveFormatKindDto> for zmanager_core::archive_format::ArchiveFormatKind {
    fn from(dto: ArchiveFormatKindDto) -> Self {
        match dto {
            ArchiveFormatKindDto::Zip => Self::Zip,
            ArchiveFormatKindDto::SplitZip => Self::SplitZip,
            ArchiveFormatKindDto::SevenZ => Self::SevenZ,
            ArchiveFormatKindDto::TarZst => Self::TarZst,
            ArchiveFormatKindDto::TarGz => Self::TarGz,
            ArchiveFormatKindDto::Tar => Self::Tar,
            ArchiveFormatKindDto::TarBz2 => Self::TarBz2,
            ArchiveFormatKindDto::TarXz => Self::TarXz,
            ArchiveFormatKindDto::TarLzma => Self::TarLzma,
            ArchiveFormatKindDto::TarLz => Self::TarLz,
            ArchiveFormatKindDto::TarLzo => Self::TarLzo,
            ArchiveFormatKindDto::TarCompress => Self::TarCompress,
            ArchiveFormatKindDto::TarLz4 => Self::TarLz4,
            ArchiveFormatKindDto::TarUu => Self::TarUu,
            ArchiveFormatKindDto::Iso => Self::Iso,
            ArchiveFormatKindDto::Cab => Self::Cab,
            ArchiveFormatKindDto::Cpio => Self::Cpio,
            ArchiveFormatKindDto::Rpm => Self::Rpm,
            ArchiveFormatKindDto::Xar => Self::Xar,
            ArchiveFormatKindDto::Pkg => Self::Pkg,
            ArchiveFormatKindDto::Dmg => Self::Dmg,
            ArchiveFormatKindDto::Lha => Self::Lha,
            ArchiveFormatKindDto::Ar => Self::Ar,
            ArchiveFormatKindDto::Warc => Self::Warc,
            ArchiveFormatKindDto::Mtree => Self::Mtree,
            ArchiveFormatKindDto::Tzap => Self::Tzap,
            ArchiveFormatKindDto::Rar => Self::Rar,
            ArchiveFormatKindDto::AppleArchive => Self::AppleArchive,
            ArchiveFormatKindDto::Deb => Self::Deb,
            ArchiveFormatKindDto::Msi => Self::Msi,
            ArchiveFormatKindDto::Vhd => Self::Vhd,
            ArchiveFormatKindDto::Vmdk => Self::Vmdk,
            ArchiveFormatKindDto::Udf => Self::Udf,
            ArchiveFormatKindDto::Squashfs => Self::Squashfs,
            ArchiveFormatKindDto::AppImage => Self::AppImage,
            ArchiveFormatKindDto::Wim => Self::Wim,
            ArchiveFormatKindDto::Vdi => Self::Vdi,
            ArchiveFormatKindDto::Nrg => Self::Nrg,
            ArchiveFormatKindDto::Mdf => Self::Mdf,
            ArchiveFormatKindDto::Cdi => Self::Cdi,
            ArchiveFormatKindDto::Isz => Self::Isz,
            ArchiveFormatKindDto::Ccd => Self::Ccd,
            ArchiveFormatKindDto::Cue => Self::Cue,
            ArchiveFormatKindDto::Vhdx => Self::Vhdx,
            ArchiveFormatKindDto::Qcow2 => Self::Qcow2,
            ArchiveFormatKindDto::Ewf => Self::Ewf,
            ArchiveFormatKindDto::Ad1 => Self::Ad1,
            ArchiveFormatKindDto::Dar => Self::Dar,
            ArchiveFormatKindDto::Aff4 => Self::Aff4,
            ArchiveFormatKindDto::RawDisk => Self::RawDisk,
            ArchiveFormatKindDto::RawStream => Self::RawStream,
            ArchiveFormatKindDto::Unknown => Self::Unknown,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveIndexStartResponseDto {
    pub session_id: String,
    pub snapshot: ArchiveIndexSnapshotDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveIndexSessionRequest {
    pub session_id: String,
    pub after_revision: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveChildrenRequest {
    pub session_id: String,
    #[serde(default)]
    pub parent_path: String,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
    pub sort_key: Option<String>,
    pub sort_ascending: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSearchRequest {
    pub session_id: String,
    #[serde(default)]
    pub query: String,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
    pub sort_key: Option<String>,
    pub sort_ascending: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveChildrenPageDto {
    pub session_id: String,
    pub revision: String,
    pub parent_path: String,
    pub entries: Vec<ArchiveEntryDto>,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub child_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlanResponse {
    pub included_count: usize,
    pub excluded_count: usize,
    pub total_bytes: u64,
    pub excluded_bytes: u64,
    pub entries: Vec<String>,
    pub plan_entries: Vec<CreatePlanEntryDto>,
    pub excluded_entries: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlanEntryDto {
    pub path: String,
    pub kind: ArchiveEntryKindDto,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub mode: Option<u32>,
    pub source_path: String,
    // WP6 incremental metadata — optional fields populated when available
    pub created: Option<String>,
    pub accessed: Option<String>,
    pub attributes: Option<Vec<crate::dto::SourceAttributeDto>>,
    pub link_target: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub owner: Option<String>,
    pub group: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCreateRequest {
    pub sources: Vec<String>,
    #[serde(default)]
    pub clean_source: bool,
    #[serde(default)]
    pub respect_gitignore: bool,
    pub exclude_names: Option<Vec<String>>,
    pub exclude_archive_paths: Option<Vec<String>>,
    pub include_archive_paths: Option<Vec<String>>,
    #[serde(default)]
    pub follow_symlinks: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveFormatDto {
    Zip,
    TarZst,
    TarGz,
    Tzap,
    SevenZ,
    AppleArchive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum DestinationCollisionStrategyDto {
    #[default]
    Refuse,
    Rename,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCreateRequest {
    pub sources: Vec<String>,
    pub destination_path: String,
    pub format: ArchiveFormatDto,
    #[serde(default)]
    pub clean_source: bool,
    pub exclude_names: Option<Vec<String>>,
    pub exclude_archive_paths: Option<Vec<String>>,
    pub include_archive_paths: Option<Vec<String>>,
    #[serde(default)]
    pub respect_gitignore: bool,
    #[serde(default)]
    pub follow_symlinks: bool,
    #[serde(default)]
    pub replace_existing: bool,
    #[serde(default)]
    pub destination_collision_strategy: DestinationCollisionStrategyDto,
    pub password: Option<String>,
    pub compression_level: Option<u32>,
    pub volume_size: Option<u64>,
    #[serde(default)]
    pub volume_count: Option<u32>,
    pub tzap_recovery_percentage: Option<u8>,
    #[serde(default)]
    pub tzap_volume_loss_tolerance: Option<u8>,
    #[serde(default)]
    pub zip_compression: Option<ZipCompressionDto>,
    #[serde(default)]
    pub seven_z_solid: Option<bool>,
    #[serde(default)]
    pub seven_z_threads: Option<u32>,
    #[serde(default)]
    pub seven_z_chunk_size: Option<u64>,
    #[serde(default)]
    pub seven_z_encrypt_file_names: Option<bool>,
    #[serde(default)]
    pub tzap_certificates: Option<TzapCertificateOptionsDto>,
    #[serde(default)]
    pub tzap_bootstrap_sidecar: Option<bool>,
    #[serde(default)]
    pub preserve_metadata: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExtractRequest {
    pub archive_path: String,
    pub destination_path: String,
    pub password: Option<String>,
    #[serde(default)]
    pub recipient_key_id: Option<String>,
    pub overwrite: OverwritePolicyDto,
    #[serde(default)]
    pub destination_collision_strategy: DestinationCollisionStrategyDto,
    #[serde(default)]
    pub entry_paths: Option<Vec<String>>,
    #[serde(default)]
    pub strip_components: usize,
    #[serde(default)]
    pub tzap_restore_policy: TzapRestorePolicyDto,
    #[serde(default)]
    pub tzap_allow_degraded: bool,
    #[serde(default)]
    pub tzap_allow_absolute_symlinks: bool,
    #[serde(default)]
    pub ignore_symlinks: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntryRequest {
    pub archive_path: String,
    pub entry_path: String,
    pub password: Option<String>,
    pub overwrite: OverwritePolicyDto,
    #[serde(default)]
    pub strip_components: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewEntryResponse {
    pub cleanup_root: String,
    pub preview_path: String,
    pub written_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDragRequest {
    pub archive_path: String,
    #[serde(default)]
    pub entry_paths: Vec<String>,
    pub password: Option<String>,
    #[serde(default)]
    pub strip_components: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDragResponse {
    pub outcome: NativeFileDragOutcomeDto,
    pub session_id: Option<String>,
    pub dragged_entries: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeFileDragOutcomeDto {
    Pending,
    Dropped,
    Cancelled,
    NoDrop,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestArchiveRequest {
    pub archive_path: String,
    pub entry_paths: Option<Vec<String>>,
    pub password: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTzapCertificateRequest {
    pub archive_path: String,
    #[serde(default)]
    pub validate_trust: bool,
    #[serde(default)]
    pub trusted_ca_certificate_paths: Vec<String>,
    #[serde(default)]
    pub trusted_system_roots: bool,
    #[serde(default)]
    pub include_official_tzap_root: bool,
    #[serde(default)]
    #[serde(alias = "onlineStatus")]
    pub check_current_status: bool,
    /// Selects the public status service for an explicit online check. Omitted
    /// requests retain the production default for backwards compatibility.
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTzapCertificateResponse {
    pub outcome: String,
    pub subject: String,
    pub issuer: String,
    pub serial_number_hex: String,
    pub certificate_sha256: String,
    pub signed_at_unix_seconds: i64,
    pub trust_anchor_subject: Option<String>,
    pub verified_chain_subjects: Vec<String>,
    pub diagnostics: Vec<String>,
    pub verification_state: String,
    pub signature_check: String,
    pub trust_check: String,
    pub certificate_time: String,
    pub status_check: String,
    pub status_reason: Option<String>,
    pub status_this_update_unix_seconds: Option<i64>,
    pub status_next_update_unix_seconds: Option<i64>,
    pub status_revoked_at_unix_seconds: Option<i64>,
    pub status_revocation_reason: Option<String>,
    pub status_revocation_category: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TzapCertificateOptionsDto {
    #[serde(default)]
    pub signing_selection: Option<TzapSigningSelectionDto>,
    #[serde(default)]
    pub recipient_selection: Option<TzapRecipientSelectionDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum TzapSigningSelectionDto {
    None,
    EnrolledIdentity {
        #[serde(rename = "signingIdentityId")]
        signing_identity_id: String,
    },
    OneTimePkcs12 {
        path: String,
        password: String,
    },
    OneTimeCertificateAndKey {
        certificate_path: String,
        private_key_path: String,
        #[serde(default)]
        chain_paths: Vec<String>,
        password: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TzapRecipientSelectionDto {
    #[serde(default)]
    pub recipient_key_ids: Vec<String>,
    #[serde(default)]
    pub contact_recipient_ids: Vec<String>,
    #[serde(default)]
    pub one_time_certificate_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ValidateTzapSigningIdentityRequest {
    pub identity_path: String,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateTzapSigningIdentityResponse {
    pub certificate_sha256: String,
    pub chain_certificate_count: usize,
    pub subject: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ZipCompressionDto {
    Store,
    Deflate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeJobRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionRequest {
    pub subscription_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AckSubscriptionRequest {
    pub subscription_id: String,
    pub revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelJobRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseJobRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeJobRequest {
    pub job_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissJobRequest {
    pub job_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum OverwritePolicyDto {
    #[default]
    Refuse,
    Replace,
    Rename,
    Ask,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TzapRestorePolicyDto {
    Content,
    #[default]
    Portable,
    SameOs,
    System,
}

#[cfg(test)]
mod tests {
    use super::{ArchiveFormatKindDto, TzapSigningSelectionDto};

    #[test]
    fn enrolled_signing_selection_accepts_frontend_camel_case_field() {
        let selection = serde_json::from_value::<TzapSigningSelectionDto>(serde_json::json!({
            "mode": "enrolledIdentity",
            "signingIdentityId": "signing_identity_1",
        }))
        .expect("frontend signing selection should deserialize");

        assert!(matches!(
            selection,
            TzapSigningSelectionDto::EnrolledIdentity { signing_identity_id }
                if signing_identity_id == "signing_identity_1"
        ));
    }

    #[test]
    fn new_archive_format_kinds_round_trip_through_the_desktop_dto() {
        let cases = [
            (ArchiveFormatKindDto::Vhdx, "vhdx"),
            (ArchiveFormatKindDto::Qcow2, "qcow2"),
            (ArchiveFormatKindDto::Ewf, "ewf"),
            (ArchiveFormatKindDto::Ad1, "ad1"),
            (ArchiveFormatKindDto::Dar, "dar"),
            (ArchiveFormatKindDto::Aff4, "aff4"),
            (ArchiveFormatKindDto::RawDisk, "rawDisk"),
        ];

        for (dto, expected_json) in cases {
            assert_eq!(serde_json::to_string(&dto).unwrap(), format!("\"{expected_json}\""));
            let core_kind: zmanager_core::archive_format::ArchiveFormatKind = dto.into();
            assert_eq!(ArchiveFormatKindDto::from(core_kind), dto);
        }
    }
}
