import type { GeneratedShellActionKind } from "./generated/shellActions.generated";
import type {
  NativeCapabilitySnapshot,
  NativePackageKind,
} from "./generated/nativeCapabilities.generated";

export type HealthcheckResponse = {
  engine: string;
  version: string;
  ready: boolean;
  summary: string;
  shell: string;
  status: string;
  appVersion: string;
  buildId: string;
};

export type ProjectContract = {
  commands: string[];
  platformStrategy: string;
  coreDependency: string;
  platformIntegration: {
    platform: string;
    packageKind: NativePackageKind;
    capabilities: NativeCapabilitySnapshot[];

  };
  sourceTableCapabilities: {
    availableColumnIds: string[];
  };
  /** Optional for backward compatibility with existing test fixtures; always present on the real Rust response. */
  localSendAvailable?: boolean;
};

export type SystemFileIconRequestEntry = {
  key: string;
  path: string;
  isDirectory: boolean;
};

export type SystemFileIconRequest = {
  entries: SystemFileIconRequestEntry[];
};

export type SystemFileIconDto = {
  key: string;
  dataUrl?: string | null;
};

export type SystemFileIconResponse = {
  icons: SystemFileIconDto[];
};

export type ValidateDirectoryRequest = {
  path: string;
};

export type ValidateDirectoryResponse = {
  exists: boolean;
  isDirectory: boolean;
  accessible: boolean;
};

export type QuickActionKind = GeneratedShellActionKind;

export type QuickActionRequestDto = {
  kind: QuickActionKind;
  paths: string[];
};

export type QuickActionStartupErrorDto = {
  code: string;
  message: string;
  hint?: string | null;
};

export type QuickActionStartupStateDto = {
  launchedForQuickAction: boolean;
  windowDisposition?: "mainWindow" | "disposableTask" | null;
  error?: QuickActionStartupErrorDto | null;
};

export type DiagnosticEventRequest = {
  scope: string;
  name: string;
  fields: Record<string, string | number | boolean | null>;
};

export type DiagnosticLogInfoDto = {
  enabled: boolean;
  path: string | null;
  sessionId: string;
  location: string;
};

export type AccountCertificateDto = {
  identityId: string;
  certificateId: string;
  certificateSha256: string;
  label?: string | null;
  identityType: "hosted" | "offline" | string;
  state: string;
  assuranceLevel: string;
  notAfterUnixSeconds: number;
  renewalRecommended: boolean;
};

export type AccountRecipientKeyDto = {
  keyId: string;
  algorithm: string;
  publicKeyFingerprint: string;
  createdAtUnixSeconds: number;
  label?: string | null;
  lifecycle: "active" | "retired" | "deletion_pending" | string;
};

export type AccountContactDto = {
  contactId: string;
  displayName: string;
  publicSignerId?: string | null;
  signingCertificateSha256: string;
  recipientPublicKeyFingerprint: string;
  verificationState: string;
  missingStatusCaveat: boolean;
  phoneSourced?: boolean;
};

export type AccountSnapshotDto = {
  authStatus: "signedOut" | "pending" | "launchOnlyCallbackCompleted" | "signedIn" | "cancelled" | "failed" | string;
  pendingState?: string | null;
  defaultSigningIdentityId: string | null;
  capabilities: {
    auth: "unavailable" | "launch_only" | "handoff_exchange" | string;
    enrollment: "unavailable" | "available" | "approval_required" | string;
    status: "offline_cache_only" | "online" | string;
    accountManagement: "external_browser" | string;
  };
  certificates: AccountCertificateDto[];
  recipientKeys: AccountRecipientKeyDto[];
  contacts: AccountContactDto[];
  displayName: string | null;
  publicSignerId: string | null;
  assuranceLevel: string | null;
  sessionExpiresAtUnixSeconds: number | null;
};

export type AccountLifecycleResultDto = {
  snapshot: AccountSnapshotDto;
  outcome: "complete" | "approval_required" | "device_linkage_pending" | "device_linkage_conflict" | "incomplete" | string;
  attemptedDeviceIds: string[];
  incompleteReasons: string[];
};

