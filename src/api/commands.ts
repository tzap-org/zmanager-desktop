import { invoke, type Channel } from "@tauri-apps/api/core";

import type {
  AccountHostedAuthLaunchDto,
  AccountHostedAuthAudience,
  AccountBeginHostedAuthRequest,
  AccountContactCardPreviewDto,
  AccountGenerateSigningIdentityRequest,
  AccountImportSigningIdentityRequest,
  AccountInstallSigningCertificateRequest,
  AccountSnapshotDto,
  AccountLifecycleResultDto,
  AccountContactSyncResultDto,
  ArchiveChildrenPageDto,
  ArchiveChildrenRequest,
  ArchiveIndexSessionRequest,
  ArchiveIndexSnapshotDto,
  ArchiveIndexStartResponseDto,
  ArchiveSearchRequest,
  CancelJobRequest,
  CancelJobResponseDto,
  CommandErrorDto,
  CreatePlanResponse,
  DefaultHandlerSnapshotDto,
  DesktopJobSnapshotDto,
  DiagnosticEventRequest,
  DiagnosticLogInfoDto,
  DismissJobRequest,
  HealthcheckResponse,
  JobControlResponseDto,
  JobCatalogEnvelopeDto,
  JobSnapshotEnvelopeDto,
  NativeFileDragRequest,
  NativeFileDragResponse,
  PauseJobRequest,
  PlanCreateRequest,
  PreviewEntryRequest,
  PreviewEntryResponse,
  ProjectContract,
  QuickActionRequestDto,
  QuickActionStartupStateDto,
  ResumeJobRequest,
  StartCreateRequest,
  StartArchiveIndexRequest,
  StartExtractRequest,
  StartJobResponseDto,
  SystemFileIconRequest,
  SystemFileIconResponse,
  TestArchiveRequest,
  ValidateDirectoryRequest,
  ValidateDirectoryResponse,
  VerifyTzapCertificateRequest,
  VerifyTzapCertificateResponse,
  ValidateTzapSigningIdentityRequest,
  AccountCurrentUserDto,
  AccountCompleteHostedAuthRequest,
  AccountRenewCertificateRequest,
  ValidateTzapSigningIdentityResponse,
  DetectArchiveFormatRequest,
  DetectArchiveFormatResponse,
  LocalSendDeviceInfoDto,
  LocalSendDiscoverRequest,
  LocalSendRespondToTransferRequest,
  LocalSendStartReceiverRequest,
  EnqueueShareRequest,
  EnqueueShareResponse,
  ShareRecordSnapshot,
  ShareRegistrySnapshot,
} from "./types";

export async function fetchAccountSnapshot(): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_snapshot");
}

export async function beginAccountHostedAuth(
  environment: string = "prod",
  audience: AccountHostedAuthAudience = "sign.tzap.org",
): Promise<AccountHostedAuthLaunchDto> {
  const request: AccountBeginHostedAuthRequest = { environment, audience };
  return invoke<AccountHostedAuthLaunchDto>("account_begin_hosted_auth", { request });
}

export async function applyAccountHostedCallback(request: {
  state: string;
  result: "completed" | "cancelled" | "failed";
  errorCode?: string | null;
}): Promise<void> {
  return invoke<void>("account_apply_hosted_callback", { request });
}

export async function forgetAccount(): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_forget");
}

export async function completeAccountHostedAuth(request: AccountCompleteHostedAuthRequest): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_complete_hosted_auth", { request });
}

export async function fetchAccountCurrentUser(): Promise<AccountCurrentUserDto> {
  return invoke<AccountCurrentUserDto>("account_fetch_current_user");
}

export async function generateAccountRecipientKey(label?: string): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_generate_recipient_key", {
    request: { label },
  });
}

export async function generateAccountSigningIdentity(
  request: AccountGenerateSigningIdentityRequest,
): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_generate_signing_identity", {
    request,
  });
}

export async function importAccountSigningIdentity(
  request: AccountImportSigningIdentityRequest,
): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_import_signing_identity", { request });
}

export async function installAccountSigningCertificate(
  request: AccountInstallSigningCertificateRequest,
): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_install_signing_certificate", { request });
}

export async function removeAccountRecipientKey(id: string): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_remove_recipient_key", { request: { id } });
}

export async function removeAccountSigningIdentity(id: string): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_remove_signing_identity", { request: { id } });
}

export async function setDefaultAccountSigningIdentity(id: string): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_set_default_signing_identity", { request: { id } });
}

export async function removeAccountContact(id: string): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_remove_contact", { request: { id } });
}

export async function inspectAccountContactCard(
  contactCard: Record<string, unknown>,
): Promise<AccountContactCardPreviewDto> {
  return invoke<AccountContactCardPreviewDto>("account_inspect_contact_card", {
    request: { contactCard },
  });
}

export async function acceptAccountContactCard(
  contactCard: Record<string, unknown>,
): Promise<AccountSnapshotDto> {
  return invoke<AccountSnapshotDto>("account_accept_contact_card", {
    request: { contactCard },
  });
}

