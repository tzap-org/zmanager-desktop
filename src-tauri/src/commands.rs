use std::collections::HashSet;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use openssl::asn1::Asn1Time;
use openssl::hash::MessageDigest;
use openssl::pkcs12::Pkcs12;
use openssl::x509::X509;
use tauri::{AppHandle, State, WebviewWindow, ipc::Channel};

#[cfg(test)]
use crate::dto::ArchiveListingResponse;
#[cfg(test)]
use crate::job_dto::TestJobEventsSnapshot;
use crate::{
    archive_index::ArchiveIndexRegistry,
    constants, destination_reservation,
    dto::{
        AckSubscriptionRequest, ArchiveEntryDto, ArchiveEntryKindDto, CreatePlanEntryDto, CreatePlanResponse, DestinationCollisionStrategyDto,
        NativeFileDragOutcomeDto, NativeFileDragRequest, NativeFileDragResponse, PauseJobRequest, PlanCreateRequest, PreviewEntryRequest, PreviewEntryResponse,
        ProjectContract, ProjectIntegrationContract, ResumeJobRequest, StartCreateRequest, StartExtractRequest, SubscribeJobRequest, SubscriptionRequest,
        SystemFileIconRequest, SystemFileIconResponse, TestArchiveRequest, TzapRestorePolicyDto, ValidateDirectoryRequest, ValidateDirectoryResponse,
    },
    error::{CommandErrorDto, ErrorSeverityDto},
    job_dto::{
        DesktopJobSnapshotDto, JobActionKindDto, JobArtifactKindDto, JobAvailableActionDto, JobCatalogEnvelopeDto, JobControlResponseDto, JobEventDto,
        JobEventKindDto, JobKindDto, JobOutputArtifactDto, JobRetryDescriptorDto, JobSnapshotEnvelopeDto, JobTerminalSummaryDto, StartJobResponseDto,
    },
    job_registry::{JobEventCollector, JobRegistry, forward_latest_values},
    native_launch_inbox::NativeLaunchInbox,
    quick_action::QuickActionLaunchCoordinator,
};
use zmanager_core::archive_browser::{self, BrowserExtractOptions, BrowserListOptions};
use zmanager_core::engine::tzap::{
    TzapArchiveSignatureCheck, TzapArchiveStatusCheck, TzapArchiveTimeCheck, TzapArchiveTrustCheck, TzapArchiveVerification, TzapArchiveVerificationOutcome,
};
use zmanager_core::engine::{
    AppleArchiveCreateOptions, CreateOptions, SevenZCreateOptions, TarGzCreateOptions, TarZstdCreateOptions, TzapCreateOptions, TzapKeySource,
    TzapRestoreOptions, TzapRestorePolicy, ZipCompression, ZipCreateOptions, is_tzap_archive_path,
};
use zmanager_core::jobs::{CancellationToken, JobEvent, JobEventSink};
use zmanager_core::manifest::{ManifestFileType, PlanError, PlanOptions, plan_archives};
use zmanager_core::safety::{ExtractionPolicy, OverwritePolicy, UnsafeFilePolicy};
use zmanager_core::secrets::SecretString;
use zmanager_tzap_hosted::auth_client::SIGN_TZAP_BASE_URL;
use zmanager_tzap_hosted::status_client::{TzapArchiveStatusTarget, TzapStatusClient, TzapStatusResponse, compose_tzap_archive_verification_with_status};

#[tauri::command]
pub fn healthcheck() -> crate::dto::HealthcheckResponse {
    let report = zmanager_core::healthcheck();
    crate::dto::HealthcheckResponse {
        engine: report.engine,
        version: report.version,
        ready: report.ready,
        summary: report.summary(),
        shell: constants::DESKTOP_SHELL_NAME,
        status: if report.ready { "ready" } else { "not-ready" },
        app_version: env!("CARGO_PKG_VERSION"),
        build_id: option_env!("ZMANAGER_BUILD_ID").unwrap_or("dev"),
    }
}

#[tauri::command]
pub fn project_contract() -> crate::dto::ProjectContract {
    use crate::dto::SourceTableCapabilitiesDto;

    let package_kind = crate::native_integration::current_package_kind();
    let capabilities = crate::native_integration::capability_snapshots(std::env::consts::OS, package_kind, &crate::platform::capability_observations());

    // Build the Compress source-table capability set for the running platform.
    // Follows the expected platform outcomes table in the implementation plan.
    // Safe base (always available): name, kind, size, modified, sourcePath
    let mut available_column_ids = vec!["name", "kind", "size", "modified", "sourcePath"];

    // All platforms: created, accessed, linkTarget (core planner captures these)
    available_column_ids.push("created");
    available_column_ids.push("accessed");
    available_column_ids.push("linkTarget");

    available_column_ids.extend_from_slice(crate::platform::source_table_column_ids());

    ProjectContract {
        commands: constants::PLANNED_COMMANDS,
        platform_strategy: constants::PLATFORM_STRATEGY,
        core_dependency: constants::CORE_DEPENDENCY,
        platform_integration: ProjectIntegrationContract { platform: std::env::consts::OS, package_kind, capabilities },
        source_table_capabilities: SourceTableCapabilitiesDto { available_column_ids },
        local_send_available: true,
    }
}

#[tauri::command]
pub fn system_file_icons(request: SystemFileIconRequest) -> SystemFileIconResponse {
    SystemFileIconResponse { icons: crate::platform::system_file_icons(&request.entries) }
}

#[tauri::command]
pub fn validate_directory(request: ValidateDirectoryRequest) -> ValidateDirectoryResponse {
    let path = request.path.trim();
    if path.is_empty() {
        return ValidateDirectoryResponse { exists: false, is_directory: false, accessible: false };
    }

    match std::fs::metadata(path) {
        Ok(metadata) => {
            let is_directory = metadata.is_dir();
            let accessible = is_directory && std::fs::read_dir(path).is_ok();
            ValidateDirectoryResponse { exists: true, is_directory, accessible }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => ValidateDirectoryResponse { exists: false, is_directory: false, accessible: false },
        Err(_) => ValidateDirectoryResponse { exists: true, is_directory: false, accessible: false },
    }
}

#[tauri::command]
pub fn quick_action_startup_state(state: State<'_, QuickActionLaunchCoordinator>) -> crate::dto::QuickActionStartupStateDto {
    state.startup_state().to_dto()
}

#[tauri::command]
pub fn native_frontend_ready(window_label: String, state: State<'_, NativeLaunchInbox>) -> Result<usize, CommandErrorDto> {
    state.frontend_ready(&window_label).map_err(|error| CommandErrorDto::invalid_request(format!("native inbox readiness failed: {error:?}")))
}

#[tauri::command]
pub fn acknowledge_native_event(window_label: String, event_id: String, state: State<'_, NativeLaunchInbox>) -> Result<(), CommandErrorDto> {
    state.acknowledge(&window_label, &event_id).map_err(|error| CommandErrorDto::invalid_request(format!("native event acknowledgement failed: {error:?}")))
}

#[cfg(test)]
fn quick_action_startup_state_internal(state: &crate::quick_action::QuickActionStartupState) -> crate::dto::QuickActionStartupStateDto {
    state.to_dto()
}

#[cfg(test)]
pub fn list_archive(request: crate::dto::ListArchiveRequest) -> Result<ArchiveListingResponse, CommandErrorDto> {
    let archive_path = ensure_non_empty_path(request.archive_path, "archivePath")?;

    let listing = archive_browser::list_entries_with_options(
        Path::new(&archive_path),
        BrowserListOptions { password: request.password.as_deref(), ..Default::default() },
    )
    .map_err(crate::platform::map_archive_browser_error)?;

    let mut total_size = 0u64;
    let mut has_size = false;
    let mut entries = Vec::with_capacity(listing.entries.len());
    let entry_count = listing.entries.len();

    for entry in listing.entries {
        if let Some(size) = entry.size {
            total_size = total_size.saturating_add(size);
            has_size = true;
        }

        entries.push(ArchiveEntryDto {
            path: entry.path,
            kind: map_browser_entry_kind(entry.kind),
            size: entry.size,
            compressed_size: entry.compressed_size,
            modified: entry.modified,
            mode: entry.mode,
            metadata_diagnostics: entry.metadata_diagnostics,
            encrypted: entry.encrypted,
            method: entry.method,
            crc: entry.crc.map(|c| format!("{:08X}", c)),
            comment: entry.comment,
            created: entry.created,
            accessed: entry.accessed,
            solid: entry.solid,
            link_target: entry.link_target,
            attributes: entry.attributes,
            uid: entry.uid,
            gid: entry.gid,
            owner: entry.owner,
            group: entry.group,
        });
    }

    Ok(ArchiveListingResponse { archive_path, entries, entry_count, total_size: if has_size { Some(total_size) } else { None } })
}

#[tauri::command]
pub fn start_archive_index(
    request: crate::dto::StartArchiveIndexRequest,
    registry: State<'_, ArchiveIndexRegistry>,
) -> Result<crate::dto::ArchiveIndexStartResponseDto, CommandErrorDto> {
    registry.start(request)
}

#[tauri::command]
pub async fn wait_archive_index(
    request: crate::dto::ArchiveIndexSessionRequest,
    registry: State<'_, ArchiveIndexRegistry>,
) -> Result<crate::dto::ArchiveIndexSnapshotDto, CommandErrorDto> {
    registry.inner().clone().wait_for_change(&request.session_id, request.after_revision.as_deref()).await
}

#[tauri::command]
pub async fn get_archive_children(
    request: crate::dto::ArchiveChildrenRequest,
    registry: State<'_, ArchiveIndexRegistry>,
) -> Result<crate::dto::ArchiveChildrenPageDto, CommandErrorDto> {
    registry.children(request).await
}

#[tauri::command]
pub fn search_archive_index(
    request: crate::dto::ArchiveSearchRequest,
    registry: State<'_, ArchiveIndexRegistry>,
) -> Result<crate::dto::ArchiveChildrenPageDto, CommandErrorDto> {
    registry.search(request)
}

#[tauri::command]
pub fn close_archive_index(request: crate::dto::ArchiveIndexSessionRequest, registry: State<'_, ArchiveIndexRegistry>) -> Result<(), CommandErrorDto> {
    registry.close(&request.session_id)
}

#[tauri::command]
pub fn plan_create(request: PlanCreateRequest) -> Result<CreatePlanResponse, CommandErrorDto> {
    let sources = normalize_non_empty_paths(&request.sources)?;

    let mut options = if request.clean_source { PlanOptions::clean_source() } else { PlanOptions::default() };
    options.respect_gitignore = request.respect_gitignore;
    options.exclude_names = request.exclude_names.unwrap_or_default();
    options.exclude_archive_paths = request.exclude_archive_paths.unwrap_or_default();
    options.include_archive_paths = request.include_archive_paths.unwrap_or_default();
    options.follow_symlinks = request.follow_symlinks;

    let manifest = plan_archives(sources, &options).map_err(map_plan_error)?;
    let included_count = manifest.included_count();
    let excluded_count = manifest.excluded_count();
    let mut identity_cache = crate::platform::IdentityCache::new();
    let plan_entries: Vec<CreatePlanEntryDto> = manifest.entries.iter().map(|entry| create_plan_entry_to_dto(entry, &mut identity_cache)).collect();
    let entries = manifest.entries.iter().map(|entry| entry.archive_path.clone()).collect();
    let excluded_entries = manifest.excluded_entries.into_iter().map(|entry| entry.archive_path).collect();
    let warnings = manifest.warnings.into_iter().map(|warning| warning.message).collect();

    Ok(CreatePlanResponse {
        included_count,
        excluded_count,
        total_bytes: manifest.total_bytes,
        excluded_bytes: manifest.excluded_bytes,
        entries,
        plan_entries,
        excluded_entries,
        warnings,
    })
}

fn create_plan_entry_to_dto(entry: &zmanager_core::manifest::ManifestEntry, cache: &mut crate::platform::IdentityCache) -> CreatePlanEntryDto {
    let link_target = entry.symlink_target.as_ref().map(|p| p.to_string_lossy().to_string());

    // Collect platform metadata from the source path.
    // Do not follow symlinks: table metadata describes the archived object.
    let source_meta = std::fs::symlink_metadata(&entry.source_path).ok();

    let created = source_meta.as_ref().and_then(|m| m.created().ok()).and_then(system_time_to_epoch_seconds_string);

    let accessed = source_meta.as_ref().and_then(|m| m.accessed().ok()).and_then(system_time_to_epoch_seconds_string);

    let platform_metadata = crate::platform::source_platform_metadata(&entry.source_path, source_meta.as_ref(), &entry.permissions, cache);

    CreatePlanEntryDto {
        path: entry.archive_path.clone(),
        kind: map_manifest_file_type(entry.file_type),
        size: matches!(entry.file_type, ManifestFileType::File).then_some(entry.size),
        modified: entry.modified.and_then(system_time_to_epoch_seconds_string),
        mode: entry.permissions.unix_mode,
        source_path: entry.source_path.to_string_lossy().to_string(),
        created,
        accessed,
        attributes: platform_metadata.attributes,
        link_target,
        uid: platform_metadata.uid,
        gid: platform_metadata.gid,
        owner: platform_metadata.owner,
        group: platform_metadata.group,
    }
}

fn map_manifest_file_type(file_type: ManifestFileType) -> ArchiveEntryKindDto {
    match file_type {
        ManifestFileType::File => ArchiveEntryKindDto::File,
        ManifestFileType::Directory => ArchiveEntryKindDto::Directory,
        ManifestFileType::Symlink => ArchiveEntryKindDto::Symlink,
        ManifestFileType::Other => ArchiveEntryKindDto::Special,
    }
}

fn system_time_to_epoch_seconds_string(time: SystemTime) -> Option<String> {
    time.duration_since(UNIX_EPOCH).ok().map(|duration| duration.as_secs().to_string())
}

#[tauri::command]
pub fn start_create(
    request: StartCreateRequest,
    app: AppHandle,
    account_runtime: State<'_, crate::account::AccountRuntime>,
    registry: State<'_, JobRegistry>,
    diagnostics: State<'_, crate::diagnostics::DiagnosticLog>,
) -> Result<StartJobResponseDto, CommandErrorDto> {
    start_create_service(request, &app, account_runtime.inner(), &registry, Some(diagnostics.inner().clone()))
}

pub(crate) fn start_create_service(
    request: StartCreateRequest,
    app: &AppHandle,
    account_runtime: &crate::account::AccountRuntime,
    registry: &JobRegistry,
    diagnostics: Option<crate::diagnostics::DiagnosticLog>,
) -> Result<StartJobResponseDto, CommandErrorDto> {
    let is_tzap = request.format == crate::dto::ArchiveFormatDto::Tzap;
    let has_signing_selection = request.tzap_certificates.as_ref().and_then(|options| options.signing_selection.as_ref()).is_some();
    let signing_selection_kind = request
        .tzap_certificates
        .as_ref()
        .and_then(|options| options.signing_selection.as_ref())
        .map(|selection| match selection {
            crate::dto::TzapSigningSelectionDto::None => "explicitNone",
            crate::dto::TzapSigningSelectionDto::EnrolledIdentity { .. } => "enrolledIdentity",
            crate::dto::TzapSigningSelectionDto::OneTimePkcs12 { .. } => "oneTimePkcs12",
            crate::dto::TzapSigningSelectionDto::OneTimeCertificateAndKey { .. } => "oneTimeCertificateAndKey",
        })
        .unwrap_or("notProvided");
    if let Some(diagnostics) = diagnostics.as_ref() {
        let _ = diagnostics.record(
            "create",
            "requested",
            crate::diagnostics::fields([
                ("format", serde_json::json!(format!("{:?}", request.format))),
                ("sourceCount", serde_json::json!(request.sources.len())),
                ("hasSigningSelection", serde_json::json!(has_signing_selection)),
                ("signingSelectionKind", serde_json::json!(signing_selection_kind)),
            ]),
        );
    }
    let app_for_worker = app.clone();
    let runtime_for_worker = account_runtime.clone();
    let diagnostics_for_worker = diagnostics.clone();
    let tzap_options = request.tzap_certificates.clone();
    let response = start_create_internal_with_resolver(request, registry, diagnostics.clone(), move || {
        if !is_tzap {
            return Ok(None);
        }
        if let Some(diagnostics) = diagnostics_for_worker.as_ref() {
            let _ = diagnostics.record("create", "signingResolutionStarted", crate::diagnostics::fields([]));
        }
        let result = crate::account::resolve_tzap_create_inputs(&app_for_worker, &runtime_for_worker, tzap_options.as_ref()).map(Some);
        if let Some(diagnostics) = diagnostics_for_worker.as_ref() {
            let _ = diagnostics.record(
                "create",
                if result.is_ok() { "signingResolutionCompleted" } else { "signingResolutionFailed" },
                crate::diagnostics::fields([]),
            );
        }
        result
    })?;
    if let Some(diagnostics) = diagnostics.as_ref() {
        let _ = diagnostics.record(
            "create",
            "jobAccepted",
            crate::diagnostics::fields([
                ("jobKind", serde_json::json!(format!("{:?}", response.kind))),
                ("status", serde_json::json!(format!("{:?}", response.status))),
            ]),
        );
    }
    Ok(response)
}

fn read_recipient_public_key_der(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("unable to read recipient certificate: {error}"))?;
    let certificate = X509::from_pem(&bytes).or_else(|_| X509::from_der(&bytes)).map_err(|error| format!("recipient certificate is invalid: {error}"))?;
    certificate.public_key().and_then(|key| key.public_key_to_der()).map_err(|error| format!("recipient certificate public key is invalid: {error}"))
}

#[cfg(test)]
pub(crate) fn start_create_internal(request: StartCreateRequest, registry: &JobRegistry) -> Result<StartJobResponseDto, CommandErrorDto> {
    start_create_internal_with_resolver(request, registry, None, || Ok(None))
}