export type AccountContactSyncResultDto = {
  snapshot: AccountSnapshotDto;
  lastSuccessfulSyncAt: number;
  counts: {
    imported: number;
    updated: number;
    removed: number;
    rejected: number;
    rejectedReasons: string[];
    statusRefreshFailed: number;
  };
};

export type AccountCompleteHostedAuthRequest = {
  state: string;
  handoffCode: string;
  callbackUrl?: string;
};

export type AccountHostedAuthAudience = "sign.tzap.org" | "login.tzap.org";

export type AccountBeginHostedAuthRequest = {
  environment?: string;
  audience?: AccountHostedAuthAudience;
};

export type AccountRenewCertificateRequest = {
  certificateId: string;
};

export type AccountCurrentUserDto = {
  displayName: string;
  publicSignerId?: string | null;
  assuranceLevel: string | null;
  selectedOrgId?: string | null;
};

export type AccountGenerateSigningIdentityRequest = {
  commonName: string;
  label?: string;
};

export type AccountImportSigningIdentityRequest = {
  identityPath: string;
  password?: string;
  label?: string;
};

export type AccountInstallSigningCertificateRequest = {
  identityId: string;
  certificateId: string;
  certificateChainDer: number[][];
  issuerCertificateSha256: string;
  issuerKeyIdentifier: string;
  serialNumber: string;
  notBeforeUnixSeconds: number;
  notAfterUnixSeconds: number;
  publicSignerId?: string | null;
  publicOrgId?: string | null;
  publicDeviceId?: string | null;
  assuranceLevel?: string | null;
  signDeviceId?: string | null;
};

export type AccountHostedAuthLaunchDto = {
  launchUrl: string;
  state: string;
  expiresAtUnixSeconds: number;
};

export type AccountContactCardPreviewDto = {
  displayName: string;
  signingCertificateSha256: string;
  recipientPublicKeyFingerprint: string;
  trustSource: string;
  verificationState: string;
  missingStatusCaveat: boolean;
};

export type CommandErrorDto = {
  code: string;
  message: string;
  hint?: string | null;
  severity: "info" | "warning" | "error";
  retryable: boolean;
};

export type ArchiveEntryKind = "file" | "directory" | "symlink" | "hardlink" | "special";

export type ArchiveEntryDto = {
  path: string;
  kind: ArchiveEntryKind;
  size?: number;
  compressedSize?: number;
  modified?: string;
  mode?: number;
  metadataDiagnostics?: string[];
  created?: string;
  accessed?: string;
  attributes?: string;
  encrypted?: boolean;
  method?: string;
  crc?: string;
  comment?: string;
  solid?: boolean;
  linkTarget?: string;
  uid?: number;
  gid?: number;
  owner?: string;
  group?: string;
};

export type ArchiveListingDto = {
  archivePath: string;
  entries: ArchiveEntryDto[];
  entryCount: number;
  totalSize?: number;
};

export type ListArchiveRequest = {
  archivePath: string;
  password?: string;
};

export type ArchiveIndexStatus = "indexing" | "ready" | "empty" | "failed" | "cancelled";

export type StartArchiveIndexRequest = ListArchiveRequest;

export type ArchiveFormatKind =
  | "zip"
  | "splitZip"
  | "sevenZ"
  | "tarZst"
  | "tarGz"
  | "tar"
  | "tarBz2"
  | "tarXz"
  | "tarLzma"
  | "tarLz"
  | "tarLzo"
  | "tarCompress"
  | "tarLz4"
  | "tarUu"
  | "iso"
  | "cab"
  | "cpio"
  | "rpm"
  | "xar"
  | "pkg"
  | "dmg"
  | "lha"
  | "ar"
  | "warc"
  | "mtree"
  | "tzap"
  | "rar"
  | "appleArchive"
  | "deb"
  | "msi"
  | "vhd"
  | "vmdk"
  | "udf"
  | "squashfs"
  | "appImage"
  | "wim"
  | "vdi"
  | "nrg"
  | "mdf"
  | "cdi"
  | "isz"
  | "ccd"
  | "cue"
  | "vhdx"
  | "qcow2"
  | "ewf"
  | "ad1"
  | "dar"
  | "aff4"
  | "rawDisk"
  | "rawStream"
  | "unknown";