export async function syncAccountContacts(): Promise<AccountContactSyncResultDto> {
  return invoke<AccountContactSyncResultDto>("account_sync_contacts");
}

export async function enrollAccountCertificate(): Promise<AccountLifecycleResultDto> {
  return invoke<AccountLifecycleResultDto>("account_enroll_certificate");
}

export async function renewAccountCertificate(certificateId: string): Promise<AccountLifecycleResultDto> {
  const request: AccountRenewCertificateRequest = { certificateId };
  return invoke<AccountLifecycleResultDto>("account_renew_certificate", { request });
}

export async function fetchHealthcheck(): Promise<HealthcheckResponse> {
  return invoke<HealthcheckResponse>("healthcheck");
}

export async function fetchProjectContract(): Promise<ProjectContract> {
  return invoke<ProjectContract>("project_contract");
}

export async function fetchSystemFileIcons(
  request: SystemFileIconRequest,
): Promise<SystemFileIconResponse> {
  return invoke<SystemFileIconResponse>("system_file_icons", {
    request,
  });
}

export async function fetchDefaultHandlerStatus(): Promise<DefaultHandlerSnapshotDto> {
  return invoke<DefaultHandlerSnapshotDto>("default_handler_status");
}

export async function setDefaultHandlers(): Promise<DefaultHandlerSnapshotDto> {
  return invoke<DefaultHandlerSnapshotDto>("default_handler_set");
}

export async function restoreDefaultHandlers(): Promise<DefaultHandlerSnapshotDto> {
  return invoke<DefaultHandlerSnapshotDto>("default_handler_restore");
}

export async function validateDirectory(
  request: ValidateDirectoryRequest,
): Promise<ValidateDirectoryResponse> {
  return invoke<ValidateDirectoryResponse>("validate_directory", {
    request,
  });
}

export async function recordDiagnosticEvent(request: DiagnosticEventRequest): Promise<void> {
  return invoke<void>("record_diagnostic_event", { request });
}

export async function fetchDiagnosticLogInfo(): Promise<DiagnosticLogInfoDto> {
  return invoke<DiagnosticLogInfoDto>("diagnostic_log_info");
}

export async function fetchQuickActionStartupState(): Promise<QuickActionStartupStateDto> {
  return invoke<QuickActionStartupStateDto>("quick_action_startup_state");
}

export async function nativeFrontendReady(windowLabel: string): Promise<number> {
  return invoke<number>("native_frontend_ready", { windowLabel });
}

export async function acknowledgeNativeEvent(
  windowLabel: string,
  eventId: string,
): Promise<void> {
  return invoke<void>("acknowledge_native_event", { windowLabel, eventId });
}

export async function startArchiveIndex(
  request: StartArchiveIndexRequest,
): Promise<ArchiveIndexStartResponseDto> {
  return invoke<ArchiveIndexStartResponseDto>("start_archive_index", { request });
}

export async function waitArchiveIndex(
  request: ArchiveIndexSessionRequest,
): Promise<ArchiveIndexSnapshotDto> {
  return invoke<ArchiveIndexSnapshotDto>("wait_archive_index", { request });
}

export async function getArchiveChildren(
  request: ArchiveChildrenRequest,
): Promise<ArchiveChildrenPageDto> {
  return invoke<ArchiveChildrenPageDto>("get_archive_children", { request });
}

export async function searchArchiveIndex(
  request: ArchiveSearchRequest,
): Promise<ArchiveChildrenPageDto> {
  return invoke<ArchiveChildrenPageDto>("search_archive_index", { request });
}

export async function closeArchiveIndex(request: ArchiveIndexSessionRequest): Promise<void> {
  return invoke<void>("close_archive_index", { request });
}

export async function detectArchiveFormat(
  request: DetectArchiveFormatRequest,
): Promise<DetectArchiveFormatResponse> {
  return invoke<DetectArchiveFormatResponse>("detect_archive_format", { request });
}

export async function runPlanCreate(request: PlanCreateRequest): Promise<CreatePlanResponse> {
  return invoke<CreatePlanResponse>("plan_create", {
    request,
  });
}

export async function runStartCreate(request: StartCreateRequest): Promise<StartJobResponseDto> {
  return invoke<StartJobResponseDto>("start_create", {
    request,
  });
}

export async function runStartExtract(request: StartExtractRequest): Promise<StartJobResponseDto> {
  return invoke<StartJobResponseDto>("start_extract", {
    request,
  });
}

export async function verifyTzapCertificate(
  request: VerifyTzapCertificateRequest,
): Promise<VerifyTzapCertificateResponse> {
  return invoke<VerifyTzapCertificateResponse>("verify_tzap_certificate", { request });
}

export async function validateTzapSigningIdentity(
  request: ValidateTzapSigningIdentityRequest,
): Promise<ValidateTzapSigningIdentityResponse> {
  return invoke<ValidateTzapSigningIdentityResponse>("validate_tzap_signing_identity", { request });
}