fn start_create_internal_with_resolver(
    request: StartCreateRequest,
    registry: &JobRegistry,
    diagnostics: Option<crate::diagnostics::DiagnosticLog>,
    resolve_tzap: impl FnOnce() -> Result<Option<crate::account::ResolvedTzapCreateInputs>, CommandErrorDto> + Send + 'static,
) -> Result<StartJobResponseDto, CommandErrorDto> {
    let sources = normalize_non_empty_paths(&request.sources)?;
    let requested_destination_path = ensure_non_empty_path(request.destination_path, "destinationPath")?.trim().to_string();
    let destination_path = if !request.replace_existing || request.destination_collision_strategy == DestinationCollisionStrategyDto::Rename {
        next_available_destination_file_path(&requested_destination_path)
    } else {
        requested_destination_path
    };

    if destination_path.ends_with('/') || destination_path.ends_with('\\') {
        return Err(CommandErrorDto::invalid_request("destinationPath must include a file name, not just a directory"));
    }

    let destination_path = ensure_non_empty_path(destination_path, "destinationPath")?;
    if let Ok(metadata) = std::fs::metadata(&destination_path) {
        if metadata.is_dir() {
            return Err(CommandErrorDto::invalid_request(format!("destinationPath must be a file path, not a directory: {destination_path}")));
        }
    } else {
        let parent = Path::new(&destination_path).parent().unwrap_or(Path::new(""));
        if !parent.exists() {
            return Err(CommandErrorDto::not_found(
                format!("destination directory does not exist: {destination_path}"),
                Some("Choose a destination inside an existing directory.".to_string()),
            ));
        }
    }

    validate_source_paths_exist(&sources)?;

    let mut plan_options = if request.clean_source { PlanOptions::clean_source() } else { PlanOptions::default() };
    plan_options.exclude_names = request.exclude_names.unwrap_or_default();
    plan_options.exclude_archive_paths = request.exclude_archive_paths.unwrap_or_default();
    plan_options.include_archive_paths = request.include_archive_paths.unwrap_or_default();
    plan_options.respect_gitignore = request.respect_gitignore;
    plan_options.follow_symlinks = request.follow_symlinks;
    let plan_options_for_thread = plan_options;

    let kind = match request.format {
        crate::dto::ArchiveFormatDto::Zip => JobKindDto::ZipCreate,
        crate::dto::ArchiveFormatDto::TarZst => JobKindDto::TarZstdCreate,
        crate::dto::ArchiveFormatDto::TarGz => JobKindDto::TarGzCreate,
        crate::dto::ArchiveFormatDto::Tzap => JobKindDto::TzapCreate,
        crate::dto::ArchiveFormatDto::SevenZ => JobKindDto::SevenZCreate,
        crate::dto::ArchiveFormatDto::AppleArchive => JobKindDto::AppleArchiveCreate,
    };

    let password = request.password.as_deref().map(str::trim).filter(|value| !value.is_empty()).map(ToOwned::to_owned);
    if request.volume_count.is_some_and(|value| value < 2) {
        return Err(CommandErrorDto::invalid_request("volumeCount must be at least 2 or omitted"));
    }
    let requested_volume_size = request.volume_size.filter(|value| *value > 0);
    let requested_volume_count = request.volume_count.filter(|value| *value > 1);
    if let Some(certificates) = request.tzap_certificates.as_ref() {
        let has_recipient_selection = certificates.recipient_selection.as_ref().is_some_and(|selection| {
            !selection.recipient_key_ids.is_empty() || !selection.contact_recipient_ids.is_empty() || !selection.one_time_certificate_paths.is_empty()
        });
        if has_recipient_selection && password.is_some() {
            return Err(CommandErrorDto::invalid_request("TZAP recipient encryption cannot be combined with a password"));
        }
        if has_recipient_selection
            && (requested_volume_size.is_some() || requested_volume_count.is_some() || request.tzap_volume_loss_tolerance.unwrap_or(0) > 0)
        {
            return Err(CommandErrorDto::invalid_request("TZAP recipient encryption cannot be split or use volume-loss tolerance"));
        }
        if let Some(crate::dto::TzapSigningSelectionDto::OneTimeCertificateAndKey { certificate_path, private_key_path, .. }) =
            certificates.signing_selection.as_ref()
            && (certificate_path.trim().is_empty() || private_key_path.trim().is_empty())
        {
            return Err(CommandErrorDto::invalid_request("TZAP signing requires both a certificate and a matching private key"));
        }
    }
    if request.format != crate::dto::ArchiveFormatDto::Tzap && requested_volume_count.is_some() {
        return Err(CommandErrorDto::invalid_request("volumeCount is supported only for TZAP archives"));
    }
    if request.format != crate::dto::ArchiveFormatDto::Tzap && request.tzap_volume_loss_tolerance.unwrap_or(0) > 0 {
        return Err(CommandErrorDto::invalid_request("volume-loss tolerance is supported only for TZAP archives"));
    }
    if requested_volume_size.is_some() && requested_volume_count.is_some() {
        return Err(CommandErrorDto::invalid_request("volumeSize and volumeCount are mutually exclusive"));
    }
    if request.tzap_volume_loss_tolerance.unwrap_or(0) > 0 && requested_volume_size.is_none() && requested_volume_count.is_none() {
        return Err(CommandErrorDto::invalid_request("volume-loss tolerance requires an active split mode"));
    }
    if let Some(count) = requested_volume_count {
        if u32::from(request.tzap_volume_loss_tolerance.unwrap_or(0)) >= count {
            return Err(CommandErrorDto::invalid_request("volume-loss tolerance must be less than volumeCount"));
        }
    }

    let reservation = if request.replace_existing && request.destination_collision_strategy != DestinationCollisionStrategyDto::Rename {
        destination_reservation::try_reserve(PathBuf::from(&destination_path)).ok_or_else(|| {
            CommandErrorDto::new("destination_busy", "The destination is already being created", None::<String>, ErrorSeverityDto::Warning, true)
        })?
    } else {
        let mut candidate = PathBuf::from(&destination_path);
        loop {
            if let Some(reservation) = destination_reservation::try_reserve(candidate.clone()) {
                break reservation;
            }
            candidate = PathBuf::from(next_available_destination_file_path(&candidate.to_string_lossy()));
        }
    };
    let destination_path = reservation.path().to_string_lossy().into_owned();

    let (response, token) = registry.try_create_job(kind).map_err(subscription_error)?;
    registry
        .configure_recovery_facts(
            &response.job_id,
            None,
            vec![JobOutputArtifactDto { artifact_id: "output".into(), kind: JobArtifactKindDto::Archive, path: destination_path.clone() }],
            vec![JobAvailableActionDto { action_id: "reveal-output".into(), kind: JobActionKindDto::Reveal, artifact_id: "output".into() }],
        )
        .map_err(subscription_error)?;
    registry.emit_direct_event(
        &response.job_id,
        JobEventDto {
            event_type: JobEventKindDto::Started,
            job_kind: Some(kind),
            phase: None,
            code: None,
            hint: None,
            severity: None,
            retryable: None,
            path: None,
            bytes: None,
            total_bytes: None,
            total_bytes_processed: Some(0),
            entries: Some(0),
            total_entries: None,
            message: Some("Starting archive creation.".to_string()),
        },
    );
    let registry_for_thread = registry.clone();
    let job_id = response.job_id.clone();

    let replace_existing = request.replace_existing;
    let preserve_metadata = request.preserve_metadata;
    let compression_level = request.compression_level;
    let volume_size = requested_volume_size;
    let volume_count = requested_volume_count;
    let tzap_recovery_percentage = request.tzap_recovery_percentage.unwrap_or(5).min(100);
    let tzap_volume_loss_tolerance = if volume_size.is_some() || volume_count.is_some() { request.tzap_volume_loss_tolerance.unwrap_or(0).min(16) } else { 0 };
    let zip_compression = request.zip_compression;
    let seven_z_solid = request.seven_z_solid.unwrap_or(true);
    let seven_z_threads = request.seven_z_threads.filter(|value| *value > 0);
    let seven_z_chunk_size = request.seven_z_chunk_size.filter(|value| *value > 0);
    let seven_z_encrypt_file_names = request.seven_z_encrypt_file_names.unwrap_or(true);
    let tzap_bootstrap_sidecar = request.tzap_bootstrap_sidecar.unwrap_or(false);
    let format = request.format;

    let request_sources = sources;
    let destination = destination_path;
    let clean_source = request.clean_source;
    let kind_for_thread = kind;
    let plan_options = plan_options_for_thread;
    let diagnostics_for_worker_lifecycle = diagnostics.clone();
    thread::spawn(move || {
        let _destination_reservation = reservation;
        let worker_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if let Some(diagnostics) = diagnostics_for_worker_lifecycle.as_ref() {
                let _ = diagnostics.record("create", "workerStarted", crate::diagnostics::fields([("jobId", serde_json::json!(job_id))]));
            }
            let mut sink = JobEventCollector::new(&registry_for_thread, job_id.clone());
            let mut resolved_tzap = match resolve_tzap() {
                Ok(resolved) => resolved,
                Err(error) => {
                    registry_for_thread.emit_direct_event(&job_id, JobEventDto::failed_from_command_error(kind_for_thread, error));
                    return;
                }
            };
            if let Some(diagnostics) = diagnostics_for_worker_lifecycle.as_ref() {
                let _ = diagnostics.record("create", "workerInputsResolved", crate::diagnostics::fields([]));
            }
            if let Some(resolved) = resolved_tzap.as_mut() {
                let mut public_keys = resolved.recipient_public_keys.take().unwrap_or_default();
                for path in resolved.one_time_recipient_certificate_paths.take().unwrap_or_default() {
                    match read_recipient_public_key_der(&path) {
                        Ok(public_key) => public_keys.push(public_key),
                        Err(error) => {
                            registry_for_thread.emit_direct_event(
                                &job_id,
                                JobEventDto::failed_from_command_error(
                                    kind_for_thread,
                                    CommandErrorDto::new("account_recipient_certificate_invalid", error, None::<String>, ErrorSeverityDto::Error, false),
                                ),
                            );
                            return;
                        }
                    }
                }
                resolved.recipient_public_keys = Some(public_keys);
                resolved.one_time_recipient_certificate_paths = Some(Vec::new());
            }
            let create_options = match format {
                crate::dto::ArchiveFormatDto::Zip => CreateOptions::Zip(ZipCreateOptions {
                    compression: match zip_compression {
                        Some(crate::dto::ZipCompressionDto::Store) => ZipCompression::Store,
                        _ => ZipCompression::Deflate,
                    },
                    level: compression_level.map(i64::from),
                    preserve_metadata,
                    replace_existing,
                    password: password.as_deref().map(SecretString::from),
                    volume_size,
                }),
                crate::dto::ArchiveFormatDto::TarZst => {
                    let level = compression_level.and_then(|value| i32::try_from(value).ok()).unwrap_or(TarZstdCreateOptions::default().level);
                    CreateOptions::TarZstd(TarZstdCreateOptions { level, preserve_metadata, replace_existing, ..TarZstdCreateOptions::default() })
                }
                crate::dto::ArchiveFormatDto::TarGz => {
                    let level = compression_level.and_then(|value| i32::try_from(value).ok()).unwrap_or(TarGzCreateOptions::default().level);
                    CreateOptions::TarGz(TarGzCreateOptions { level, preserve_metadata, replace_existing })
                }
                crate::dto::ArchiveFormatDto::Tzap => {
                    let resolved = resolved_tzap;
                    let (key_source, resolved_signing, signing_selection_provided) = if let Some(resolved) = resolved {
                        let public_keys = resolved.recipient_public_keys.unwrap_or_default();
                        let key_source = if resolved.recipient_selection_provided {
                            if public_keys.is_empty() { TzapKeySource::NoPassword } else { TzapKeySource::RecipientPublicKeys(public_keys) }
                        } else {
                            password.as_deref().map(SecretString::from).map_or(TzapKeySource::NoPassword, TzapKeySource::Passphrase)
                        };
                        (key_source, resolved.signing, resolved.signing_selection_provided)
                    } else {
                        let key_source = password.as_deref().map(SecretString::from).map_or(TzapKeySource::NoPassword, TzapKeySource::Passphrase);
                        (key_source, None, false)
                    };
                    let x509_signing = if signing_selection_provided { resolved_signing } else { None };
                    CreateOptions::Tzap(TzapCreateOptions {
                        key_source,
                        level: compression_level.and_then(|value| i32::try_from(value).ok()).unwrap_or(3),
                        preserve_metadata,
                        replace_existing,
                        volume_size,
                        volume_count,
                        recovery_percentage: tzap_recovery_percentage,
                        volume_loss_tolerance: tzap_volume_loss_tolerance,
                        x509_signing,
                        emit_bootstrap_sidecar: tzap_bootstrap_sidecar,
                    })
                }
                crate::dto::ArchiveFormatDto::SevenZ => CreateOptions::SevenZ(SevenZCreateOptions {
                    solid: seven_z_solid,
                    level: compression_level,
                    preserve_metadata,
                    password: password.as_deref().map(SecretString::from),
                    encrypt_file_names: seven_z_encrypt_file_names,
                    replace_existing,
                    volume_size,
                    threads: seven_z_threads,
                    chunk_size: seven_z_chunk_size,
                }),
                crate::dto::ArchiveFormatDto::AppleArchive => CreateOptions::AppleArchive(AppleArchiveCreateOptions {
                    preserve_metadata,
                    replace_existing,
                    password: password.clone(),
                    ..Default::default()
                }),
            };

            if let Some(diagnostics) = diagnostics_for_worker_lifecycle.as_ref() {
                let _ = diagnostics.record("create", "engineStarted", crate::diagnostics::fields([]));
            }
            let result =
                zmanager_core::jobs::run_engine_create_job_from_sources(&request_sources, &destination, &create_options, &plan_options, &token, &mut sink)
                    .map(|report| JobTerminalSummaryDto {
                        written_entries: usize::try_from(report.written_entries).unwrap_or(usize::MAX),
                        skipped_entries: None,
                        written_bytes: report.written_bytes,
                        warnings: report.warnings,
                    })
                    .map_err(crate::platform::archive_error::map_engine_error);

            match result {
                Ok(summary) => {
                    if clean_source {
                        match remove_created_source_paths(&request_sources, &destination) {
                            Ok(()) => complete_job_if_needed(&registry_for_thread, &job_id, kind_for_thread, summary),
                            Err(error) => registry_for_thread.emit_direct_event(&job_id, JobEventDto::failed_from_command_error(kind_for_thread, error)),
                        }
                    } else {
                        complete_job_if_needed(&registry_for_thread, &job_id, kind_for_thread, summary);
                    }
                }
                Err(error) => {
                    registry_for_thread.emit_direct_event(&job_id, JobEventDto::failed_from_command_error(kind_for_thread, error));
                }
            }
            if let Some(diagnostics) = diagnostics_for_worker_lifecycle.as_ref() {
                let _ = diagnostics.record("create", "workerFinished", crate::diagnostics::fields([]));
            }
        }));

        if let Err(payload) = worker_result {
            let panic_message = payload
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("archive worker panicked without a message")
                .to_owned();
            if let Some(diagnostics) = diagnostics_for_worker_lifecycle.as_ref() {
                let _ = diagnostics.record("create", "workerPanicked", crate::diagnostics::fields([("message", serde_json::json!(panic_message))]));
            }
            registry_for_thread.emit_direct_event(
                &job_id,
                JobEventDto::failed_from_command_error(
                    kind_for_thread,
                    CommandErrorDto::new(
                        "archive_worker_panicked",
                        format!("Archive worker terminated unexpectedly: {panic_message}"),
                        None::<String>,
                        ErrorSeverityDto::Error,
                        false,
                    ),
                ),
            );
        }
    });

    Ok(response)
}

#[tauri::command]
pub fn start_extract(
    request: StartExtractRequest,
    app: AppHandle,
    account_runtime: State<'_, crate::account::AccountRuntime>,
    registry: State<'_, JobRegistry>,
) -> Result<StartJobResponseDto, CommandErrorDto> {
    let recipient_private_key =
        request.recipient_key_id.as_deref().map(|key_id| crate::account::resolve_tzap_recipient_private_key(&app, &account_runtime, key_id)).transpose()?;
    start_extract_internal_with_recipient_key(request, &registry, recipient_private_key)
}

#[tauri::command]
pub fn validate_tzap_signing_identity(
    request: crate::dto::ValidateTzapSigningIdentityRequest,
) -> Result<crate::dto::ValidateTzapSigningIdentityResponse, CommandErrorDto> {
    let identity_path = ensure_non_empty_path(request.identity_path, "identityPath")?;
    let identity_bytes = std::fs::read(&identity_path).map_err(|error| map_io_error(identity_path.clone(), error))?;
    let identity = Pkcs12::from_der(&identity_bytes).map_err(map_identity_error)?;
    let parsed = identity.parse2(request.password.as_deref().unwrap_or_default()).map_err(map_identity_error)?;
    let private_key = parsed.pkey.ok_or_else(|| CommandErrorDto::invalid_request("P12/PFX bundle does not contain a private key"))?;
    let certificate = parsed.cert.ok_or_else(|| CommandErrorDto::invalid_request("P12/PFX bundle does not contain a signing certificate"))?;
    let now = Asn1Time::days_from_now(0).map_err(map_identity_error)?;
    if certificate.not_before() > now.as_ref() || certificate.not_after() < now.as_ref() {
        return Err(CommandErrorDto::invalid_request("P12/PFX signing certificate is outside its validity period"));
    }
    let certificate_key = certificate.public_key().map_err(map_identity_error)?;
    if !private_key.public_eq(&certificate_key) {
        return Err(CommandErrorDto::invalid_request("P12/PFX private key does not match its signing certificate"));
    }
    let certificate_sha256 = certificate.digest(MessageDigest::sha256()).map_err(map_identity_error)?;
    let subject =
        certificate.subject_name().entries().next().and_then(|entry| entry.data().to_string().ok()).unwrap_or_else(|| "Unnamed signing certificate".to_owned());
    let chain_certificate_count = parsed.ca.as_ref().map_or(0, |chain| chain.len());
    let warnings = if chain_certificate_count == 0 { vec!["The bundle has no intermediate certificate chain.".to_owned()] } else { Vec::new() };
    Ok(crate::dto::ValidateTzapSigningIdentityResponse {
        certificate_sha256: hex_bytes(certificate_sha256.as_ref()),
        chain_certificate_count,
        subject,
        warnings,
    })
}

fn map_identity_error(error: openssl::error::ErrorStack) -> CommandErrorDto {
    CommandErrorDto::new("certificate_error", format!("Unable to create signing identity: {error}"), None::<String>, ErrorSeverityDto::Error, false)
}

fn archive_signature_check_label(check: TzapArchiveSignatureCheck) -> &'static str {
    match check {
        TzapArchiveSignatureCheck::Ok => "ok",
        TzapArchiveSignatureCheck::Absent => "absent",
        TzapArchiveSignatureCheck::Invalid => "invalid",
        TzapArchiveSignatureCheck::UnsupportedProfile => "unsupported_profile",
        TzapArchiveSignatureCheck::VolumesIncomplete => "volumes_incomplete",
    }
}

fn archive_trust_check_label(check: TzapArchiveTrustCheck) -> &'static str {
    match check {
        TzapArchiveTrustCheck::ProductionRoot => "production_root",
        TzapArchiveTrustCheck::StagingRoot => "staging_root",
        TzapArchiveTrustCheck::Untrusted => "untrusted",
    }
}

fn archive_time_check_label(check: TzapArchiveTimeCheck) -> &'static str {
    match check {
        TzapArchiveTimeCheck::ValidAtSigning => "valid_at_signing",
        TzapArchiveTimeCheck::ExpiredSinceSigning => "expired_since_signing",
        TzapArchiveTimeCheck::ExpiredAtSigning => "expired_at_signing",
    }
}

fn archive_status_check_label(check: &TzapArchiveStatusCheck) -> (&'static str, Option<String>) {
    match check {
        TzapArchiveStatusCheck::FreshValid => ("fresh_valid", None),
        TzapArchiveStatusCheck::BeforeRevocation { revoked_at_unix_seconds, reason } => {
            ("signed_before_renewal", reason.clone().or_else(|| Some(revoked_at_unix_seconds.to_string())))
        }
        TzapArchiveStatusCheck::Revoked { reason, .. } => ("revoked", reason.clone()),
        TzapArchiveStatusCheck::Suspended => ("suspended", None),
        TzapArchiveStatusCheck::Unavailable { reason } => ("status_unavailable", reason.clone()),
    }
}

fn archive_verification_state(verification: &TzapArchiveVerification) -> &'static str {
    match (&verification.outcome, &verification.status) {
        (TzapArchiveVerificationOutcome::Verified, _) => "fresh_valid",
        (TzapArchiveVerificationOutcome::VerifiedWithCaveat, TzapArchiveStatusCheck::BeforeRevocation { .. }) => "signed_before_renewal",
        (TzapArchiveVerificationOutcome::VerifiedWithCaveat, TzapArchiveStatusCheck::Unavailable { reason: None }) => "cryptographically_intact_offline",
        (TzapArchiveVerificationOutcome::VerifiedWithCaveat, TzapArchiveStatusCheck::Unavailable { reason: Some(_) }) => "status_unavailable",
        (TzapArchiveVerificationOutcome::VerifiedWithCaveat, _) => "verified_with_caveat",
        (TzapArchiveVerificationOutcome::NotSigned, _) => "not_signed",
        (TzapArchiveVerificationOutcome::Unverifiable, _) => "unverifiable",
        (TzapArchiveVerificationOutcome::Failed, _) => "invalid",
    }
}

fn archive_verification_response(
    verification: TzapArchiveVerification,
    status_response: Option<&TzapStatusResponse>,
) -> crate::dto::VerifyTzapCertificateResponse {
    let verification_state = archive_verification_state(&verification).to_owned();
    let headline = verification.headline_label().to_owned();
    let (status_check, status_reason) = archive_status_check_label(&verification.status);
    let signer = verification.signer;
    crate::dto::VerifyTzapCertificateResponse {
        outcome: verification_state.clone(),
        subject: signer.as_ref().map_or_else(String::new, |signer| signer.subject.clone()),
        issuer: signer.as_ref().map_or_else(String::new, |signer| signer.issuer.clone()),
        serial_number_hex: signer.as_ref().map_or_else(String::new, |signer| signer.serial_number_hex.clone()),
        certificate_sha256: signer.as_ref().map_or_else(String::new, |signer| signer.certificate_sha256_hex.clone()),
        signed_at_unix_seconds: signer.as_ref().map_or(0, |signer| signer.signed_at_unix_seconds),
        trust_anchor_subject: None,
        verified_chain_subjects: Vec::new(),
        diagnostics: vec![headline],
        verification_state,
        signature_check: archive_signature_check_label(verification.signature).to_owned(),
        trust_check: archive_trust_check_label(verification.trust).to_owned(),
        certificate_time: archive_time_check_label(verification.certificate_time).to_owned(),
        status_check: status_check.to_owned(),
        status_reason,
        status_this_update_unix_seconds: status_response.and_then(|status| status.this_update_unix_seconds),
        status_next_update_unix_seconds: status_response.and_then(|status| status.next_update_unix_seconds),
        status_revoked_at_unix_seconds: status_response.and_then(|status| status.revoked_at_unix_seconds),
        status_revocation_reason: status_response.and_then(|status| status.revocation_reason.clone()),
        status_revocation_category: status_response.and_then(|status| status.revocation_category.clone()),
    }
}

fn hosted_status_base_url(environment: Option<&str>) -> Result<&'static str, CommandErrorDto> {
    let requested_environment = environment.unwrap_or("prod");
    crate::account::ensure_build_environment_allows(requested_environment)?;
    match requested_environment {
        "local" => Ok("http://localhost:8787"),
        "staging" => Ok("https://staging.tzap.org"),
        "prod" => Ok(SIGN_TZAP_BASE_URL),
        _ => Err(CommandErrorDto::invalid_request("Unsupported hosted environment")),
    }
}

#[tauri::command]
pub fn verify_tzap_certificate(request: crate::dto::VerifyTzapCertificateRequest) -> Result<crate::dto::VerifyTzapCertificateResponse, CommandErrorDto> {
    let archive_path = ensure_non_empty_path(request.archive_path, "archivePath")?;
    if !is_tzap_archive_path(Path::new(&archive_path)) {
        return Err(CommandErrorDto::invalid_request("certificate verification is available only for TZAP archives"));
    }

    if request.check_current_status {
        let trust = zmanager_core::engine::tzap::TzapX509TrustOptions {
            trusted_ca_certificates: request.trusted_ca_certificate_paths.iter().map(PathBuf::from).collect(),
            trusted_system_roots: request.trusted_system_roots,
            // Current status is an explicit online enhancement, but it must
            // remain usable from the default offline verification surface.
            // The bundled official root is the fallback when the user has not
            // selected a custom/system trust source.
            include_official_tzap_root: request.include_official_tzap_root || !request.validate_trust,
        };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
        let offline = zmanager_core::engine::tzap::verify_tzap_archive_public_no_key(&archive_path, &trust, now)
            .map_err(|error| CommandErrorDto::operation_failed(error.to_string()))?;
        let mut status_response = None;
        let status_base_url = hosted_status_base_url(request.environment.as_deref())?;
        let verification = if let Some(signer) = &offline.signer {
            let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|error| CommandErrorDto::operation_failed(error))?;
            let status_client = TzapStatusClient::new(status_base_url, &transport);
            match status_client.status_by_fingerprint(&signer.certificate_sha256_hex) {
                Ok(status) => {
                    let composed = TzapArchiveStatusTarget::from_leaf_certificate_der(&signer.leaf_certificate_der, None)
                        .map(|target| compose_tzap_archive_verification_with_status(offline.clone(), &target, &status, now))
                        .unwrap_or_else(|_| offline.clone());
                    status_response = Some(status);
                    composed
                }
                Err(_) => TzapArchiveVerification::new(
                    offline.signature,
                    offline.trust,
                    offline.certificate_time,
                    TzapArchiveStatusCheck::Unavailable { reason: Some("status request unavailable".to_owned()) },
                    offline.signer,
                    offline.signer_is_this_device,
                ),
            }
        } else {
            offline
        };
        return Ok(archive_verification_response(verification, status_response.as_ref()));
    }

    let trust = zmanager_core::engine::tzap::TzapX509TrustOptions {
        trusted_ca_certificates: request.trusted_ca_certificate_paths.iter().map(PathBuf::from).collect(),
        trusted_system_roots: request.trusted_system_roots,
        // The default verification action is an offline TZAP verification, so
        // it must still validate archive integrity, certificate time, chain,
        // and the embedded official roots. Custom/system trust remains an
        // explicit opt-in through the existing request fields.
        include_official_tzap_root: request.include_official_tzap_root || !request.validate_trust,
    };
    if request.validate_trust && !trust.has_trust_source() {
        return Err(CommandErrorDto::invalid_request("trust validation requires the official TZAP root, a custom CA, or system roots"));
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let offline = zmanager_core::engine::tzap::verify_tzap_archive_public_no_key(&archive_path, &trust, now)
        .map_err(|error| CommandErrorDto::operation_failed(error.to_string()))?;
    Ok(archive_verification_response(offline, None))
}