export type DetectArchiveFormatRequest = {
  path: string;
};

export type DetectArchiveFormatResponse = {
  format: ArchiveFormatKind;
};

export type ArchiveIndexSnapshotDto = {
  revision: string;
  sessionId: string;
  archivePath: string;
  status: ArchiveIndexStatus;
  discoveredEntries: number;
  discoveredBytes?: number;
  finalEntryCount?: number;
  finalTotalBytes?: number;
  latestFailure?: CommandErrorDto;
  format?: ArchiveFormatKind;
};

export type ArchiveIndexStartResponseDto = {
  sessionId: string;
  snapshot: ArchiveIndexSnapshotDto;
};

export type ArchiveIndexSessionRequest = { sessionId: string; afterRevision?: string };

export type ArchiveChildrenRequest = ArchiveIndexSessionRequest & {
  parentPath?: string;
  cursor?: string;
  limit?: number;
  sortKey?: string;
  sortAscending?: boolean;
};

export type ArchiveSearchRequest = ArchiveIndexSessionRequest & {
  query: string;
  cursor?: string;
  limit?: number;
  sortKey?: string;
  sortAscending?: boolean;
};

export type ArchiveChildrenPageDto = {
  sessionId: string;
  revision: string;
  parentPath: string;
  entries: ArchiveEntryDto[];
  nextCursor?: string;
  complete: boolean;
  childCount: number;
};

export type PlanCreateRequest = {
  sources: string[];
  cleanSource: boolean;
  respectGitignore: boolean;
  excludeNames?: string[];
  excludeArchivePaths?: string[];
  includeArchivePaths?: string[];
  followSymlinks: boolean;
};

export type CreatePlanResponse = {
  includedCount: number;
  excludedCount: number;
  totalBytes: number;
  excludedBytes: number;
  entries: string[];
  planEntries: CreatePlanEntryDto[];
  excludedEntries: string[];
  warnings: string[];
};

export type SourceAttributeDto = Readonly<{
  namespace: "windows" | "bsd" | "portable";
  code: string;
}>;

export type CreatePlanEntryDto = {
  path: string;
  kind: ArchiveEntryKind;
  size?: number;
  modified?: string;
  mode?: number;
  sourcePath: string;
  /** Source birth/creation time as signed Unix seconds, reported when available */
  created?: string;
  /** Source access time as signed Unix seconds, reported when available */
  accessed?: string;
  /** Source filesystem attributes, reported when Rust advertises "attributes" */
  attributes?: readonly SourceAttributeDto[];
  /** Source symbolic-link target, reported when Rust advertises "linkTarget" */
  linkTarget?: string;
  /** Source Unix user ID, reported when Rust advertises "uid" */
  uid?: number;
  /** Source Unix group ID, reported when Rust advertises "gid" */
  gid?: number;
  /** Source owner name, reported when Rust advertises "owner" */
  owner?: string;
  /** Source group name, reported when Rust advertises "group" */
  group?: string;
};

export type StartCreateRequest = {
  sources: string[];
  destinationPath: string;
  format: "zip" | "tarZst" | "tzap" | "sevenZ" | "tarGz" | "appleArchive";
  cleanSource: boolean;
  excludeNames?: string[];
  excludeArchivePaths?: string[];
  includeArchivePaths?: string[];
  respectGitignore?: boolean;
  followSymlinks?: boolean;
  replaceExisting: boolean;
  destinationCollisionStrategy?: "refuse" | "rename";
  password?: string;
  compressionLevel?: number;
  volumeSize?: number;
  volumeCount?: number;
  tzapRecoveryPercentage?: number;
  tzapVolumeLossTolerance?: number;
  zipCompression?: "store" | "deflate";
  sevenZSolid?: boolean;
  sevenZThreads?: number;
  sevenZChunkSize?: number;
  sevenZEncryptFileNames?: boolean;
  tzapCertificates?: TzapCertificateOptions;
  tzapBootstrapSidecar?: boolean;
  preserveMetadata: boolean;
};