export async function runPreviewEntry(request: PreviewEntryRequest): Promise<PreviewEntryResponse> {
  return invoke<PreviewEntryResponse>("preview_entry", {
    request,
  });
}

export async function runStartNativeFileDrag(
  request: NativeFileDragRequest,
): Promise<NativeFileDragResponse> {
  return invoke<NativeFileDragResponse>("start_native_file_drag", {
    request,
  });
}

export async function cleanupPreviewRoots(): Promise<void> {
  return invoke<void>("cleanup_preview_roots");
}

export async function runTestArchive(request: TestArchiveRequest): Promise<StartJobResponseDto> {
  return invoke<StartJobResponseDto>("test_archive", {
    request,
  });
}

export function subscribeJob(request: { jobId: string }, onSnapshot: Channel<JobSnapshotEnvelopeDto>): Promise<string> {
  return invoke<string>("subscribe_job", { request, onSnapshot });
}
export function getJobSnapshot(request: { jobId: string }): Promise<DesktopJobSnapshotDto> {
  return invoke<DesktopJobSnapshotDto>("get_job_snapshot", { request });
}
export function subscribeJobCatalog(onSnapshot: Channel<JobCatalogEnvelopeDto>): Promise<string> {
  return invoke<string>("subscribe_job_catalog", { onSnapshot });
}
export function ackSubscription(request: { subscriptionId: string; revision: string }): Promise<void> {
  return invoke<void>("ack_subscription", { request });
}
export function unsubscribeJob(request: { subscriptionId: string }): Promise<void> {
  return invoke<void>("unsubscribe_job", { request });
}

export async function cancelJob(request: CancelJobRequest): Promise<CancelJobResponseDto> {
  return invoke<CancelJobResponseDto>("cancel_job", {
    request,
  });
}

export async function pauseJob(request: PauseJobRequest): Promise<JobControlResponseDto> {
  return invoke<JobControlResponseDto>("pause_job", {
    request,
  });
}

export async function resumeJob(request: ResumeJobRequest): Promise<JobControlResponseDto> {
  return invoke<JobControlResponseDto>("resume_job", {
    request,
  });
}

export async function dismissJob(request: DismissJobRequest): Promise<void> {
  return invoke<void>("dismiss_job", {
    request,
  });
}

export async function runLocalSendDiscover(request: LocalSendDiscoverRequest): Promise<LocalSendDeviceInfoDto[]> {
  return invoke<LocalSendDeviceInfoDto[]>("localsend_discover", { request });
}

export async function enqueueShare(request: EnqueueShareRequest): Promise<EnqueueShareResponse> {
  return invoke<EnqueueShareResponse>("enqueue_share", { request });
}

export async function setShareReceiver(request: { shareId: string; receiver: LocalSendDeviceInfoDto }): Promise<ShareRecordSnapshot> {
  return invoke<ShareRecordSnapshot>("set_share_receiver", { request });
}

export async function startShare(request: { shareId: string; acknowledgeDeliveryUncertainty?: boolean }): Promise<ShareRecordSnapshot> {
  return invoke<ShareRecordSnapshot>("start_share", { request });
}

export async function getShareQueue(): Promise<ShareRegistrySnapshot> {
  return invoke<ShareRegistrySnapshot>("get_share_queue");
}

export async function skipShare(request: { shareId: string }): Promise<ShareRecordSnapshot> {
  return invoke<ShareRecordSnapshot>("skip_share", { request });
}

export async function cancelShare(request: { shareId: string }): Promise<ShareRecordSnapshot> {
  return invoke<ShareRecordSnapshot>("cancel_share", { request });
}

export async function removeShare(request: { shareId: string }): Promise<void> {
  return invoke<void>("remove_share", { request });
}

export async function runLocalSendRespondToTransfer(request: LocalSendRespondToTransferRequest): Promise<void> {
  return invoke<void>("localsend_respond_to_transfer", { request });
}

export async function runLocalSendStartReceiver(request: LocalSendStartReceiverRequest): Promise<void> {
  return invoke<void>("localsend_start_receiver", { request });
}

export async function runLocalSendStopReceiver(): Promise<void> {
  return invoke<void>("localsend_stop_receiver");
}

export async function runLocalSendListTrustedDevices(): Promise<string[]> {
  return invoke<string[]>("localsend_list_trusted_devices");
}

export async function runLocalSendTrustDevice(fingerprint: string): Promise<void> {
  return invoke<void>("localsend_trust_device", { fingerprint });
}

export async function runLocalSendUntrustDevice(fingerprint: string): Promise<void> {
  return invoke<void>("localsend_untrust_device", { fingerprint });
}

export function asCommandError(value: unknown): CommandErrorDto | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<CommandErrorDto>;
  if (typeof candidate.code !== "string" || typeof candidate.message !== "string") {
    return null;
  }

  return {
    code: candidate.code,
    message: candidate.message,
    hint: candidate.hint,
    severity: candidate.severity ?? "error",
    retryable: Boolean(candidate.retryable),
  };
}