fn hex_bytes(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
pub(crate) fn start_extract_internal(request: StartExtractRequest, registry: &JobRegistry) -> Result<StartJobResponseDto, CommandErrorDto> {
    start_extract_internal_with_spawner(request, registry, |worker| {
        thread::spawn(worker);
    })
}

pub(crate) fn start_extract_internal_with_recipient_key(
    request: StartExtractRequest,
    registry: &JobRegistry,
    recipient_private_key: Option<zmanager_core::secrets::SecretBytes>,
) -> Result<StartJobResponseDto, CommandErrorDto> {
    start_extract_internal_with_recipient_key_and_spawner(request, registry, recipient_private_key, |worker| {
        thread::spawn(worker);
    })
}

#[cfg(test)]
fn start_extract_internal_with_spawner(
    request: StartExtractRequest,
    registry: &JobRegistry,
    spawn_worker: impl FnOnce(Box<dyn FnOnce() + Send + 'static>),
) -> Result<StartJobResponseDto, CommandErrorDto> {
    start_extract_internal_with_recipient_key_and_spawner(request, registry, None, spawn_worker)
}

fn start_extract_internal_with_recipient_key_and_spawner(
    request: StartExtractRequest,
    registry: &JobRegistry,
    recipient_private_key: Option<zmanager_core::secrets::SecretBytes>,
    spawn_worker: impl FnOnce(Box<dyn FnOnce() + Send + 'static>),
) -> Result<StartJobResponseDto, CommandErrorDto> {
    let archive_path = ensure_non_empty_path(request.archive_path, "archivePath")?;
    let requested_destination_path = ensure_non_empty_path(request.destination_path, "destinationPath")?;
    let destination_path = if request.destination_collision_strategy == DestinationCollisionStrategyDto::Rename {
        next_available_destination_directory_path(&requested_destination_path)
    } else {
        requested_destination_path
    };
    let entry_paths = normalize_optional_entry_paths(request.entry_paths)?;
    if recipient_private_key.is_some() && !entry_paths.is_empty() {
        return Err(CommandErrorDto::invalid_request("Recipient-key extraction currently requires a whole-archive operation"));
    }
    let password = request.password.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    let format_kind = zmanager_core::archive_format::detect_archive_format(&archive_path);
    if recipient_private_key.is_some() && password.is_some() {
        return Err(CommandErrorDto::invalid_request("Choose either a recipient key or an archive password for extraction"));
    }
    if recipient_private_key.is_some() && format_kind != zmanager_core::archive_format::ArchiveFormatKind::Tzap {
        return Err(CommandErrorDto::invalid_request("Recipient-key extraction is available only for TZAP archives"));
    }
    let kind = match format_kind {
        zmanager_core::archive_format::ArchiveFormatKind::Zip | zmanager_core::archive_format::ArchiveFormatKind::SplitZip => JobKindDto::ZipExtract,
        zmanager_core::archive_format::ArchiveFormatKind::TarZst => JobKindDto::TarZstdExtract,
        zmanager_core::archive_format::ArchiveFormatKind::SevenZ => JobKindDto::SevenZExtract,
        zmanager_core::archive_format::ArchiveFormatKind::Rar => JobKindDto::RarExtract,
        zmanager_core::archive_format::ArchiveFormatKind::Tzap => JobKindDto::TzapExtract,
        zmanager_core::archive_format::ArchiveFormatKind::AppleArchive => JobKindDto::AppleArchiveExtract,
        zmanager_core::archive_format::ArchiveFormatKind::RawStream => JobKindDto::RawStreamExtract,
        _ => JobKindDto::ArchiveExtract,
    };

    let (response, token) = registry.try_create_job(kind).map_err(subscription_error)?;
    registry
        .configure_recovery_facts(
            &response.job_id,
            Some(JobRetryDescriptorDto::ExtractArchive {
                action_id: "retry-with-password".into(),
                archive_path: archive_path.clone(),
                destination_path: destination_path.clone(),
                overwrite: request.overwrite,
                destination_collision_strategy: request.destination_collision_strategy,
                entry_paths: entry_paths.clone(),
                strip_components: request.strip_components,
                tzap_restore_policy: request.tzap_restore_policy,
                tzap_allow_degraded: request.tzap_allow_degraded,
                tzap_allow_absolute_symlinks: request.tzap_allow_absolute_symlinks,
                ignore_symlinks: request.ignore_symlinks,
            }),
            vec![JobOutputArtifactDto { artifact_id: "output".into(), kind: JobArtifactKindDto::Directory, path: destination_path.clone() }],
            vec![JobAvailableActionDto { action_id: "open-output".into(), kind: JobActionKindDto::Open, artifact_id: "output".into() }],
        )
        .map_err(subscription_error)?;
    let registry_for_thread = registry.clone();
    let job_id = response.job_id.clone();
    let policy = extraction_policy(request.overwrite, request.strip_components, request.ignore_symlinks);
    let tzap_restore_options = TzapRestoreOptions {
        policy: map_tzap_restore_policy(request.tzap_restore_policy),
        allow_degraded: request.tzap_allow_degraded,
        allow_absolute_symlinks: request.tzap_allow_absolute_symlinks,
    };
    let recipient_private_key = recipient_private_key;

    spawn_worker(Box::new(move || {
        let mut sink = JobEventCollector::new(&registry_for_thread, job_id.clone());
        let result = if entry_paths.is_empty() {
            sink.emit(JobEvent::Started {
                kind: match kind {
                    JobKindDto::ZipExtract => zmanager_core::jobs::JobKind::ZipExtract,
                    JobKindDto::TarZstdExtract => zmanager_core::jobs::JobKind::TarZstdExtract,
                    JobKindDto::SevenZExtract => zmanager_core::jobs::JobKind::SevenZExtract,
                    JobKindDto::RarExtract => zmanager_core::jobs::JobKind::RarExtract,
                    JobKindDto::TzapExtract => zmanager_core::jobs::JobKind::TzapExtract,
                    JobKindDto::AppleArchiveExtract => zmanager_core::jobs::JobKind::AppleArchiveExtract,
                    _ => zmanager_core::jobs::JobKind::ArchiveExtract,
                },
                total_bytes: None,
            });
            let mut options = zmanager_core::engine::ExtractOptions {
                destination: PathBuf::from(&destination_path),
                policy,
                recipient_key_bytes: recipient_private_key.as_ref().map(|k| vec![k.expose_secret().to_vec()]),
                tzap_password: password.clone(),
                tzap_restore_options: Some(tzap_restore_options),
                cancellation: Some(token.clone()),
                ..Default::default()
            };
            let engine_res = zmanager_core::engine::create_default_engine();
            match engine_res {
                Ok(engine) => {
                    let open_res = engine.open(
                        zmanager_core::engine::ArchiveSource::from_path_autodetect(&archive_path),
                        zmanager_core::engine::OpenOptions { password: password.clone(), recipient_key: None, ..Default::default() },
                    );
                    match open_res {
                        Ok(mut handle) => handle
                            .extract(&mut options)
                            .map(|report| JobTerminalSummaryDto {
                                written_entries: usize::try_from(report.written_entries).unwrap_or(usize::MAX),
                                skipped_entries: Some(usize::try_from(report.skipped_entries).unwrap_or(usize::MAX)),
                                written_bytes: report.written_bytes,
                                warnings: report.warnings,
                            })
                            .map_err(crate::platform::archive_error::map_engine_error),
                        Err(err) => Err(crate::platform::archive_error::map_engine_error(err)),
                    }
                }
                Err(err) => Err(crate::platform::archive_error::map_engine_error(err)),
            }
        } else {
            run_selected_extract_job(&archive_path, &destination_path, &entry_paths, password.as_deref(), policy, tzap_restore_options, &token, &mut sink, kind)
        };

        match result {
            Ok(summary) => {
                complete_job_if_needed(&registry_for_thread, &job_id, kind, summary);
            }
            Err(error) => {
                registry_for_thread.emit_direct_event(&job_id, JobEventDto::failed_from_command_error(kind, error));
            }
        }
    }));

    Ok(response)
}

fn complete_job_if_needed(registry: &JobRegistry, job_id: &str, kind: JobKindDto, summary: JobTerminalSummaryDto) {
    let _ = registry.commit_completed(job_id, kind, summary);
}

/// Removes create sources only after the archive engine has successfully
/// written the output. The destination is checked first so a source that
/// contains the output cannot make a successful archive disappear during
/// cleanup.
fn remove_created_source_paths(sources: &[PathBuf], destination: &str) -> Result<(), CommandErrorDto> {
    let destination_path = Path::new(destination);
    let destination_absolute = if destination_path.exists() {
        std::fs::canonicalize(destination_path)
    } else {
        let parent = destination_path.parent().unwrap_or(Path::new("."));
        std::fs::canonicalize(parent).map(|parent| parent.join(destination_path.file_name().unwrap_or_default()))
    }
    .map_err(|error| map_io_error(destination.to_string(), error))?;

    let mut canonical_sources: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(sources.len());
    for source in sources {
        let canonical = std::fs::canonicalize(source).map_err(|error| map_io_error(source.to_string_lossy().to_string(), error))?;
        if destination_absolute == canonical || destination_absolute.starts_with(&canonical) {
            return Err(CommandErrorDto::invalid_request("cleanSource cannot remove a source containing the archive destination"));
        }
        if !canonical_sources.iter().any(|(_, existing)| existing == &canonical) {
            // Keep the caller's path for deletion. `canonicalize` follows a
            // symlink, and deleting that resolved target would violate the
            // source cleanup contract.
            canonical_sources.push((source.clone(), canonical));
        }
    }

    for (source, _) in canonical_sources {
        let metadata = match std::fs::symlink_metadata(&source) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(map_io_error(source.to_string_lossy().to_string(), error)),
        };
        let result = if metadata.is_dir() { std::fs::remove_dir_all(&source) } else { std::fs::remove_file(&source) };
        result.map_err(|error| map_io_error(source.to_string_lossy().to_string(), error))?;
    }
    Ok(())
}

#[tauri::command]
pub fn preview_entry(
    request: PreviewEntryRequest,
    registry: State<'_, JobRegistry>,
    archive_index_registry: State<'_, ArchiveIndexRegistry>,
) -> Result<PreviewEntryResponse, CommandErrorDto> {
    let archive_path = ensure_non_empty_path(request.archive_path, "archivePath")?;
    let entry_path = ensure_non_empty_path(request.entry_path, "entryPath")?;
    let password = request
        .password
        .and_then(|value| {
            let trimmed = value.trim().to_owned();
            (!trimmed.is_empty()).then_some(trimmed)
        })
        .or_else(|| archive_index_registry.password_for_archive(&archive_path));

    let report = archive_browser::preview_entry_with_options(
        archive_path,
        &entry_path,
        BrowserExtractOptions {
            password: password.as_deref(),
            overwrite: map_overwrite_policy(request.overwrite),
            strip_components: request.strip_components,
            ..BrowserExtractOptions::default()
        },
    )
    .map_err(crate::platform::map_archive_browser_error)?;

    registry.replace_preview_root(report.cleanup_root.clone());

    Ok(PreviewEntryResponse {
        cleanup_root: report.cleanup_root.to_string_lossy().to_string(),
        preview_path: report.preview_path.to_string_lossy().to_string(),
        written_bytes: report.written_bytes,
    })
}

#[tauri::command]
pub fn start_native_file_drag(
    window: tauri::WebviewWindow,
    request: NativeFileDragRequest,
    _registry: State<'_, JobRegistry>,
    archive_index_registry: State<'_, ArchiveIndexRegistry>,
    drag_registry: State<'_, crate::native_drag_session::NativeDragSessionRegistry>,
    diagnostics: State<'_, crate::diagnostics::DiagnosticLog>,
) -> Result<NativeFileDragResponse, CommandErrorDto> {
    let started_at = Instant::now();
    let archive_path = ensure_non_empty_path(request.archive_path, "archivePath")?;
    let entry_paths = normalize_optional_entry_paths(Some(request.entry_paths))?;
    let password = request.password.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());

    let (drag_items, preparation_source) = match archive_index_registry.drag_entries(&archive_path, &entry_paths)? {
        Some(entries) => (native_drag_items_from_cached_entries(&entries, request.strip_components)?, "archiveIndex"),
        None => (build_native_drag_items(&archive_path, &entry_paths, request.strip_components, password.as_deref())?, "coreFallback"),
    };
    let _ = diagnostics.record(
        "nativeDrag",
        "prepared",
        crate::diagnostics::fields([
            ("elapsedMs", serde_json::Value::from(u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX))),
            ("preparedEntryCount", serde_json::Value::from(drag_items.len())),
            ("requestedEntryCount", serde_json::Value::from(entry_paths.len())),
            ("source", serde_json::Value::String(preparation_source.to_string())),
        ]),
    );
    let stream_archive_path = archive_path.clone();
    let stream_password = password.clone();
    let successful_streams = Arc::new(Mutex::new(HashSet::<String>::new()));
    let streamed_bytes = Arc::new(AtomicU64::new(0));
    let stream_failure = Arc::new(Mutex::new(None::<CommandErrorDto>));
    let provider_successes = Arc::clone(&successful_streams);
    let provider_streamed_bytes = Arc::clone(&streamed_bytes);
    let provider_failure = Arc::clone(&stream_failure);
    let stream_provider: crate::platform::NativeFileDragStreamProvider = Arc::new(move |entry_path, writer| {
        let result = stream_native_drag_entry(&stream_archive_path, stream_password.as_deref(), entry_path, writer);
        match &result {
            Ok(written_bytes) => {
                provider_successes.lock().unwrap_or_else(|error| error.into_inner()).insert(entry_path.to_string());
                provider_streamed_bytes.fetch_add(*written_bytes, AtomicOrdering::Relaxed);
            }
            Err(error) => {
                let mut failure = provider_failure.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                if failure.is_none() {
                    *failure = Some(error.clone());
                }
            }
        }
        result.map_err(native_file_drag_error_from_command)
    });

    let start = crate::platform::start_native_file_drag(&window, &drag_items, stream_provider, &drag_registry).map_err(|error| {
        let mapped = map_native_file_drag_error(error);
        let _ = diagnostics.record(
            "nativeDrag",
            "failed",
            crate::diagnostics::fields([
                ("code", serde_json::Value::String(mapped.code.to_string())),
                ("elapsedMs", serde_json::Value::from(u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX))),
            ]),
        );
        mapped
    })?;
    if let Some(error) = stream_failure.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone() {
        let _ = diagnostics.record(
            "nativeDrag",
            "streamFailed",
            crate::diagnostics::fields([
                ("code", serde_json::Value::String(error.code.to_string())),
                ("elapsedMs", serde_json::Value::from(u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX))),
            ]),
        );
        return Err(error);
    }

    let streamed_entry_count = successful_streams.lock().unwrap_or_else(|error| error.into_inner()).len();
    let (mut outcome, session_id) = match start {
        crate::platform::NativeFileDragStart::Pending { session_id } => (NativeFileDragOutcomeDto::Pending, Some(session_id)),
        crate::platform::NativeFileDragStart::Settled { outcome } => (map_native_file_drag_outcome(outcome), None),
    };
    if matches!(outcome, NativeFileDragOutcomeDto::Dropped) && streamed_entry_count < drag_items.len() {
        if streamed_entry_count == 0 {
            outcome = NativeFileDragOutcomeDto::NoDrop;
        } else {
            return Err(CommandErrorDto::operation_failed(format!(
                "The drop target materialized {streamed_entry_count} of {} dragged files.",
                drag_items.len()
            )));
        }
    }
    let _ = diagnostics.record(
        "nativeDrag",
        "settled",
        crate::diagnostics::fields([
            ("elapsedMs", serde_json::Value::from(u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX))),
            ("outcome", serde_json::Value::String(format!("{outcome:?}").to_lowercase())),
            ("streamedBytes", serde_json::Value::from(streamed_bytes.load(AtomicOrdering::Relaxed))),
            ("streamedEntryCount", serde_json::Value::from(streamed_entry_count)),
        ]),
    );
    Ok(NativeFileDragResponse { outcome, session_id, dragged_entries: drag_items.iter().map(|item| item.entry_path.clone()).collect() })
}

#[tauri::command]
pub fn cleanup_preview_roots(registry: State<'_, JobRegistry>) {
    registry.cleanup_preview_roots();
}

#[tauri::command]
pub fn test_archive(request: TestArchiveRequest, registry: State<'_, JobRegistry>) -> Result<StartJobResponseDto, CommandErrorDto> {
    start_test_archive_internal(request, &registry)
}

fn start_test_archive_internal(request: TestArchiveRequest, registry: &JobRegistry) -> Result<StartJobResponseDto, CommandErrorDto> {
    let archive_path = ensure_non_empty_path(request.archive_path, "archivePath")?;
    let entry_paths = normalize_optional_entry_paths(request.entry_paths)?;
    let retry_entry_paths = entry_paths.clone();
    let selected_entry_keys = Arc::new(entry_paths.into_iter().collect::<HashSet<_>>());

    let (response, _token) = registry.try_create_job(JobKindDto::TestArchive).map_err(subscription_error)?;
    registry
        .configure_recovery_facts(
            &response.job_id,
            Some(JobRetryDescriptorDto::TestArchive {
                action_id: "retry-with-password".into(),
                archive_path: archive_path.clone(),
                entry_paths: retry_entry_paths,
            }),
            Vec::new(),
            Vec::new(),
        )
        .map_err(subscription_error)?;
    let registry_for_thread = registry.clone();
    let job_id = response.job_id.clone();

    let password = request.password.map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());

    thread::spawn(move || {
        registry_for_thread.emit_direct_event(
            &job_id,
            JobEventDto {
                event_type: JobEventKindDto::Started,
                job_kind: Some(JobKindDto::TestArchive),
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
            },
        );

        let result: Result<JobTerminalSummaryDto, CommandErrorDto> = (|| {
            let engine = zmanager_core::engine::create_default_engine().map_err(crate::platform::archive_error::map_engine_error)?;
            let mut handle = engine
                .open(
                    zmanager_core::engine::ArchiveSource::from_path_autodetect(&archive_path),
                    zmanager_core::engine::OpenOptions { password: password.clone(), recipient_key: None, ..Default::default() },
                )
                .map_err(crate::platform::archive_error::map_engine_error)?;
            let selected_paths = selected_entry_keys.iter().cloned().collect::<Vec<_>>();
            let report = handle
                .test(&zmanager_core::engine::TestOptions {
                    selected_paths,
                    recipient_key: None,
                    recipient_key_bytes: None,
                    tzap_x509_trust: None,
                    cancellation: None,
                })
                .map_err(crate::platform::archive_error::map_engine_error)?;
            Ok(JobTerminalSummaryDto {
                written_entries: usize::try_from(report.tested_entries).unwrap_or(usize::MAX),
                skipped_entries: Some(usize::try_from(report.skipped_entries).unwrap_or(usize::MAX)),
                written_bytes: report.tested_bytes,
                warnings: report.warnings,
            })
        })();

        match result {
            Ok(summary) => {
                let _ = registry_for_thread.commit_completed(&job_id, JobKindDto::TestArchive, summary);
            }
            Err(error) => {
                registry_for_thread.emit_direct_event(&job_id, JobEventDto::failed_from_command_error(JobKindDto::TestArchive, error));
            }
        }
    });

    Ok(response)
}

#[allow(clippy::too_many_arguments)]
fn run_selected_extract_job(
    archive_path: &str,
    destination_path: &str,
    entry_paths: &[String],
    password: Option<&str>,
    policy: ExtractionPolicy,
    tzap_restore_options: TzapRestoreOptions,
    token: &CancellationToken,
    sink: &mut JobEventCollector,
    kind: JobKindDto,
) -> Result<JobTerminalSummaryDto, CommandErrorDto> {
    sink.emit_direct(JobEventDto {
        event_type: JobEventKindDto::Started,
        job_kind: Some(kind),
        phase: None,
        code: None,
        hint: None,
        severity: None,
        retryable: None,
        path: None,
        bytes: None,
        total_bytes: None,
        total_bytes_processed: None,
        entries: Some(0),
        total_entries: Some(entry_paths.len()),
        message: None,
    });

    let mut written_entries = 0usize;
    let mut written_bytes = 0u64;

    for entry_path in entry_paths {
        if token.is_cancelled() {
            return Ok(cancel_selected_extract_job(sink, kind, Some(entry_path.clone()), written_entries, written_bytes, entry_paths.len()));
        }

        sink.emit_direct(JobEventDto {
            event_type: JobEventKindDto::EntryStarted,
            job_kind: Some(kind),
            phase: None,
            code: None,
            hint: None,
            severity: None,
            retryable: None,
            path: Some(entry_path.clone()),
            bytes: None,
            total_bytes: None,
            total_bytes_processed: Some(written_bytes),
            entries: Some(written_entries),
            total_entries: Some(entry_paths.len()),
            message: None,
        });

        let report = archive_browser::extract_entry_with_options(
            archive_path,
            entry_path,
            destination_path,
            BrowserExtractOptions {
                password,
                overwrite: policy.overwrite,
                strip_components: policy.strip_components,
                tzap_restore_policy: tzap_restore_options.policy,
                tzap_allow_degraded: tzap_restore_options.allow_degraded,
                tzap_allow_absolute_symlinks: tzap_restore_options.allow_absolute_symlinks,
                ignore_symlinks: policy.ignore_symlinks,
                limits: None,
            },
        )
        .map_err(crate::platform::map_archive_browser_error)?;

        written_entries = written_entries.saturating_add(1);
        written_bytes = written_bytes.saturating_add(report.written_bytes);
        for diagnostic in report.metadata_diagnostics {
            sink.emit_direct(JobEventDto {
                event_type: JobEventKindDto::Warning,
                job_kind: Some(kind),
                phase: None,
                code: Some("metadata_degraded"),
                hint: None,
                severity: Some(ErrorSeverityDto::Warning),
                retryable: Some(false),
                path: Some(entry_path.clone()),
                bytes: None,
                total_bytes: None,
                total_bytes_processed: Some(written_bytes),
                entries: Some(written_entries),
                total_entries: Some(entry_paths.len()),
                message: Some(diagnostic),
            });
        }
        sink.emit_direct(JobEventDto {
            event_type: JobEventKindDto::EntryFinished,
            job_kind: Some(kind),
            phase: None,
            code: None,
            hint: None,
            severity: None,
            retryable: None,
            path: Some(entry_path.clone()),
            bytes: Some(report.written_bytes),
            total_bytes: None,
            total_bytes_processed: Some(written_bytes),
            entries: Some(written_entries),
            total_entries: Some(entry_paths.len()),
            message: None,
        });

        if token.is_cancelled() {
            return Ok(cancel_selected_extract_job(sink, kind, Some(entry_path.clone()), written_entries, written_bytes, entry_paths.len()));
        }
    }

    if token.is_cancelled() {
        return Ok(cancel_selected_extract_job(sink, kind, None, written_entries, written_bytes, entry_paths.len()));
    }

    Ok(JobTerminalSummaryDto { written_entries, skipped_entries: None, written_bytes, warnings: Vec::new() })
}