export type ShareMode = "compressAndShare" | "directShare";
export type CompressionState = "notRequired" | "compressing" | "cancelling" | "complete" | "failed" | "cancelled";
export type TransferState = "notStarted" | "waiting" | "sending" | "cancelling" | "sent" | "failed" | "cancelled";
export type SharingIntent = "pending" | "skipped";
export type ShareLifecycle = "active" | "cancelled";

export type CompressionProgressSummary = {
  processedBytes: number;
  totalBytes: number | null;
  processedEntries: number;
  totalEntries: number | null;
};

export type ShareErrorSummary = {
  code: string;
  message: string;
  hint: string | null;
};

export type ShareRecordSnapshot = {
  shareId: string;
  clientRequestId: string;
  enqueueSequence: string;
  mode: ShareMode;
  sourcePaths: string[];
  senderAlias: string;
  compressionJobId: string | null;
  artifactPath: string | null;
  receiver: LocalSendDeviceInfoDto | null;
  receiverGeneration: string;
  sendId: string | null;
  compressionState: CompressionState;
  compressionProgress: CompressionProgressSummary | null;
  transferState: TransferState;
  sharingIntent: SharingIntent;
  lifecycle: ShareLifecycle;
  attempt: number;
  bytesSent: number;
  totalBytes: number | null;
  deliveryUncertain: boolean;
  createdAt: string;
  updatedAt: string;
  lastError: ShareErrorSummary | null;
};

export type ShareRegistrySnapshot = {
  queueRevision: string;
  items: ShareRecordSnapshot[];
};

export type EnqueueShareRequest =
  | { mode: "compressAndShare"; clientRequestId: string; senderAlias: string; createRequest: StartCreateRequest; receiver: LocalSendDeviceInfoDto | null }
  | { mode: "directShare"; clientRequestId: string; senderAlias: string; artifactPath: string; receiver: LocalSendDeviceInfoDto | null };

export type EnqueueShareResponse = { item: ShareRecordSnapshot; deduplicated: boolean };

export type TzapCertificateOptions = {
  signingSelection?: TzapSigningSelection;
  recipientSelection?: TzapRecipientSelection;
};

export type TzapSigningSelection =
  | { mode: "none" }
  | { mode: "enrolledIdentity"; signingIdentityId: string }
  | { mode: "oneTimePkcs12"; path: string; password: string }
  | {
      mode: "oneTimeCertificateAndKey";
      certificatePath: string;
      privateKeyPath: string;
      chainPaths?: string[];
      password?: string;
    };

export type TzapRecipientSelection = {
  recipientKeyIds: string[];
  contactRecipientIds: string[];
  oneTimeCertificatePaths: string[];
};

export type ValidateTzapSigningIdentityRequest = {
  identityPath: string;
  password?: string;
};

export type ValidateTzapSigningIdentityResponse = {
  certificateSha256: string;
  chainCertificateCount: number;
  subject: string;
  warnings: string[];
};

export type StartExtractRequest = {
  archivePath: string;
  destinationPath: string;
  password?: string;
  recipientKeyId?: string;
  overwrite: "refuse" | "replace" | "rename" | "ask";
  destinationCollisionStrategy?: "refuse" | "rename";
  entryPaths?: string[];
  stripComponents: number;
  tzapRestorePolicy: "content" | "portable" | "sameOs" | "system";
  tzapAllowDegraded: boolean;
  tzapAllowAbsoluteSymlinks: boolean;
  ignoreSymlinks: boolean;
};

export type PreviewEntryRequest = {
  archivePath: string;
  entryPath: string;
  password?: string;
  overwrite: "refuse" | "replace" | "rename" | "ask";
  stripComponents: number;
};

export type PreviewEntryResponse = {
  cleanupRoot: string;
  previewPath: string;
  writtenBytes: number;
};

export type NativeFileDragRequest = {
  archivePath: string;
  entryPaths: string[];
  password?: string;
  stripComponents: number;
};

export type NativeFileDragResponse = {
  outcome: "pending" | "dropped" | "cancelled" | "noDrop";
  sessionId: string | null;
  draggedEntries: string[];
};

export type DefaultHandlerEntryDto = {
  fileExtension: string;
  contentType: string | null;
  handlerBundleId: string | null;
  isCurrentApplication: boolean;
  errorCode: number | null;
};