fn cancel_selected_extract_job(
    sink: &mut JobEventCollector,
    kind: JobKindDto,
    path: Option<String>,
    written_entries: usize,
    written_bytes: u64,
    total_entries: usize,
) -> JobTerminalSummaryDto {
    sink.emit_direct(JobEventDto {
        event_type: JobEventKindDto::Cancelled,
        job_kind: Some(kind),
        phase: None,
        code: Some(constants::COMMAND_ERROR_CANCELLED),
        hint: None,
        severity: None,
        retryable: Some(true),
        path,
        bytes: None,
        total_bytes: None,
        total_bytes_processed: Some(written_bytes),
        entries: Some(written_entries),
        total_entries: Some(total_entries),
        message: Some("Extraction cancelled.".to_string()),
    });

    JobTerminalSummaryDto { written_entries, skipped_entries: None, written_bytes, warnings: vec!["Extraction cancelled.".to_string()] }
}

#[tauri::command]
pub fn subscribe_job(
    request: SubscribeJobRequest,
    on_snapshot: Channel<JobSnapshotEnvelopeDto>,
    window: WebviewWindow,
    registry: State<'_, JobRegistry>,
) -> Result<String, CommandErrorDto> {
    let job_id = request.job_id.trim();
    if job_id.is_empty() {
        return Err(CommandErrorDto::invalid_request("jobId cannot be empty"));
    }
    let owner = window.label().to_string();
    let (subscription_id, snapshots, commands, shared_flow) = registry.register_job_subscription(&owner, job_id).map_err(subscription_error)?;
    let registry = registry.inner().clone();
    let task_subscription_id = subscription_id.clone();
    tauri::async_runtime::spawn(async move {
        forward_latest_values(
            snapshots,
            commands,
            shared_flow,
            |snapshot| snapshot.revision.parse::<u64>().ok(),
            |current| {
                on_snapshot
                    .send(JobSnapshotEnvelopeDto {
                        subscription_id: task_subscription_id.clone(),
                        revision: current.revision.clone(),
                        payload: (*current).clone(),
                    })
                    .map_err(|_| ())
            },
        )
        .await;
        registry.cleanup_subscription(&task_subscription_id);
    });
    Ok(subscription_id)
}

/// One-shot read of a Job's snapshot. Unlike `subscribe_job`, this does not
/// open a live subscription or require the calling window to own the Job, so
/// the Main Window can use it to read a single fact (e.g. output artifacts)
/// about a Job it has already handed off to a task window.
#[tauri::command]
pub fn get_job_snapshot(request: SubscribeJobRequest, registry: State<'_, JobRegistry>) -> Result<DesktopJobSnapshotDto, CommandErrorDto> {
    let job_id = request.job_id.trim();
    if job_id.is_empty() {
        return Err(CommandErrorDto::invalid_request("jobId cannot be empty"));
    }
    registry.current_job_snapshot(job_id).map(|snapshot| (*snapshot).clone()).ok_or_else(|| CommandErrorDto::invalid_request("job_not_found"))
}

#[tauri::command]
pub fn subscribe_job_catalog(
    on_snapshot: Channel<JobCatalogEnvelopeDto>,
    window: WebviewWindow,
    registry: State<'_, JobRegistry>,
) -> Result<String, CommandErrorDto> {
    let owner = window.label().to_string();
    let (subscription_id, snapshots, commands, shared_flow) = registry.register_catalog_subscription(&owner).map_err(subscription_error)?;
    let registry = registry.inner().clone();
    let task_subscription_id = subscription_id.clone();
    tauri::async_runtime::spawn(async move {
        forward_latest_values(
            snapshots,
            commands,
            shared_flow,
            |snapshot| snapshot.catalog_revision.parse::<u64>().ok(),
            |current| {
                on_snapshot
                    .send(JobCatalogEnvelopeDto {
                        subscription_id: task_subscription_id.clone(),
                        revision: current.catalog_revision.clone(),
                        payload: (*current).clone(),
                    })
                    .map_err(|_| ())
            },
        )
        .await;
        registry.cleanup_subscription(&task_subscription_id);
    });
    Ok(subscription_id)
}

#[tauri::command]
pub fn ack_subscription(request: AckSubscriptionRequest, window: WebviewWindow, registry: State<'_, JobRegistry>) -> Result<(), CommandErrorDto> {
    let revision = request.revision.parse::<u64>().map_err(|_| CommandErrorDto::invalid_request("revision must be an unsigned decimal string"))?;
    registry.acknowledge_subscription(window.label(), request.subscription_id.trim(), revision).map_err(subscription_error)
}

#[tauri::command]
pub fn unsubscribe_job(request: SubscriptionRequest, window: WebviewWindow, registry: State<'_, JobRegistry>) -> Result<(), CommandErrorDto> {
    registry.unsubscribe(window.label(), request.subscription_id.trim()).map_err(subscription_error)
}

fn subscription_error(code: &'static str) -> CommandErrorDto {
    CommandErrorDto::invalid_request(code)
}

fn ensure_task_job_owner(owner: &str, job_id: &str) -> Result<(), CommandErrorDto> {
    if owner == format!("task-{job_id}") {
        return Ok(());
    }
    Err(CommandErrorDto::invalid_request("job_control_forbidden"))
}

#[tauri::command]
pub fn cancel_job(
    request: crate::dto::CancelJobRequest,
    window: WebviewWindow,
    registry: State<'_, JobRegistry>,
    diagnostics: State<'_, crate::diagnostics::DiagnosticLog>,
) -> Result<crate::job_dto::CancelJobResponseDto, CommandErrorDto> {
    let job_id = request.job_id.trim().to_string();
    if job_id.is_empty() {
        return Err(CommandErrorDto::invalid_request("jobId cannot be empty"));
    }
    let owner = window.label().to_string();
    let result = ensure_task_job_owner(&owner, &job_id).and_then(|()| {
        registry.request_cancel(&job_id).ok_or_else(|| {
            CommandErrorDto::not_found(format!("job not found: {job_id}"), Some("The job may have already completed and can be dismissed.".to_string()))
        })
    });
    let _ = diagnostics.record(
        "jobControl",
        if result.is_ok() { "cancelRequested" } else { "cancelRejected" },
        crate::diagnostics::fields([
            ("jobId", serde_json::Value::String(job_id)),
            ("owner", serde_json::Value::String(owner)),
            ("errorCode", serde_json::Value::String(result.as_ref().err().map(|error| error.code.to_owned()).unwrap_or_default())),
        ]),
    );
    result
}

#[tauri::command]
pub fn pause_job(request: PauseJobRequest, window: WebviewWindow, registry: State<'_, JobRegistry>) -> Result<JobControlResponseDto, CommandErrorDto> {
    let job_id = request.job_id.trim().to_string();
    if job_id.is_empty() {
        return Err(CommandErrorDto::invalid_request("jobId cannot be empty"));
    }
    ensure_task_job_owner(window.label(), &job_id)?;

    registry
        .request_pause(&job_id)
        .ok_or_else(|| CommandErrorDto::not_found(format!("job not found: {job_id}"), Some("Start a new job command before pausing.".to_string())))
}

#[tauri::command]
pub fn resume_job(request: ResumeJobRequest, window: WebviewWindow, registry: State<'_, JobRegistry>) -> Result<JobControlResponseDto, CommandErrorDto> {
    let job_id = request.job_id.trim().to_string();
    if job_id.is_empty() {
        return Err(CommandErrorDto::invalid_request("jobId cannot be empty"));
    }
    ensure_task_job_owner(window.label(), &job_id)?;

    registry.request_resume(&job_id).ok_or_else(|| {
        CommandErrorDto::not_found(format!("job not found: {job_id}"), Some("Only jobs that still exist in this session can be resumed.".to_string()))
    })
}

#[tauri::command]
pub fn dismiss_job(request: crate::dto::DismissJobRequest, window: WebviewWindow, registry: State<'_, JobRegistry>) -> Result<(), CommandErrorDto> {
    let job_id = request.job_id.trim().to_string();
    if job_id.is_empty() {
        return Err(CommandErrorDto::invalid_request("jobId cannot be empty"));
    }
    ensure_task_job_owner(window.label(), &job_id)?;

    let snapshot = registry.snapshot(&job_id).ok_or_else(|| {
        CommandErrorDto::not_found(format!("job not found: {job_id}"), Some("Only dismiss jobs that still exist in this session.".to_string()))
    })?;

    if !snapshot.status.is_terminal() {
        return Err(CommandErrorDto::invalid_request(format!("cannot dismiss job {job_id} while it is {:?}", snapshot.status,)));
    }

    let _ = registry.remove_job_if_terminal(&job_id);
    Ok(())
}

pub(crate) fn map_browser_entry_kind(entry: zmanager_core::archive_browser::BrowserEntryKind) -> ArchiveEntryKindDto {
    match entry {
        zmanager_core::archive_browser::BrowserEntryKind::File | zmanager_core::archive_browser::BrowserEntryKind::FileCopy => ArchiveEntryKindDto::File,
        zmanager_core::archive_browser::BrowserEntryKind::Directory => ArchiveEntryKindDto::Directory,
        zmanager_core::archive_browser::BrowserEntryKind::Symlink => ArchiveEntryKindDto::Symlink,
        zmanager_core::archive_browser::BrowserEntryKind::Hardlink => ArchiveEntryKindDto::Hardlink,
        zmanager_core::archive_browser::BrowserEntryKind::Special => ArchiveEntryKindDto::Special,
    }
}

fn map_plan_error(error: PlanError) -> CommandErrorDto {
    CommandErrorDto::invalid_request(error.to_string())
}

pub(crate) fn map_io_error(path: String, source: io::Error) -> CommandErrorDto {
    match source.kind() {
        io::ErrorKind::NotFound => {
            CommandErrorDto::not_found(format!("could not find file or directory: {path}"), Some("Check that the path exists and is accessible.".to_string()))
        }
        _ => CommandErrorDto::io_error(
            format!("I/O failed for {path}: {source}"),
            source.kind() == io::ErrorKind::TimedOut || source.kind() == io::ErrorKind::Interrupted,
        ),
    }
}

fn map_native_file_drag_error(error: crate::platform::NativeFileDragError) -> CommandErrorDto {
    match error.kind {
        crate::platform::NativeFileDragErrorKind::InvalidRequest => CommandErrorDto::invalid_request(error.message),
        crate::platform::NativeFileDragErrorKind::UnsafeArchive => CommandErrorDto::unsafe_archive(error.message),
        crate::platform::NativeFileDragErrorKind::OperationFailed => {
            CommandErrorDto::new(constants::COMMAND_ERROR_OPERATION_FAILED, error.message, error.hint, ErrorSeverityDto::Warning, false)
        }
    }
}

fn native_file_drag_error_from_command(error: CommandErrorDto) -> crate::platform::NativeFileDragError {
    crate::platform::NativeFileDragError::new(error.message, error.hint)
}

fn map_native_file_drag_outcome(outcome: crate::platform::NativeFileDragOutcome) -> NativeFileDragOutcomeDto {
    match outcome {
        crate::platform::NativeFileDragOutcome::Dropped => NativeFileDragOutcomeDto::Dropped,
        crate::platform::NativeFileDragOutcome::Cancelled => NativeFileDragOutcomeDto::Cancelled,
        crate::platform::NativeFileDragOutcome::NoDrop => NativeFileDragOutcomeDto::NoDrop,
    }
}

fn build_native_drag_items(
    archive_path: &str,
    entry_paths: &[String],
    strip_components: usize,
    password: Option<&str>,
) -> Result<Vec<crate::platform::NativeFileDragItem>, CommandErrorDto> {
    let mut entries = Vec::new();
    archive_browser::visit_entries_with_options(Path::new(archive_path), BrowserListOptions { password, ..Default::default() }, |entry| {
        entries.push(entry);
        true
    })
    .map_err(crate::platform::map_archive_browser_error)?;

    native_drag_items_from_listing(&entries, entry_paths, strip_components)
}

fn native_drag_items_from_cached_entries(
    entries: &[ArchiveEntryDto],
    strip_components: usize,
) -> Result<Vec<crate::platform::NativeFileDragItem>, CommandErrorDto> {
    let candidates = entries
        .iter()
        .map(|entry| crate::platform::NativeFileDragCandidate {
            entry_path: entry.path.clone(),
            size: entry.size,
            modified_unix_seconds: entry.modified.as_deref().and_then(|modified| modified.parse::<u64>().ok()),
        })
        .collect::<Vec<_>>();
    crate::platform::prepare_native_file_drag(&candidates, strip_components).map_err(map_native_file_drag_error)
}

fn native_drag_items_from_listing(
    entries: &[zmanager_core::archive_browser::BrowserEntry],
    entry_paths: &[String],
    strip_components: usize,
) -> Result<Vec<crate::platform::NativeFileDragItem>, CommandErrorDto> {
    let mut selected_entry_keys = HashSet::new();
    let mut selected_entries = Vec::new();

    for entry_path in entry_paths {
        let requested_key = archive_entry_key(entry_path);
        let Some(selected) = entries.iter().find(|entry| archive_entry_key(&entry.path) == requested_key) else {
            let before = selected_entries.len();
            let folder_key = archive_folder_key(entry_path);
            for descendant in entries {
                if descendant.kind != zmanager_core::archive_browser::BrowserEntryKind::File {
                    continue;
                }
                if entry_is_under_folder_key(&archive_entry_key(&descendant.path), &folder_key) {
                    push_native_drag_listing_entry(descendant, &mut selected_entry_keys, &mut selected_entries);
                }
            }
            if selected_entries.len() > before {
                continue;
            }
            return Err(CommandErrorDto::not_found(
                format!("archive entry not found: {entry_path}"),
                Some("Open the archive again or choose a visible entry.".to_string()),
            ));
        };

        match selected.kind {
            zmanager_core::archive_browser::BrowserEntryKind::File => {
                push_native_drag_listing_entry(selected, &mut selected_entry_keys, &mut selected_entries);
            }
            zmanager_core::archive_browser::BrowserEntryKind::Directory => {
                let before = selected_entries.len();
                let folder_key = archive_folder_key(&selected.path);
                for descendant in entries {
                    if descendant.kind != zmanager_core::archive_browser::BrowserEntryKind::File {
                        continue;
                    }
                    if entry_is_under_folder_key(&archive_entry_key(&descendant.path), &folder_key) {
                        push_native_drag_listing_entry(descendant, &mut selected_entry_keys, &mut selected_entries);
                    }
                }
                if selected_entries.len() == before {
                    return Err(CommandErrorDto::unsupported_format(format!("directory has no regular file entries to drag out: {}", selected.path)));
                }
            }
            _ => {
                return Err(CommandErrorDto::unsupported_format(format!("entry cannot be dragged out as a virtual file: {}", selected.path)));
            }
        }
    }

    let mut candidates = Vec::with_capacity(selected_entries.len());
    for entry in selected_entries {
        candidates.push(crate::platform::NativeFileDragCandidate {
            entry_path: entry.path.clone(),
            size: entry.size,
            modified_unix_seconds: entry.modified.as_deref().and_then(|modified| modified.parse::<u64>().ok()),
        });
    }

    crate::platform::prepare_native_file_drag(&candidates, strip_components).map_err(map_native_file_drag_error)
}

fn push_native_drag_listing_entry<'a>(
    entry: &'a zmanager_core::archive_browser::BrowserEntry,
    selected_entry_keys: &mut HashSet<String>,
    selected_entries: &mut Vec<&'a zmanager_core::archive_browser::BrowserEntry>,
) {
    if selected_entry_keys.insert(archive_entry_key(&entry.path)) {
        selected_entries.push(entry);
    }
}

fn archive_entry_key(path: &str) -> String {
    path.split(['/', '\\']).filter(|component| !component.is_empty()).collect::<Vec<_>>().join("/")
}

fn archive_folder_key(path: &str) -> String {
    let mut key = archive_entry_key(path);
    if !key.ends_with('/') {
        key.push('/');
    }
    key
}

fn entry_is_under_folder_key(entry_key: &str, folder_key: &str) -> bool {
    entry_key.starts_with(folder_key) && entry_key.len() > folder_key.len()
}

fn stream_native_drag_entry(archive_path: &str, password: Option<&str>, entry_path: &str, output: &mut dyn Write) -> Result<u64, CommandErrorDto> {
    stream_entry_to_writer(Path::new(archive_path), entry_path, output, password)
}

fn stream_entry_to_writer(archive_path: &Path, entry_path: &str, output: &mut (dyn Write + '_), password: Option<&str>) -> Result<u64, CommandErrorDto> {
    let engine = zmanager_core::engine::create_default_engine().map_err(crate::platform::archive_error::map_engine_error)?;
    let mut handle = engine
        .open(
            zmanager_core::engine::ArchiveSource::from_path_autodetect(archive_path),
            zmanager_core::engine::OpenOptions { password: password.map(str::to_owned), ..Default::default() },
        )
        .map_err(crate::platform::archive_error::map_engine_error)?;
    let listing = handle.list().map_err(crate::platform::archive_error::map_engine_error)?;
    let target_key = archive_entry_key(entry_path);
    let entry = listing.entries.iter().find(|e| archive_entry_key(&e.path) == target_key).ok_or_else(|| {
        CommandErrorDto::not_found(format!("archive entry not found: {entry_path}"), Some("Open the archive again or choose a visible entry.".to_string()))
    })?;
    let report = handle.copy_entry(entry.id, output).map_err(crate::platform::archive_error::map_engine_error)?;
    Ok(report.written_bytes)
}

fn map_overwrite_policy(policy: crate::dto::OverwritePolicyDto) -> OverwritePolicy {
    match policy {
        crate::dto::OverwritePolicyDto::Refuse => OverwritePolicy::Refuse,
        crate::dto::OverwritePolicyDto::Replace => OverwritePolicy::Replace,
        crate::dto::OverwritePolicyDto::Rename => OverwritePolicy::Rename,
        crate::dto::OverwritePolicyDto::Ask => OverwritePolicy::Ask,
    }
}

fn map_tzap_restore_policy(policy: TzapRestorePolicyDto) -> TzapRestorePolicy {
    match policy {
        TzapRestorePolicyDto::Content => TzapRestorePolicy::Content,
        TzapRestorePolicyDto::Portable => TzapRestorePolicy::Portable,
        TzapRestorePolicyDto::SameOs => TzapRestorePolicy::SameOs,
        TzapRestorePolicyDto::System => TzapRestorePolicy::System,
    }
}

fn extraction_policy(overwrite: crate::dto::OverwritePolicyDto, strip_components: usize, ignore_symlinks: bool) -> ExtractionPolicy {
    ExtractionPolicy {
        overwrite: map_overwrite_policy(overwrite),
        unsafe_file: UnsafeFilePolicy::Reject,
        include_patterns: Vec::new(),
        exclude_patterns: Vec::new(),
        strip_components,
        limits: Default::default(),
        ignore_symlinks,
    }
}

fn normalize_non_empty_paths(paths: &[String]) -> Result<Vec<PathBuf>, CommandErrorDto> {
    let mut normalized = Vec::new();

    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        normalized.push(PathBuf::from(trimmed));
    }

    if normalized.is_empty() {
        return Err(CommandErrorDto::invalid_request("at least one source path is required"));
    }

    Ok(normalized)
}

fn normalize_optional_entry_paths(paths: Option<Vec<String>>) -> Result<Vec<String>, CommandErrorDto> {
    let Some(paths) = paths else {
        return Ok(Vec::new());
    };

    let normalized = paths.into_iter().map(|path| path.trim().to_string()).filter(|path| !path.is_empty()).collect::<Vec<_>>();

    if normalized.is_empty() {
        return Err(CommandErrorDto::invalid_request("at least one selected entry path is required"));
    }

    Ok(normalized)
}

fn validate_source_paths_exist(sources: &[PathBuf]) -> Result<(), CommandErrorDto> {
    for source in sources {
        std::fs::metadata(source).map_err(|source_error| {
            if source_error.kind() == io::ErrorKind::NotFound {
                CommandErrorDto::not_found(
                    format!("source path does not exist: {}", source.to_string_lossy()),
                    Some("Select an existing file or folder before creating an archive.".to_string()),
                )
            } else {
                map_io_error(source.to_string_lossy().to_string(), source_error)
            }
        })?;
    }
    Ok(())
}

fn ensure_non_empty_path(value: String, field: &str) -> Result<String, CommandErrorDto> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(CommandErrorDto::invalid_request(format!("{field} cannot be empty")));
    }

    Ok(value)
}

pub(crate) fn next_available_destination_directory_path(path: &str) -> String {
    let candidate = Path::new(path);
    if !candidate.exists() {
        return path.to_string();
    }

    let parent = candidate.parent().unwrap_or(Path::new(""));
    let dir_name = candidate.file_name().and_then(|value| value.to_str()).unwrap_or(path);

    for index in 2..10_000 {
        let renamed = parent.join(format!("{dir_name} {index}"));
        if !renamed.exists() {
            return renamed.to_string_lossy().to_string();
        }
    }

    path.to_string()
}

pub(crate) fn next_available_destination_file_path(path: &str) -> String {
    let candidate = Path::new(path);
    if !candidate.exists() {
        return path.to_string();
    }

    let parent = candidate.parent().unwrap_or(Path::new(""));
    let file_name = candidate.file_name().and_then(|value| value.to_str()).unwrap_or(path);
    let (stem, suffix) = split_file_collision_name(file_name);

    for index in 2..10_000 {
        let renamed = parent.join(format!("{stem} {index}{suffix}"));
        if !renamed.exists() {
            return renamed.to_string_lossy().to_string();
        }
    }

    path.to_string()
}

#[cfg(test)]
pub(crate) fn next_available_destination_path(path: &str) -> String {
    let candidate = Path::new(path);
    if candidate.is_dir() { next_available_destination_directory_path(path) } else { next_available_destination_file_path(path) }
}

fn split_file_collision_name(name: &str) -> (&str, &str) {
    const COMPOUND_SUFFIXES: &[&str] =
        &[".tar.br", ".tar.bz2", ".tar.gz", ".tar.lz", ".tar.lz4", ".tar.lzma", ".tar.lzo", ".tar.lrz", ".tar.xz", ".tar.z", ".tar.zst", ".7z.001"];

    let lower_name = name.to_ascii_lowercase();
    for suffix in COMPOUND_SUFFIXES {
        if lower_name.ends_with(suffix) && name.len() > suffix.len() {
            return name.split_at(name.len() - suffix.len());
        }
    }

    if let Some(dot_index) = name.rfind('.')
        && dot_index > 0
    {
        return name.split_at(dot_index);
    }

    (name, "")
}