export type DefaultHandlerSnapshotDto = {
  entries: DefaultHandlerEntryDto[];
  canRestore: boolean;
};

export type TestArchiveRequest = {
  archivePath: string;
  entryPaths?: string[];
  password?: string;
};

export type VerifyTzapCertificateRequest = {
  archivePath: string;
  validateTrust: boolean;
  trustedCaCertificatePaths: string[];
  trustedSystemRoots: boolean;
  includeOfficialTzapRoot: boolean;
  checkCurrentStatus?: boolean;
  environment?: "local" | "staging" | "prod" | string;
};

export type VerifyTzapCertificateResponse = {
  outcome: "signatureValid" | "trusted" | string;
  subject: string;
  issuer: string;
  serialNumberHex: string;
  certificateSha256: string;
  signedAtUnixSeconds: number;
  trustAnchorSubject?: string | null;
  verifiedChainSubjects: string[];
  diagnostics: string[];
  verificationState?: string;
  signatureCheck?: string;
  trustCheck?: string;
  certificateTime?: string;
  statusCheck?: string;
  statusReason?: string | null;
  statusThisUpdateUnixSeconds?: number | null;
  statusNextUpdateUnixSeconds?: number | null;
  statusRevokedAtUnixSeconds?: number | null;
  statusRevocationReason?: string | null;
  statusRevocationCategory?: string | null;
};

export type CancelJobRequest = {
  jobId: string;
};

export type PauseJobRequest = {
  jobId: string;
};

export type ResumeJobRequest = {
  jobId: string;
};

export type DismissJobRequest = {
  jobId: string;
};

export type StartJobResponseDto = {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  createdAt: string;
};

export type BaseJobSnapshotDto = {
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  createdAt: string;
  canDismiss: boolean;
  events: JobEventDto[];
  terminalSummary?: JobTerminalSummaryDto | null;
};

export type JobProgressFactsDto = {
  processedBytes: number;
  totalBytes?: number | null;
  processedEntries: number;
  totalEntries?: number | null;
  currentPath?: string | null;
  recentPaths: string[];
  activePhase?: JobPhase | null;
  phaseProcessedBytes: number;
  phaseTotalBytes?: number | null;
  warningCount: number;
  activeElapsedMillis: number;
  phaseElapsedMillis: number;
};

export type DesktopJobSnapshotDto = {
  revision: string;
  jobId: string;
  kind: JobKind;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canDismiss: boolean;
  progressFacts: JobProgressFactsDto;
  latestFailure?: JobEventDto | null;
  boundedNotices: JobEventDto[];
  availableActions: JobAvailableActionDto[];
  outputArtifacts: JobOutputArtifactDto[];
  retryDescriptor?: JobRetryDescriptorDto | null;
  terminalSummary?: JobTerminalSummaryDto | null;
};

export type JobOutputArtifactDto = {
  artifactId: string;
  kind: "archive" | "directory";
  path: string;
};

export type JobAvailableActionDto = {
  actionId: string;
  kind: "open" | "reveal";
  artifactId: string;
};

export type JobRetryDescriptorDto =
  | {
      retryKind: "extractArchive";
      actionId: string;
      archivePath: string;
      destinationPath: string;
      overwrite: StartExtractRequest["overwrite"];
      destinationCollisionStrategy: NonNullable<StartExtractRequest["destinationCollisionStrategy"]>;
      entryPaths: string[];
      stripComponents: number;
      tzapRestorePolicy?: StartExtractRequest["tzapRestorePolicy"];
      tzapAllowDegraded?: boolean;
      tzapAllowAbsoluteSymlinks?: boolean;
      ignoreSymlinks?: boolean;
    }
  | {
      retryKind: "testArchive";
      actionId: string;
      archivePath: string;
      entryPaths: string[];
    };

export type JobSnapshotEnvelopeDto = { subscriptionId: string; revision: string; payload: DesktopJobSnapshotDto };
export type JobCatalogDescriptorDto = { jobId: string; revision: string; kind: JobKind; status: JobStatus; terminal: boolean };
export type JobCatalogSnapshotDto = { catalogRevision: string; jobs: JobCatalogDescriptorDto[] };
export type JobCatalogEnvelopeDto = { subscriptionId: string; revision: string; payload: JobCatalogSnapshotDto };