#[tauri::command]
pub fn detect_archive_format(request: crate::dto::DetectArchiveFormatRequest) -> crate::dto::DetectArchiveFormatResponse {
    let kind = zmanager_core::archive_format::detect_archive_format(&request.path);
    crate::dto::DetectArchiveFormatResponse { format: crate::dto::ArchiveFormatKindDto::from(kind) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::OverwritePolicyDto;
    use crate::job_dto::JobStatusDto;
    use crate::quick_action::QuickActionStartupState;
    use openssl::asn1::Asn1Integer;
    use openssl::bn::{BigNum, MsbOption};
    use openssl::nid::Nid;
    use openssl::pkey::PKey;
    use openssl::rsa::Rsa;
    use openssl::x509::X509NameBuilder;

    #[test]
    fn job_controls_are_scoped_to_the_matching_disposable_task_window() {
        assert!(ensure_task_job_owner("task-42", "42").is_ok());
        assert_eq!(ensure_task_job_owner("main", "42").expect_err("Main Window must not control a Job").code, constants::COMMAND_ERROR_INVALID_REQUEST,);
        assert!(ensure_task_job_owner("task-41", "42").is_err());
    }

    #[test]
    fn archive_verification_response_preserves_online_status_outcomes() {
        let before_renewal = archive_verification_response(
            TzapArchiveVerification::new(
                TzapArchiveSignatureCheck::Ok,
                TzapArchiveTrustCheck::ProductionRoot,
                TzapArchiveTimeCheck::ValidAtSigning,
                TzapArchiveStatusCheck::BeforeRevocation { revoked_at_unix_seconds: 123, reason: Some("supersession".to_owned()) },
                None,
                false,
            ),
            None,
        );
        assert_eq!(before_renewal.outcome, "signed_before_renewal");
        assert_eq!(before_renewal.status_check, "signed_before_renewal");
        assert_eq!(before_renewal.status_reason.as_deref(), Some("supersession"));

        let status = TzapStatusResponse {
            status: zmanager_core::trust::TzapCertificateStatus::Revoked,
            certificate_sha256: Some("sha256:certificate".to_owned()),
            issuer_certificate_sha256: Some("sha256:issuer".to_owned()),
            issuer_key_identifier: Some("key-id".to_owned()),
            serial_number: Some("01".to_owned()),
            not_before_unix_seconds: Some(1),
            not_after_unix_seconds: Some(2),
            this_update_unix_seconds: Some(100),
            next_update_unix_seconds: Some(200),
            revoked_at_unix_seconds: Some(150),
            revocation_reason: Some("renewed".to_owned()),
            revocation_category: Some("supersession".to_owned()),
            query: Default::default(),
        };
        let enriched = archive_verification_response(
            TzapArchiveVerification::new(
                TzapArchiveSignatureCheck::Ok,
                TzapArchiveTrustCheck::ProductionRoot,
                TzapArchiveTimeCheck::ValidAtSigning,
                TzapArchiveStatusCheck::FreshValid,
                None,
                false,
            ),
            Some(&status),
        );
        assert_eq!(enriched.status_this_update_unix_seconds, Some(100));
        assert_eq!(enriched.status_next_update_unix_seconds, Some(200));
        assert_eq!(enriched.status_revoked_at_unix_seconds, Some(150));
        assert_eq!(enriched.status_revocation_reason.as_deref(), Some("renewed"));
        assert_eq!(enriched.status_revocation_category.as_deref(), Some("supersession"));

        let unavailable = archive_verification_response(
            TzapArchiveVerification::new(
                TzapArchiveSignatureCheck::Ok,
                TzapArchiveTrustCheck::ProductionRoot,
                TzapArchiveTimeCheck::ValidAtSigning,
                TzapArchiveStatusCheck::Unavailable { reason: Some("network".to_owned()) },
                None,
                false,
            ),
            None,
        );
        assert_eq!(unavailable.outcome, "status_unavailable");
        assert_eq!(unavailable.status_reason.as_deref(), Some("network"));

        let offline = archive_verification_response(
            TzapArchiveVerification::new(
                TzapArchiveSignatureCheck::Ok,
                TzapArchiveTrustCheck::ProductionRoot,
                TzapArchiveTimeCheck::ValidAtSigning,
                TzapArchiveStatusCheck::Unavailable { reason: None },
                None,
                false,
            ),
            None,
        );
        assert_eq!(offline.outcome, "cryptographically_intact_offline");
        assert_eq!(offline.status_check, "status_unavailable");
    }

    #[test]
    fn hosted_status_base_url_is_allow_listed_by_environment() {
        assert_eq!(hosted_status_base_url(None).unwrap(), SIGN_TZAP_BASE_URL);
        assert_eq!(hosted_status_base_url(Some("local")).unwrap(), "http://localhost:8787");
        assert_eq!(hosted_status_base_url(Some("staging")).unwrap(), "https://staging.tzap.org");
        assert!(hosted_status_base_url(Some("unknown")).is_err());
    }

    #[test]
    fn verify_tzap_certificate_defaults_to_offline_without_account_session() {
        let archive_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../zmanager/fixtures/archives/basic.tzap");
        assert!(archive_path.exists(), "shared TZAP fixture is required for the offline verification contract test");
        let result = verify_tzap_certificate(crate::dto::VerifyTzapCertificateRequest {
            archive_path: archive_path.to_string_lossy().into_owned(),
            validate_trust: false,
            trusted_ca_certificate_paths: Vec::new(),
            trusted_system_roots: false,
            include_official_tzap_root: false,
            check_current_status: false,
            environment: None,
        })
        .unwrap();
        assert_eq!(result.status_check, "status_unavailable");
        assert_ne!(result.status_reason.as_deref(), Some("network"));
    }

    use std::env;
    use std::ffi::OsString;
    use std::fs;
    use std::io::Error;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use zmanager_core::manifest::{ManifestEntry, ManifestFileType, PermissionSnapshot};

    #[test]
    fn create_plan_entry_dto_preserves_core_permission_mode() {
        let entry = ManifestEntry {
            archive_path: "bin/tool".to_string(),
            source_path: PathBuf::from("C:/work/bin/tool"),
            file_type: ManifestFileType::File,
            size: 42,
            modified: None,
            permissions: PermissionSnapshot { readonly: false, unix_mode: Some(0o755) },
            symlink_target: None,
        };

        let dto = create_plan_entry_to_dto(&entry, &mut crate::platform::IdentityCache::new());

        assert_eq!(dto.mode, Some(0o755));
    }

    #[test]
    fn create_plan_entry_dto_maps_symlink_target_to_link_target() {
        let entry = ManifestEntry {
            archive_path: "link.txt".to_string(),
            source_path: PathBuf::from("/tmp/link.txt"),
            file_type: ManifestFileType::Symlink,
            size: 0,
            modified: None,
            permissions: PermissionSnapshot { readonly: false, unix_mode: Some(0o777) },
            symlink_target: Some(PathBuf::from("target.txt")),
        };

        let dto = create_plan_entry_to_dto(&entry, &mut crate::platform::IdentityCache::new());

        assert_eq!(dto.link_target, Some("target.txt".to_string()));
        // Optional fields not yet populated remain None
        assert_eq!(dto.created, None);
        assert_eq!(dto.uid, None);
        assert_eq!(dto.owner, None);
    }

    #[test]
    fn create_plan_entry_dto_leaves_link_target_none_when_no_symlink_target() {
        let entry = ManifestEntry {
            archive_path: "regular.txt".to_string(),
            source_path: PathBuf::from("/tmp/regular.txt"),
            file_type: ManifestFileType::File,
            size: 100,
            modified: None,
            permissions: PermissionSnapshot { readonly: false, unix_mode: Some(0o644) },
            symlink_target: None,
        };

        let dto = create_plan_entry_to_dto(&entry, &mut crate::platform::IdentityCache::new());

        assert_eq!(dto.link_target, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn create_plan_entry_dto_reports_exact_object_metadata_without_following_symlinks() {
        use std::os::unix::fs::symlink;

        let root = env::temp_dir().join(format!(
            "zmanager-source-columns-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.txt");
        let link = root.join("link.txt");
        fs::write(&target, b"target").unwrap();
        symlink("target.txt", &link).unwrap();
        assert!(std::process::Command::new("/usr/bin/chflags").arg("hidden").arg(&target).status().unwrap().success());

        let mut identity_cache = crate::platform::IdentityCache::new();
        let target_dto = create_plan_entry_to_dto(
            &ManifestEntry {
                archive_path: "target.txt".into(),
                source_path: target.clone(),
                file_type: ManifestFileType::File,
                size: 6,
                modified: None,
                permissions: PermissionSnapshot { readonly: false, unix_mode: Some(0o644) },
                symlink_target: None,
            },
            &mut identity_cache,
        );
        let link_dto = create_plan_entry_to_dto(
            &ManifestEntry {
                archive_path: "link.txt".into(),
                source_path: link,
                file_type: ManifestFileType::Symlink,
                size: 0,
                modified: None,
                permissions: PermissionSnapshot { readonly: false, unix_mode: Some(0o777) },
                symlink_target: Some(PathBuf::from("target.txt")),
            },
            &mut identity_cache,
        );

        assert!(target_dto.created.is_some());
        assert!(target_dto.accessed.is_some());
        assert!(target_dto.uid.is_some());
        assert!(target_dto.owner.is_some());
        assert!(target_dto.attributes.as_deref().unwrap_or_default().iter().any(|attribute| attribute.code == "hidden"));
        assert!(!link_dto.attributes.as_deref().unwrap_or_default().iter().any(|attribute| attribute.code == "hidden"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn completion_fallback_marks_successful_job_terminal_without_core_completed_event() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::TzapExtract);

        complete_job_if_needed(
            &registry,
            &response.job_id,
            JobKindDto::TzapExtract,
            JobTerminalSummaryDto { written_entries: 2, skipped_entries: None, written_bytes: 42, warnings: Vec::new() },
        );

        let poll = registry.take_test_events(&response.job_id).expect("fallback-completed job should remain pollable");
        assert_eq!(poll.status, JobStatusDto::Completed);
        assert!(poll.can_dismiss);
        assert_eq!(poll.terminal_summary.expect("terminal summary should be retained").written_bytes, 42);
        assert!(
            poll.events
                .iter()
                .any(|event| { event.event_type == JobEventKindDto::Completed && event.total_bytes_processed == Some(42) && event.entries == Some(2) })
        );
    }

    #[test]
    fn completion_fallback_does_not_override_cancelled_job() {
        let registry = JobRegistry::new();
        let (response, _) = registry.create_job(JobKindDto::ZipExtract);
        registry.emit_direct_event(
            &response.job_id,
            JobEventDto {
                event_type: JobEventKindDto::Cancelled,
                job_kind: Some(JobKindDto::ZipExtract),
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
                message: Some("cancelled".to_string()),
            },
        );

        complete_job_if_needed(
            &registry,
            &response.job_id,
            JobKindDto::ZipExtract,
            JobTerminalSummaryDto { written_entries: 1, skipped_entries: None, written_bytes: 12, warnings: Vec::new() },
        );

        let poll = registry.take_test_events(&response.job_id).expect("cancelled job should remain pollable");
        assert_eq!(poll.status, JobStatusDto::Cancelled);
        assert!(!poll.events.iter().any(|event| event.event_type == JobEventKindDto::Completed));
    }

    #[test]
    fn native_drag_items_expand_folders_to_regular_file_descendants() {
        let entries = vec![
            browser_entry("docs", zmanager_core::archive_browser::BrowserEntryKind::Directory),
            browser_entry("docs/a.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
            browser_entry("docs/nested/b.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
            browser_entry("other.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
        ];

        let items = native_drag_items_from_listing(&entries, &["docs".to_string()], 1).unwrap();

        assert_eq!(
            items.iter().map(|item| item.display_path.as_str()).collect::<Vec<_>>(),
            vec!["a.txt".to_string(), format!("nested{}b.txt", std::path::MAIN_SEPARATOR)]
        );
    }

    #[test]
    fn native_drag_items_expand_synthetic_folder_prefixes() {
        let entries = vec![
            browser_entry("folder/alpha.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
            browser_entry("folder/beta.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
            browser_entry("root.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
        ];

        let items = native_drag_items_from_listing(&entries, &["folder".to_string()], 0).unwrap();

        assert_eq!(
            items.iter().map(|item| item.display_path.as_str()).collect::<Vec<_>>(),
            vec![format!("folder{}alpha.txt", std::path::MAIN_SEPARATOR), format!("folder{}beta.txt", std::path::MAIN_SEPARATOR),]
        );
    }

    #[test]
    fn native_drag_items_reject_duplicate_display_paths_after_stripping() {
        let entries = vec![
            browser_entry("one/readme.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
            browser_entry("two/readme.txt", zmanager_core::archive_browser::BrowserEntryKind::File),
        ];

        let error = native_drag_items_from_listing(&entries, &["one/readme.txt".to_string(), "two/readme.txt".to_string()], 1).unwrap_err();

        assert_eq!(error.code, constants::COMMAND_ERROR_INVALID_REQUEST);
    }

    fn browser_entry(path: &str, kind: zmanager_core::archive_browser::BrowserEntryKind) -> zmanager_core::archive_browser::BrowserEntry {
        zmanager_core::archive_browser::BrowserEntry {
            path: path.to_string(),
            kind,
            size: Some(1),
            compressed_size: None,
            modified: Some("1700000000".to_string()),
            mode: Some(0o644),
            metadata_diagnostics: Vec::new(),
            encrypted: None,
            method: None,
            crc: None,
            comment: None,
            created: None,
            accessed: None,
            solid: None,
            link_target: None,
            attributes: None,
            uid: None,
            gid: None,
            owner: None,
            group: None,
        }
    }

    #[test]
    fn list_archive_rejects_empty_path() {
        let error = list_archive(crate::dto::ListArchiveRequest { archive_path: "".to_string(), password: None }).unwrap_err();

        assert_eq!(error.code, constants::COMMAND_ERROR_INVALID_REQUEST);
        assert!(!error.message.is_empty());
    }

    #[test]
    fn missing_archive_maps_not_found_or_io_error() {
        let missing = env::temp_dir().join(".zmanager-does-not-exist.zip");
        let error = list_archive(crate::dto::ListArchiveRequest { archive_path: missing.to_string_lossy().to_string(), password: None }).unwrap_err();

        assert!(error.code == constants::COMMAND_ERROR_NOT_FOUND || error.code == constants::COMMAND_ERROR_IO_ERROR);
    }

    #[test]
    fn mapping_does_not_leak_password_text() {
        let password = "super-secret-password";
        let missing = env::temp_dir().join(".zmanager-does-not-exist.zip");
        let error = list_archive(crate::dto::ListArchiveRequest { archive_path: missing.to_string_lossy().to_string(), password: Some(password.to_string()) })
            .unwrap_err();

        assert!(!error.message.contains(password));
        assert!(!error.hint.as_ref().is_some_and(|value| value.contains(password)));
    }

    #[test]
    fn mapping_password_required_is_distinct_from_invalid_password() {
        let password_required = crate::platform::archive_error::map_engine_error(zmanager_core::engine::ArchiveError::usable(
            zmanager_core::engine::ErrorKind::PasswordRequired,
            "Password required",
        ));
        let invalid_password = crate::platform::archive_error::map_engine_error(zmanager_core::engine::ArchiveError::usable(
            zmanager_core::engine::ErrorKind::WrongPassword,
            "Invalid password",
        ));

        assert_eq!(password_required.code, crate::constants::COMMAND_ERROR_PASSWORD_REQUIRED);
        assert_eq!(invalid_password.code, crate::constants::COMMAND_ERROR_INVALID_PASSWORD);
        assert_ne!(password_required.code, invalid_password.code);
    }

    #[test]
    fn mapping_safety_errors_to_unsafe_archive() {
        let safety_error = crate::platform::archive_error::map_engine_error(zmanager_core::engine::ArchiveError::usable(
            zmanager_core::engine::ErrorKind::SafetyViolation,
            "blocked",
        ));

        assert_eq!(safety_error.code, crate::constants::COMMAND_ERROR_UNSAFE_ARCHIVE);
    }

    #[test]
    fn quick_action_startup_state_command_exposes_only_window_disposition() {
        let state = QuickActionStartupState::from_args(["--quick-action", "open", "--path", "C:/tmp/one.zip"].into_iter().map(OsString::from));

        let response = quick_action_startup_state_internal(&state);

        assert!(response.launched_for_quick_action);
        assert!(response.error.is_none());
        assert_eq!(response.window_disposition, Some(crate::dto::QuickActionWindowDispositionDto::MainWindow),);
    }

    #[test]
    fn quick_action_startup_state_command_exposes_invalid_launch() {
        let state = QuickActionStartupState::from_args(["--quick-action", "extract-to-folder", "--path", "one.zip", "two.zip"].into_iter().map(OsString::from));

        let response = quick_action_startup_state_internal(&state);

        assert!(response.launched_for_quick_action);
        let error = response.error.expect("invalid launch should include an error");
        assert_eq!(error.code, constants::COMMAND_ERROR_INVALID_REQUEST);
        assert_eq!(error.message, "extract-to-folder requires exactly one archive path");
    }

    #[test]
    fn normalize_non_empty_paths_trims_and_rejects_empty_values() {
        let normalized = normalize_non_empty_paths(&["  C:/tmp/src ".to_string(), "   ".to_string(), "".to_string(), "C:/tmp/dest".to_string()])
            .expect("non-empty paths should parse");

        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0].to_string_lossy(), "C:/tmp/src".to_string());
        assert_eq!(normalized[1].to_string_lossy(), "C:/tmp/dest".to_string());
    }

    #[test]
    fn normalize_non_empty_paths_rejects_only_blank_paths() {
        let result = normalize_non_empty_paths(&["".to_string(), "   ".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn detect_archive_format_is_case_insensitive_and_handles_windows_drive() {
        use zmanager_core::archive_format::{ArchiveFormatKind, detect_archive_format};
        assert_eq!(detect_archive_format(r"C:\\Users\\me\\archive.ZIP"), ArchiveFormatKind::Zip);
        assert_eq!(detect_archive_format(r"D:\\archives\\report.TAR.ZST"), ArchiveFormatKind::TarZst);
        assert_eq!(detect_archive_format(r"\\\\server\\share\\bundle.TZAP"), ArchiveFormatKind::Tzap);
    }

    #[test]
    fn detect_archive_format_supports_tar_zst_double_extension_and_plain_tar() {
        use zmanager_core::archive_format::{ArchiveFormatKind, detect_archive_format};
        assert_eq!(detect_archive_format("/tmp/archive.tar.zst"), ArchiveFormatKind::TarZst);
        assert_eq!(detect_archive_format("/tmp/archive.tar"), ArchiveFormatKind::Tar);
    }

    #[test]
    fn ensure_non_empty_path_trims_whitespace() {
        assert_eq!(ensure_non_empty_path("  C:/tmp/archive.zip  ".to_string(), "archivePath").expect("path should trim to valid value"), "C:/tmp/archive.zip");

        assert!(ensure_non_empty_path("   ".to_string(), "archivePath").is_err(), "blank path should not pass",);
    }

    #[test]
    fn normalize_non_empty_paths_accepts_windows_and_long_paths() {
        let very_long_leaf = format!("{}{}", "nested/", "a".repeat(1024),);
        let win_like = format!("C:\\tmp\\{very_long_leaf}.zip");

        let normalized = normalize_non_empty_paths(&[r"  C:\tmp\my archive.zip  ".to_string(), win_like.clone()])
            .expect("windows-like and long-like paths should normalize");

        assert_eq!(normalized[0].to_string_lossy(), "C:\\tmp\\my archive.zip");
        assert_eq!(normalized[1].to_string_lossy(), win_like);
        assert_eq!(normalized.len(), 2);
    }

    #[test]
    fn map_io_error_preserves_retryability_for_non_retryable_cases() {
        let denied = map_io_error("C:/restricted/path".to_string(), Error::new(io::ErrorKind::PermissionDenied, "forbidden"));
        assert_eq!(denied.code, constants::COMMAND_ERROR_IO_ERROR);
        assert!(!denied.retryable);
    }

    #[test]
    fn detect_archive_format_handles_windows_backslashes_and_collision_cases() {
        use zmanager_core::archive_format::{ArchiveFormatKind, detect_archive_format};
        assert_eq!(detect_archive_format(r"C:\temp\ARCHIVE.ZIp"), ArchiveFormatKind::Zip);
        assert_eq!(detect_archive_format(r"D:\\WORK\\report.TAR.ZST"), ArchiveFormatKind::TarZst);
    }

    #[test]
    fn detect_archive_format_recognizes_aar() {
        use zmanager_core::archive_format::{ArchiveFormatKind, detect_archive_format};
        assert_eq!(detect_archive_format("test.aar"), ArchiveFormatKind::AppleArchive);
    }

    #[test]
    fn detect_archive_format_recognizes_aea() {
        use zmanager_core::archive_format::{ArchiveFormatKind, detect_archive_format};
        assert_eq!(detect_archive_format("test.aea"), ArchiveFormatKind::AppleArchive);
    }

    #[test]
    fn detect_archive_format_maps_registry_kinds_explicitly() {
        use zmanager_core::archive_format::{ArchiveFormatKind, detect_archive_format};
        assert_eq!(detect_archive_format("comic.cbz"), ArchiveFormatKind::Zip);
        assert_eq!(detect_archive_format("book.epub"), ArchiveFormatKind::Zip);
        assert_eq!(detect_archive_format("archive.cb7"), ArchiveFormatKind::SevenZ);
        assert_eq!(detect_archive_format("comic.cbr"), ArchiveFormatKind::Rar);
        assert_eq!(detect_archive_format("archive.cbt"), ArchiveFormatKind::Tar);
        assert_eq!(detect_archive_format("archive.tbz"), ArchiveFormatKind::TarBz2);
        assert_eq!(detect_archive_format("archive.tlzma"), ArchiveFormatKind::TarLzma);
        assert_eq!(detect_archive_format("image.iso"), ArchiveFormatKind::Iso);
        assert_eq!(detect_archive_format("installer.dmg"), ArchiveFormatKind::Dmg);
        assert_eq!(detect_archive_format("archive.7z.001"), ArchiveFormatKind::SevenZ);
        assert_eq!(detect_archive_format("bundle.vol000.tzap"), ArchiveFormatKind::Tzap);
        assert_eq!(detect_archive_format("archive.z01"), ArchiveFormatKind::SplitZip);
    }

    #[test]
    fn apple_archive_format_serializes_correctly() {
        let format = crate::dto::ArchiveFormatDto::AppleArchive;
        let json = serde_json::to_string(&format).unwrap();
        assert_eq!(json, "\"appleArchive\"");
    }

    fn create_temp_workspace(name: &str) -> PathBuf {
        let now_nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let base = env::temp_dir().join(format!("zmanager-command-{name}-{now_nanos}"));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("temporary workspace should be created");
        base
    }

    #[test]
    fn clean_source_rejects_an_archive_destination_inside_a_source() {
        let workspace = create_temp_workspace("clean-source-destination-guard");
        let source = workspace.join("source");
        let destination = source.join("archive.zip");
        fs::create_dir_all(&source).expect("source directory should exist");
        fs::write(source.join("payload.txt"), b"payload").expect("source payload should exist");

        let error = remove_created_source_paths(std::slice::from_ref(&source), &destination.to_string_lossy())
            .expect_err("source cleanup must refuse to remove its own output");

        assert_eq!(error.code, constants::COMMAND_ERROR_INVALID_REQUEST);
        assert!(source.join("payload.txt").is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[cfg(unix)]
    #[test]
    fn clean_source_removes_a_symlink_without_following_its_target() {
        use std::os::unix::fs::symlink;

        let workspace = create_temp_workspace("clean-source-symlink");
        let target = workspace.join("target");
        let source_link = workspace.join("source-link");
        let destination = workspace.join("archive.zip");
        fs::create_dir_all(&target).expect("symlink target should exist");
        fs::write(target.join("keep.txt"), b"keep").expect("target payload should exist");
        symlink(&target, &source_link).expect("source symlink should be created");
        fs::write(&destination, b"archive").expect("archive destination should exist");

        remove_created_source_paths(std::slice::from_ref(&source_link), &destination.to_string_lossy()).expect("symlink source should be removable");

        assert!(!source_link.exists(), "cleanSource should remove the link itself");
        assert!(target.join("keep.txt").is_file(), "cleanSource must not follow and delete a symlink target");
        let _ = fs::remove_dir_all(&workspace);
    }

    fn write_test_p12(identity_path: &Path, certificate_path: &Path) {
        let key = PKey::from_rsa(Rsa::generate(2048).expect("test key should generate")).expect("test key should parse");
        let mut name = X509NameBuilder::new().expect("test subject should build");
        name.append_entry_by_nid(Nid::COMMONNAME, "Desktop Test Signer").expect("test subject should contain a common name");
        let name = name.build();
        let mut serial = BigNum::new().expect("test serial should build");
        serial.rand(64, MsbOption::MAYBE_ZERO, false).expect("test serial should generate");
        let serial = Asn1Integer::from_bn(&serial).expect("test serial should encode");
        let mut certificate = X509::builder().expect("test certificate should build");
        certificate.set_version(2).expect("version should set");
        certificate.set_serial_number(&serial).expect("serial should set");
        certificate.set_subject_name(&name).expect("subject should set");
        certificate.set_issuer_name(&name).expect("issuer should set");
        certificate.set_pubkey(&key).expect("public key should set");
        let not_before = Asn1Time::days_from_now(0).expect("start should build");
        let not_after = Asn1Time::days_from_now(365).expect("end should build");
        certificate
            .set_not_before(not_before.as_ref())
            .and_then(|_| certificate.set_not_after(not_after.as_ref()))
            .and_then(|_| certificate.sign(&key, MessageDigest::sha256()))
            .expect("test certificate should sign");
        let certificate = certificate.build();
        let mut identity = Pkcs12::builder();
        identity.name("Desktop Test Signer");
        identity.pkey(&key);
        identity.cert(&certificate);
        let identity = identity.build2("identity-secret").expect("test identity should build");
        fs::write(identity_path, identity.to_der().expect("identity should encode")).expect("identity should write");
        fs::write(certificate_path, certificate.to_pem().expect("certificate should encode")).expect("certificate should write");
    }

    #[test]
    fn validate_tzap_signing_identity_checks_the_private_key_match() {
        let workspace = create_temp_workspace("validate-tzap-identity");
        let identity_path = workspace.join("signer.p12");
        let certificate_path = workspace.join("signer.crt");
        write_test_p12(&identity_path, &certificate_path);

        let validation = validate_tzap_signing_identity(crate::dto::ValidateTzapSigningIdentityRequest {
            identity_path: identity_path.to_string_lossy().into_owned(),
            password: Some("identity-secret".to_owned()),
        })
        .expect("identity validation should succeed");
        assert_eq!(validation.subject, "Desktop Test Signer");
        assert_eq!(validation.chain_certificate_count, 0);
        assert_eq!(validation.warnings.len(), 1);
        assert!(!validation.certificate_sha256.is_empty());
        let _ = fs::remove_dir_all(workspace);
    }

    fn wait_for_job_terminal(registry: &crate::job_registry::JobRegistry, job_id: &str) -> (TestJobEventsSnapshot, Vec<JobEventDto>) {
        let mut all_events = Vec::new();

        for _ in 0..400 {
            let poll = registry.take_test_events(job_id).expect("job should stay available while waiting for terminal state");
            all_events.extend_from_slice(&poll.events);
            if poll.status.is_terminal() {
                return (poll, all_events);
            }
            std::thread::sleep(Duration::from_millis(25));
        }

        panic!("timed out while waiting for job to complete");
    }

    #[test]
    fn recovery_smoke_create_open_test_extract_zip_end_to_end() {
        let workspace = create_temp_workspace("recovery-smoke");
        let source = workspace.join("source");
        let nested = source.join("nested");
        let destination_archive = workspace.join("created.zip");
        let extract_destination = workspace.join("extracted");
        fs::create_dir_all(&nested).expect("nested fixture directory should exist");
        fs::create_dir_all(&extract_destination).expect("extract destination should exist");
        fs::write(source.join("hello.txt"), b"hello smoke").expect("hello fixture should write");
        fs::write(nested.join("readme.md"), b"# smoke").expect("nested fixture should write");

        let registry = crate::job_registry::JobRegistry::new();
        let create_job = start_create_internal(
            StartCreateRequest {
                sources: vec![source.to_string_lossy().to_string()],
                destination_path: destination_archive.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Zip,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: true,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &registry,
        )
        .expect("smoke create should start");

        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert!(destination_archive.is_file(), "smoke archive should be written");

        let listing = list_archive(crate::dto::ListArchiveRequest { archive_path: destination_archive.to_string_lossy().to_string(), password: None })
            .expect("smoke archive should list");
        let listed_paths = listing.entries.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>();
        assert!(listed_paths.contains(&"source/hello.txt"));
        assert!(listed_paths.contains(&"source/nested/readme.md"));

        let test_job = start_test_archive_internal(
            TestArchiveRequest { archive_path: destination_archive.to_string_lossy().to_string(), entry_paths: None, password: None },
            &registry,
        )
        .expect("smoke test archive should start");
        let (test_poll, _) = wait_for_job_terminal(&registry, &test_job.job_id);
        assert_eq!(test_poll.status, JobStatusDto::Completed);

        let extract_job = start_extract_internal(
            StartExtractRequest {
                archive_path: destination_archive.to_string_lossy().to_string(),
                destination_path: extract_destination.to_string_lossy().to_string(),
                password: None,
                recipient_key_id: None,
                overwrite: OverwritePolicyDto::Replace,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                entry_paths: None,
                strip_components: 0,
                tzap_restore_policy: TzapRestorePolicyDto::Portable,
                tzap_allow_degraded: false,
                tzap_allow_absolute_symlinks: false,
                ignore_symlinks: false,
            },
            &registry,
        )
        .expect("smoke extract should start");
        let (extract_poll, _) = wait_for_job_terminal(&registry, &extract_job.job_id);
        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read_to_string(extract_destination.join("source").join("hello.txt")).expect("extracted hello should be readable"), "hello smoke");
        assert_eq!(
            fs::read_to_string(extract_destination.join("source").join("nested").join("readme.md"),).expect("extracted nested file should be readable"),
            "# smoke"
        );

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn whole_archive_extract_returns_the_queued_job_before_worker_enumeration() {
        let workspace = create_temp_workspace("extract-registration-boundary");
        let source = workspace.join("source");
        let destination_archive = workspace.join("created.zip");
        fs::create_dir_all(&source).expect("fixture source should exist");
        fs::write(source.join("payload.txt"), b"payload").expect("fixture payload should write");

        let registry = JobRegistry::new();
        let create_job = start_create_internal(
            StartCreateRequest {
                sources: vec![source.to_string_lossy().to_string()],
                destination_path: destination_archive.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Zip,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: true,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &registry,
        )
        .expect("fixture archive creation should start");
        let (create_snapshot, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_snapshot.status, JobStatusDto::Completed);

        let extract_job = start_extract_internal_with_spawner(
            StartExtractRequest {
                archive_path: destination_archive.to_string_lossy().to_string(),
                destination_path: workspace.join("out").to_string_lossy().to_string(),
                password: None,
                recipient_key_id: None,
                overwrite: OverwritePolicyDto::Replace,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                entry_paths: None,
                strip_components: 0,
                tzap_restore_policy: TzapRestorePolicyDto::Portable,
                tzap_allow_degraded: false,
                tzap_allow_absolute_symlinks: false,
                ignore_symlinks: false,
            },
            &registry,
            |_worker| {},
        )
        .expect("extract job should be registered before its worker runs");

        let snapshot = registry.current_job_snapshot(&extract_job.job_id).expect("registered extract job should have a retained snapshot");
        assert_eq!(snapshot.status, JobStatusDto::Queued);
        assert_eq!(snapshot.progress_facts.total_entries, None);
        assert_eq!(snapshot.progress_facts.total_bytes, None);
        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn recovery_smoke_password_required_invalid_and_valid_zip_flow() {
        let workspace = create_temp_workspace("recovery-password-smoke");
        let source = workspace.join("source");
        let destination_archive = workspace.join("protected.zip");
        fs::create_dir_all(&source).expect("password smoke source should exist");
        fs::write(source.join("secret.txt"), b"protected smoke").expect("password smoke fixture should write");

        let registry = crate::job_registry::JobRegistry::new();
        let create_job = start_create_internal(
            StartCreateRequest {
                sources: vec![source.to_string_lossy().to_string()],
                destination_path: destination_archive.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Zip,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: true,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: Some("smoke-secret".to_string()),
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &registry,
        )
        .expect("password smoke create should start");

        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let listing = list_archive(crate::dto::ListArchiveRequest {
            archive_path: destination_archive.to_string_lossy().to_string(),
            password: Some("smoke-secret".to_string()),
        })
        .expect("valid password should list protected archive");

        assert!(listing.entries.iter().any(|entry| entry.path == "source/secret.txt"), "protected smoke archive should list expected file",);

        let missing_password_job = start_extract_internal(
            StartExtractRequest {
                archive_path: destination_archive.to_string_lossy().to_string(),
                destination_path: workspace.join("missing-password").to_string_lossy().to_string(),
                password: None,
                recipient_key_id: None,
                overwrite: OverwritePolicyDto::Replace,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                entry_paths: None,
                strip_components: 0,
                tzap_restore_policy: TzapRestorePolicyDto::Portable,
                tzap_allow_degraded: false,
                tzap_allow_absolute_symlinks: false,
                ignore_symlinks: false,
            },
            &registry,
        )
        .expect("missing-password extract should start");
        let (missing_password_poll, missing_password_events) = wait_for_job_terminal(&registry, &missing_password_job.job_id);
        assert_eq!(missing_password_poll.status, JobStatusDto::Failed);
        assert!(
            missing_password_events.iter().any(|event| event.code == Some(constants::COMMAND_ERROR_PASSWORD_REQUIRED)),
            "missing password extract should fail with password_required",
        );

        let invalid_password_job = start_extract_internal(
            StartExtractRequest {
                archive_path: destination_archive.to_string_lossy().to_string(),
                destination_path: workspace.join("invalid-password").to_string_lossy().to_string(),
                password: Some("wrong-password".to_string()),
                recipient_key_id: None,
                overwrite: OverwritePolicyDto::Replace,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                entry_paths: None,
                strip_components: 0,
                tzap_restore_policy: TzapRestorePolicyDto::Portable,
                tzap_allow_degraded: false,
                tzap_allow_absolute_symlinks: false,
                ignore_symlinks: false,
            },
            &registry,
        )
        .expect("invalid-password extract should start");
        let (invalid_password_poll, invalid_password_events) = wait_for_job_terminal(&registry, &invalid_password_job.job_id);
        assert_eq!(invalid_password_poll.status, JobStatusDto::Failed);
        assert!(
            invalid_password_events.iter().any(|event| event.code == Some(constants::COMMAND_ERROR_INVALID_PASSWORD)),
            "invalid password extract should fail with invalid_password",
        );
        assert!(
            invalid_password_events.iter().filter_map(|event| event.message.as_deref()).all(|message| !message.contains("wrong-password")),
            "invalid password diagnostics must not leak the attempted password",
        );

        let valid_extract_destination = workspace.join("valid-password");
        fs::create_dir_all(&valid_extract_destination).expect("valid password destination should exist");
        let valid_password_job = start_extract_internal(
            StartExtractRequest {
                archive_path: destination_archive.to_string_lossy().to_string(),
                destination_path: valid_extract_destination.to_string_lossy().to_string(),
                password: Some("smoke-secret".to_string()),
                recipient_key_id: None,
                overwrite: OverwritePolicyDto::Replace,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                entry_paths: None,
                strip_components: 0,
                tzap_restore_policy: TzapRestorePolicyDto::Portable,
                tzap_allow_degraded: false,
                tzap_allow_absolute_symlinks: false,
                ignore_symlinks: false,
            },
            &registry,
        )
        .expect("valid-password extract should start");
        let (valid_password_poll, valid_password_events) = wait_for_job_terminal(&registry, &valid_password_job.job_id);
        assert_eq!(valid_password_poll.status, JobStatusDto::Completed);
        assert!(
            valid_password_events.iter().filter_map(|event| event.message.as_deref()).all(|message| !message.contains("smoke-secret")),
            "valid password diagnostics must not leak the password",
        );
        assert_eq!(
            fs::read_to_string(valid_extract_destination.join("source").join("secret.txt")).expect("valid password extraction should write protected file"),
            "protected smoke",
        );

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_job_reaches_terminal_and_writes_archive() {
        let workspace = create_temp_workspace("start-create");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.zip");
        fs::create_dir_all(&sources).expect("source directory should exist");

        fs::write(sources.join("hello.txt"), b"hello from create").expect("fixture file should write");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("create command should start a job");
        let (create_poll, mut create_events) = wait_for_job_terminal(&registry, &create_job.job_id);

        create_events.extend_from_slice(&create_poll.events);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert_eq!(create_poll.kind, JobKindDto::ZipCreate);
        assert!(create_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Started)), "create lifecycle should emit a started event",);
        assert!(create_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)), "create lifecycle should emit a completed event",);
        assert!(create_poll.terminal_summary.is_some());
        assert!(destination.is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn create_worker_panic_is_published_as_terminal_failure() {
        let workspace = create_temp_workspace("start-create-worker-panic");
        let source = workspace.join("source.txt");
        let destination = workspace.join("created.zip");
        fs::write(&source, b"panic boundary").expect("fixture file should write");
        let registry = crate::job_registry::JobRegistry::new();
        let job = start_create_internal_with_resolver(
            StartCreateRequest {
                sources: vec![source.to_string_lossy().into_owned()],
                destination_path: destination.to_string_lossy().into_owned(),
                format: crate::dto::ArchiveFormatDto::Zip,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: true,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &registry,
            None,
            || panic!("test worker panic"),
        )
        .expect("create command should accept the job before worker execution");

        let (poll, events) = wait_for_job_terminal(&registry, &job.job_id);
        assert_eq!(poll.status, JobStatusDto::Failed);
        assert!(events.iter().any(|event| event.code == Some("archive_worker_panicked")));
        assert!(events.iter().filter_map(|event| event.message.as_deref()).any(|message| message.contains("test worker panic")));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn start_create_returns_job_before_tzap_inputs_are_resolved() {
        let workspace = create_temp_workspace("start-create-deferred-tzap-resolution");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("hello.txt"), b"hello from create").expect("fixture file should write");
        let registry = crate::job_registry::JobRegistry::new();
        let (resolution_started_tx, resolution_started_rx) = mpsc::channel();
        let (release_resolution_tx, release_resolution_rx) = mpsc::channel();
        let request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let started_at = std::time::Instant::now();
        let job = start_create_internal_with_resolver(request, &registry, None, move || {
            resolution_started_tx.send(()).expect("resolution probe receiver should remain open");
            release_resolution_rx.recv().expect("resolution release should arrive");
            Ok(None)
        })
        .expect("create command should accept the job before resolution");

        assert!(started_at.elapsed() < Duration::from_secs(1), "start_create should not wait for secure-store resolution");
        resolution_started_rx.recv_timeout(Duration::from_secs(1)).expect("worker should begin TZAP input resolution");
        release_resolution_tx.send(()).expect("worker should still be resolving inputs");

        let (poll, _) = wait_for_job_terminal(&registry, &job.job_id);
        assert_eq!(poll.status, JobStatusDto::Completed);
        assert!(destination.is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_renames_existing_destination_when_requested() {
        let workspace = create_temp_workspace("start-create-rename-destination");
        let sources = workspace.join("docs");
        let destination = workspace.join("docs.tzap");
        let renamed_destination = workspace.join("docs 2.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("README.md"), b"# docs").expect("fixture file should write");
        fs::write(&destination, b"existing archive should stay untouched").expect("existing destination should write");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("create command should start a renamed-destination job");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(&destination).expect("original destination should remain readable"), b"existing archive should stay untouched");
        assert!(renamed_destination.is_file(), "renamed archive destination should be written");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_tzap_create_job_reaches_terminal_and_writes_archive() {
        let workspace = create_temp_workspace("start-create-tzap");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");

        let first_payload = vec![b'a'; 256 * 1024];
        let second_payload = vec![b'b'; 256 * 1024];
        fs::write(sources.join("one.bin"), &first_payload).expect("first fixture should write");
        fs::write(sources.join("two.bin"), &second_payload).expect("second fixture should write");
        let source_total_bytes = (first_payload.len() + second_payload.len()) as u64;
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: true,
        };
        let create_job = start_create_internal(create_request, &registry).expect("create command should start a job");
        let (create_poll, mut create_events) = wait_for_job_terminal(&registry, &create_job.job_id);

        create_events.extend_from_slice(&create_poll.events);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert_eq!(create_poll.kind, JobKindDto::TzapCreate);
        assert!(create_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Started)), "create lifecycle should emit a started event",);
        assert!(create_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)), "create lifecycle should emit a completed event",);
        assert!(destination.is_file());
        let finished_event = create_events
            .iter()
            .find(|event| matches!(event.event_type, JobEventKindDto::BytesProcessed) && event.entries.unwrap_or_default() > 0)
            .expect("tzap create should aggregate finished entries for file counts");
        assert!(finished_event.entries.unwrap_or_default() > 0);
        let summary = create_poll.terminal_summary.as_ref().expect("tzap create should return a terminal summary");
        let listing = list_archive(crate::dto::ListArchiveRequest { archive_path: destination.to_string_lossy().to_string(), password: None })
            .expect("created TZAP archive should expose entry metadata");
        println!("summary.written_entries = {}, listing.entries = {:?}", summary.written_entries, listing.entries);
        assert_eq!(summary.written_entries, 3);
        assert_eq!(listing.entries.len(), 3);
        assert!(listing.entries.iter().all(|entry| entry.mode.is_some()));
        assert!(listing.entries.iter().all(|entry| entry.modified.is_some()));
        assert_ne!(summary.written_bytes, source_total_bytes);
        assert!(listing.entries.iter().all(|entry| entry.metadata_diagnostics.is_empty()));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_tzap_create_accepts_explicit_zero_recovery_fast_path() {
        let workspace = create_temp_workspace("start-create-tzap-zero-recovery");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.bin"), vec![b'a'; 16 * 1024]).expect("fixture should write");

        let registry = crate::job_registry::JobRegistry::new();
        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: Some(0),
            volume_count: None,
            tzap_recovery_percentage: Some(0),
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let create_job = start_create_internal(create_request, &registry).expect("zero-recovery create command should start a job");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert!(destination.is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_tzap_create_passes_exact_volume_count() {
        let workspace = create_temp_workspace("start-create-tzap-volume-count");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.bin"), vec![b'a'; 512 * 1024]).expect("fixture should write");

        let registry = crate::job_registry::JobRegistry::new();
        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: Some(1),
            volume_size: None,
            volume_count: Some(3),
            tzap_recovery_percentage: Some(0),
            tzap_volume_loss_tolerance: Some(0),
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let create_job = start_create_internal(create_request, &registry).expect("exact-count create should start a job");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        for index in 0..3 {
            assert!(workspace.join(format!("created.vol{index:03}.tzap")).is_file(), "volume {index} should exist");
        }
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_rejects_zero_volume_count() {
        let workspace = create_temp_workspace("start-create-zero-volume-count");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.txt"), b"one").expect("fixture should write");

        let result = start_create_internal(
            StartCreateRequest {
                sources: vec![sources.to_string_lossy().to_string()],
                destination_path: destination.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Tzap,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: false,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: Some(0),
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &crate::job_registry::JobRegistry::new(),
        );

        let error = result.expect_err("zero volume count must be rejected");
        assert_eq!(error.code, "invalid_request");
        assert!(error.message.contains("volumeCount"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_rejects_single_volume_count() {
        let workspace = create_temp_workspace("start-create-single-volume-count");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.txt"), b"one").expect("fixture should write");

        let result = start_create_internal(
            StartCreateRequest {
                sources: vec![sources.to_string_lossy().to_string()],
                destination_path: destination.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Tzap,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: false,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: Some(1),
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &crate::job_registry::JobRegistry::new(),
        );

        let error = result.expect_err("a one-volume exact count must be rejected");
        assert_eq!(error.code, "invalid_request");
        assert!(error.message.contains("at least 2"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_rejects_tzap_tolerance_for_non_tzap_archive() {
        let workspace = create_temp_workspace("start-create-non-tzap-tolerance");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.zip");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.txt"), b"one").expect("fixture should write");

        let result = start_create_internal(
            StartCreateRequest {
                sources: vec![sources.to_string_lossy().to_string()],
                destination_path: destination.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Zip,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: false,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: Some(1024),
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: Some(1),
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &crate::job_registry::JobRegistry::new(),
        );

        let error = result.expect_err("TZAP-only tolerance must be rejected for ZIP");
        assert_eq!(error.code, "invalid_request");
        assert!(error.message.contains("only for TZAP"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_rejects_volume_loss_tolerance_without_split() {
        let workspace = create_temp_workspace("start-create-tolerance-without-split");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.txt"), b"one").expect("fixture should write");

        let result = start_create_internal(
            StartCreateRequest {
                sources: vec![sources.to_string_lossy().to_string()],
                destination_path: destination.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Tzap,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: false,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: Some(1),
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: None,
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &crate::job_registry::JobRegistry::new(),
        );

        let error = result.expect_err("tolerance without split must be rejected");
        assert_eq!(error.code, "invalid_request");
        assert!(error.message.contains("active split mode"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_tzap_create_rejects_incomplete_signing_identity() {
        let workspace = create_temp_workspace("start-create-tzap-incomplete-signing");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.txt"), b"one").expect("fixture should write");

        let result = start_create_internal(
            StartCreateRequest {
                sources: vec![sources.to_string_lossy().to_string()],
                destination_path: destination.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Tzap,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: false,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: None,
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: Some(crate::dto::TzapCertificateOptionsDto {
                    signing_selection: Some(crate::dto::TzapSigningSelectionDto::OneTimeCertificateAndKey {
                        certificate_path: "C:/certs/signer.pem".to_owned(),
                        private_key_path: "".to_owned(),
                        chain_paths: Vec::new(),
                        password: None,
                    }),
                    recipient_selection: None,
                }),
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &crate::job_registry::JobRegistry::new(),
        );

        let error = result.expect_err("incomplete signing identity must be rejected");
        assert_eq!(error.code, "invalid_request");
        assert!(error.message.contains("certificate") && error.message.contains("private key"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_tzap_create_rejects_password_with_recipient_selection() {
        let workspace = create_temp_workspace("start-create-tzap-password-recipient");
        let sources = workspace.join("sources");
        let destination = workspace.join("created.tzap");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("one.txt"), b"one").expect("fixture should write");

        let result = start_create_internal(
            StartCreateRequest {
                sources: vec![sources.to_string_lossy().to_string()],
                destination_path: destination.to_string_lossy().to_string(),
                format: crate::dto::ArchiveFormatDto::Tzap,
                clean_source: false,
                exclude_names: None,
                exclude_archive_paths: None,
                include_archive_paths: None,
                respect_gitignore: false,
                follow_symlinks: false,
                replace_existing: false,
                destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
                password: Some("must-not-be-used-with-recipients".to_owned()),
                compression_level: None,
                volume_size: None,
                volume_count: None,
                tzap_recovery_percentage: None,
                tzap_volume_loss_tolerance: None,
                zip_compression: None,
                seven_z_solid: None,
                seven_z_threads: None,
                seven_z_chunk_size: None,
                seven_z_encrypt_file_names: None,
                tzap_certificates: Some(crate::dto::TzapCertificateOptionsDto {
                    signing_selection: Some(crate::dto::TzapSigningSelectionDto::None),
                    recipient_selection: Some(crate::dto::TzapRecipientSelectionDto {
                        recipient_key_ids: vec!["recipient-1".to_owned()],
                        contact_recipient_ids: Vec::new(),
                        one_time_certificate_paths: Vec::new(),
                    }),
                }),
                tzap_bootstrap_sidecar: None,
                preserve_metadata: false,
            },
            &crate::job_registry::JobRegistry::new(),
        );
        let error = result.expect_err("password and recipient encryption must be exclusive");
        assert_eq!(error.code, "invalid_request");
        assert!(error.message.contains("recipient") && error.message.contains("password"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_tzap_extract_job_reaches_terminal_and_outputs_expected_file() {
        let workspace = create_temp_workspace("start-extract-tzap");
        let sources = workspace.join("sources");
        let destination_archive = workspace.join("fixture.tzap");
        let extract_destination = workspace.join("extracted");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::create_dir_all(&extract_destination).expect("extract directory should exist");

        fs::write(sources.join("README.md"), b"# extractor").expect("fixture file should write");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("fixture create should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let extract_request = StartExtractRequest {
            archive_path: destination_archive.to_string_lossy().to_string(),
            destination_path: extract_destination.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Replace,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let extract_job = start_extract_internal(extract_request, &registry).expect("extract command should start a job");
        let (extract_poll, mut extract_events) = wait_for_job_terminal(&registry, &extract_job.job_id);
        extract_events.extend_from_slice(&extract_poll.events);

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(extract_poll.kind, JobKindDto::TzapExtract);
        assert!(extract_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Started)), "extract lifecycle should emit a started event",);
        assert!(extract_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)), "extract lifecycle should emit a completed event",);
        assert!(extract_poll.terminal_summary.is_some());

        assert_eq!(fs::read_to_string(extract_destination.join("sources").join("README.md")).expect("extracted README should be readable"), "# extractor");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_extract_renames_existing_destination_when_requested() {
        let workspace = create_temp_workspace("start-extract-rename-destination");
        let sources = workspace.join("sources");
        let destination_archive = workspace.join("fixture.zip");
        let extract_destination = workspace.join("extracted");
        let renamed_extract_destination = workspace.join("extracted 2");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::create_dir_all(&extract_destination).expect("existing extract directory should exist");
        fs::write(sources.join("README.md"), b"# extractor").expect("fixture file should write");
        fs::write(extract_destination.join("marker.txt"), b"keep").expect("existing destination marker should write");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("fixture create should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let extract_request = StartExtractRequest {
            archive_path: destination_archive.to_string_lossy().to_string(),
            destination_path: extract_destination.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Rename,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let extract_job = start_extract_internal(extract_request, &registry).expect("extract command should start a renamed-destination job");
        let (extract_poll, _) = wait_for_job_terminal(&registry, &extract_job.job_id);

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read_to_string(extract_destination.join("marker.txt")).expect("existing destination marker should remain"), "keep");
        assert!(renamed_extract_destination.join("sources").join("README.md").is_file(), "renamed extract destination should receive archive contents");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn quick_compress_and_extract_end_to_end_collision_auto_renames_real_zip_files() {
        let workspace = create_temp_workspace("quick-action-real-zip-collision");
        let source_dir = workspace.join("xxx");
        let pre_existing_zip = workspace.join("xxx.zip");
        let expected_auto_renamed_zip = workspace.join("xxx 2.zip");

        fs::create_dir_all(&source_dir).expect("source dir create");
        fs::write(source_dir.join("sample.txt"), b"new compressed data").expect("write sample.txt");

        // Pre-create xxx.zip with original marker data
        fs::write(&pre_existing_zip, b"original existing archive marker").expect("write pre-existing zip");

        let registry = crate::job_registry::JobRegistry::new();

        // 1. Quick Compress step (replace_existing: false)
        let create_request = StartCreateRequest {
            sources: vec![source_dir.to_string_lossy().to_string()],
            destination_path: pre_existing_zip.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let create_job = start_create_internal(create_request, &registry).expect("quick compress command should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(&pre_existing_zip).expect("pre-existing zip should remain untouched"), b"original existing archive marker");
        assert!(expected_auto_renamed_zip.is_file(), "xxx 2.zip should be created automatically without error");

        // 2. Quick Extract step into existing folder (overwrite: Rename)
        let pre_existing_extract_dir = workspace.join("extract_out");
        let expected_auto_renamed_extract_dir = workspace.join("extract_out 2");
        fs::create_dir_all(&pre_existing_extract_dir).expect("create pre-existing extract dir");
        fs::write(pre_existing_extract_dir.join("old.txt"), b"old extract marker").expect("write old.txt");

        let extract_request = StartExtractRequest {
            archive_path: expected_auto_renamed_zip.to_string_lossy().to_string(),
            destination_path: pre_existing_extract_dir.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Rename,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };

        let extract_job = start_extract_internal(extract_request, &registry).expect("quick extract command should start");
        let (extract_poll, _) = wait_for_job_terminal(&registry, &extract_job.job_id);

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(pre_existing_extract_dir.join("old.txt")).expect("old extract marker should stay"), b"old extract marker");
        assert!(
            expected_auto_renamed_extract_dir.join("xxx").join("sample.txt").is_file(),
            "extract_out 2/xxx/sample.txt should be created with extracted archive content"
        );

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn quick_compress_and_extract_folder_trees_end_to_end_collision() {
        let workspace = create_temp_workspace("quick-folder-tree-collision");
        let project_dir = workspace.join("my_project");
        let src_dir = project_dir.join("src");
        let docs_dir = project_dir.join("docs");

        fs::create_dir_all(&src_dir).expect("src dir create");
        fs::create_dir_all(&docs_dir).expect("docs dir create");
        fs::write(src_dir.join("main.rs"), b"fn main() {}").expect("write main.rs");
        fs::write(docs_dir.join("readme.md"), b"# My Project").expect("write readme.md");

        // 1. Pre-existing target archive collision when compressing a folder tree
        let pre_existing_archive = workspace.join("my_project.zip");
        let expected_auto_renamed_archive = workspace.join("my_project 2.zip");
        fs::write(&pre_existing_archive, b"existing archive marker").expect("write pre-existing my_project.zip");

        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![project_dir.to_string_lossy().to_string()],
            destination_path: pre_existing_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let create_job = start_create_internal(create_request, &registry).expect("folder tree compress should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(&pre_existing_archive).expect("original archive should stay untouched"), b"existing archive marker");
        assert!(expected_auto_renamed_archive.is_file(), "my_project 2.zip should be created automatically for folder tree");

        // 2. Pre-existing target directory collision when extracting a folder tree
        let target_extract_base = workspace.join("out_dir");
        let existing_dest_folder = target_extract_base.join("my_project");
        let expected_renamed_dest_folder = target_extract_base.join("my_project 2");

        fs::create_dir_all(&existing_dest_folder).expect("create existing target dir");
        fs::write(existing_dest_folder.join("existing_file.txt"), b"do not overwrite me").expect("write existing marker file");

        let extract_request = StartExtractRequest {
            archive_path: expected_auto_renamed_archive.to_string_lossy().to_string(),
            destination_path: existing_dest_folder.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Rename,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };

        let extract_job = start_extract_internal(extract_request, &registry).expect("folder tree extract should start");
        let (extract_poll, _) = wait_for_job_terminal(&registry, &extract_job.job_id);

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(existing_dest_folder.join("existing_file.txt")).expect("existing file in target dir must be untouched"), b"do not overwrite me");
        assert!(expected_renamed_dest_folder.is_dir(), "my_project 2 directory should be created");
        assert_eq!(
            fs::read_to_string(expected_renamed_dest_folder.join("my_project").join("src").join("main.rs")).expect("nested main.rs should be extracted"),
            "fn main() {}"
        );
        assert_eq!(
            fs::read_to_string(expected_renamed_dest_folder.join("my_project").join("docs").join("readme.md")).expect("nested readme.md should be extracted"),
            "# My Project"
        );

        let _ = fs::remove_dir_all(&workspace);
    }

    fn assert_create_format_auto_renames(format: crate::dto::ArchiveFormatDto, initial_name: &str, expected_name: &str) {
        let workspace = create_temp_workspace(&format!("create-fmt-test-{}", initial_name.replace('.', "-")));
        fs::create_dir_all(&workspace).expect("workspace dir create");

        let source_dir = workspace.join("src_folder");
        fs::create_dir_all(&source_dir).expect("source dir create");
        fs::write(source_dir.join("file.txt"), b"test content").expect("write file.txt");

        let pre_existing_archive = workspace.join(initial_name);
        let expected_auto_renamed_archive = workspace.join(expected_name);
        fs::write(&pre_existing_archive, b"existing marker").expect("write pre-existing marker");

        let registry = crate::job_registry::JobRegistry::new();
        let create_request = StartCreateRequest {
            sources: vec![source_dir.to_string_lossy().to_string()],
            destination_path: pre_existing_archive.to_string_lossy().to_string(),
            format,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let create_job = start_create_internal(create_request, &registry).unwrap_or_else(|err| panic!("start_create failed for format {format:?}: {err:?}"));
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);

        assert_eq!(create_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(&pre_existing_archive).expect("pre-existing archive must be untouched"), b"existing marker");
        assert!(expected_auto_renamed_archive.is_file(), "{expected_name} should be created automatically");

        let _ = fs::remove_dir_all(&workspace);
    }

    fn assert_extract_format_auto_renames(initial_folder_name: &str, expected_folder_name: &str) {
        let workspace = create_temp_workspace(&format!("extract-fmt-test-{}", initial_folder_name.replace(' ', "-")));
        let sources = workspace.join("src_content");
        let archive_file = workspace.join("test.zip");
        let pre_existing_dest = workspace.join(initial_folder_name);
        let expected_dest = workspace.join(expected_folder_name);

        fs::create_dir_all(&sources).expect("source dir");
        fs::write(sources.join("data.txt"), b"extracted content").expect("write data.txt");
        fs::create_dir_all(&pre_existing_dest).expect("existing dest dir");
        fs::write(pre_existing_dest.join("old.txt"), b"old marker").expect("write old marker");

        let registry = crate::job_registry::JobRegistry::new();
        let create_req = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: archive_file.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let c_job = start_create_internal(create_req, &registry).expect("zip create should start");
        wait_for_job_terminal(&registry, &c_job.job_id);

        let extract_req = StartExtractRequest {
            archive_path: archive_file.to_string_lossy().to_string(),
            destination_path: pre_existing_dest.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Rename,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let e_job = start_extract_internal(extract_req, &registry).expect("extract should start");
        let (e_poll, _) = wait_for_job_terminal(&registry, &e_job.job_id);

        assert_eq!(e_poll.status, JobStatusDto::Completed);
        assert_eq!(fs::read(pre_existing_dest.join("old.txt")).expect("old marker should stay"), b"old marker");
        assert!(expected_dest.is_dir(), "{expected_folder_name} should be created");

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_collision_auto_rename_create_zip() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::Zip, "archive.zip", "archive 2.zip");
    }

    #[test]
    fn test_collision_auto_rename_create_seven_z() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::SevenZ, "archive.7z", "archive 2.7z");
    }

    #[test]
    fn test_collision_auto_rename_create_tzap() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::Tzap, "archive.tzap", "archive 2.tzap");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_collision_auto_rename_create_apple_archive() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::AppleArchive, "archive.aar", "archive 2.aar");
    }

    #[test]
    fn test_collision_auto_rename_create_tar_gz() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::TarGz, "archive.tar.gz", "archive 2.tar.gz");
    }

    #[test]
    fn test_collision_auto_rename_create_tar_zst() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::TarZst, "archive.tar.zst", "archive 2.tar.zst");
    }

    #[test]
    fn test_collision_auto_rename_extract_zip_destination() {
        assert_extract_format_auto_renames("my_dest", "my_dest 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_seven_z_destination() {
        assert_extract_format_auto_renames("output_7z", "output_7z 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_tzap_destination() {
        assert_extract_format_auto_renames("output_tzap", "output_tzap 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_apple_archive_destination() {
        assert_extract_format_auto_renames("output_aar", "output_aar 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_tar_gz_destination() {
        assert_extract_format_auto_renames("output_targz", "output_targz 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_tar_zst_destination() {
        assert_extract_format_auto_renames("output_tarzst", "output_tarzst 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_iso_destination() {
        assert_extract_format_auto_renames("output_iso", "output_iso 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_deb_destination() {
        assert_extract_format_auto_renames("output_deb", "output_deb 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_rpm_destination() {
        assert_extract_format_auto_renames("output_rpm", "output_rpm 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_dmg_destination() {
        assert_extract_format_auto_renames("output_dmg", "output_dmg 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_cab_destination() {
        assert_extract_format_auto_renames("output_cab", "output_cab 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_wim_destination() {
        assert_extract_format_auto_renames("output_wim", "output_wim 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_rar_destination() {
        assert_extract_format_auto_renames("output_rar", "output_rar 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_tar_bz2_destination() {
        assert_extract_format_auto_renames("output_tarbz2", "output_tarbz2 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_tar_xz_destination() {
        assert_extract_format_auto_renames("output_tarxz", "output_tarxz 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_tar_lz4_destination() {
        assert_extract_format_auto_renames("output_tarlz4", "output_tarlz4 2");
    }

    #[test]
    fn test_collision_auto_rename_extract_7z_split_destination() {
        assert_extract_format_auto_renames("output_7zsplit", "output_7zsplit 2");
    }

    #[test]
    fn test_collision_auto_rename_create_sequential_increment_zip() {
        let workspace = create_temp_workspace("seq-inc-zip");
        fs::create_dir_all(&workspace).expect("workspace dir");
        let src = workspace.join("src");
        fs::create_dir_all(&src).expect("src dir");
        fs::write(src.join("a.txt"), b"seq data").expect("write a.txt");

        fs::write(workspace.join("seq.zip"), b"1").expect("write seq.zip");
        fs::write(workspace.join("seq 2.zip"), b"2").expect("write seq 2.zip");
        fs::write(workspace.join("seq 3.zip"), b"3").expect("write seq 3.zip");

        let registry = crate::job_registry::JobRegistry::new();
        let create_req = StartCreateRequest {
            sources: vec![src.to_string_lossy().to_string()],
            destination_path: workspace.join("seq.zip").to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let job = start_create_internal(create_req, &registry).expect("job start");
        let (poll, _) = wait_for_job_terminal(&registry, &job.job_id);

        assert_eq!(poll.status, JobStatusDto::Completed);
        assert!(workspace.join("seq 4.zip").is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_collision_auto_rename_create_sequential_increment_seven_z() {
        let workspace = create_temp_workspace("seq-inc-7z");
        fs::create_dir_all(&workspace).expect("workspace dir");
        let src = workspace.join("src");
        fs::create_dir_all(&src).expect("src dir");
        fs::write(src.join("a.txt"), b"seq data").expect("write a.txt");

        fs::write(workspace.join("seq.7z"), b"1").expect("write seq.7z");
        fs::write(workspace.join("seq 2.7z"), b"2").expect("write seq 2.7z");

        let registry = crate::job_registry::JobRegistry::new();
        let create_req = StartCreateRequest {
            sources: vec![src.to_string_lossy().to_string()],
            destination_path: workspace.join("seq.7z").to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::SevenZ,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let job = start_create_internal(create_req, &registry).expect("job start");
        let (poll, _) = wait_for_job_terminal(&registry, &job.job_id);

        assert_eq!(poll.status, JobStatusDto::Completed);
        assert!(workspace.join("seq 3.7z").is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_collision_auto_rename_create_sequential_increment_tzap() {
        let workspace = create_temp_workspace("seq-inc-tzap");
        fs::create_dir_all(&workspace).expect("workspace dir");
        let src = workspace.join("src");
        fs::create_dir_all(&src).expect("src dir");
        fs::write(src.join("a.txt"), b"seq data").expect("write a.txt");

        fs::write(workspace.join("seq.tzap"), b"1").expect("write seq.tzap");
        fs::write(workspace.join("seq 2.tzap"), b"2").expect("write seq 2.tzap");

        let registry = crate::job_registry::JobRegistry::new();
        let create_req = StartCreateRequest {
            sources: vec![src.to_string_lossy().to_string()],
            destination_path: workspace.join("seq.tzap").to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Rename,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let job = start_create_internal(create_req, &registry).expect("job start");
        let (poll, _) = wait_for_job_terminal(&registry, &job.job_id);

        assert_eq!(poll.status, JobStatusDto::Completed);
        assert!(workspace.join("seq 3.tzap").is_file());
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_collision_auto_rename_extract_sequential_increment_folder() {
        assert_extract_format_auto_renames("seq_out 2", "seq_out 2 2");
    }

    #[test]
    fn test_collision_auto_rename_create_with_dots_in_filename() {
        assert_create_format_auto_renames(crate::dto::ArchiveFormatDto::Zip, "my.app.v1.0.zip", "my.app.v1.0 2.zip");
    }

    #[test]
    fn test_collision_auto_rename_create_replace_existing_overwrites() {
        let workspace = create_temp_workspace("create-replace-overwrite");
        let src = workspace.join("src");
        let dest = workspace.join("target.zip");

        fs::create_dir_all(&src).expect("src dir");
        fs::write(src.join("new.txt"), b"new").expect("write new");
        fs::write(&dest, b"old content").expect("write old content");

        let registry = crate::job_registry::JobRegistry::new();
        let req = StartCreateRequest {
            sources: vec![src.to_string_lossy().to_string()],
            destination_path: dest.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let job = start_create_internal(req, &registry).expect("start create");
        let (poll, _) = wait_for_job_terminal(&registry, &job.job_id);

        assert_eq!(poll.status, JobStatusDto::Completed);
        assert_ne!(fs::read(&dest).expect("dest read"), b"old content", "replace_existing: true should overwrite existing destination file");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_collision_auto_rename_extract_replace_overwrites_existing() {
        let workspace = create_temp_workspace("extract-replace-overwrite");
        let src = workspace.join("src");
        let archive = workspace.join("data.zip");
        let dest = workspace.join("extract_target");

        fs::create_dir_all(&src).expect("src dir");
        fs::write(src.join("data.txt"), b"new extracted content").expect("write data.txt");
        fs::create_dir_all(&dest).expect("dest dir");

        let registry = crate::job_registry::JobRegistry::new();
        let c_req = StartCreateRequest {
            sources: vec![src.to_string_lossy().to_string()],
            destination_path: archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let c_job = start_create_internal(c_req, &registry).expect("c_job");
        wait_for_job_terminal(&registry, &c_job.job_id);

        let e_req = StartExtractRequest {
            archive_path: archive.to_string_lossy().to_string(),
            destination_path: dest.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Replace,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let e_job = start_extract_internal(e_req, &registry).expect("e_job");
        let (e_poll, _) = wait_for_job_terminal(&registry, &e_job.job_id);

        assert_eq!(e_poll.status, JobStatusDto::Completed);
        assert!(!workspace.join("extract_target 2").exists(), "no auto-renamed 2-folder created on replace");
        assert_eq!(fs::read_to_string(dest.join("src").join("data.txt")).expect("read data.txt"), "new extracted content");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_extract_job_reaches_terminal_and_outputs_expected_file() {
        let workspace = create_temp_workspace("start-extract");
        let sources = workspace.join("sources");
        let destination_archive = workspace.join("fixture.zip");
        let extract_destination = workspace.join("extracted");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::create_dir_all(&extract_destination).expect("extract directory should exist");

        fs::write(sources.join("README.md"), b"# extractor").expect("fixture file should write");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("fixture create should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let extract_request = StartExtractRequest {
            archive_path: destination_archive.to_string_lossy().to_string(),
            destination_path: extract_destination.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Replace,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let extract_job = start_extract_internal(extract_request, &registry).expect("extract command should start a job");
        let (extract_poll, mut extract_events) = wait_for_job_terminal(&registry, &extract_job.job_id);
        extract_events.extend_from_slice(&extract_poll.events);

        let extracted_file = extract_destination.join("sources").join("README.md");

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(extract_poll.kind, JobKindDto::ZipExtract);
        assert!(extract_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)), "extract lifecycle should emit a completed event",);
        assert!(extracted_file.is_file());
        assert_eq!(fs::read_to_string(&extracted_file).expect("extracted file should be readable"), "# extractor");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_extract_selected_entries_uses_job_lifecycle() {
        let workspace = create_temp_workspace("start-extract-selected");
        let sources = workspace.join("sources");
        let destination_archive = workspace.join("fixture.zip");
        let extract_destination = workspace.join("selected");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::create_dir_all(&extract_destination).expect("extract directory should exist");

        fs::write(sources.join("keep.txt"), b"keep me").expect("selected fixture should write");
        fs::write(sources.join("skip.txt"), b"skip me").expect("unselected fixture should write");

        let registry = crate::job_registry::JobRegistry::new();
        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("fixture create should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let extract_request = StartExtractRequest {
            archive_path: destination_archive.to_string_lossy().to_string(),
            destination_path: extract_destination.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Replace,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            entry_paths: Some(vec!["sources/keep.txt".to_string()]),
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let extract_job = start_extract_internal(extract_request, &registry).expect("selected extract command should start a job");
        let (extract_poll, mut extract_events) = wait_for_job_terminal(&registry, &extract_job.job_id);
        extract_events.extend_from_slice(&extract_poll.events);

        let extracted_file = extract_destination.join("sources").join("keep.txt");
        let skipped_file = extract_destination.join("sources").join("skip.txt");

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        assert_eq!(extract_poll.kind, JobKindDto::ZipExtract);
        let finished_event = extract_events
            .iter()
            .find(|event| matches!(event.event_type, JobEventKindDto::EntryFinished))
            .expect("selected extract should retain the latest finished entry for file counts");
        assert_eq!(finished_event.entries, Some(1));
        assert_eq!(finished_event.total_entries, Some(1));
        assert!(
            extract_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)),
            "selected extract lifecycle should emit a completed event",
        );
        assert!(
            extract_poll.terminal_summary.as_ref().is_some_and(|summary| summary.written_entries == 1),
            "selected extract should include a one-entry terminal summary",
        );
        assert!(extracted_file.is_file());
        assert!(!skipped_file.exists());
        assert_eq!(fs::read_to_string(&extracted_file).expect("selected file should be readable"), "keep me");
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_rejects_directory_destination_path() {
        let workspace = create_temp_workspace("start-create-directory-destination");
        let sources = workspace.join("sources");
        let destination = workspace.join("destination-folder");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::create_dir_all(&destination).expect("destination directory should exist");
        fs::write(sources.join("hello.txt"), b"hello from create").expect("fixture file should write");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let error = start_create_internal(create_request, &registry).expect_err("directory destination should fail");
        assert_eq!(error.code, crate::constants::COMMAND_ERROR_INVALID_REQUEST);
        assert!(error.message.contains("file path"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_start_create_rejects_missing_source() {
        let workspace = create_temp_workspace("start-create-missing-source");
        let missing_source = workspace.join("does-not-exist");
        let destination = workspace.join("created.tzap");
        let registry = crate::job_registry::JobRegistry::new();

        let create_request = StartCreateRequest {
            sources: vec![missing_source.to_string_lossy().to_string()],
            destination_path: destination.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };

        let error = start_create_internal(create_request, &registry).expect_err("missing source should fail");
        assert_eq!(error.code, crate::constants::COMMAND_ERROR_NOT_FOUND);
        assert!(error.message.contains("source path does not exist"));
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn selected_extract_reports_cancelled_without_completed_event_when_token_is_cancelled() {
        let registry = crate::job_registry::JobRegistry::new();
        let (response, token) = registry.create_job(JobKindDto::ZipExtract);
        registry.request_cancel(&response.job_id).expect("cancel should target the selected extract job");
        assert!(token.is_cancelled(), "registry cancellation should mark the selected extract token");

        let mut sink = JobEventCollector::new(&registry, response.job_id.clone());
        let summary = run_selected_extract_job(
            "unused.zip",
            "unused-destination",
            &["sources/keep.txt".to_string()],
            None,
            extraction_policy(OverwritePolicyDto::Replace, 0, false),
            TzapRestoreOptions::default(),
            &token,
            &mut sink,
            JobKindDto::ZipExtract,
        )
        .expect("pre-cancelled selected extract should finish with a terminal summary");

        let poll = registry.take_test_events(&response.job_id).expect("cancelled selected extract job should be pollable");

        assert_eq!(poll.status, JobStatusDto::Cancelled);
        assert_eq!(summary.written_entries, 0);
        assert_eq!(summary.written_bytes, 0);
        assert!(poll.events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Cancelled)), "selected extract should emit a cancelled event",);
        assert!(!poll.events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)), "cancelled selected extract must not emit completed",);
    }

    #[test]
    fn command_boundary_test_archive_job_reaches_terminal_for_valid_zip() {
        let workspace = create_temp_workspace("test-archive-valid");
        let sources = workspace.join("sources");
        let destination_archive = workspace.join("fixture.zip");
        fs::create_dir_all(&sources).expect("source directory should exist");
        fs::write(sources.join("hello.txt"), b"hello from test").expect("fixture file should write");

        let registry = crate::job_registry::JobRegistry::new();
        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Zip,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: true,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("fixture create should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let test_job = start_test_archive_internal(
            TestArchiveRequest { archive_path: destination_archive.to_string_lossy().to_string(), entry_paths: None, password: None },
            &registry,
        )
        .expect("test archive command should start a job");
        let (test_poll, mut test_events) = wait_for_job_terminal(&registry, &test_job.job_id);
        test_events.extend_from_slice(&test_poll.events);

        assert_eq!(test_poll.status, JobStatusDto::Completed);
        assert_eq!(test_poll.kind, JobKindDto::TestArchive);
        assert!(test_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Started)), "test lifecycle should emit a started event",);
        assert!(test_events.iter().any(|event| matches!(event.event_type, JobEventKindDto::Completed)), "test lifecycle should emit a completed event",);
        assert!(test_poll.terminal_summary.as_ref().is_some_and(|summary| summary.written_entries > 0), "successful test should include a terminal summary",);

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn command_boundary_test_archive_job_reports_failed_for_corrupt_zip() {
        let workspace = create_temp_workspace("test-archive-corrupt");
        let archive_path = workspace.join("corrupt.zip");
        fs::write(&archive_path, b"this is not a valid zip archive").expect("corrupt archive fixture should write");

        let registry = crate::job_registry::JobRegistry::new();
        let test_job = start_test_archive_internal(
            TestArchiveRequest { archive_path: archive_path.to_string_lossy().to_string(), entry_paths: None, password: None },
            &registry,
        )
        .expect("test archive command should start a job");
        let (test_poll, mut test_events) = wait_for_job_terminal(&registry, &test_job.job_id);
        test_events.extend_from_slice(&test_poll.events);

        assert_eq!(test_poll.status, JobStatusDto::Failed);
        assert_eq!(test_poll.kind, JobKindDto::TestArchive);
        assert!(test_poll.terminal_summary.is_none());
        assert!(
            test_events
                .iter()
                .any(|event| { matches!(event.event_type, JobEventKindDto::Failed) && event.message.as_ref().is_some_and(|message| !message.is_empty()) }),
            "failed test should emit a failure event with a message",
        );

        let _ = fs::remove_dir_all(&workspace);
    }

    #[cfg(unix)]
    #[test]
    fn list_archive_inaccessible_source_maps_to_io_error() {
        let workspace = create_temp_workspace("permission-denied");
        let archive_path = workspace.join("locked.zip");
        fs::write(&archive_path, b"not a real archive").expect("fixture should be written");

        let mut permissions = fs::metadata(&archive_path).expect("fixture metadata should be readable").permissions();
        permissions.set_mode(0o000);
        fs::set_permissions(&archive_path, permissions.clone()).expect("permissions should be restricted");

        if fs::File::open(&archive_path).is_ok() {
            permissions.set_mode(0o644);
            let _ = fs::set_permissions(&archive_path, permissions);
            let _ = fs::remove_dir_all(&workspace);
            return;
        }

        let error = list_archive(crate::dto::ListArchiveRequest { archive_path: archive_path.to_string_lossy().to_string(), password: None }).unwrap_err();

        assert_eq!(error.code, constants::COMMAND_ERROR_IO_ERROR);
        assert!(!error.retryable, "permission denied should not be marked retryable",);

        permissions.set_mode(0o644);
        let _ = fs::set_permissions(&archive_path, permissions);
        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn normalize_non_empty_paths_preserves_reserved_names() {
        let normalized =
            normalize_non_empty_paths(&[r"C:\CON\archive.zip".to_string(), r"D:\AUX\report.TAR.ZST".to_string(), r"\\server\\NUL\bundle.tZAP".to_string()])
                .expect("reserved-looking names should parse as paths");

        assert_eq!(normalized[0].to_string_lossy(), r"C:\CON\archive.zip");
        assert_eq!(normalized[1].to_string_lossy(), r"D:\AUX\report.TAR.ZST");
        assert_eq!(normalized[2].to_string_lossy(), r"\\server\\NUL\bundle.tZAP");
    }

    #[cfg(windows)]
    #[test]
    fn windows_case_collision_is_os_case_insensitive() {
        let workspace = create_temp_workspace("case-collision");
        let root = workspace.join("root");
        let lower = root.join("archive.zip");
        let upper = root.join("ARCHIVE.ZIP");

        fs::create_dir_all(&root).expect("case-collision workspace should be created");
        fs::write(&lower, b"lower-path").expect("baseline file should be written");
        let lower_canonical = lower.canonicalize().expect("canonical path should resolve");
        let upper_canonical = upper.canonicalize().expect("case variant should resolve to same file");

        assert_eq!(lower_canonical, upper_canonical);
        let read = fs::read_to_string(&upper).expect("case-variant path should resolve");
        assert_eq!(read, "lower-path");

        let normalized =
            normalize_non_empty_paths(&[lower.to_string_lossy().to_string(), upper.to_string_lossy().to_string()]).expect("case-variant paths should parse");
        assert_eq!(normalized.len(), 2);
        let _ = fs::remove_dir_all(&workspace);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_case_variants_are_distinct_paths() {
        let workspace = create_temp_workspace("case-variance");
        let root = workspace.join("root");
        let lower = root.join("archive.zip");
        let upper = root.join("ARCHIVE.ZIP");

        fs::create_dir_all(&root).expect("case-variant workspace should be created");
        fs::write(&lower, b"lower-path").expect("lowercase baseline file should be written");
        fs::write(&upper, b"upper-path").expect("uppercase path should be separate file on case-sensitive FS");

        assert_ne!(
            lower.canonicalize().expect("lower file path should resolve").to_string_lossy().to_string(),
            upper.canonicalize().expect("upper file path should resolve").to_string_lossy().to_string(),
        );

        assert_eq!(fs::read_to_string(&lower).expect("lowercase file should be readable"), "lower-path");
        assert_eq!(fs::read_to_string(&upper).expect("uppercase file should be readable"), "upper-path");

        let _ = fs::remove_dir_all(&workspace);
    }

    #[cfg(windows)]
    #[test]
    fn windows_long_filename_semantics_remain_stable_for_create() {
        let workspace = create_temp_workspace("long-name");
        let root = workspace.join("root");
        let long_name = format!("{}.zip", "a".repeat(140));
        let long_path = root.join(long_name);

        fs::create_dir_all(&root).expect("long-name workspace should be created");
        fs::write(&long_path, b"ok").expect("long filenames should be writable");

        let normalized = normalize_non_empty_paths(&[long_path.to_string_lossy().to_string()]).expect("long filename should normalize");
        assert_eq!(normalized[0].to_string_lossy(), long_path.to_string_lossy().to_string());
        assert!(fs::metadata(&long_path).is_ok());

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn next_available_destination_path_handles_all_format_types_and_compound_extensions() {
        let workspace = create_temp_workspace("collision-formats");
        fs::create_dir_all(&workspace).expect("workspace directory should exist");

        // Test cases: (file/dir name to pre-create, expected next path suffix)
        let cases = vec![
            ("archive.zip", "archive 2.zip"),
            ("archive.7z", "archive 2.7z"),
            ("archive.tzap", "archive 2.tzap"),
            ("archive.aar", "archive 2.aar"),
            ("archive.aea", "archive 2.aea"),
            ("archive.apk", "archive 2.apk"),
            ("archive.appx", "archive 2.appx"),
            ("archive.br", "archive 2.br"),
            ("archive.bz2", "archive 2.bz2"),
            ("archive.cab", "archive 2.cab"),
            ("archive.cbr", "archive 2.cbr"),
            ("archive.cpio", "archive 2.cpio"),
            ("archive.deb", "archive 2.deb"),
            ("archive.dmg", "archive 2.dmg"),
            ("archive.gz", "archive 2.gz"),
            ("archive.img", "archive 2.img"),
            ("archive.ipa", "archive 2.ipa"),
            ("archive.iso", "archive 2.iso"),
            ("archive.jar", "archive 2.jar"),
            ("archive.lrz", "archive 2.lrz"),
            ("archive.lz", "archive 2.lz"),
            ("archive.lz4", "archive 2.lz4"),
            ("archive.lzma", "archive 2.lzma"),
            ("archive.lzo", "archive 2.lzo"),
            ("archive.rar", "archive 2.rar"),
            ("archive.rpm", "archive 2.rpm"),
            ("archive.tar", "archive 2.tar"),
            ("archive.tbz2", "archive 2.tbz2"),
            ("archive.tgz", "archive 2.tgz"),
            ("archive.txz", "archive 2.txz"),
            ("archive.tzst", "archive 2.tzst"),
            ("archive.war", "archive 2.war"),
            ("archive.wim", "archive 2.wim"),
            ("archive.xar", "archive 2.xar"),
            ("archive.xpi", "archive 2.xpi"),
            ("archive.xz", "archive 2.xz"),
            ("archive.z", "archive 2.z"),
            ("archive.zipx", "archive 2.zipx"),
            ("archive.zst", "archive 2.zst"),
            ("archive.tar.br", "archive 2.tar.br"),
            ("archive.tar.bz2", "archive 2.tar.bz2"),
            ("archive.tar.gz", "archive 2.tar.gz"),
            ("archive.tar.lrz", "archive 2.tar.lrz"),
            ("archive.tar.lz", "archive 2.tar.lz"),
            ("archive.tar.lz4", "archive 2.tar.lz4"),
            ("archive.tar.lzma", "archive 2.tar.lzma"),
            ("archive.tar.lzo", "archive 2.tar.lzo"),
            ("archive.tar.xz", "archive 2.tar.xz"),
            ("archive.tar.z", "archive 2.tar.z"),
            ("archive.tar.zst", "archive 2.tar.zst"),
            ("archive.7z.001", "archive 2.7z.001"),
            ("my_folder", "my_folder 2"),
        ];

        for (name, expected_name) in cases {
            let target = workspace.join(name);
            if name.contains('.') && !name.ends_with("folder") {
                fs::write(&target, b"existing archive").expect("fixture file write");
            } else {
                fs::create_dir_all(&target).expect("fixture dir create");
            }

            let resolved = next_available_destination_path(&target.to_string_lossy());
            let expected_path = workspace.join(expected_name);
            assert_eq!(PathBuf::from(resolved), expected_path, "collision resolution for {name} should equal {expected_name}");
        }

        // Sequential collision check: target, target 2, target 3 -> target 4
        let seq_base = workspace.join("seq.zip");
        fs::write(&seq_base, b"1").expect("write seq.zip");
        fs::write(workspace.join("seq 2.zip"), b"2").expect("write seq 2.zip");
        fs::write(workspace.join("seq 3.zip"), b"3").expect("write seq 3.zip");

        let seq_resolved = next_available_destination_file_path(&seq_base.to_string_lossy());
        assert_eq!(PathBuf::from(seq_resolved), workspace.join("seq 4.zip"));

        // Directory collision with dots in folder names (e.g. version numbers and installer names)
        let dir_cases = vec![
            ("MPC-BE.1.9.1.x64-installer", "MPC-BE.1.9.1.x64-installer 2"),
            ("node-v20.10.0", "node-v20.10.0 2"),
            ("my.backup.folder.tar.gz", "my.backup.folder.tar.gz 2"),
        ];

        for (dir_name, expected_name) in dir_cases {
            let target_dir = workspace.join(dir_name);
            fs::create_dir_all(&target_dir).expect("fixture dir create");
            let resolved = next_available_destination_directory_path(&target_dir.to_string_lossy());
            assert_eq!(PathBuf::from(resolved), workspace.join(expected_name));
        }

        // Sequential directory collision check
        let seq_dir = workspace.join("MPC-BE.1.9.1.x64-installer");
        fs::create_dir_all(workspace.join("MPC-BE.1.9.1.x64-installer 2")).expect("create dir 2");
        let seq_dir_resolved = next_available_destination_directory_path(&seq_dir.to_string_lossy());
        assert_eq!(PathBuf::from(seq_dir_resolved), workspace.join("MPC-BE.1.9.1.x64-installer 3"));

        let _ = fs::remove_dir_all(&workspace);
    }

    #[test]
    fn extract_does_not_rename_destination_folder_when_collision_strategy_is_refuse_even_with_overwrite_rename() {
        let workspace = create_temp_workspace("extract-refuse-collision");
        let sources = workspace.join("sources");
        fs::create_dir_all(&sources).expect("sources workspace should be created");
        fs::write(sources.join("README.md"), b"hello").expect("readme should be created");

        let destination_archive = workspace.join("archive.tzap");
        let registry = JobRegistry::new();
        let create_request = StartCreateRequest {
            sources: vec![sources.to_string_lossy().to_string()],
            destination_path: destination_archive.to_string_lossy().to_string(),
            format: crate::dto::ArchiveFormatDto::Tzap,
            clean_source: false,
            exclude_names: None,
            exclude_archive_paths: None,
            include_archive_paths: None,
            respect_gitignore: false,
            follow_symlinks: false,
            replace_existing: false,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            password: None,
            compression_level: None,
            volume_size: None,
            volume_count: None,
            tzap_recovery_percentage: None,
            tzap_volume_loss_tolerance: None,
            zip_compression: None,
            seven_z_solid: None,
            seven_z_threads: None,
            seven_z_chunk_size: None,
            seven_z_encrypt_file_names: None,
            tzap_certificates: None,
            tzap_bootstrap_sidecar: None,
            preserve_metadata: false,
        };
        let create_job = start_create_internal(create_request, &registry).expect("fixture create should start");
        let (create_poll, _) = wait_for_job_terminal(&registry, &create_job.job_id);
        assert_eq!(create_poll.status, JobStatusDto::Completed);

        let extract_destination = workspace.join("Downloads");
        fs::create_dir_all(&extract_destination).expect("Downloads folder exists");

        let extract_request = StartExtractRequest {
            archive_path: destination_archive.to_string_lossy().to_string(),
            destination_path: extract_destination.to_string_lossy().to_string(),
            password: None,
            recipient_key_id: None,
            overwrite: OverwritePolicyDto::Rename,
            destination_collision_strategy: DestinationCollisionStrategyDto::Refuse,
            entry_paths: None,
            strip_components: 0,
            tzap_restore_policy: TzapRestorePolicyDto::Portable,
            tzap_allow_degraded: false,
            tzap_allow_absolute_symlinks: false,
            ignore_symlinks: false,
        };
        let extract_job = start_extract_internal(extract_request, &registry).expect("extract command should start");
        let (extract_poll, _) = wait_for_job_terminal(&registry, &extract_job.job_id);

        assert_eq!(extract_poll.status, JobStatusDto::Completed);
        // Downloads 2 must NOT exist
        assert!(!workspace.join("Downloads 2").exists(), "Downloads 2 must not be created");
        // Output must be directly inside Downloads
        assert!(extract_destination.join("sources").join("README.md").is_file(), "contents must extract directly into destination folder");
        let _ = fs::remove_dir_all(&workspace);
    }
}