export type CancelJobResponseDto = {
  jobId: string;
  status: JobStatus;
  revision: string;
};

export type JobControlResponseDto = {
  jobId: string;
  status: JobStatus;
  revision: string;
};

export type JobEventDto = {
  eventType:
    | "started"
    | "entryStarted"
    | "bytesProcessed"
    | "phaseStarted"
    | "phaseBytesProcessed"
    | "entryFinished"
    | "paused"
    | "resumed"
    | "warning"
    | "completed"
    | "failed"
    | "cancelled";
  jobKind?: JobKind;
  phase?: JobPhase;
  code?: string;
  hint?: string | null;
  severity?: "info" | "warning" | "error";
  retryable?: boolean | null;
  path?: string;
  bytes?: number;
  totalBytes?: number;
  totalBytesProcessed?: number;
  entries?: number;
  totalEntries?: number;
  message?: string;
};

export type JobPhase =
  | "planningPayload"
  | "planningMetadata"
  | "emittingPayload"
  | "emittingMetadata"
  | "committingOutput";

export type JobTerminalSummaryDto = {
  writtenEntries: number;
  skippedEntries?: number | null;
  writtenBytes: number;
  warnings: string[];
};

export type JobKind =
  | "zipCreate"
  | "zipExtract"
  | "sevenZCreate"
  | "sevenZExtract"
  | "rarExtract"
  | "tarGzCreate"
  | "tarZstdCreate"
  | "tarZstdExtract"
  | "tzapCreate"
  | "tzapExtract"
  | "appleArchiveCreate"
  | "appleArchiveExtract"
  | "archiveExtract"
  | "rawStreamExtract"
  | "testArchive";

export type JobStatus = "queued" | "running" | "paused" | "cancelling" | "completed" | "failed" | "cancelled";

export type BrowseState = "idle" | "loading" | "loaded" | "empty" | "error";
export type CreateState = "idle" | "loading" | "ready" | "error";

// ---------------------------------------------------------------------
// LAN sharing (LocalSend) — mirrors src-tauri/src/localsend.rs's DTOs.
// ---------------------------------------------------------------------

export type LocalSendDeviceInfoDto = {
  alias: string;
  fingerprint: string;
  port: number;
  protocol: string;
  ip: string | null;
  deviceModel: string | null;
};

export type LocalSendTransferFileDto = {
  id: string;
  fileName: string;
  size: number;
  fileType: string;
};

export type LocalSendTransferDecision = "accept" | "acceptFiles" | "decline" | "refuse";

export type LocalSendEventDto =
  | Readonly<{ type: "peerRegistered"; device: LocalSendDeviceInfoDto }>
  | Readonly<{ type: "transferRequest"; requestId: string; sender: LocalSendDeviceInfoDto; files: LocalSendTransferFileDto[] }>
  | Readonly<{ type: "textReceived"; sessionId: string; text: string; senderAlias: string }>
  | Readonly<{
      type: "fileReceiveProgress";
      sessionId: string;
      fileId: string;
      fileName: string;
      senderAlias: string;
      bytesReceived: number;
      totalBytes: number;
      fileCount: number;
    }>
  | Readonly<{ type: "fileReceived"; sessionId: string; fileId: string; fileName: string; path: string }>
  | Readonly<{ type: "sessionDone"; sessionId: string }>
  | Readonly<{
      type: "fileSendProgress";
      sendId: string;
      sessionId: string;
      fileId: string;
      fileName: string;
      bytesSent: number;
      totalBytes: number;
      rateBytesPerSecond: number;
    }>;

export type LocalSendDiscoverRequest = {
  alias: string;
  port?: number;
  https?: boolean;
  timeoutMs?: number;
  interfaceIps?: string[];
};

export type LocalSendStartReceiverRequest = {
  alias: string;
  port?: number;
  https?: boolean;
  pin?: string | null;
  receiveFolderPath: string;
  autoExtract?: boolean;
};

export type LocalSendRespondToTransferRequest = {
  requestId: string;
  decision: LocalSendTransferDecision;
  fileIds?: string[];
  reason?: string | null;
};
