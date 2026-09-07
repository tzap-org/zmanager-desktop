import {
  APP_TITLE,
  COMMAND_INVALID_PASSWORD,
  COMMAND_PASSWORD_REQUIRED,
} from "../app/constants";
import {
  COMMAND_DEFINITIONS,
  ARCHIVE_NOT_READY_MESSAGE,
  NO_ARCHIVE_OPEN_MESSAGE,
  NO_ENTRIES_MESSAGE,
  NO_SELECTION_MESSAGE,
  SINGLE_FILE_REQUIRED_MESSAGE,
  SINGLE_FOLDER_REQUIRED_MESSAGE,
  UNSUPPORTED_OPERATION_MESSAGE,
  selectCommandState,
  type CommandId,
  type CommandStateMap,
} from "../app/classicCommands";
import {
  createCommandRouter,
  selectContextCommand,
  selectDetailsCommand,
  type CommandRouterPayload,
} from "../app/commands/commandRouter";
import {
  buildAddSourcesContextMenuItems,
  buildArchiveEntryContextMenuItems,
  buildArchiveFolderContextMenuItems,
  buildArchiveHeaderContextMenuItems,
  buildCompressRowContextMenuItems,
  buildCreateHeaderContextMenuItems,
  buildSourceContextMenuItems,
  buildStartupContextMenuItems,
  type ContextMenuActionPayload,
} from "../app/commands/contextMenuModel";
import {
  createArchiveLoadController,
  type ArchiveLoadOptions,
} from "../app/controllers/archiveLoadController";
import {
  createArchiveOpenController,
} from "../app/controllers/archiveOpenController";
import {
  createArchivePreviewController,
  type ArchivePreviewMode,
} from "../app/controllers/archivePreviewController";
import {
  createArchiveTestController,
} from "../app/controllers/archiveTestController";
import {
  createCreatePlanController,
} from "../app/controllers/createPlanController";
import {
  createCreateStartController,
} from "../app/controllers/createStartController";
import {
  createExtractStartController,
} from "../app/controllers/extractStartController";
import { createJobHandoffController } from "../app/controllers/jobHandoffController";
import { createJobTerminationWatcher } from "../app/controllers/jobTerminationWatcher";
import {
  createQuickActionController,
} from "../app/controllers/quickActionController";
import {
  createStartupController,
} from "../app/controllers/startupController";
import { createAccountController } from "../app/controllers/accountController";
import { initializeDeepLinkAdapter } from "../desktop/deepLinkAdapter";
import { createDefaultHandlerController } from "../app/controllers/defaultHandlerController";
import { createLocalSendTrustController } from "../app/controllers/localSendTrustController";
import { createLocalSendDiscoveryController } from "../app/controllers/localSendDiscoveryController";
import { createShareQueueController } from "../app/controllers/shareQueueController";
import { localSendDiscoveryDesktopAdapter } from "../desktop/localSendDiscovery";
import {
  createNativeInboundController,
} from "../app/controllers/nativeInboundController";
import { createMainWindowSubmissionGuard } from "../app/mainWindowSubmissionGuard";
import {
  ARCHIVE_TABLE_COLUMNS,
  buildArchiveBrowserRows,
  moveColumn,
  resetColumnSettings,
  setColumnWidth,
  toggleColumnVisibility,
  visibleColumns,
  type ArchiveSortKey,
  type ArchiveTableColumn,
  type ArchiveTableColumnId,
  type ArchiveTableColumnSettings,
  type ArchiveTableRow,
} from "../app/archiveTable";
import {
  createArchiveWorkspace,
  type ArchiveWorkspacePasswordRetry,
  type ArchiveWorkspacePasswordRetryOperation,
  type ArchiveWorkspaceSnapshot,
  type SelectableArchiveWorkspaceRow,
} from "../app/workspaces/archiveWorkspace";
import {
  createCreateWorkspace,
  buildQuickCreateStartRequest,
  type CreateWorkspacePlanStatus,
  type CreateWorkspaceSnapshot,
} from "../app/workspaces/createWorkspace";
import {
  CREATE_SOURCE_TABLE_COLUMNS,
  type CreateSourceColumnId,
  type CreateSourceColumnSettings,
} from "../app/createTableColumns";
import {
  resolveCompressColumns,
  resolveExtractColumns,
  resolveCompressCapabilitySet,
  resolveExtractSortKey,
  compareResolvedDefaults,
  resolveExtractFamilyFromPath,
  archiveSettingsFromResolved,
  createSettingsFromResolved,
  type ResolvedWorkspaceColumns,
} from "../app/workspaceColumnResolver";
import {
  cleanInstallVisibilityPreferences,
  normalizeTableColumnVisibilityPreferences,
  TABLE_COLUMN_VISIBILITY_PREFERENCE_KEY,
  type TableColumnVisibilityPreferences,
} from "../app/tableColumnPreferences";
import {
  resolveArchiveFormatFamily,
  type ArchiveFormatFamilyResolution,
} from "../app/archiveFormatFamily";
import {
  CANONICAL_COLUMN_ORDER,
  COMPRESS_SAFE_BASE_IDS,
  type TableColumnId,
  type CompressTableColumnId,
  type ExtractTableColumnId,
} from "../app/tableColumnCatalogue";
import {
  getCompressLayout,
  getExtractLayout,
} from "../app/scenarioColumnLayout";
import {
  createExtractWorkspace,
  type ExtractWorkspaceDefaults,
  type ExtractWorkspaceOptionPatch,
} from "../app/workspaces/extractWorkspace";
import {
  pathsWithSameExtension,
} from "../app/selection";
import {
  applyHierarchicalRowSelectionIntent,
  clearHierarchicalTableSelection,
  ensureHierarchicalTablePathSelected,
  focusHierarchicalTablePath,
  invertVisibleHierarchicalSelection,
  replaceHierarchicalTableSelection,
  selectAllVisibleHierarchicalRows,
  setHierarchicalTablePathSelected,
  type HierarchicalTableSelectionResult,
} from "../app/hierarchicalTable";
import { getPathBasename } from "../app/formatting";
import {
  normalizeArchivePath,
} from "../app/archiveTree";
import {
  createFormatSupportsPassword,
  getArchiveName,
  sourcePathForCreatePlanRow,
  type CreateArchiveFormat,
  type CreatePlanRow,
} from "../app/createFlow";
import {
  unknownErrorMessage,
  type NativeDialogOpenOptions,
} from "../app/dialogs";
import {
  buildStartExtractRequest,
  type ExtractMode,
  type ExtractOverwritePolicy,
  type ExtractStartInput,
} from "../app/extractFlow";
import {
  archiveExtractionPolicy,
  extractHerePathOptions,
} from "../app/extractionPolicy";
import {
  createExtractDialogFormSnapshot,
  extractStartInputFromDialogForm,
  patchExtractDialogFormSnapshot,
  type ExtractDialogFormPatch,
  type ExtractDialogFormSnapshot,
} from "../app/extractDialogState";
import {
  ARCHIVE_OPEN_FILTER,
  getKnownArchiveSuffix,
  isSupportedArchivePath,
} from "../app/archiveFileTypes";
import {
  classifyDropIntent,
  dropSurfaceForWorkspace,
  type DroppedPath,
  type DropIntentDecision,
  type DropIntentSurface,
  type WorkspaceDropMode,
} from "../app/dropIntent";
import { createDisposableTaskLifecycle } from "../app/shell/disposableTaskLifecycle";
import { createProcessJobAccounting } from "../app/shell/processJobAccounting";
import { runInboundQuickAction } from "../app/shell/quickActionLaunchDisposition";
import { createAccountWorkspace } from "../app/workspaces/accountWorkspace";
import {
  createDefaultsForFormat,
  defaultCreateDirectory,
  loadAppPreferences,
  preferencesWithPatch,
  saveAppPreferences,
  type AppPreferencePatch,
  type AppPreferences,
} from "../app/preferences";
import {
  createPathHistoryStore,
} from "../app/pathHistory";
import {
  createShellWorkspace,
  type DropOverlayCopy,
  type DropOverlayMode,
  type ShellWorkspaceSnapshot,
} from "../app/shell/shellWorkspace";
import {
  type MessageKey,
  type MessageParams,
} from "../app/i18n/translator";
import {
  createDisplayContext,
  refreshDisplayContext,
  selectDisplayRefreshSurfaces,
  type DisplayRefreshWorkspace,
} from "../app/display/displayContext";
import {
  buildAboutDialogSnapshot,
  buildArchiveInfoDialogSnapshot,
  buildEntryInfoDialogSnapshot,
  buildSelectionInfoDialogSnapshot,
  serializeAboutDiagnostics,
} from "../app/display/dialogSnapshots";
import {
  createZManagerReactSnapshot,
  type ZManagerAccountIntent,
  displaySnapshotFromContext,
  type ZManagerContextMenuIntent,
  type ZManagerDesktopIntent,
  type ZManagerDialogIntent,
  type ZManagerDialogSnapshot,
  type ZManagerKeyboardIntent,
  type ZManagerReactRuntimeAdapter,
  type ZManagerReactSnapshot,
} from "../ui/react/appRuntime";
import type { LocalSendIncomingTransferSnapshot } from "../app/controllers/localSendIncomingTransfer";
import {
  uniqueQuickActionPaths,
  quickCreateDestination,
  type QuickActionExtractMode,
} from "../app/quickActions";
import {
  asCommandError,
  applyAccountHostedCallback,
  beginAccountHostedAuth,
  completeAccountHostedAuth,
  fetchAccountCurrentUser,
  acknowledgeNativeEvent,
  fetchHealthcheck,
  fetchAccountSnapshot,
  fetchProjectContract,
  fetchDiagnosticLogInfo,
  fetchQuickActionStartupState,
  fetchSystemFileIcons,
  enqueueShare,
  getShareQueue,
  setShareReceiver,
  startShare,
  skipShare,
  cancelShare,
  removeShare,
  getJobSnapshot,
  validateTzapSigningIdentity as validateTzapSigningIdentityCommand,
  generateAccountRecipientKey,
  generateAccountSigningIdentity,
  importAccountSigningIdentity,
  installAccountSigningCertificate,
  startArchiveIndex,
  waitArchiveIndex,
  getArchiveChildren,
  searchArchiveIndex,
  closeArchiveIndex,
  nativeFrontendReady,
  forgetAccount,
  removeAccountContact,
  removeAccountSigningIdentity,
  inspectAccountContactCard,
  acceptAccountContactCard,
  syncAccountContacts,
  enrollAccountCertificate,
  renewAccountCertificate,
  retireAccountDevice,
  removeAccountRecipientKey,
  setDefaultAccountSigningIdentity,
  runLocalSendRespondToTransfer,
  runLocalSendStartReceiver,
  runLocalSendStopReceiver,
  runLocalSendTrustDevice,
  runPlanCreate,
  runPreviewEntry,
  runStartCreate,
  runStartExtract,
  runTestArchive,
  validateDirectory,
  verifyTzapCertificate as verifyTzapCertificateCommand,
} from "../api/commands";
import type {
  ArchiveEntryDto,
  ArchiveListingDto,
  BrowseState,
  CreatePlanEntryDto,
  CreatePlanResponse,
  DiagnosticLogInfoDto,
  HealthcheckResponse,
  JobStatus,
  ListArchiveRequest,
  LocalSendEventDto,
  LocalSendDeviceInfoDto,
  EnqueueShareRequest,
  ProjectContract,
  QuickActionRequestDto,
  QuickActionStartupStateDto,
  StartCreateRequest,
  StartExtractRequest,
  StartJobResponseDto,
  SystemFileIconRequestEntry,
} from "../api/types";
import type {
  NativeInboundHostedAuthEvent,
} from "../api/generated/nativeInboundEvents.generated";
import { isNativeCapabilityAvailable } from "../api/generated/nativeCapabilities.generated";
import {
  isDesktopRuntime,
  openNativeDialog as openRuntimeDialog,
} from "../desktop/runtime";
import {
  bindDesktopFileDrop,
  type DesktopFileDropEvent,
} from "../desktop/fileDrop";
import {
  openDesktopPath,
  revealInFileManager,
} from "../desktop/fileManager";
import {
  canReadClipboard,
  readClipboardText,
  writeClipboardText,
} from "../desktop/clipboard";
import {
  createAppTimers,
} from "../desktop/timers";
import { createTauriJobFeed, type JobFeedSubscription } from "../desktop/jobFeed";
import {
  bindPreviewCleanupOnAppClose,
  cleanupPreviewRoots,
} from "../desktop/previewCleanup";
import { listenNativeInboundEvents } from "../desktop/nativeInboundEvents";
import { listenNativeMenuCommands } from "../desktop/nativeMenu";
import { defaultHandlerDesktopAdapter } from "../desktop/defaultHandlers";
import { localSendTrustDesktopAdapter } from "../desktop/localSendTrust";
import { listenLocalSendEvents } from "../desktop/localSendEvents";
import { listenShareQueueChanged } from "../desktop/shareQueueEvents";
import {
  listenNativeFileDragOutcomes,
  startNativeFileDrag,
} from "../desktop/nativeDrag";
import {
  createWindowController,
  type AppWindowResizeDirection,
} from "../desktop/windowController";
import { createDisposableTaskWindowManager } from "../desktop/disposableTaskWindowManager";
import {
  listenDisposableTaskJobHandoffs,
  listenDisposableTaskOutputActions,
} from "../desktop/disposableTaskWindow";
import {
  createDesktopDiagnosticRecorder,
  persistDiagnosticEvent,
} from "../desktop/diagnostics";
import {
  createBrowserDocumentAdapter,
} from "./browserDocumentAdapter";
import {
  createBrowserPasswordPromptAdapter,
} from "./passwordPromptAdapter";
import {
  createRuntimeContextMenu,
} from "./contextMenuRuntime";
import {
  createReactRuntimeStore,
} from "./reactRuntimeStore";
import {
  createArchiveRuntimeActions,
} from "./archiveRuntimeActions";
import {
  createCreateRuntimeActions,
} from "./createRuntimeActions";
import type {
  ArchiveFixture,
} from "./runtimeArchiveFixtures";
import {
  installRuntimeDevTools,
  loadLocalDevFixtureFromUrl as loadRuntimeLocalDevFixtureFromUrl,
  type RuntimeDevErrorSurfaceFixture,
} from "./runtimeDevTools";
import {
  startZManagerRuntime,
} from "./runtimeStartup";
type SelectableBrowserRow = Extract<ArchiveTableRow, { rowType: "folder" | "entry" }>;
type CompressPlanRow = CreatePlanRow;
type CommandSurfaceClassState = Partial<Record<CommandId, {
  primary?: boolean;
  secondary?: boolean;
}>>;
const browserDocument = createBrowserDocumentAdapter({});
const passwordPromptAdapter = createBrowserPasswordPromptAdapter();
browserDocument.initializeLayout();

let appPreferences: AppPreferences = loadAppPreferences();

// -- unified column preferences --
function loadColumnPrefs(): TableColumnVisibilityPreferences {
  try {
    const raw = localStorage.getItem(TABLE_COLUMN_VISIBILITY_PREFERENCE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.visibleColumnIds)) {
        return normalizeTableColumnVisibilityPreferences(parsed);
      }
    }
  } catch { /* fall through to clean install */ }
  return cleanInstallVisibilityPreferences();
}

function saveColumnPrefs(prefs: TableColumnVisibilityPreferences): boolean {
  try {
    const normalized = normalizeTableColumnVisibilityPreferences(prefs);
    localStorage.setItem(TABLE_COLUMN_VISIBILITY_PREFERENCE_KEY, JSON.stringify(normalized));
    const readBack = localStorage.getItem(TABLE_COLUMN_VISIBILITY_PREFERENCE_KEY);
    if (readBack !== JSON.stringify(normalized)) return false;
    return true;
  } catch { return false; }
}

let columnVisibilityPrefs: TableColumnVisibilityPreferences = loadColumnPrefs();
let columnVisibilityDraft: TableColumnVisibilityPreferences | null = null;

// Compress capability set — starts as safe base; updated when contract arrives
let compressCapabilitySet: readonly CompressTableColumnId[] = COMPRESS_SAFE_BASE_IDS;
// Track whether user has made local column changes (to decide clamp vs reset on contract arrival)
let createWorkspaceHadLocalColumnMutation = false;

const shellWorkspace = createShellWorkspace();
const pathHistoryStore = createPathHistoryStore();
// Resolve initial archive table columns from prefs (conservative: no archive open yet)
const initialExtractResolved = resolveExtractColumns({
  familyResolution: { kind: "unknown" as const },
  visibilityPrefs: columnVisibilityPrefs,
});
const initialArchiveColumns = archiveSettingsFromResolved(initialExtractResolved);
const archiveWorkspace = createArchiveWorkspace({
  flatView: appPreferences.flatViewDefault,
  showParentFolderItem: appPreferences.showParentFolderItem,
  sortKey: appPreferences.tableSortKey,
  sortAscending: appPreferences.tableSortAscending,
  tableColumns: initialArchiveColumns,
});

// Resolve initial create table columns from prefs + safe-base capability set
const initialCompressResolved = resolveCompressColumns({
  capabilitySet: compressCapabilitySet,
  visibilityPrefs: columnVisibilityPrefs,
});
const initialCreateColumns = createSettingsFromResolved(initialCompressResolved);
const createWorkspace = createCreateWorkspace(initialCreateColumns);
const extractWorkspace = createExtractWorkspace();
const accountWorkspace = createAccountWorkspace();
let displayContext = createDisplayContext(appPreferences.locale);
let preferencesDialogDraft: AppPreferences | null = null;
let systemIconDataUrls = new Map<string, string | null>();
let cachedSystemIconsSnapshot: Record<string, string | null> = {};

function syncSystemIconsSnapshot(): void {
  cachedSystemIconsSnapshot = Object.fromEntries(systemIconDataUrls);
}

let systemIconRequestRevision = 0;
let activeExtractMode: ExtractMode = "archive";
let activeExtractDialogForm: ExtractDialogFormSnapshot = createExtractDialogFormSnapshot();
let activeExtractDialogMessage = "";

let dropUnlisten: (() => void) | null = null;
const pendingNativeDragCounts = new Map<string, number>();

let normalWorkspaceRendered = false;
const disposableTaskLifecycle = createDisposableTaskLifecycle();
const processJobs = createProcessJobAccounting();
const mainWindowSubmissionGuard = createMainWindowSubmissionGuard();
const diagnostics = createDesktopDiagnosticRecorder();
function reportJobPresentationFailure(
  job: StartJobResponseDto,
  error: unknown,
): void {
  diagnostics.record({
    scope: "jobPresentation",
    name: "presentationFailed",
    fields: {
      jobKind: job.kind,
      error: unknownErrorMessage(error, "Unable to present task window."),
    },
  });
  setOperationalStatus("The Job started, but its task window could not be opened.");
}
const disposableTaskWindows = createDisposableTaskWindowManager({
  onReady: () => {},
  onAllClosed: () => {
    maybeCloseQuickActionOnlyCoordinator();
  },
  onPresentationFailed: reportJobPresentationFailure,
  diagnostics,
});
const jobHandoff = createJobHandoffController({
  recordAccepted: (job) => {
    processJobs.observeAccepted(job);
  },
  presentTaskWindow: async (job) => {
    if (isDesktopRuntime()) {
      await disposableTaskWindows.open(job);
    }
  },
  reportPresentationFailure: reportJobPresentationFailure,
});
let latestHealthcheck: HealthcheckResponse | null = null;
let latestContract: ProjectContract | null = null;
let latestDiagnosticLogInfo: DiagnosticLogInfoDto | null = null;
let reactDialogSnapshot: ZManagerDialogSnapshot = { kind: "none" };
const reactRuntimeStore = createReactRuntimeStore({
  createSnapshot: createCurrentReactSnapshot,
});
const contextMenuRuntime = createRuntimeContextMenu({
  publishSnapshot: () => reactRuntimeStore.publishSnapshot(),
});
const archiveRuntimeActions = createArchiveRuntimeActions({
  navigateToFolder,
  navigateBack,
  navigateUp,
  loadNextPage: () => archiveLoadController.loadNextPage(),
  loadPreviousPage: () => archiveLoadController.loadPreviousPage(),
  setSearchQuery: (query) => {
    publishArchiveSnapshot(archiveWorkspace.setSearchQuery(query));
    void (query.trim()
      ? archiveLoadController.loadSearch(query)
      : archiveLoadController.loadFolder(archiveCurrentFolder()));
  },
  clearSearch,
  setFlatView,
  setColumnWidth: setTableColumnWidth,
  reorderColumn: (sourceColumnId, targetColumnId) => {
    publishArchiveSnapshot(archiveWorkspace.reorderColumn(sourceColumnId, targetColumnId));
  },
  toggleTreeFolder: (folderPath) => {
    const snapshot = archiveWorkspace.toggleTreeFolder(folderPath);
    publishArchiveSnapshot(snapshot);
    if (snapshot.view.expandedTreeFolders.includes(folderPath)) {
      void archiveLoadController.loadTreeFolder(folderPath);
    }
  },
  sortByColumn: applySortCommand,
  selectAllVisible: selectVisibleEntries,
  clearSelection: clearBrowseSelection,
  selectRow: (path, modifiers) => updateSelectionByIntent(path, modifiers),
  setRowSelected: (path, selected) => {
    applyArchiveTableSelection(setHierarchicalTablePathSelected({
      ...currentArchiveTableSelectionState(),
      path,
      selected,
    }));
  },
  applySelection: (input) => {
    applyArchiveTableSelection({
      selectedPaths: new Set(input.selectedPaths),
      focusedPath: input.focusedPath,
      anchorPath: input.anchorPath,
    });
  },
  runEntryDefaultAction: (path) => {
    updateSelectionByIntent(path);
    runRoutedCommand("view");
  },
  startNativeDrag: startNativeDragOut,
  copyDetailsValue: copyTextToClipboard,
  setExtractDestination: (destinationPath) => {
    extractWorkspace.setOptions({ destinationPath });
    publishReactSnapshot();
  },
  browseExtractDestination: onSelectWorkspaceExtractDestination,
  setExtractOptions: (patch) => {
    extractWorkspace.setOptions(patch);
    publishReactSnapshot();
  },
  resetExtractDefaults: () => {
    extractWorkspace.resetToDefaults();
    publishReactSnapshot();
  },
  setTzapVerificationOptions: (patch) => {
    extractWorkspace.setTzapVerificationOptions(patch);
    publishReactSnapshot();
  },
  chooseTzapTrustedCAs: chooseTzapTrustedCAs,
  removeTzapTrustedCA: (path) => {
    const current = extractWorkspace.getSnapshot().tzapVerification.trustedCaCertificatePaths;
    extractWorkspace.setTzapVerificationOptions({ trustedCaCertificatePaths: current.filter((item) => item !== path) });
    publishReactSnapshot();
  },
  verifyTzapCertificate: verifyCurrentTzapCertificate,
  runExtract: (mode, password) => startExtract(mode, extractWorkspace.buildStartInput(password)),
  showEmptyContextMenu: showStartupContextMenu,
  showColumnContextMenu: (columnId, x, y) => showTableHeaderContextMenu(x, y, columnId),
  showFolderContextMenu: (path, x, y) => showFolderContextMenu(path, x, y, path),
  showEntryContextMenu,
  runDetailsAction: handleArchiveDetailsAction,
});
const createRuntimeActions = createCreateRuntimeActions({
  showWorkspace: showCreateWorkspace,
  showAddSourcesMenu: (x, y) => {
    showAddSourcesMenuAt(x, y);
  },
  clearSources: clearCreateSources,
  removeSources: (sourcePaths) => removeCreateSources([...sourcePaths]),
  showSourceContextMenu,
  setDestinationPath: (destinationPath) => {
    publishCreateWorkspaceSnapshot(createWorkspace.setDestinationPath(destinationPath).snapshot);
  },
  browseDestination: onSelectCreateDestination,
  changeFormat: (format) => {
    const defaults = createDefaultsForFormat(appPreferences, format);
    publishCreateWorkspaceSnapshot(createWorkspace.changeFormat(format, defaults).snapshot);
    queuePlanRun();
  },
  setOptions: (patch) => {
    publishCreateWorkspaceSnapshot(createWorkspace.setOptions(patch).snapshot);
    queuePlanRun();
  },
  chooseTzapCertificate: chooseCreateTzapCertificate,
  validateTzapSigningIdentity: validateCreateTzapIdentity,
  navigateToFolder: (folderPath) => {
    const navigation = createWorkspace.navigateToFolder(folderPath);
    if (navigation.changed) {
      publishCreateWorkspaceSnapshot(navigation.snapshot);
    } else {
      publishReactSnapshot();
    }
  },
  setSearchQuery: (query) => {
    publishCreateWorkspaceSnapshot(createWorkspace.setSearchQuery(query));
  },
  clearSearch: () => {
    publishCreateWorkspaceSnapshot(createWorkspace.clearSearch());
  },
  toggleTreeFolder: (folderPath) => {
    const navigation = createWorkspace.toggleTreeFolder(folderPath);
    if (navigation.changed) {
      publishCreateWorkspaceSnapshot(navigation.snapshot);
    } else {
      publishReactSnapshot();
    }
  },
  setPathIncluded: (path, included) => {
    publishCreateWorkspaceSnapshot(createWorkspace.setPathIncluded(path, included).snapshot);
  },
  setCurrentFolderIncluded: (included) => {
    publishCreateWorkspaceSnapshot(
      createWorkspace.setCurrentFolderIncluded(
        createWorkspace.getSnapshot().view.currentFolder,
        included,
      ).snapshot,
    );
  },
  setVisibleRowsIncluded: (included) => {
    publishCreateWorkspaceSnapshot(createWorkspace.setVisibleRowsIncluded(included).snapshot);
  },
  selectRow: (intent) => {
    publishCreateWorkspaceSnapshot(createWorkspace.selectRow(intent.path, intent).snapshot);
  },
  applySelection: (input) => {
    publishCreateWorkspaceSnapshot(createWorkspace.updateSelection({
      selectedPaths: new Set(input.selectedPaths),
      focusedPath: input.focusedPath,
      anchorPath: input.anchorPath,
    }).snapshot);
  },
  toggleRowSelection: (path) => {
    publishCreateWorkspaceSnapshot(createWorkspace.toggleRowSelection(path).snapshot);
  },
  focusRow: (path) => {
    publishCreateWorkspaceSnapshot(createWorkspace.focusRow(path).snapshot);
  },
  removeSelectedSources: (fallbackSourcePath) => {
    const selectedSourcePaths = selectedCompressSourcePaths();
    const trimmedFallbackSourcePath = fallbackSourcePath?.trim();
    removeCreateSources(
      selectedSourcePaths.length > 0
        ? selectedSourcePaths
        : trimmedFallbackSourcePath
          ? [trimmedFallbackSourcePath]
          : [],
    );
    publishReactSnapshot();
  },
  showCompressRowContextMenu: (path, sourcePath, x, y) => {
    if (visibleCompressRowForPath(path)) {
      if (!createWorkspace.getSnapshot().selection.selectedPaths.includes(path)) {
        publishCreateWorkspaceSnapshot(createWorkspace.ensureRowSelected(path).snapshot);
      }
      showCompressRowContextMenuForPath(path, sourcePath ?? "", x, y);
    } else if (sourcePath) {
      showSourceContextMenu(sourcePath, x, y);
    }
    publishReactSnapshot();
  },
  showColumnContextMenu: (columnId, x, y) => {
    showCreateTableHeaderContextMenu(x, y, columnId);
  },
  setColumnWidth: (columnId, width) => {
    createWorkspaceHadLocalColumnMutation = true;
    publishCreateWorkspaceSnapshot(createWorkspace.setColumnWidth(columnId, width));
  },
  reorderColumn: (sourceColumnId, targetColumnId) => {
    createWorkspaceHadLocalColumnMutation = true;
    publishCreateWorkspaceSnapshot(createWorkspace.reorderColumn(sourceColumnId, targetColumnId));
  },
  runCreate: (password, passwordConfirm, signingIdentityPassword) => runCreate({
    passwordInput: {
      password,
      passwordConfirm,
      signingIdentityPassword,
    },
  }),
  compressAndShareOnLan: startCompressAndShareOnLan,
});

const appTimers = createAppTimers({
  createPlanDebounceMs: 350,
});
const createPlanDebounce = appTimers.createPlanDebounce;

function archiveSnapshot(): ArchiveWorkspaceSnapshot {
  return archiveWorkspace.getSnapshot();
}

function archiveCurrentPath(): string {
  return archiveSnapshot().currentArchivePath;
}

function archiveCurrentFolder(): string {
  return archiveSnapshot().view.currentFolder;
}

function archiveBrowseState(): BrowseState {
  return archiveSnapshot().browseState;
}

function archiveEntries(): readonly ArchiveEntryDto[] {
  return archiveSnapshot().entries;
}

function archiveSelectedPathSet(): Set<string> {
  return new Set(archiveSnapshot().view.selection.selectedPaths);
}

function archiveSelectedCount(): number {
  return archiveSnapshot().view.selection.selectedCount;
}

function archiveFocusedPath(): string {
  return archiveSnapshot().view.selection.focusedPath;
}

function archiveSelectionAnchorPath(): string {
  return archiveSnapshot().view.selection.anchorPath;
}

const createPlanController = createCreatePlanController({
  workspace: createWorkspace,
  debounceTimer: createPlanDebounce,
  runPlanCreate,
  publishSnapshot: publishCreateWorkspaceSnapshot,
  canUseBrowserPreview: canUseBrowserCreatePlanPreview,
  browserPreview: (sources) => browserCreatePlanPreview([...sources]),
  toCommandError: asCommandError,
});
const createStartController = createCreateStartController({
  workspace: createWorkspace,
  submissionGuard: mainWindowSubmissionGuard,
  publishSnapshot: publishCreateWorkspaceSnapshot,
  startCreate: async (request) => {
    const signingSelection = request.tzapCertificates?.signingSelection;
    const signingSelectionKind = signingSelection?.mode ?? "notProvided";
    diagnostics.record({
      scope: "create",
      name: "startCommandInvoked",
      fields: {
        format: request.format,
        sourceCount: request.sources.length,
        signingSelectionKind,
      },
    });
    try {
      return await runStartCreate(request);
    } catch (error) {
      const commandError = asCommandError(error);
      diagnostics.record({
        scope: "create",
        name: "startCommandFailed",
        fields: {
          errorCode: commandError?.code ?? "invokeFailed",
          errorMessage: commandError?.message ?? unknownErrorMessage(error, "start_create failed"),
          signingSelectionKind,
        },
      });
      throw error;
    }
  },
  onCreateStarted: async (response, request) => {
    await jobHandoff.handoffAcceptedJob(response, {
      resetSubmittedState: () => {
        cancelQueuedPlanRun();
        publishCreateWorkspaceSnapshot(createWorkspace.resetAfterAcceptedStart().snapshot);
      },
    });
    recordCreateDestinationHistory(request.destinationPath);
  },
  toCommandError: asCommandError,
});
const jobFeed = createTauriJobFeed({
  onConnectionError: (error) => {
    diagnostics.record({
      scope: "jobCatalog",
      name: "connectionFailed",
      fields: {
        error: unknownErrorMessage(error, "Unable to subscribe to the Job catalog."),
      },
    });
    setOperationalStatus("Job lifecycle updates are temporarily unavailable; reconnecting.");
  },
});
let catalogSubscription: JobFeedSubscription | null = null;

/**
 * Lets code in the Main Window learn when a specific Job it started (and
 * already handed off to a task window) reaches a terminal state, without
 * opening its own per-Job subscription. The watcher is fed by the Job catalog
 * feed the Main Window already subscribes to below and retains terminal
 * catalog state for fast jobs.
 */
const jobTerminationWatcher = createJobTerminationWatcher();

function awaitJobTermination(jobId: string): Promise<JobStatus> {
  return jobTerminationWatcher.wait(jobId);
}

async function subscribeToJobCatalog(): Promise<void> {
  if (catalogSubscription) return;
  catalogSubscription = await jobFeed.subscribeCatalog((catalog) => {
    processJobs.reconcileCatalog(catalog);
    jobTerminationWatcher.observe(catalog);
    maybeCloseQuickActionOnlyCoordinator();
  });
}
let activeArchiveLoadTiming: {
  startedAt: number;
  firstPageRecorded: boolean;
} | null = null;
const archiveLoadController = createArchiveLoadController({
  workspace: archiveWorkspace,
  enterExtractWorkspace: () => setWorkspaceMode("extract"),
  startArchiveIndex,
  waitArchiveIndex,
  getArchiveChildren,
  searchArchiveIndex,
  closeArchiveIndex,
  toCommandError: asCommandError,
  renderLoading: (snapshot) => {
    publishArchiveSnapshot(snapshot);
    setOperationalMessage("status.loadingArchive");
  },
  renderPage: (snapshot) => {
    if (activeArchiveLoadTiming && !activeArchiveLoadTiming.firstPageRecorded) {
      activeArchiveLoadTiming.firstPageRecorded = true;
      diagnostics.record({
        scope: "archiveLoad",
        name: "firstPageRendered",
        fields: {
          elapsedMs: Math.round(performance.now() - activeArchiveLoadTiming.startedAt),
          entryCount: snapshot.entryCount,
          visibleRowCount: snapshot.entries.length,
        },
      });
    }
    clearTrackedPreviewState();
    contextMenuRuntime.hide();
    applyExtractPreferenceDefaults(snapshot.currentArchivePath);
    publishArchiveSnapshot(snapshot);
    setOperationalMessage("archive.loaded");
  },
  renderLoadError: (snapshot, text) => {
    publishArchiveSnapshot(snapshot);
    setBrowseState("error", text);
  },
  failedListMessage: () => message("browse.failedList"),
  loadErrorMessage: (error, options) => options.includeHint && error.hint
    ? `${error.message}\n${error.hint}`
    : error.message,
  promptForPasswordRetry: promptForArchivePasswordRetry,
  resolveDefaultTableColumns: (archivePath) => {
    const familyRes = resolveExtractFamilyFromPath(archivePath);
    const resolved = resolveExtractColumns({
      familyResolution: familyRes,
      visibilityPrefs: columnVisibilityPrefs,
    });
    return archiveSettingsFromResolved(resolved);
  },
});
const archiveOpenController = createArchiveOpenController({
  pathHistoryStore,
  publishPathHistorySnapshot: () => renderExtractDestinationHistory(),
  openArchiveDialogOptions: () => ({
    title: displayContext.translator.t("nativeDialog.openArchive"),
    directory: false,
    multiple: false,
    filters: [ARCHIVE_OPEN_FILTER],
  }),
  openArchiveDialog: openNativeDialog,
  canReadClipboard,
  readClipboardText,
  unsupportedClipboardMessage: () => UNSUPPORTED_OPERATION_MESSAGE,
  clipboardEmptyMessage: () => setOperationalMessage("browse.noArchiveOpen"),
  nativeDialogFailedMessage: () => displayContext.translator.t("nativeDialog.failed"),
  unknownErrorMessage,
  setOperationalStatus,
  clearPreviewState: clearTrackedPreviewState,
  setCurrentArchivePath: () => {},
  loadArchive: (request) => loadArchive(request),
});
const archiveTestController = createArchiveTestController({
  workspace: archiveWorkspace,
  submissionGuard: mainWindowSubmissionGuard,
  hasCurrentArchive: () => Boolean(archiveCurrentPath()),
  initialPassword: () => undefined,
  runTestArchive,
  handoffAcceptedJob: (response, resetSubmittedState) => (
    jobHandoff.handoffAcceptedJob(response, { resetSubmittedState })
  ),
  resetSubmittedState: () => {
    archiveWorkspace.resetAfterAcceptedOperation();
    publishReactSnapshot();
  },
  toCommandError: asCommandError,
  promptForPasswordRetry: promptForArchivePasswordRetry,
  unableStartMessage: () => message("test.unableStart"),
  setBrowseError: (text) => setBrowseState("error", text),
});
const archivePreviewController = createArchivePreviewController({
  workspace: archiveWorkspace,
  hasCurrentArchive: () => Boolean(archiveCurrentPath()),
  isCurrentArchive: (archivePath) => archiveCurrentPath() === archivePath,
  cleanupBeforePreview: applyPreviewCleanupPolicyBeforeNextPreview,
  previewRequestInput: (password) => ({
    overwrite: extractWorkspace.getSnapshot().overwrite,
    stripComponents: extractWorkspace.getSnapshot().stripComponents,
    ...(password ? { password } : {}),
  }),
  cachedPreviewPathForEntry: (entryPath) => shellWorkspace.getCachedPreviewPathForEntry(entryPath),
  runPreviewEntry,
  openPath: openDesktopPath,
  clearTrackedPreviewState,
  trackPreviewResult: (metadata) => {
    shellWorkspace.trackPreviewResultMetadata(metadata);
  },
  toCommandError: asCommandError,
  promptForPasswordRetry: promptForArchivePasswordRetry,
  singleFileRequired: () => setOperationalMessage("command.singleFileRequired"),
  previewUnableMessage: () => message("preview.unablePreview"),
  cachedOpenedMessage: () => message("preview.openedCached"),
  openedOutsideMessage: (writtenBytes) => message("preview.openedOutside", { size: formatBytes(writtenBytes) }),
  previewReadyMessage: (writtenBytes) => message("preview.ready", { size: formatBytes(writtenBytes) }),
  setBrowseLoaded: (text) => {
    setBrowseState("loaded", text);
  },
  setBrowseError: (text) => setBrowseState("error", text),
});
const extractStartController = createExtractStartController({
  workspace: archiveWorkspace,
  submissionGuard: mainWindowSubmissionGuard,
  hasCurrentArchive: () => Boolean(archiveCurrentPath()),
  joinNativePath,
  startExtract: runStartExtract,
  toCommandError: asCommandError,
  requestPasswordInDialog: requestExtractPasswordInDialog,
  chooseDestinationFirst: () => {
    setOperationalStatus(message("extract.chooseDestinationFirst"));
  },
  selectEntryFirst: () => {
    setOperationalStatus(message("extract.selectEntryFirst"));
  },
  recordDestination: recordExtractDestinationHistory,
  closeExtractDialog: closeReactDialog,
  handoffAcceptedJob: (response, resetSubmittedState) => (
    jobHandoff.handoffAcceptedJob(response, { resetSubmittedState })
  ),
  resetSubmittedState: () => {
    archiveWorkspace.resetAfterAcceptedOperation();
    extractWorkspace.setOptions({ passwordPromptOpen: false });
    publishReactSnapshot();
  },
  unableStartMessage: (mode) => message(mode === "selection" ? "extract.unableSelected" : "extract.unableStart"),
  setBrowseError: (text) => setBrowseState("error", text),
});
const appWindowController = createWindowController();

const appWindowEffects = {
  close(): void {
    if (!isDesktopRuntime()) {
      setOperationalMessage("status.closeInBrowser");
      return;
    }

    const hasOpenTaskWindows = disposableTaskWindows.hasOpenWindows();
    const hasActiveJobs = processJobs.hasActiveJobs();
    const closeOrHide = hasOpenTaskWindows || hasActiveJobs
      ? appWindowController.hideCurrentWindow()
      : appWindowController.closeCurrentWindow();
    diagnostics.record({
      scope: "mainWindow",
      name: hasOpenTaskWindows || hasActiveJobs ? "hideRequested" : "closeRequested",
      fields: { hasOpenTaskWindows, hasActiveJobs },
    });
    if (hasOpenTaskWindows || hasActiveJobs) {
      disposableTaskLifecycle.observeMainWindowHiddenForTasks();
      shellWorkspace.setQuickActionWindowShown(false);
    }
    void closeOrHide.catch(() => {
      setOperationalMessage("quick.completed.closeWindow");
    });
  },
  minimize(): void {
    if (!isDesktopRuntime()) {
      return;
    }

    void appWindowController.minimizeCurrentWindow().catch(() => {
      setOperationalMessage("jobs.minimizeFailed");
    });
  },
  toggleMaximize(): void {
    if (!isDesktopRuntime()) {
      return;
    }

    void appWindowController.toggleMaximizeCurrentWindow().catch(() => {
      setOperationalMessage("status.windowControlFailed");
    });
  },
};

const jobPasswordPrompts = {
  promptForNewArchivePassword(): string | null {
    return promptForArchivePassword(message("create.prompt.newArchivePassword"));
  },
  promptForCommandRetry(commandCode: string): string | null {
    return promptForArchivePassword(getArchivePasswordPrompt(commandCode));
  },
};

const quickActionController = createQuickActionController({
  preferences: () => appPreferences,
  pathHelpers: { nativeParentPath, joinNativePath },
  setOperationalMessage,
  setOperationalStatus,
  message,
  openArchive: openQuickActionArchive,
  runStartCreate,
  runStartExtract,
  toCommandError: asCommandError,
  isPasswordCommandError,
  promptForNewArchivePassword: jobPasswordPrompts.promptForNewArchivePassword,
  promptForCommandRetry: jobPasswordPrompts.promptForCommandRetry,
  recordCreateDestination: recordCreateDestinationHistory,
  recordExtractDestination: recordExtractDestinationHistory,
  handoffAcceptedJob: (response) => jobHandoff.handoffAcceptedJob(response),
  showCreateWorkspace,
  readCreateSnapshot: () => createWorkspace.getSnapshot(),
  addCreateSources: (sources) => createWorkspace.addSources(sources).snapshot,
  applyCreateDefaultsForFormat,
  setCreateOptions: (patch) => createWorkspace.setOptions(patch).snapshot,
  setCreateDestinationPath: (path) => createWorkspace.setDestinationPath(path).snapshot,
  publishCreateSnapshot: publishCreateWorkspaceSnapshot,
  cancelQueuedPlanRun,
  runPlan,
  setCurrentArchivePath: () => {},
  loadArchive: (request) => loadArchive(request),
  readBrowseState: archiveBrowseState,
  readArchiveEntries: archiveEntries,
  setBrowseError: (text) => setBrowseState("error", text),
  openExtractDialog,
  diagnostics,
});

const startupController = createStartupController({
  fetchHealthcheck,
  fetchProjectContract,
  fetchQuickActionStartupState,
  isDesktopRuntime,
  revealWindowForStartupQuickAction,
  revealNormalWindow: revealNormalAppWindow,
  setOperationalStatus,
  setOperationalMessage,
  setBrowseError: (text) => setBrowseState("error", text),
  unknownErrorMessage,
  toCommandError: asCommandError,
  message,
  setBootstrapState: (state) => {
    latestHealthcheck = state.healthcheck;
    latestContract = state.contract;

    // Resolve Compress column capability from the contract
    if (state.contract) {
      const rawCapabilityIds = state.contract.sourceTableCapabilities?.availableColumnIds;
      const validated = resolveCompressCapabilitySet(rawCapabilityIds);

      if (createWorkspaceHadLocalColumnMutation) {
        // Clamp existing layout to the newly available set — don't add new optional columns
        const resolved = resolveCompressColumns({
          capabilitySet: validated,
          visibilityPrefs: columnVisibilityPrefs,
        });
        const availableSet = new Set(resolved.availableColumnIds);
        // Keep only locally-visible columns that are still available
        const snap = createWorkspace.getSnapshot();
        const clampedSettings: CreateSourceColumnSettings = {
          visibleColumnIds: snap.view.columnSettings.visibleColumnIds.filter(
            (id) => availableSet.has(id as TableColumnId),
          ),
          columnOrderIds: snap.view.columnSettings.columnOrderIds.filter(
            (id) => availableSet.has(id as TableColumnId),
          ),
          columnWidths: Object.fromEntries(
            Object.entries(snap.view.columnSettings.columnWidths).filter(
              ([key]) => availableSet.has(key as TableColumnId),
            ),
          ),
        };
        publishCreateWorkspaceSnapshot(createWorkspace.resetColumns(clampedSettings));
      } else {
        // No local mutations — reset to newly resolved configured defaults
        const resolved = resolveCompressColumns({
          capabilitySet: validated,
          visibilityPrefs: columnVisibilityPrefs,
        });
        const columns = createSettingsFromResolved(resolved);
        publishCreateWorkspaceSnapshot(createWorkspace.resetColumns(columns));
      }

      compressCapabilitySet = validated;
    } else {
      // Invalid contract — fall back to safe base
      compressCapabilitySet = COMPRESS_SAFE_BASE_IDS;
    }

    if (state.contract) {
      const hasNativeMenu = state.contract.platformIntegration.capabilities.some(
        c => c.id === "nativeApplicationMenu" && c.availability === "available"
      );
      const isMacOs = state.contract.platformIntegration.capabilities.some(
        c => c.id === "nativeHostLifecycle" && c.availability === "available"
      );
      browserDocument.setNativeMenuBar(hasNativeMenu);
      browserDocument.setMacOsOverlayTitleBar(isMacOs);
    }
    
    if (isDesktopRuntime()) {
      import("@tauri-apps/api/webviewWindow").then((module) => {
        module.getCurrentWebviewWindow().isDecorated().then((decorated) => {
          browserDocument.setCustomWindowChrome(!decorated);
        }).catch(() => {
          browserDocument.setCustomWindowChrome(false);
        });
      }).catch(() => {
        browserDocument.setCustomWindowChrome(false);
      });
    } else {
      browserDocument.setCustomWindowChrome(false);
    }
  },
  onBootstrapStateChanged: publishBootstrapStateSnapshot,
  diagnostics,
});

const nativeInboundController = createNativeInboundController({
  isDesktopRuntime,
  listen: listenNativeInboundEvents,
  markFrontendReady: nativeFrontendReady,
  acknowledge: acknowledgeNativeEvent,
  handleQuickAction: routeQuickActionRequest,
  handleHostedAuthCallback,
  revealApplication: () => revealNormalAppWindow(true),
  reportFailure: (error) => setOperationalStatus(unknownErrorMessage(
    error,
    message("desktopIntegration.initFailed"),
  )),
  diagnostics,
});

const accountController = createAccountController({
  workspace: accountWorkspace,
  fetchSnapshot: fetchAccountSnapshot,
  beginHostedAuth: beginAccountHostedAuth,
  applyHostedCallback: applyAccountHostedCallback,
  completeHostedAuth: (state, handoffCode, callbackUrl) => completeAccountHostedAuth({ state, handoffCode, callbackUrl }),
  fetchCurrentUser: fetchAccountCurrentUser,
  enrollDeviceCertificate: enrollAccountCertificate,
  renewCertificate: renewAccountCertificate,
  retireDevice: retireAccountDevice,
  forget: forgetAccount,
  generateRecipientKey: generateAccountRecipientKey,
  generateSigningIdentity: (commonName, label) => generateAccountSigningIdentity({ commonName, label }),
  importSigningIdentity: (identityPath, password, label) => importAccountSigningIdentity({ identityPath, password, label }),
  installSigningCertificate: installAccountSigningCertificate,
  createSelfSignedCertificateStore: createAccountSelfSignedCertificateStore,
  removeSigningIdentity: removeAccountSigningIdentity,
  removeRecipientKey: removeAccountRecipientKey,
  setDefaultSigningIdentity: setDefaultAccountSigningIdentity,
  removeContact: removeAccountContact,
  inspectContactCard: inspectAccountContactCard,
  acceptContactCard: acceptAccountContactCard,
  syncContacts: syncAccountContacts,
  openUrl: openDesktopPath,
  publish: publishReactSnapshot,
  errorMessage: (error) => unknownErrorMessage(error, "Account operation failed."),
  diagnostics,
});

const defaultHandlerController = createDefaultHandlerController({
  ...defaultHandlerDesktopAdapter,
  publish: publishReactSnapshot,
  errorMessage: (error) => unknownErrorMessage(error, "Unable to update macOS default handlers."),
});

const localSendTrustController = createLocalSendTrustController({
  ...localSendTrustDesktopAdapter,
  publish: publishReactSnapshot,
  errorMessage: (error) => unknownErrorMessage(error, "Unable to update trusted LAN devices."),
});

const localSendDiscoveryController = createLocalSendDiscoveryController({
  ...localSendDiscoveryDesktopAdapter,
  publish: publishReactSnapshot,
  errorMessage: (error) => unknownErrorMessage(error, "Unable to discover LAN receivers."),
});

const shareQueueController = createShareQueueController({
  api: { enqueueShare, getShareQueue, setShareReceiver, startShare, skipShare, cancelShare, removeShare },
  reveal: () => revealNormalAppWindow(true),
  listen: listenShareQueueChanged,
  publish: publishReactSnapshot,
  reportError: (error) => setOperationalStatus(unknownErrorMessage(error, "Unable to load the LAN share queue.")),
});

function localSendAliasOrDefault(): string {
  return appPreferences.lanShareAlias.trim() || "ZManager Desktop";
}

type LocalSendReceiverConfigKey = string | null;

function localSendReceiverConfigKey(): LocalSendReceiverConfigKey {
  if (!appPreferences.lanShareEnableReceiving) {
    return null;
  }
  return JSON.stringify([
    localSendAliasOrDefault(),
    appPreferences.lanShareReceiveFolderPath,
    appPreferences.lanShareAutoExtract,
  ]);
}

let appliedLocalSendReceiverConfigKey: LocalSendReceiverConfigKey | undefined;

/**
 * Applies the current `lanShareEnableReceiving`/`lanShareAlias`/
 * `lanShareReceiveFolderPath`/`lanShareAutoExtract` preferences to the
 * running receiver. A no-op when none of those fields changed since the
 * last call, so saving an unrelated preference (theme, sort order, ...)
 * doesn't rebind the socket or interrupt an in-flight transfer. Otherwise
 * stops first (a harmless no-op error if nothing was running) so the
 * change takes effect immediately rather than only on the next app
 * launch. Called once at startup and again every time preferences are
 * saved.
 */
function syncLocalSendReceiverWithPreferences() {
  if (!latestContract?.localSendAvailable) {
    return;
  }
  const nextConfigKey = localSendReceiverConfigKey();
  if (nextConfigKey === appliedLocalSendReceiverConfigKey) {
    return;
  }
  appliedLocalSendReceiverConfigKey = nextConfigKey;
  void runLocalSendStopReceiver()
    .catch(() => {})
    .then(() => {
      if (!appPreferences.lanShareEnableReceiving) {
        return;
      }
      return runLocalSendStartReceiver({
        alias: localSendAliasOrDefault(),
        https: true,
        receiveFolderPath: appPreferences.lanShareReceiveFolderPath,
        autoExtract: appPreferences.lanShareAutoExtract,
      }).catch((error) => {
        // Let the next sync retry instead of treating this config as
        // already applied.
        appliedLocalSendReceiverConfigKey = undefined;
        setOperationalStatus(unknownErrorMessage(error, "Unable to start LAN receiving."));
      });
    });
}

/**
 * Set right before triggering a compress run that should open the Share on
 * LAN dialog once the job succeeds, and always cleared once that run either
 * starts a job (consumed inside `onCreateStarted`) or fails to (consumed by
 * the `finally` in `startCompressAndShareOnLan`). A plain module flag is
 * safe here because `createStartController`'s own submission guard already
 * prevents a second compress run from overlapping this one.
 */
function startCompressAndShareOnLan() {
  const format = createWorkspace.getSnapshot().options.format;
  const defaults = createDefaultsForFormat(appPreferences, format);

  let password: string | undefined;
  if (defaults.promptForPassword && createFormatSupportsPassword(format)) {
    const promptedPassword = jobPasswordPrompts.promptForNewArchivePassword();
    if (!promptedPassword) {
      setOperationalMessage("shareOnLan.compressCancelled");
      return;
    }
    password = promptedPassword;
  }

  const workspace = createWorkspace.getSnapshot();
  const requestResult = buildQuickCreateStartRequest({
    sources: [...workspace.sources],
    destinationPath: workspace.options.destinationPath,
    format,
    cleanSource: workspace.options.cleanSource,
    replaceExisting: defaults.replaceExisting,
    preserveMetadata: defaults.preserveMetadata,
    password,
    compressionLevel: defaults.compressionLevel ?? undefined,
    volumeSize: defaults.volumeSize ?? undefined,
    respectGitignore: defaults.respectGitignore,
    followSymlinks: defaults.followSymlinks,
    tzapRecoveryPercentage: defaults.tzapRecoveryPercentage ?? undefined,
    tzapVolumeLossTolerance: defaults.tzapVolumeLossTolerance,
    zipCompression: defaults.zipCompression,
    sevenZSolid: defaults.sevenZSolid,
    sevenZThreads: defaults.sevenZThreads ?? undefined,
    sevenZChunkSize: defaults.sevenZChunkSize ?? undefined,
    sevenZEncryptFileNames: defaults.sevenZEncryptFileNames,
  });
  if (!requestResult.ok) {
    setOperationalMessage(requestResult.reason === "needsSources" ? "quickCreate.needsSource" : "quickCreate.needsDestination");
    return;
  }
  void shareQueueController.enqueue({
    mode: "compressAndShare",
    clientRequestId: crypto.randomUUID(),
    senderAlias: localSendAliasOrDefault(),
    createRequest: requestResult.request,
    receiver: null,
  }).catch((error) => setOperationalStatus(unknownErrorMessage(error, "Unable to queue Share on LAN.")));
}

let localSendIncomingTransfers: LocalSendIncomingTransferSnapshot[] = [];

function handleLocalSendEvent(event: LocalSendEventDto) {
  if (event.type === "transferRequest") {
    // Reaching the frontend at all means the sender's fingerprint was not
    // in the trust store — see handle_queued_event in src-tauri/src/localsend.rs,
    // which auto-accepts trusted senders before this event is ever emitted.
    localSendIncomingTransfers = [
      ...localSendIncomingTransfers,
      { requestId: event.requestId, sender: event.sender, files: event.files },
    ];
    publishReactSnapshot();
  }
}

async function respondToLocalSendIncomingTransfer(
  requestId: string,
  decision: "accept" | "decline",
  alwaysAccept: boolean,
) {
  const transfer = localSendIncomingTransfers.find((candidate) => candidate.requestId === requestId);
  localSendIncomingTransfers = localSendIncomingTransfers.filter((candidate) => candidate.requestId !== requestId);
  publishReactSnapshot();
  try {
    await runLocalSendRespondToTransfer({ requestId, decision });
    if (decision === "accept" && alwaysAccept && transfer) {
      await runLocalSendTrustDevice(transfer.sender.fingerprint);
    }
  } catch (error) {
    setOperationalStatus(unknownErrorMessage(error, "Unable to respond to the LAN transfer request."));
  }
}

function persistPreferencePatch(patch: AppPreferencePatch): AppPreferences {
  appPreferences = preferencesWithPatch(appPreferences, patch);
  saveAppPreferences(appPreferences);
  return appPreferences;
}

function savePreferencePatch(patch: AppPreferencePatch) {
  persistPreferencePatch(patch);
  publishReactSnapshot();
}

function setFlatView(nextFlatView: boolean, persistPreference: boolean) {
  publishArchiveSnapshot(archiveWorkspace.setFlatView(nextFlatView));
  void (nextFlatView
    ? archiveLoadController.loadSearch(currentSearchQuery())
    : archiveLoadController.loadFolder(archiveCurrentFolder()));
  if (persistPreference) {
    savePreferencePatch({ flatViewDefault: nextFlatView });
  }
}

function applySortCommand(nextSortKey: ArchiveSortKey) {
  publishArchiveSnapshot(archiveWorkspace.applySortCommand(nextSortKey));
  const sort = archiveWorkspace.getSnapshot().view.sort;
  savePreferencePatch({ tableSortKey: sort.key, tableSortAscending: sort.ascending });
  void reloadArchivePageForView();
}

function applySortDirection(nextSortKey: ArchiveSortKey, ascending: boolean) {
  publishArchiveSnapshot(archiveWorkspace.applySortDirection(nextSortKey, ascending));
  const sort = archiveWorkspace.getSnapshot().view.sort;
  savePreferencePatch({ tableSortKey: sort.key, tableSortAscending: sort.ascending });
  void reloadArchivePageForView();
}

function reloadArchivePageForView(): Promise<void> {
  const snapshot = archiveWorkspace.getSnapshot();
  return snapshot.view.flatView || snapshot.view.searchQuery.trim()
    ? archiveLoadController.loadSearch(snapshot.view.searchQuery)
    : archiveLoadController.loadFolder(snapshot.view.currentFolder);
}

function closeAppWindow() {
  appWindowEffects.close();
}

function minimizeAppWindow() {
  appWindowEffects.minimize();
}

function toggleAppWindowMaximize() {
  appWindowEffects.toggleMaximize();
}

function renderNormalWorkspaceOnce() {
  if (normalWorkspaceRendered) {
    return;
  }

  renderExtractDestinationHistory();
  renderBrowse();
  normalWorkspaceRendered = true;
  publishReactSnapshot();
}

async function revealNormalAppWindow(userInitiated = false) {
  diagnostics.record({
    scope: "mainWindow",
    name: "normalRevealRequested",
    fields: { alreadyShown: shellWorkspace.getSnapshot().quickActionWindow.shown },
  });
  disposableTaskLifecycle.observeNormalLaunch();
  renderNormalWorkspaceOnce();
  if (!isDesktopRuntime() || (!userInitiated && shellWorkspace.getSnapshot().quickActionWindow.shown)) {
    return;
  }

  try {
    await appWindowController.revealNormalWindow({ userInitiated, alreadyShown: shellWorkspace.getSnapshot().quickActionWindow.shown });
    diagnostics.record({ scope: "mainWindow", name: "normalRevealCompleted", fields: { userInitiated } });
  } catch {
    diagnostics.record({ scope: "mainWindow", name: "normalRevealFailed", fields: { userInitiated } });
    return;
  }
  shellWorkspace.setQuickActionWindowShown(true);
}

async function revealWindowForStartupQuickAction(state: QuickActionStartupStateDto) {
  if (
    state.launchedForQuickAction
    && (
      state.windowDisposition === "disposableTask"
      || (state.windowDisposition == null && !state.error)
    )
  ) {
    disposableTaskLifecycle.observeQuickActionLaunch();
    return;
  }

  // The ZMANAGER_MACOS_QUICK_ACTION env var set via
  // NSWorkspace.OpenConfiguration.environment does not propagate through
  // URL scheme launches on modern macOS. If a quick action was already
  // ingested via the native inbound path, skip the main window reveal.
  if (disposableTaskLifecycle.getSnapshot().quickActionOnlyCoordinator) {
    diagnostics.record({
      scope: "startup",
      name: "revealSuppressedByPendingQuickAction",
      fields: {
        pendingQuickActionRequests:
          disposableTaskLifecycle.getSnapshot().pendingQuickActionRequests,
      },
    });
    disposableTaskLifecycle.observeQuickActionLaunch();
    return;
  }

  await revealNormalAppWindow();
}

function clearTrackedPreviewState() {
  shellWorkspace.clearTrackedPreview();
}

function updateStatusBar() {
  publishReactSnapshot();
}

function applyPreferenceClasses() {
  publishReactSnapshot();
}

function formatBytes(value?: number): string {
  return displayContext.format.bytes(value);
}

function message(key: MessageKey, params?: MessageParams): string {
  return displayContext.translator.t(key, params);
}

function setOperationalMessage(key: MessageKey, params?: MessageParams): void {
  setOperationalStatus(message(key, params));
}

function formatDate(value?: string): string {
  return displayContext.format.date(value, { emptyValue: "" });
}

function infoReturnFocusPath(): string {
  return archiveFocusedPath() || getSelectedEntryPaths()[0] || "";
}

function previewActionHint(): string {
  return message("preview.openTempOutsideHint");
}

function normalizeEntryPath(path: string): string {
  return normalizeArchivePath(path);
}

function getBaseName(path: string): string {
  return getPathBasename(path, path);
}

function systemIconRequestForPath(path: string, isDirectory: boolean): SystemFileIconRequestEntry {
  const lookupPath = isDirectory ? "folder" : systemIconLookupPath(path);
  return {
    key: isDirectory ? "directory" : `file:${lookupPath.toLowerCase()}`,
    path: lookupPath,
    isDirectory,
  };
}

function systemIconLookupPath(path: string): string {
  const suffix = getKnownArchiveSuffix(path);
  if (suffix) {
    return suffix;
  }

  const extension = pathExtension(path);
  return extension ? `.${extension}` : "file";
}

function pathExtension(path: string): string | null {
  const name = getBaseName(path);
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return null;
  }

  return name.slice(dotIndex + 1).toLowerCase();
}

function systemIconRequestForEntry(entry: ArchiveEntryDto): SystemFileIconRequestEntry | null {
  if (entry.kind === "directory") {
    return systemIconRequestForPath("folder", true);
  }
  if (entry.kind === "special") {
    return null;
  }

  return systemIconRequestForPath(entry.path, false);
}

function systemIconDataUrlForRequest(request: SystemFileIconRequestEntry | null): string | null {
  if (!appPreferences.showRealFileIcons || !request) {
    return null;
  }

  return systemIconDataUrls.get(request.key) ?? null;
}

function collectSystemIconRequests(): SystemFileIconRequestEntry[] {
  if (!appPreferences.showRealFileIcons) {
    return [];
  }

  const archive = archiveSnapshot();
  const create = createWorkspace.getSnapshot();
  const requests = new Map<string, SystemFileIconRequestEntry>();
  const add = (request: SystemFileIconRequestEntry | null) => {
    if (request && !systemIconDataUrls.has(request.key)) {
      requests.set(request.key, request);
    }
  };

  if (archive.currentArchivePath) {
    add(systemIconRequestForPath(archive.currentArchivePath, false));
    add(systemIconRequestForPath("folder", true));
    for (const entry of archive.entries) {
      add(systemIconRequestForEntry(entry));
    }
  }

  const createEntries = create.plan.current?.planEntries ?? [];
  if (createEntries.length) {
    add(systemIconRequestForPath("folder", true));
    for (const entry of createEntries) {
      add(systemIconRequestForPath(entry.sourcePath, entry.kind === "directory"));
    }
  }

  return [...requests.values()];
}

function queueSystemIconRefresh() {
  if (!isDesktopRuntime()) {
    return;
  }

  const entries = collectSystemIconRequests();
  if (!entries.length) {
    return;
  }

  const requestRevision = ++systemIconRequestRevision;
  void fetchSystemFileIcons({ entries })
    .then((response) => {
      if (requestRevision < systemIconRequestRevision) {
        return;
      }

      for (const icon of response.icons) {
        systemIconDataUrls.set(icon.key, icon.dataUrl ?? null);
      }
      syncSystemIconsSnapshot();
      publishReactSnapshot();
    })
    .catch(() => {
      for (const entry of entries) {
        systemIconDataUrls.set(entry.key, null);
      }
      syncSystemIconsSnapshot();
    });
}

function createPlanStatusText(status: CreateWorkspacePlanStatus | null): string {
  if (!status) {
    return "";
  }
  if (status.messageKey) {
    return message(status.messageKey as MessageKey);
  }
  return status.fallbackText ?? "";
}

function publishCreateWorkspaceSnapshot(
  snapshot: CreateWorkspaceSnapshot = createWorkspace.getSnapshot(),
): CreateWorkspaceSnapshot {
  queueSystemIconRefresh();
  publishReactSnapshot();
  return snapshot;
}

function createDestinationSuggestionOptions() {
  return {
    defaultDirectory: defaultCreateDirectory(appPreferences),
    nativeParentPath,
  };
}

function joinNativePath(parentPath: string, childName: string): string {
  const trimmedParent = parentPath.trim().replace(/[\\/]+$/, "");
  if (!trimmedParent) {
    return childName;
  }
  const separator = trimmedParent.includes("\\") ? "\\" : "/";
  return `${trimmedParent}${separator}${childName}`;
}

function suggestedCreateArchiveDefaultPath(_sources = createWorkspace.getSnapshot().sources): string {
  return createWorkspace.suggestedDestinationPath(createDestinationSuggestionOptions());
}

function createOutputFolderDefaultPath(destinationPath: string): string {
  const trimmed = destinationPath.trim();
  return nativeParentPath(trimmed || suggestedCreateArchiveDefaultPath());
}

function extractionDefaultsForArchive(archivePath: string): ExtractWorkspaceDefaults {
  const parent = nativeParentPath(archivePath);
  const configuredBase = appPreferences.customExtractFolderPath.trim() || defaultCreateDirectory(appPreferences) || parent;
  const suffix = getKnownArchiveSuffix(archivePath);
  const archiveName = getPathBasename(archivePath, APP_TITLE);
  const folderName = suffix && archiveName.toLowerCase().endsWith(suffix.toLowerCase())
    ? archiveName.slice(0, -suffix.length)
    : archiveName;
  const extractionAction = appPreferences.defaultExtractionBehavior === "extractHere"
    ? "extractHere"
    : "extractToFolder";
  const destinationPath = archiveExtractionPolicy(extractionAction).destination === "archiveParent"
    ? parent
    : joinNativePath(configuredBase, folderName || APP_TITLE);

  return {
    destinationPath,
    pathMode: appPreferences.defaultExtractPathMode,
    overwrite: appPreferences.defaultExtractOverwrite,
    stripComponents: appPreferences.defaultExtractStripComponents,
    deduplicateRoot: appPreferences.defaultExtractDeduplicateRoot,
    tzapRestorePolicy: appPreferences.defaultTzapRestorePolicy,
    tzapAllowDegraded: appPreferences.defaultTzapAllowDegraded,
    tzapAllowAbsoluteSymlinks: appPreferences.defaultTzapAllowAbsoluteSymlinks,
    ignoreSymlinks: appPreferences.defaultExtractIgnoreSymlinks,
  };
}

function applyExtractPreferenceDefaults(archivePath = archiveCurrentPath()) {
  extractWorkspace.applyDefaults(extractionDefaultsForArchive(archivePath));
}

function nativeParentPath(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash > 0 ? trimmed.slice(0, slash) : "";
}

function getEntryByPath(path: string): ArchiveEntryDto | null {
  const normalized = normalizeEntryPath(path);
  return archiveWorkspace.getSnapshot().entries
    .find((entry) => normalizeEntryPath(entry.path) === normalized) ?? null;
}

function getSelectedEntryDtos(): ArchiveEntryDto[] {
  return [...archiveWorkspace.getSnapshot().view.selection.selectedEntries];
}

function getVisibleSelectedEntryDtos(): ArchiveEntryDto[] {
  return [...archiveWorkspace.getSnapshot().view.selection.visibleSelectedEntries];
}

function getVisibleSelectedRows(): SelectableBrowserRow[] {
  return [...archiveWorkspace.getSnapshot().view.selection.visibleSelectedRows];
}

function getSelectedEntryPaths(): string[] {
  return [...archiveWorkspace.getSnapshot().view.selection.selectedEntryPaths];
}

async function startNativeDragOut(entryPath: string) {
  if (!archiveCurrentPath()) {
    return;
  }

  if (!isDesktopRuntime()) {
    setOperationalMessage("preview.nativeDragDesktopOnly");
    return;
  }

  if (!archiveSelectedPathSet().has(entryPath)) {
    applyArchiveTableSelection(ensureHierarchicalTablePathSelected({
      ...currentArchiveTableSelectionState(),
      path: entryPath,
    }));
  }

  let password: string | undefined;
  let requestResult = archiveWorkspace.buildNativeDragRequest({ entryPath, password });
  if (!requestResult.ok) {
    setOperationalMessage("preview.selectEntryToDrag");
    return;
  }
  let request = requestResult.request;

  setOperationalMessage("preview.preparingDrag", { count: request.entryPaths.length });

  while (true) {
    try {
      const response = await startNativeFileDrag(request);
      archiveWorkspace.clearPasswordRetry();
      if (response.outcome === "pending") {
        if (response.sessionId) {
          pendingNativeDragCounts.set(response.sessionId, response.draggedEntries.length);
        }
        setOperationalMessage("preview.dragPromiseStarted", {
          count: response.draggedEntries.length,
        });
      } else if (response.outcome === "cancelled") {
        setOperationalMessage("preview.dragCancelled");
      } else if (response.outcome === "noDrop") {
        setOperationalMessage("preview.dragNoDrop");
      } else {
        setOperationalMessage("preview.draggedOut", { count: response.draggedEntries.length });
      }
      return;
    } catch (error) {
      const commandError = asCommandError(error);
      const retry = requestArchivePasswordRetry("nativeDragOut", commandError);
      if (retry) {
        const nextPassword = promptForArchivePasswordRetry(retry);
        if (!nextPassword) {
          archiveWorkspace.clearPasswordRetry();
          setOperationalStatus(commandError?.message ?? message("preview.unableStartDrag"));
          return;
        }
        password = nextPassword;
        requestResult = archiveWorkspace.buildNativeDragRequest({ entryPath, password });
        if (!requestResult.ok) {
          setOperationalMessage("preview.selectEntryToDrag");
          return;
        }
        request = requestResult.request;
        continue;
      }

      setOperationalStatus(commandError?.message ?? message("preview.unableStartDrag"));
      return;
    }
  }
}

function getVisibleSelectablePaths(): string[] {
  return [...archiveWorkspace.getSnapshot().view.selection.visibleSelectablePaths];
}

function currentArchiveTableSelectionState() {
  const selection = archiveWorkspace.getSnapshot().view.selection;
  return {
    selectedPaths: new Set(selection.selectedPaths),
    focusedPath: selection.focusedPath,
    anchorPath: selection.anchorPath,
  };
}

function applyArchiveTableSelection(result: HierarchicalTableSelectionResult) {
  publishArchiveSnapshot(archiveWorkspace.updateSelection(result));
}

function currentSearchQuery(): string {
  return archiveSnapshot().view.searchQuery.trim();
}

function archiveListingFromFixture(listing: ArchiveFixture): ArchiveListingDto {
  return {
    archivePath: listing.archivePath,
    entries: [...listing.entries],
    entryCount: typeof listing.entryCount === "number" ? listing.entryCount : listing.entries.length,
    ...(typeof listing.totalSize === "number" ? { totalSize: listing.totalSize } : {}),
  };
}

function publishArchiveSnapshot(
  snapshot: ArchiveWorkspaceSnapshot = archiveWorkspace.getSnapshot(),
): ArchiveWorkspaceSnapshot {
  queueSystemIconRefresh();
  publishReactSnapshot();
  return snapshot;
}

function clearSearch() {
  if (!currentSearchQuery()) {
    return;
  }
  publishArchiveSnapshot(archiveWorkspace.clearSearch());
  void archiveLoadController.loadFolder(archiveCurrentFolder());
}

function currentWorkspaceMode(): WorkspaceDropMode {
  return shellWorkspace.getSnapshot().activeMode;
}

function renderOperationalStatus() {
  publishReactSnapshot();
}

function setOperationalStatus(message: string) {
  shellWorkspace.setOperationalStatus(message);
  renderOperationalStatus();
}

function setBrowseState(next: BrowseState, message = "") {
  const snapshot = archiveWorkspace.setBrowseState(next, next === "error" ? message : undefined);
  publishArchiveSnapshot(snapshot);

  if (message) {
    setOperationalStatus(message);
  } else if (next === "loading") {
    setOperationalMessage("status.loadingArchive");
  } else if (next === "error") {
    setOperationalMessage("status.failed");
  } else {
    setOperationalMessage("status.ready");
  }
}

function currentCommandClassState(hasArchive = Boolean(archiveCurrentPath())): CommandSurfaceClassState {
  const mode = currentWorkspaceMode();
  return {
    open: { primary: mode === "extract" && !hasArchive },
    refresh: { secondary: true },
  };
}

function promptForArchivePassword(promptMessage: string): string | null {
  return passwordPromptAdapter.promptForPassword(promptMessage);
}

function getArchivePasswordPrompt(commandCode: string): string {
  return commandCode === COMMAND_PASSWORD_REQUIRED
    ? displayContext.translator.t("browse.passwordRequired")
    : displayContext.translator.t("browse.passwordInvalid");
}

function requestArchivePasswordRetry(
  operation: ArchiveWorkspacePasswordRetryOperation,
  commandError: ReturnType<typeof asCommandError>,
): ArchiveWorkspacePasswordRetry | null {
  return archiveWorkspace.requestPasswordRetry({
    operation,
    error: commandError,
  });
}

function promptForArchivePasswordRetry(retry: ArchiveWorkspacePasswordRetry): string | null {
  return promptForArchivePassword(message(retry.promptKey));
}

function isPasswordCommandError(commandError: ReturnType<typeof asCommandError>): boolean {
  return (
    commandError?.code === COMMAND_PASSWORD_REQUIRED ||
    commandError?.code === COMMAND_INVALID_PASSWORD
  );
}

function currentCommandStateMap() {
  const snapshot = archiveWorkspace.getSnapshot();
  const commandContext = snapshot.command;

  return selectCommandState({
    ...commandContext,
    mutableOperationsSupported: false,
  });
}

function updateCommandState() {
  publishReactSnapshot();
}

const commandRouter = createCommandRouter({
  getCommandState: currentCommandStateMap,
  effects: {
    openArchive: (source, archivePath) => {
      if (source === "clipboard") {
        void openArchiveFromClipboard();
        return;
      }
      if (source === "path" && archivePath) {
        void openArchiveFromPath(archivePath);
        return;
      }
      void onOpenArchive();
    },
    closeArchive: closeCurrentArchive,
    addSources: (anchor) => {
      if (anchor) {
        showAddSourcesMenuAt(anchor.x, anchor.y);
        return;
      }

      void addSourcePathsFromDialog("files");
    },
    selectAll: selectVisibleEntries,
    deselectAll: clearBrowseSelection,
    invertSelection: invertVisibleSelectionEntries,
    selectByType: () => selectEntriesByType("add"),
    deselectByType: () => selectEntriesByType("remove"),
    openRoot: () => navigateToFolder(""),
    upOneLevel: navigateUp,
    openInside: () => {
      const selected = getSelectedEntryPaths();
      if (selected.length !== 1) {
        setOperationalMessage("command.singleFileRequired");
        return;
      }
      navigateToFolder(selected[0]);
    },
    openOutside: () => void onOpenOutsideSelectedEntry(),
    extract: (mode, destination) => {
      if (destination === "here") {
        const parent = nativeParentPath(archiveCurrentPath());
        const selectedEntries = mode === "selection" ? getSelectedEntryDtos() : [];
        const selectedFilePath = selectedEntries.length === 1 && selectedEntries[0]?.kind !== "directory"
          ? selectedEntries[0].path
          : undefined;
        const herePathOptions = extractHerePathOptions(extractWorkspace.buildStartInput(), {
          mode,
          selectedFilePath,
        });
        void startExtract(mode, {
          ...extractWorkspace.buildStartInput(),
          ...herePathOptions,
          destinationBasePath: parent,
        });
        return;
      }
      openExtractDialog(mode);
    },
    test: () => void onTestArchive(),
    view: () => void onPreviewSelectedEntry(),
    copySelectedPaths: () => void copySelectedEntryPathsToClipboard(),
    info: (target, entryPath) => {
      if (target === "archive") {
        showArchiveInfo();
        return;
      }
      if (target === "context") {
        const selectedRows = getVisibleSelectedRows();
        if (selectedRows.length > 1) {
          showSelectionInfo(selectedRows);
          return;
        }
        if (entryPath) {
          showEntryInfo(entryPath);
          return;
        }
        showArchiveInfo();
        return;
      }
      showCurrentInfo();
    },
    refresh: () => void onRefreshArchive(),
    exit: closeAppWindow,
    detailsView: () => setOperationalMessage("status.detailsViewActive"),
    sort: (key) => applySortCommand(key),
    toggleToolbarLabels: () => {
      savePreferencePatch({ showToolbarLabels: !appPreferences.showToolbarLabels });
    },
    options: openPreferencesDialog,
    about: openAboutDialog,
    toggleFlatView: () => setFlatView(!archiveSnapshot().view.flatView, true),
    deleteTempFiles: () => void onDeleteTemporaryFiles(),
    reportDisabled: (_commandId, reason) => {
      setOperationalStatus(localizedCommandStateReason(reason) ?? UNSUPPORTED_OPERATION_MESSAGE);
    },
    reportUnsupported: () => {
      setOperationalStatus(UNSUPPORTED_OPERATION_MESSAGE);
    },
  },
});

function commandPayload(commandId: CommandId): CommandRouterPayload {
  if (commandId === "extract") {
    return { extractMode: archiveSelectedCount() ? "selection" : "archive" };
  }

  return {};
}

function runRoutedCommand(commandId: CommandId, payload: CommandRouterPayload = {}): void {
  commandRouter.run(commandId, { ...commandPayload(commandId), ...payload });
}

function isMacOsFromContract(): boolean {
  return (
    latestContract?.platformIntegration.capabilities.some(
      (c) => c.id === "nativeHostLifecycle" && c.availability === "available",
    ) ?? false
  );
}

function isLocalSendAvailableFromContract(): boolean {
  return latestContract?.localSendAvailable ?? false;
}

function createCurrentReactSnapshot(): ZManagerReactSnapshot {
  const archive = archiveWorkspace.getSnapshot();
  const commandClassState = currentCommandClassState(archive.command.hasArchive);

  return createZManagerReactSnapshot({
    account: accountWorkspace.getSnapshot(),
    defaultHandlers: defaultHandlerController.getSnapshot(),
    localSendTrustedDevices: localSendTrustController.getSnapshot(),
    localSendDiscovery: localSendDiscoveryController.getSnapshot(),
    shareQueue: shareQueueController.getSnapshot(),
    localSendIncomingTransfers,
    shell: shellWorkspace.getSnapshot(),
    archive,
    create: createWorkspace.getSnapshot(),
    extract: extractWorkspace.getSnapshot(),
    systemIcons: cachedSystemIconsSnapshot,
    preferences: appPreferences,
    preferencesDraft: preferencesDialogDraft,
    columnVisibilityDraft,
    pathHistory: pathHistoryStore.getSnapshot(),
    display: displaySnapshotFromContext(displayContext),
    commands: {
      states: currentCommandStateMap(),
      pressed: {
        flatView: archive.view.flatView,
        showButtonText: appPreferences.showToolbarLabels,
      },
      primaryCommandIds: commandIdsWithClass(commandClassState, "primary"),
      secondaryCommandIds: commandIdsWithClass(commandClassState, "secondary"),
    },
    contextMenu: contextMenuRuntime.getSnapshot(),
    runtime: {
      isDesktop: isDesktopRuntime(),
      isMacOs: isMacOsFromContract(),
      isLocalSendAvailable: isLocalSendAvailableFromContract(),
    },
    dialog: reactDialogSnapshot,
  });
}

function commandIdsWithClass(
  classState: CommandSurfaceClassState,
  kind: "primary" | "secondary",
): CommandId[] {
  return (Object.keys(classState) as CommandId[])
    .filter((commandId) => Boolean(classState[commandId]?.[kind]));
}

function publishReactSnapshot() {
  reactRuntimeStore.publishSnapshot();
}

function handleReactAccountIntent(intent: ZManagerAccountIntent) {
  switch (intent.type) {
    case "open": void accountController.open(); break;
    case "close": accountController.close(); break;
    case "refresh": void accountController.open(); break;
    case "beginHostedAuth": void accountController.beginHostedAuth(intent.environment ?? "prod", intent.audience); break;
    case "forget": void accountController.forget(); break;
    case "generateRecipientKey": void accountController.generateRecipientKey(intent.label); break;
    case "generateSigningIdentity": void accountController.generateSigningIdentity(intent.commonName, intent.label); break;
    case "importSigningIdentity": void chooseAndImportAccountSigningIdentity(intent.password, intent.label); break;
    case "createSelfSignedCertificateStore": void accountController.createSelfSignedCertificateStore(intent.commonName); break;
    case "removeSigningIdentity": void accountController.removeSigningIdentity(intent.id); break;
    case "removeRecipientKey": void accountController.removeRecipientKey(intent.id); break;
    case "setDefaultSigningIdentity": void accountController.setDefaultSigningIdentity(intent.id); break;
    case "removeContact": void accountController.removeContact(intent.id); break;
    case "inspectContactCard": {
      try {
        void accountController.inspectContactCard(JSON.parse(intent.contactCard) as Record<string, unknown>);
      } catch {
        accountWorkspace.setNotice("Contact card must be valid JSON.");
        publishReactSnapshot();
      }
      break;
    }
    case "acceptContactCard": {
      try {
        void accountController.acceptContactCard(JSON.parse(intent.contactCard) as Record<string, unknown>);
      } catch {
        accountWorkspace.setNotice("Contact card must be valid JSON.");
        publishReactSnapshot();
      }
      break;
    }
    case "enrollCertificate": void accountController.handleEnroll(); break;
    case "renewCertificate": void accountController.handleRenew(intent.certificateId); break;
    case "retireDevice": void accountController.handleDeviceRetire(); break;
    case "syncContacts": void accountController.syncContacts(); break;
  }
}

function handleReactDialogIntent(intent: ZManagerDialogIntent) {
  switch (intent.type) {
    case "extract":
      openExtractDialog(intent.mode);
      break;
    case "extractHere":
      openExtractHereDialog(intent.mode);
      break;
    case "submitExtract":
      activeExtractMode = intent.mode;
      activeExtractDialogForm = extractDialogFormFromIntent(intent);
      activeExtractDialogMessage = extractDialogMessageForMode(intent.mode);
      void startExtract(
        intent.mode,
        extractStartInputFromDialogForm(activeExtractDialogForm, intent.password),
      );
      break;
    case "browseExtractDestination":
      void onSelectDestinationForExtract(extractDialogFormFromIntent(intent));
      break;
    case "preferences":
      openPreferencesDialog();
      break;
    case "about":
      openAboutDialog();
      break;
    case "info":
      if (intent.target === "archive") {
        showArchiveInfo();
      } else if (intent.entryPath) {
        showEntryInfo(intent.entryPath);
      } else {
        showCurrentInfo();
      }
      break;
    case "infoAction":
      handleInfoDialogAction(intent.action, intent.copyValue);
      break;
    case "copyAboutDiagnostics":
      void copyAboutDiagnostics();
      break;
    case "preferencesPatch":
      updateReactPreferencesDraft(intent.patch);
      break;
    case "preferencesSaveDirectPatch":
      savePreferencePatch(intent.patch);
      break;
    case "columnVisibilityPatch":
      columnVisibilityDraft = intent.visibility;
      publishReactSnapshot();
      break;
    case "preferencesCreateDefaultsPatch":
      updateReactCreateDefaultsDraft(intent.format, intent.patch);
      break;
    case "preferencesChooseOutput":
      void onSelectReactPreferenceOutputFolder();
      break;
    case "preferencesChooseExtractOutput":
      void onSelectReactPreferenceExtractFolder();
      break;
    case "preferencesChooseLanShareReceiveFolder":
      void onSelectReactPreferenceLanShareReceiveFolder();
      break;
    case "localSendTrustRefresh":
      void localSendTrustController.refresh();
      break;
    case "shareQueueOpenReceivers":
      void localSendDiscoveryController.openPicker(localSendAliasOrDefault());
      break;
    case "shareQueueRefreshReceivers":
      void localSendDiscoveryController.refresh(localSendAliasOrDefault());
      break;
    case "localSendTrustForget":
      void localSendTrustController.forget(intent.fingerprint);
      break;
    case "shareQueueSetReceiver":
      void shareQueueController.setReceiver(intent.shareId, intent.receiver).catch((error) => setOperationalStatus(unknownErrorMessage(error, "Unable to select the LAN receiver.")));
      break;
    case "shareQueueStart":
      void shareQueueController.start(intent.shareId, intent.acknowledgeDeliveryUncertainty).catch((error) => setOperationalStatus(unknownErrorMessage(error, "Unable to start the LAN share.")));
      break;
    case "shareQueueSkip":
      void shareQueueController.skip(intent.shareId).catch((error) => setOperationalStatus(unknownErrorMessage(error, "Unable to skip the LAN share.")));
      break;
    case "shareQueueCancel":
      void shareQueueController.cancel(intent.shareId).catch((error) => setOperationalStatus(unknownErrorMessage(error, "Unable to cancel the LAN share.")));
      break;
    case "shareQueueRemove":
      void shareQueueController.remove(intent.shareId).catch((error) => setOperationalStatus(unknownErrorMessage(error, "Unable to remove the LAN share.")));
      break;
    case "localSendIncomingRespond":
      void respondToLocalSendIncomingTransfer(intent.requestId, intent.decision, intent.alwaysAccept);
      break;
    case "defaultHandlersRefresh":
      void defaultHandlerController.refresh();
      break;
    case "defaultHandlersSet":
      void defaultHandlerController.set();
      break;
    case "defaultHandlersRestore":
      void defaultHandlerController.restore();
      break;
    case "preferencesSave":
      void saveReactPreferencesDraft();
      break;
    case "preferencesCancel":
      cancelReactPreferencesDialog();
      break;
    case "closeCurrent": {
      if (reactDialogSnapshot.kind !== "none") {
        closeReactDialog();
        break;
      }
      publishReactSnapshot();
      break;
    }
  }
}

function handleReactDesktopIntent(intent: ZManagerDesktopIntent) {
  switch (intent.type) {
    case "droppedPaths":
      handleDroppedPaths(intent.paths);
      break;
    case "dropEntered":
      if (intent.paths?.length) {
        setDropOverlayForPaths(intent.paths);
      } else {
        setDropOverlayForSurface(currentDropSurface());
      }
      break;
    case "dropLeft":
      clearDropOverlay();
      break;
    case "dropChoice":
      activatePendingDropChoice(intent.choice);
      break;
    case "windowControl":
      if (intent.control === "minimize") {
        minimizeAppWindow();
      } else if (intent.control === "toggleMaximize") {
        toggleAppWindowMaximize();
      } else {
        closeAppWindow();
      }
      break;
    case "beginWindowResize":
      if (browserDocument.usesManualWindowResize()) {
        void appWindowController.beginResizeDrag(intent.direction as AppWindowResizeDirection);
      }
      break;
  }
}

function handleReactContextMenuIntent(intent: ZManagerContextMenuIntent) {
  contextMenuRuntime.handleIntent(intent, handleContextMenuAction);
}

function handleArchiveDetailsAction(action: string) {
  if (action === "clear-search") {
    clearSearch();
    return;
  }

  const routedCommand = selectDetailsCommand(action);
  if (routedCommand) {
    runRoutedCommand(routedCommand.commandId, routedCommand.payload);
  }
}

function handleReactKeyboardIntent(intent: ZManagerKeyboardIntent) {
  switch (intent.type) {
    case "escape":
      contextMenuRuntime.hide();
      if (preferencesDialogDraft) {
        cancelReactPreferencesDialog();
      } else if (reactDialogSnapshot.kind !== "none") {
        closeReactDialog();
      } else {
        clearBrowseSelection();
      }
      break;
    case "focusSearch": {
      if (!archiveSnapshot().command.canSearchEntries) {
        setOperationalMessage("browse.noArchiveOpen");
      }
      break;
    }
  }
}

export function getZManagerRuntimeAdapter(): ZManagerReactRuntimeAdapter {
  return {
    getSnapshot: reactRuntimeStore.getSnapshot,
    subscribe: reactRuntimeStore.subscribe,
    actions: {
      executeCommand: runRoutedCommand,
      setWorkspaceMode,
      handleArchiveIntent: archiveRuntimeActions.handleIntent,
      handleCreateIntent: createRuntimeActions.handleIntent,

      handleAccountIntent: handleReactAccountIntent,
      handleDialogIntent: handleReactDialogIntent,
      handleDesktopIntent: handleReactDesktopIntent,
      handleContextMenuIntent: handleReactContextMenuIntent,
      handleKeyboardIntent: handleReactKeyboardIntent,
    },
  };
}

function setWorkspaceMode(mode: WorkspaceDropMode) {
  if (currentWorkspaceMode() === mode) {
    publishReactSnapshot();
    return;
  }

  shellWorkspace.setWorkspaceMode(mode);
  setOperationalMessage(mode === "compress" ? "workspace.mode.compressStatus" : "workspace.mode.extractStatus");
}

function navigateToCompressFolder(folderPath: string) {
  const navigation = createWorkspace.navigateToFolder(folderPath);
  if (!navigation.accepted) {
    return;
  }
  publishCreateWorkspaceSnapshot(navigation.snapshot);
}

function renderDetails() {
  publishReactSnapshot();
}

function renderBrowse() {
  publishArchiveSnapshot();
}

function browserCreatePlanPreview(paths: string[]): CreatePlanResponse {
  const planEntries: CreatePlanEntryDto[] = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)))
    .map((path) => {
      const name = getPathBasename(path) || path;
      const looksLikeFile = Boolean(pathExtension(path)) || isSupportedArchivePath(path);
      return {
        path: name,
        kind: looksLikeFile ? "file" : "directory",
        size: looksLikeFile ? 0 : undefined,
        sourcePath: path,
      };
    });
  return {
    includedCount: planEntries.length,
    excludedCount: 0,
    totalBytes: 0,
    excludedBytes: 0,
    entries: planEntries.map((entry) => entry.path),
    planEntries,
    excludedEntries: [],
    warnings: [],
  };
}

function canUseBrowserCreatePlanPreview(): boolean {
  return !isDesktopRuntime();
}

function createPlanEntries(snapshot: CreateWorkspaceSnapshot = createWorkspace.getSnapshot()): CreatePlanEntryDto[] {
  return snapshot.plan.current?.planEntries ?? [];
}

function compressRowInclusionState(row: CompressPlanRow): "included" | "excluded" | "partial" {
  return createWorkspace.getRowInclusionState(row);
}

function setCompressPathIncluded(path: string, included: boolean) {
  createWorkspace.setPathIncluded(path, included);
}

function clearCreateSources() {
  const result = createWorkspace.clearSources();
  createWorkspace.clearSelection();
  publishCreateWorkspaceSnapshot(result.snapshot);
  queuePlanRun();
}

function removeCreateSources(sourcePaths: string[]) {
  const result = createWorkspace.removeSources(sourcePaths);
  if (!result.changed) {
    return;
  }
  createWorkspace.clearSelection();
  publishCreateWorkspaceSnapshot(result.snapshot);
  queuePlanRun();
}

function visibleCompressRows(): CompressPlanRow[] {
  return [...createWorkspace.getSnapshot().view.rows];
}

function visibleCompressRowForPath(path: string): CompressPlanRow | undefined {
  const normalizedPath = normalizeEntryPath(path);
  return visibleCompressRows().find((row) => normalizeEntryPath(row.path) === normalizedPath);
}

function sourcePathForCompressRow(
  row: CompressPlanRow,
  snapshot: CreateWorkspaceSnapshot = createWorkspace.getSnapshot(),
): string {
  return sourcePathForCreatePlanRow(row, createPlanEntries(snapshot), snapshot.sources);
}

function selectedCompressSourcePaths(): string[] {
  const snapshot = createWorkspace.getSnapshot();
  return Array.from(new Set(
    snapshot.selection.selectedPaths
      .map((rowPath) => removableSourcePathForCompressPath(rowPath, snapshot))
      .filter(Boolean),
  ));
}

function removableSourcePathForCompressPath(
  rowPath: string,
  snapshot: CreateWorkspaceSnapshot = createWorkspace.getSnapshot(),
): string {
  if (!rowPath || snapshot.view.currentFolder) {
    return "";
  }

  const row = visibleCompressRowForPath(rowPath);
  const sourcePath = row ? sourcePathForCompressRow(row, snapshot) : "";
  return snapshot.sources.includes(sourcePath) &&
      normalizeEntryPath(rowPath) === getPathBasename(sourcePath)
    ? sourcePath
    : "";
}

function sourcePathsForCompressMenu(rowSourcePath: string): string[] {
  const selectedSourcePaths = selectedCompressSourcePaths();
  if (!rowSourcePath) {
    return selectedSourcePaths;
  }
  return selectedSourcePaths.includes(rowSourcePath) && selectedSourcePaths.length > 1
    ? selectedSourcePaths
    : [rowSourcePath];
}

function compressPathsForContextAction(rowPath: string): string[] {
  const selection = createWorkspace.getSnapshot().selection;
  if (!rowPath) {
    return [];
  }
  if (selection.selectedPaths.includes(rowPath) && selection.selectedPaths.length > 1) {
    const visiblePaths = new Set(selection.visibleSelectablePaths);
    return selection.selectedPaths.filter((path) => visiblePaths.has(path));
  }
  return [rowPath];
}

function maybeCloseQuickActionOnlyCoordinator(): void {
  const input = {
    desktopRuntime: isDesktopRuntime(),
    hasOpenTaskWindows: disposableTaskWindows.hasOpenWindows(),
    hasActiveJobs: processJobs.hasActiveJobs(),
    mainWindowShown: shellWorkspace.getSnapshot().quickActionWindow.shown,
  };
  if (!disposableTaskLifecycle.shouldCloseCoordinator(input)) {
    return;
  }
  diagnostics.record({
    scope: "quickActionLifecycle",
    name: "coordinatorCloseRequested",
    fields: {
      ...input,
      quickActionOnlyCoordinator: disposableTaskLifecycle.getSnapshot().quickActionOnlyCoordinator,
      quickActionActivityObserved: disposableTaskLifecycle.getSnapshot().quickActionActivityObserved,
      pendingQuickActionRequests: disposableTaskLifecycle.getSnapshot().pendingQuickActionRequests,
    },
  });
  void appWindowController.destroyCurrentWindow().catch((error) => {
    diagnostics.record({
      scope: "quickActionLifecycle",
      name: "coordinatorDestroyFailed",
      fields: {
        error: unknownErrorMessage(error, "Unable to close the quick-action coordinator."),
      },
    });
  });
}

function queuePlanRun() {
  createPlanController.queuePlanRun();
}

function cancelQueuedPlanRun() {
  createPlanController.cancelQueuedPlanRun();
}

function recordExtractDestinationHistory(destination: string): void {
  archiveOpenController.recordExtractDestinationHistory(destination);
}

function renderExtractDestinationHistory() {
  if (reactDialogSnapshot.kind === "extract") {
    updateOpenExtractDialogSnapshot();
  } else {
    publishReactSnapshot();
  }
}

function recordCreateDestinationHistory(destination: string): void {
  archiveOpenController.recordCreateDestinationHistory(destination);
}

function recordRecentArchiveHistory(archivePath: string): void {
  archiveOpenController.recordRecentArchiveHistory(archivePath);
}

function extractDialogMessageForMode(mode: ExtractMode): string {
  const selectedCount = archiveSelectedCount();
  return mode === "selection"
    ? message("extract.selectedMessage", {
      count: selectedCount,
      entryLabel: message(selectedCount === 1 ? "extract.entrySingular" : "extract.entryPlural"),
    })
    : message("extract.archiveMessage");
}

function requestExtractPasswordInDialog(retry: ArchiveWorkspacePasswordRetry) {
  extractWorkspace.setOptions({ passwordPromptOpen: true });
  setOperationalStatus(message(retry.promptKey));
  publishReactSnapshot();
}

function toNumberOrUndefined(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? undefined : Math.trunc(parsed);
}

function currentExtractDialogStripComponents(): number {
  return toNumberOrUndefined(activeExtractDialogForm.stripComponents) ?? 0;
}

async function openNativeDialog(options: NativeDialogOpenOptions) {
  return openRuntimeDialog(options, setOperationalStatus, {
    unavailableInBrowser: message("nativeDialog.unavailableInBrowser"),
    failed: message("nativeDialog.failed"),
  });
}

function setReactDialogSnapshot(snapshot: ZManagerDialogSnapshot) {
  reactDialogSnapshot = snapshot;
  publishReactSnapshot();
}

function closeReactDialog() {
  const previous = reactDialogSnapshot;
  reactDialogSnapshot = { kind: "none" };
  extractWorkspace.setOptions({ passwordPromptOpen: false });
  if (previous.kind === "extract") {
    archiveWorkspace.clearPasswordRetry();
    activeExtractDialogForm = patchExtractDialogFormSnapshot(activeExtractDialogForm, {
      passwordPromptOpen: false,
    });
  }
  publishReactSnapshot();
}

function buildReactExtractDialogSnapshot(
  mode: ExtractMode,
  messageText: string,
  form: ExtractDialogFormSnapshot,
): Extract<ZManagerDialogSnapshot, { kind: "extract" }> {
  return {
    kind: "extract",
    mode,
    title: message(mode === "selection" ? "extract.selectedTitle" : "extract.archiveTitle"),
    message: messageText,
    startLabel: message(mode === "selection" ? "extract.selectedAction" : "extract.allAction"),
    destination: form.destination,
    destinationHistory: [...pathHistoryStore.getSnapshot().extractDestinationHistory],
    useSubfolder: form.useSubfolder,
    subfolder: form.subfolder,
    pathMode: form.pathMode,
    overwrite: form.overwrite,
    stripComponents: form.stripComponents,
    deduplicateRoot: form.deduplicateRoot,
    tzapRestorePolicy: form.tzapRestorePolicy,
    tzapAllowDegraded: form.tzapAllowDegraded,
    tzapAllowAbsoluteSymlinks: form.tzapAllowAbsoluteSymlinks,
    ignoreSymlinks: form.ignoreSymlinks,
    passwordPromptOpen: form.passwordPromptOpen,
  };
}

function updateOpenExtractDialogSnapshot(options: Readonly<{
  mode?: ExtractMode;
  messageText?: string;
  formPatch?: ExtractDialogFormPatch;
  form?: ExtractDialogFormSnapshot;
}> = {}) {
  if (reactDialogSnapshot.kind !== "extract") {
    return;
  }

  activeExtractMode = options.mode ?? activeExtractMode;
  activeExtractDialogForm = options.form
    ?? patchExtractDialogFormSnapshot(activeExtractDialogForm, options.formPatch ?? {});
  activeExtractDialogMessage = options.messageText
    ?? (activeExtractDialogMessage || extractDialogMessageForMode(activeExtractMode));
  setReactDialogSnapshot(buildReactExtractDialogSnapshot(
    activeExtractMode,
    activeExtractDialogMessage,
    activeExtractDialogForm,
  ));
}

function openReactExtractDialogSnapshot(
  mode: ExtractMode,
  form: ExtractDialogFormSnapshot,
  messageText: string,
) {
  activeExtractMode = mode;
  activeExtractDialogForm = form;
  activeExtractDialogMessage = messageText;
  setReactDialogSnapshot(buildReactExtractDialogSnapshot(mode, messageText, form));
}

function extractDialogFormFromIntent(
  input: Extract<ZManagerDialogIntent, { type: "submitExtract" | "browseExtractDestination" }>,
): ExtractDialogFormSnapshot {
  return createExtractDialogFormSnapshot({
    destination: input.destination,
    useSubfolder: input.useSubfolder,
    subfolder: input.subfolder,
    pathMode: input.pathMode,
    overwrite: input.overwrite as ExtractOverwritePolicy,
    stripComponents: input.stripComponents,
    deduplicateRoot: input.deduplicateRoot,
    tzapRestorePolicy: input.tzapRestorePolicy,
    tzapAllowDegraded: input.tzapAllowDegraded,
    tzapAllowAbsoluteSymlinks: input.tzapAllowAbsoluteSymlinks,
    ignoreSymlinks: input.ignoreSymlinks,
    passwordPromptOpen: activeExtractDialogForm.passwordPromptOpen,
  });
}

function isCreateSubmissionInFlight(): boolean {
  return createWorkspace.getSnapshot().options.submissionInFlight;
}

function currentDropSurface(): DropIntentSurface {
  return dropSurfaceForWorkspace({ createDialogOpen: false, mode: currentWorkspaceMode() });
}

function renderDropOverlay(snapshot: ShellWorkspaceSnapshot = shellWorkspace.getSnapshot()) {
  void snapshot;
  publishReactSnapshot();
}

function setDropOverlay(mode: DropOverlayMode, copy?: DropOverlayCopy) {
  renderDropOverlay(shellWorkspace.setDropOverlay(mode, copy));
}

function setDropOverlayChoice(decision: Extract<DropIntentDecision, { kind: "askAction" }>, copy: DropOverlayCopy) {
  renderDropOverlay(shellWorkspace.setDropOverlayChoice(decision, copy));
}

function clearDropOverlay() {
  renderDropOverlay(shellWorkspace.clearDropOverlay());
}

function dropCopyForSurface(surface: DropIntentSurface): DropOverlayCopy {
  if (surface === "create") {
    return {
      titleKey: "drop.addSources.title",
      messageKey: "drop.addSources.copyMessage",
      ...(isDesktopRuntime() ? {} : { supportKey: "drop.browserPreview" }),
      target: "compress",
    };
  }

  if (archiveCurrentPath()) {
    return {
      titleKey: "drop.openArchive.title",
      messageKey: "drop.openArchive.message",
      ...(isDesktopRuntime() ? {} : { supportKey: "drop.browserPreview" }),
      target: "extract",
    };
  }

  return {
    titleKey: "drop.chooseMode.title",
    messageKey: "drop.chooseMode.message",
    ...(isDesktopRuntime() ? {} : { supportKey: "drop.browserPreview" }),
    target: "choose",
  };
}

function dropCopyForDecision(decision: DropIntentDecision): DropOverlayCopy {
  if (isCreateSubmissionInFlight()) {
    return {
      titleKey: "drop.blocked.title",
      messageKey: "drop.blocked.message",
      target: "blocked",
    };
  }

  switch (decision.kind) {
    case "openArchive":
      return {
        titleKey: "drop.openArchive.title",
        messageKey: "drop.openArchive.actionMessage",
        messageParams: { archiveName: getPathBasename(decision.archivePath) || decision.archivePath },
        ...(isDesktopRuntime() ? {} : { supportKey: "drop.browserPreview" }),
        target: "extract",
      };
    case "addCreateSources":
      return {
        titleKey: "drop.addSources.title",
        messageKey: "drop.addSources.copyMessage",
        ...(isDesktopRuntime() ? {} : { supportKey: "drop.browserPreview" }),
        target: "compress",
      };
    case "askAction":
      return {
        titleKey: "drop.chooseMode.title",
        messageKey: "drop.chooseMode.mixedMessage",
        messageParams: {
          archiveCount: decision.archivePaths.length,
          sourceCount: decision.sourcePaths.length,
        },
        ...(isDesktopRuntime() ? {} : { supportKey: "drop.browserPreview" }),
        target: "choose",
        showActions: true,
      };
    case "rejectUnsupportedDrop":
      return {
        titleKey: "drop.blocked.title",
        messageKey: decision.reason === "emptyDrop" ? "drop.empty" : "drop.browseRequiresArchive",
        target: "blocked",
      };
  }
}

function setDropOverlayForSurface(surface: DropIntentSurface) {
  setDropOverlay("active", dropCopyForSurface(surface));
}

function setDropOverlayForPaths(paths: readonly DroppedPath[]) {
  const filteredPaths = paths
    .map((path) => (typeof path === "string" ? path.trim() : path.path.trim()))
    .filter(Boolean);
  if (filteredPaths.length === 0) {
    setDropOverlayForSurface(currentDropSurface());
    return;
  }

  const decision = classifyDropIntent(paths, currentDropSurface());
  setDropOverlay("active", dropCopyForDecision(decision));
}

function rejectDrop(reason: string) {
  switch (reason) {
    case "emptyDrop":
      setOperationalMessage("drop.empty");
      break;
    case "openRequiresSingleArchive":
      setOperationalMessage("drop.openRequiresSingleArchive");
      break;
    case "browseRequiresArchive":
      setOperationalMessage("drop.browseRequiresArchive");
      break;
    default:
      setOperationalMessage("drop.unsupported");
  }
}

function addDroppedSources(paths: string[]) {
  applyCreatePreferenceDefaults();
  applyExtractPreferenceDefaults();
  addSources(paths);
  setWorkspaceMode("compress");
  setOperationalMessage("drop.sourcesAdded", {
    count: paths.length,
    sourceLabel: message(paths.length === 1 ? "compress.sourceSingular" : "compress.sourcePlural"),
  });
}

function handleDropDecision(decision: DropIntentDecision, chosenAction?: "openArchive" | "addToCompress") {
  if (chosenAction === "openArchive" && "archivePaths" in decision && decision.archivePaths.length > 0) {
    void openArchiveFromPath(decision.archivePaths[0]);
    clearDropOverlay();
    return;
  }

  if (chosenAction === "addToCompress" && "sourcePaths" in decision && "archivePaths" in decision) {
    addDroppedSources([...decision.archivePaths, ...decision.sourcePaths]);
    clearDropOverlay();
    return;
  }

  switch (decision.kind) {
    case "openArchive":
      if (decision.extraArchivePaths?.length) {
        setOperationalMessage("drop.openedWithSkipped", {
          archivePath: decision.archivePath,
          count: decision.extraArchivePaths.length,
        });
      }
      void openArchiveFromPath(decision.archivePath);
      clearDropOverlay();
      break;
    case "addCreateSources":
      addDroppedSources(decision.sourcePaths);
      clearDropOverlay();
      break;
    case "askAction":
      setDropOverlayChoice(decision, dropCopyForDecision(decision));
      break;
    case "rejectUnsupportedDrop":
      rejectDrop(decision.reason);
      clearDropOverlay();
      break;
  }
}

function handleDroppedPaths(paths: readonly DroppedPath[]) {
  const trimmedPaths = paths
    .map((path) => (typeof path === "string" ? path.trim() : path.path.trim()))
    .filter(Boolean);
  if (isCreateSubmissionInFlight()) {
    setOperationalMessage("drop.waitForStart");
    setDropOverlay("active", {
      titleKey: "drop.blocked.title",
      messageKey: "drop.blocked.message",
      target: "blocked",
    });
    return;
  }

  const surface = currentDropSurface();
  const decision = classifyDropIntent(trimmedPaths, surface);
  handleDropDecision(decision);
}

function droppedPathsFromDesktopEvent(event: DesktopFileDropEvent): DroppedPath[] {
  const eventWithPaths = event as DesktopFileDropEvent & { paths?: string[] };
  return Array.isArray(eventWithPaths.paths) ? eventWithPaths.paths : [];
}

function handleTauriDropEvent(event: DesktopFileDropEvent) {
  if (event.type === "enter") {
    const paths = droppedPathsFromDesktopEvent(event);
    if (paths.length) {
      setDropOverlayForPaths(paths);
    } else {
      setDropOverlayForSurface(currentDropSurface());
    }
    return;
  }

  if (event.type === "drop") {
    handleDroppedPaths(droppedPathsFromDesktopEvent(event));
    return;
  }

  if (event.type === "leave") {
    clearDropOverlay();
  }
}

async function bindTauriFileDrop() {
  if (!isDesktopRuntime()) {
    return;
  }

  try {
    dropUnlisten = await bindDesktopFileDrop(handleTauriDropEvent);
  } catch (error) {
    setOperationalStatus(unknownErrorMessage(error, "File drag/drop is unavailable."));
  }
}

function activatePendingDropChoice(action: "openArchive" | "addToCompress" | "cancel") {
  if (action === "cancel") {
    clearDropOverlay();
    return;
  }

  const pendingChoice = shellWorkspace.getSnapshot().dropOverlay.pendingChoice;
  if (!pendingChoice) {
    clearDropOverlay();
    return;
  }

  handleDropDecision(
    {
      kind: "askAction",
      surface: pendingChoice.surface,
      archivePaths: [...pendingChoice.archivePaths],
      sourcePaths: [...pendingChoice.sourcePaths],
    },
    action,
  );
}

function navigateToFolder(folderPath: string) {
  const before = archiveWorkspace.getSnapshot().view;
  const snapshot = archiveWorkspace.navigateToFolder(folderPath);
  if (
    snapshot.view.currentFolder === before.currentFolder &&
    snapshot.view.navigationHistory.length === before.navigationHistory.length &&
    snapshot.view.searchQuery === before.searchQuery
  ) {
    return;
  }

  publishArchiveSnapshot(snapshot);

  const beforeExpanded = new Set(before.expandedTreeFolders);
  for (const folder of snapshot.view.expandedTreeFolders) {
    if (!beforeExpanded.has(folder)) {
      void archiveLoadController.loadTreeFolder(folder);
    }
  }

  void archiveLoadController.loadFolder(snapshot.view.currentFolder);
}

function navigateBack() {
  const before = archiveWorkspace.getSnapshot().view;
  const snapshot = archiveWorkspace.navigateBack();
  if (
    snapshot.view.currentFolder === before.currentFolder &&
    snapshot.view.navigationHistory.length === before.navigationHistory.length
  ) {
    return;
  }
  publishArchiveSnapshot(snapshot);
  void archiveLoadController.loadFolder(snapshot.view.currentFolder);
}

function navigateUp() {
  if (!archiveCurrentFolder()) {
    return;
  }
  const before = archiveWorkspace.getSnapshot().view;
  const snapshot = archiveWorkspace.navigateUp();
  if (
    snapshot.view.currentFolder === before.currentFolder &&
    snapshot.view.navigationHistory.length === before.navigationHistory.length
  ) {
    return;
  }
  publishArchiveSnapshot(snapshot);
  void archiveLoadController.loadFolder(snapshot.view.currentFolder);
}

function updateSelectionByIntent(
  entryPath: string,
  options?: { shift?: boolean; ctrl?: boolean; meta?: boolean },
) {
  const selection = currentArchiveTableSelectionState();
  applyArchiveTableSelection(applyHierarchicalRowSelectionIntent({
    path: entryPath,
    visiblePaths: getVisibleSelectablePaths(),
    currentSelection: selection.selectedPaths,
    anchorPath: selection.anchorPath,
    shiftKey: Boolean(options?.shift),
    ctrlKey: Boolean(options?.ctrl),
    metaKey: Boolean(options?.meta),
  }));
}

function selectAllVisibleEntries() {
  applyArchiveTableSelection(selectAllVisibleHierarchicalRows(getVisibleSelectablePaths()));
}

function invertVisibleSelectionEntries() {
  const selection = currentArchiveTableSelectionState();
  applyArchiveTableSelection(invertVisibleHierarchicalSelection({
    currentSelection: selection.selectedPaths,
    visiblePaths: getVisibleSelectablePaths(),
  }));
}

function selectEntriesByType(mode: "add" | "remove") {
  let selection = currentArchiveTableSelectionState();
  if (!selection.focusedPath) {
    if (selection.selectedPaths.size > 0) {
      applyArchiveTableSelection(focusHierarchicalTablePath(
        selection,
        getSelectedEntryPaths()[0] ?? "",
      ));
      selection = currentArchiveTableSelectionState();
    }
  }

  if (!selection.focusedPath) {
    return;
  }

  const sameType = pathsWithSameExtension(selection.focusedPath, getVisibleSelectablePaths());
  const nextSelection = new Set(selection.selectedPaths);

  for (const path of sameType) {
    if (mode === "add") {
      nextSelection.add(path);
    } else {
      nextSelection.delete(path);
    }
  }

  applyArchiveTableSelection(replaceHierarchicalTableSelection({
    paths: [...nextSelection],
    focusedPath: selection.focusedPath,
    anchorPath: selection.anchorPath,
  }));
}

function selectVisibleEntries() {
  selectAllVisibleEntries();
}

function clearBrowseSelection() {
  applyArchiveTableSelection(clearHierarchicalTableSelection());
}

function tableColumnById(columnId: ArchiveTableColumnId): ArchiveTableColumn | undefined {
  const snapshot = archiveWorkspace.getSnapshot();
  return visibleColumns(snapshot.view.tableColumns).find((column) => column.id === columnId)
    ?? ARCHIVE_TABLE_COLUMNS.find((column) => column.id === columnId);
}

function setTableColumnWidth(columnId: ArchiveTableColumnId, width: number, _persist = false) {
  archiveWorkspace.setColumnWidth(columnId, width);
  publishReactSnapshot();
}

function adjustTableColumnWidth(columnId: ArchiveTableColumnId, delta: number) {
  const column = tableColumnById(columnId);
  if (!column) {
    return;
  }
  setTableColumnWidth(columnId, column.width + delta);
}

function resetTableColumnWidth(columnId: ArchiveTableColumnId) {
  const column = ARCHIVE_TABLE_COLUMNS.find((item) => item.id === columnId);
  if (!column) {
    return;
  }
  setTableColumnWidth(columnId, column.width);
}

function showStartupContextMenu(x: number, y: number) {
  contextMenuRuntime.show(x, y, buildStartupContextMenuItems({
    translator: displayContext.translator,
    canPastePath: canReadClipboard(),
    recentArchiveHistory: pathHistoryStore.getSnapshot().recentArchiveHistory,
  }));
}

function showFolderContextMenu(folderPath: string, x: number, y: number, entryPath = "") {
  if (entryPath && !archiveSelectedPathSet().has(entryPath)) {
    applyArchiveTableSelection(ensureHierarchicalTablePathSelected({
      ...currentArchiveTableSelectionState(),
      path: entryPath,
    }));
  }
  contextMenuRuntime.show(x, y, buildArchiveFolderContextMenuItems({
    translator: displayContext.translator,
    folderPath,
    entryPath,
    selectedCount: getSelectedEntryPaths().length,
    hasArchive: Boolean(archiveCurrentPath()),
  }));
}

function showEntryContextMenu(entryPath: string, x: number, y: number) {
  if (!archiveSelectedPathSet().has(entryPath)) {
    applyArchiveTableSelection(ensureHierarchicalTablePathSelected({
      ...currentArchiveTableSelectionState(),
      path: entryPath,
    }));
  }
  const entry = getEntryByPath(entryPath);
  const selectedCount = getSelectedEntryPaths().length;
  contextMenuRuntime.show(x, y, buildArchiveEntryContextMenuItems({
    translator: displayContext.translator,
    entryPath,
    canOpenInside: entry?.kind === "directory",
    canOpenOutside: selectedCount === 1 && entry?.kind !== "directory",
    selectedCount,
    selectedEntryCount: archiveSelectedCount(),
    hasArchive: Boolean(archiveCurrentPath()),
  }));
}

function showTableHeaderContextMenu(x: number, y: number, selectedColumnId?: ArchiveTableColumnId) {
  const snapshot = archiveWorkspace.getSnapshot();
  contextMenuRuntime.show(x, y, buildArchiveHeaderContextMenuItems({
    translator: displayContext.translator,
    tableColumnSettings: snapshot.view.tableColumns,
    selectedColumnId,
    archivePath: snapshot.currentArchivePath,
  }));
}

function showCreateTableHeaderContextMenu(
  x: number,
  y: number,
  selectedColumnId?: CreateSourceColumnId,
) {
  const snapshot = createWorkspace.getSnapshot();
  contextMenuRuntime.show(x, y, buildCreateHeaderContextMenuItems({
    translator: displayContext.translator,
    tableColumnSettings: snapshot.view.columnSettings,
    selectedColumnId,
    availableColumnIds: compressCapabilitySet,
  }));
}

function showCompressRowContextMenuForPath(
  rowPath: string,
  rowSourcePath: string,
  x: number,
  y: number,
) {
  const snapshot = createWorkspace.getSnapshot();
  const row = visibleCompressRowForPath(rowPath);
  if (!row) {
    return;
  }

  const folderPath = row.rowType === "folder" || (row.rowType === "entry" && row.entry.kind === "directory")
    ? row.path
    : undefined;
  const sourcePath = rowSourcePath || sourcePathForCompressRow(row, snapshot);
  const removableSourcePath = removableSourcePathForCompressPath(row.path, snapshot);
  const removableSourcePaths = removableSourcePath ? sourcePathsForCompressMenu(removableSourcePath) : [];
  const contextPaths = compressPathsForContextAction(rowPath);
  const contextRows = contextPaths
    .map((path) => visibleCompressRowForPath(path))
    .filter((candidate): candidate is CompressPlanRow => Boolean(candidate));
  const canInclude = contextRows.some((compressRow) => compressRowInclusionState(compressRow) !== "included");
  const canExclude = contextRows.some((compressRow) => compressRowInclusionState(compressRow) !== "excluded");
  contextMenuRuntime.show(x, y, buildCompressRowContextMenuItems({
    translator: displayContext.translator,
    rowPath,
    folderPath,
    sourcePath,
    contextRowCount: contextRows.length,
    removableSourceCount: removableSourcePaths.length,
    canInclude,
    canExclude,
    hasSources: snapshot.hasSources,
  }));
}

function showSourceContextMenu(sourcePath: string, x: number, y: number) {
  contextMenuRuntime.show(x, y, buildSourceContextMenuItems({
    translator: displayContext.translator,
    sourcePath,
  }));
}

function showAddSourcesMenuAt(x: number, y: number) {
  contextMenuRuntime.show(x, y, buildAddSourcesContextMenuItems(displayContext.translator));
}

function handleContextMenuAction(payload: ContextMenuActionPayload) {
  const action = payload.action;
  const folderPath = payload.folderPath;
  const columnId = payload.columnId;
  const archivePath = payload.archivePath;
  const entryPath = payload.entryPath ?? "";
  const sourcePath = payload.sourcePath ?? "";
  const routedContextCommand = selectContextCommand(action, {
    archivePath,
    entryPath,
    extractMode: archiveSelectedCount() ? "selection" : "archive",
  });
  if (routedContextCommand) {
    runRoutedCommand(routedContextCommand.commandId, routedContextCommand.payload);
    return;
  }
  if (action === "add-source-files") {
    void addSourcePathsFromDialog("files");
    return;
  }
  if (action === "add-source-folder") {
    void addSourcePathsFromDialog("folder");
    return;
  }
  if (action === "compress-open-folder" && folderPath !== undefined) {
    navigateToCompressFolder(folderPath);
    return;
  }
  if (action === "open-folder" && folderPath !== undefined) {
    navigateToFolder(folderPath);
    return;
  }
  if (action === "open-entry") {
    const selectedPath = entryPath;
    if (!selectedPath) {
      return;
    }
    const selectedEntry = getEntryByPath(selectedPath);
    if (selectedEntry?.kind === "directory") {
      navigateToFolder(selectedPath);
    } else {
      applyArchiveTableSelection(replaceHierarchicalTableSelection({
        paths: [selectedPath],
        focusedPath: selectedPath,
        anchorPath: selectedPath,
      }));
      runRoutedCommand("view");
    }
    return;
  }
  const archiveColId = columnId as ArchiveTableColumnId | undefined;
  if (currentWorkspaceMode() === "compress") {
    const createColId = columnId as CreateSourceColumnId | undefined;
    if (action === "toggle-column" && createColId) {
      createWorkspaceHadLocalColumnMutation = true;
      publishCreateWorkspaceSnapshot(createWorkspace.toggleColumnVisibility(createColId));
      return;
    }
    if (action === "reset-columns") {
      const resolved = resolveCompressColumns({
        capabilitySet: compressCapabilitySet,
        visibilityPrefs: columnVisibilityPrefs,
      });
      publishCreateWorkspaceSnapshot(createWorkspace.resetColumns(
        createSettingsFromResolved(resolved),
      ));
      return;
    }
  } else {
    if (action === "sort-ascending" && archiveColId) {
      applySortDirection(archiveColId, true);
      return;
    }
    if (action === "sort-descending" && archiveColId) {
      applySortDirection(archiveColId, false);
      return;
    }
    if (action === "toggle-column" && archiveColId) {
      archiveWorkspace.toggleColumnVisibility(archiveColId);
      publishReactSnapshot();
      return;
    }
    if (action === "reset-columns") {
      const archivePath = archiveCurrentPath();
      const familyRes = archivePath
        ? resolveExtractFamilyFromPath(archivePath)
        : { kind: "unknown" as const };
      const resolved = resolveExtractColumns({
        familyResolution: familyRes,
        visibilityPrefs: columnVisibilityPrefs,
      });
      archiveWorkspace.resetColumns(archiveSettingsFromResolved(resolved));
      // Apply sort fallback if the configured sort key is no longer visible
      const sortSnap = archiveWorkspace.getSnapshot();
      const fallback = resolveExtractSortKey(
        appPreferences.tableSortKey,
        appPreferences.tableSortAscending,
        resolved.currentVisibleIds,
      );
      if (fallback.sortKey !== sortSnap.view.sort.key) {
        applySortDirection(fallback.sortKey as ArchiveSortKey, fallback.sortAscending);
      }
      publishReactSnapshot();
      return;
    }
  }

  if (action === "reveal-source" && sourcePath) {
    void revealInFileManager(sourcePath).catch((error) => {
      setOperationalStatus(unknownErrorMessage(error, message("preview.unableRevealSource")));
    });
    return;
  }
  if (action === "include-compress-path" || action === "exclude-compress-path") {
    const path = payload.compressMenuPath;
    if (path) {
      for (const compressPath of compressPathsForContextAction(path)) {
        setCompressPathIncluded(compressPath, action === "include-compress-path");
      }
      publishReactSnapshot();
    }
    return;
  }
  if (action === "remove-source") {
    removeCreateSources(sourcePathsForCompressMenu(sourcePath));
    return;
  }
  if (action === "clear-sources") {
    clearCreateSources();
  }
}

function showArchiveInfo() {
  setReactDialogSnapshot(buildArchiveInfoDialogSnapshot({
    archive: archiveWorkspace.getSnapshot(),
    display: displayContext,
    lastTestStatus: null,
    returnFocusPath: infoReturnFocusPath(),
  }));
}

function showEntryInfo(path: string) {
  const entry = getEntryByPath(path);
  if (!entry) {
    return;
  }

  setReactDialogSnapshot(buildEntryInfoDialogSnapshot({
    entry,
    display: displayContext,
    previewActionTitle: previewActionHint(),
    returnFocusPath: infoReturnFocusPath(),
  }));
}

function showSelectionInfo(selectedRows = getVisibleSelectedRows()) {
  if (selectedRows.length === 0) {
    showArchiveInfo();
    return;
  }

  setReactDialogSnapshot(buildSelectionInfoDialogSnapshot({
    archive: archiveWorkspace.getSnapshot(),
    display: displayContext,
    selectedRows,
    returnFocusPath: infoReturnFocusPath(),
  }));
}

function showCurrentInfo() {
  const selectedRows = getVisibleSelectedRows();
  if (selectedRows.length === 1) {
    const entry = selectedRows[0].entry ?? getEntryByPath(selectedRows[0].path);
    if (entry) {
      showEntryInfo(entry.path);
      return;
    }
  }
  if (selectedRows.length > 1) {
    showSelectionInfo(selectedRows);
    return;
  }
  showArchiveInfo();
}

function currentAboutDialogSnapshot(): Extract<ZManagerDialogSnapshot, { kind: "about" }> {
  return buildAboutDialogSnapshot({
    display: displayContext,
    healthcheck: latestHealthcheck,
    contract: latestContract,
    diagnosticLogPath: latestDiagnosticLogInfo?.path ?? null,
    diagnosticLogLocation: latestDiagnosticLogInfo?.location ?? null,
  });
}

function openAboutDialog() {
  setReactDialogSnapshot(currentAboutDialogSnapshot());
}

function refreshAboutDialogSnapshot() {
  if (reactDialogSnapshot.kind === "about") {
    setReactDialogSnapshot(currentAboutDialogSnapshot());
  }
}

function publishBootstrapStateSnapshot() {
  refreshAboutDialogSnapshot();
  if (normalWorkspaceRendered) {
    renderBrowse();
  }
}

async function copyAboutDiagnostics() {
  try {
    const snapshot = reactDialogSnapshot.kind === "about"
      ? reactDialogSnapshot
      : currentAboutDialogSnapshot();
    await writeClipboardText(serializeAboutDiagnostics(snapshot));
    setOperationalMessage("status.copied");
  } catch {
    setOperationalMessage("status.copyDiagnosticsFailed");
  }
}

async function validatePreferencesDraft(draft: AppPreferences): Promise<boolean> {
  const customOutputSelected = draft.defaultOutputLocation === "customFolder";
  const customOutputPath = draft.customOutputFolderPath.trim();
  if (!customOutputSelected) {
    return true;
  }
  if (!customOutputPath) {
    setOperationalStatus(message("preferences.validation.customOutputRequired"));
    return false;
  }
  if (!isDesktopRuntime()) {
    return true;
  }

  try {
    const validation = await validateDirectory({ path: customOutputPath });
    const messageKey: MessageKey | null =
      !validation.exists
        ? "preferences.validation.customOutputMissing"
        : !validation.isDirectory
          ? "preferences.validation.customOutputNotFolder"
          : !validation.accessible
            ? "preferences.validation.customOutputInaccessible"
            : null;
    if (messageKey) {
      setOperationalStatus(message(messageKey));
      return false;
    }
  } catch {
    setOperationalStatus(message("preferences.validation.customOutputInaccessible"));
    return false;
  }

  return true;
}

function activeDisplayWorkspace(): DisplayRefreshWorkspace {
  return currentWorkspaceMode() === "compress" ? "create" : "browse";
}

function refreshDisplayFromPreferences() {
  const refreshSurfaces = selectDisplayRefreshSurfaces({
    activeWorkspace: activeDisplayWorkspace(),
    preferencesVisible: Boolean(preferencesDialogDraft),
  });

  refreshDisplayContext(appPreferences.locale, {
    commitContext: (nextDisplayContext) => {
      displayContext = nextDisplayContext;
    },
  });

  browserDocument.applyDisplayMetadata(displayContext);
  for (const surface of refreshSurfaces) {
    switch (surface) {
      case "browse":
        renderBrowse();
        break;
      case "create":
      case "preferences":
        publishReactSnapshot();
        break;
    }
  }
}

function localizedCommandStateReason(reason?: string): string | undefined {
  if (reason === UNSUPPORTED_OPERATION_MESSAGE) {
    return displayContext.translator.t("command.unsupported");
  }
  if (reason === SINGLE_FILE_REQUIRED_MESSAGE) {
    return displayContext.translator.t("command.singleFileRequired");
  }
  if (reason === SINGLE_FOLDER_REQUIRED_MESSAGE) {
    return displayContext.translator.t("command.singleFolderRequired");
  }
  if (
    reason === NO_ARCHIVE_OPEN_MESSAGE ||
    reason === ARCHIVE_NOT_READY_MESSAGE ||
    reason === NO_SELECTION_MESSAGE ||
    reason === NO_ENTRIES_MESSAGE
  ) {
    return reason;
  }
  return reason;
}

function currentPreferencesDraft(): AppPreferences {
  return preferencesDialogDraft ?? appPreferences;
}

function updateReactPreferencesDraft(patch: AppPreferencePatch) {
  preferencesDialogDraft = preferencesWithPatch(currentPreferencesDraft(), patch);
  publishReactSnapshot();
}

function updateReactCreateDefaultsDraft(
  format: CreateArchiveFormat,
  patch: Partial<ReturnType<typeof createDefaultsForFormat>>,
) {
  const draft = currentPreferencesDraft();
  const nextDefaultsForFormat = {
    ...createDefaultsForFormat(draft, format),
    ...patch,
  };
  if (format === "tzap" && patch.volumeSize !== undefined) {
    if (patch.volumeSize === null) {
      nextDefaultsForFormat.tzapVolumeLossTolerance = 0;
    } else if (!createDefaultsForFormat(draft, format).volumeSize && patch.tzapVolumeLossTolerance === undefined) {
      nextDefaultsForFormat.tzapVolumeLossTolerance = 1;
    }
  }
  preferencesDialogDraft = preferencesWithPatch(draft, {
    createFormatDefaults: {
      ...draft.createFormatDefaults,
      [format]: nextDefaultsForFormat,
    },
    ...(draft.defaultArchiveFormat === format
      ? { defaultCleanSourceEnabled: Boolean(nextDefaultsForFormat.cleanSource) }
      : {}),
  });
  publishReactSnapshot();
}

function applyCreatePreferenceDefaults() {
  const format = appPreferences.defaultArchiveFormat;
  applyCreateDefaultsForFormat(format, { suggestDestinationIfBlank: true });
}

function applyCreateDefaultsForFormat(
  format: CreateArchiveFormat,
  options: { suggestDestinationIfBlank?: boolean } = {},
) {
  const defaults = createDefaultsForFormat(appPreferences, format);
  const result = createWorkspace.applyFormatDefaults(
    format,
    defaults,
    options.suggestDestinationIfBlank ? createDestinationSuggestionOptions() : undefined,
  );
  publishCreateWorkspaceSnapshot(result.snapshot);
}

async function savePreferencesFromDialog() {
  const draft = currentPreferencesDraft();
  if (!(await validatePreferencesDraft(draft))) {
    return;
  }
  persistPreferencePatch(draft);
  preferencesDialogDraft = null;
  syncLocalSendReceiverWithPreferences();

  // Save column visibility preferences if changed
  if (columnVisibilityDraft) {
    // Resolve before/after for selective workspace reset
    const archivePath = archiveCurrentPath();
    const familyRes = archivePath
      ? resolveExtractFamilyFromPath(archivePath)
      : { kind: "unknown" as const };

    const extractBefore = resolveExtractColumns({
      familyResolution: familyRes,
      visibilityPrefs: columnVisibilityPrefs,
    });
    const compressBefore = resolveCompressColumns({
      capabilitySet: compressCapabilitySet,
      visibilityPrefs: columnVisibilityPrefs,
    });

    columnVisibilityPrefs = columnVisibilityDraft;
    saveColumnPrefs(columnVisibilityPrefs);
    columnVisibilityDraft = null;

    const extractAfter = resolveExtractColumns({
      familyResolution: familyRes,
      visibilityPrefs: columnVisibilityPrefs,
    });
    const compressAfter = resolveCompressColumns({
      capabilitySet: compressCapabilitySet,
      visibilityPrefs: columnVisibilityPrefs,
    });

    const comparison = compareResolvedDefaults(
      compressBefore, compressAfter,
      extractBefore, extractAfter,
    );

    if (comparison.extractChanged) {
      publishArchiveSnapshot(archiveWorkspace.resetColumns(
        archiveSettingsFromResolved(extractAfter),
      ));
    }
    if (comparison.compressChanged) {
      publishCreateWorkspaceSnapshot(createWorkspace.resetColumns(
        createSettingsFromResolved(compressAfter),
      ));
    }
  }

  publishArchiveSnapshot(archiveWorkspace.setRowOptions({
    showParentFolderItem: appPreferences.showParentFolderItem,
  }));
  publishArchiveSnapshot(archiveWorkspace.setFlatView(appPreferences.flatViewDefault));
  applyCreatePreferenceDefaults();
  applyPreferenceClasses();
  refreshDisplayFromPreferences();
  setOperationalStatus(displayContext.translator.t("preferences.saved"));
  publishReactSnapshot();
}

function openPreferencesDialog() {
  preferencesDialogDraft = appPreferences;
  columnVisibilityDraft = { ...columnVisibilityPrefs, visibleColumnIdsByFormatFamily: { ...columnVisibilityPrefs.visibleColumnIdsByFormatFamily } };
  publishReactSnapshot();
  if (
    latestContract
    && isNativeCapabilityAvailable(
      latestContract.platformIntegration.capabilities,
      "defaultHandlerControl",
    )
  ) {
    void defaultHandlerController.refresh();
  }
  if (latestContract?.localSendAvailable) {
    void localSendTrustController.refresh();
  }
}

async function onSelectReactPreferenceOutputFolder() {
  const selected = await openNativeDialog({
    title: displayContext.translator.t("nativeDialog.chooseDefaultOutput"),
    directory: true,
    multiple: false,
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  updateReactPreferencesDraft({
    customOutputFolderPath: selected,
  });
}

async function onSelectReactPreferenceExtractFolder() {
  const selected = await openNativeDialog({
    title: displayContext.translator.t("nativeDialog.chooseDefaultOutput"),
    directory: true,
    multiple: false,
  });
  if (!selected || Array.isArray(selected)) {
    return;
  }
  updateReactPreferencesDraft({ customExtractFolderPath: selected });
}

async function onSelectReactPreferenceLanShareReceiveFolder() {
  const selected = await openNativeDialog({
    title: displayContext.translator.t("nativeDialog.chooseDefaultOutput"),
    directory: true,
    multiple: false,
  });
  if (!selected || Array.isArray(selected)) {
    return;
  }
  updateReactPreferencesDraft({ lanShareReceiveFolderPath: selected });
}

async function saveReactPreferencesDraft() {
  await savePreferencesFromDialog();
  publishReactSnapshot();
}

function cancelReactPreferencesDialog() {
  preferencesDialogDraft = null;
  columnVisibilityDraft = null;
  publishReactSnapshot();
}

function openExtractDialog(mode: ExtractMode) {
  if (!archiveCurrentPath()) {
    return;
  }

  archiveWorkspace.clearPasswordRetry();
  const { extractDestinationHistory } = pathHistoryStore.getSnapshot();
  openReactExtractDialogSnapshot(
    mode,
    createExtractDialogFormSnapshot({
      destination: extractDestinationHistory[0] ?? "",
      overwrite: activeExtractDialogForm.overwrite,
      stripComponents: activeExtractDialogForm.stripComponents,
      tzapRestorePolicy: extractWorkspace.getSnapshot().tzapRestorePolicy,
      tzapAllowDegraded: extractWorkspace.getSnapshot().tzapAllowDegraded,
      tzapAllowAbsoluteSymlinks: extractWorkspace.getSnapshot().tzapAllowAbsoluteSymlinks,
      ignoreSymlinks: extractWorkspace.getSnapshot().ignoreSymlinks,
    }),
    extractDialogMessageForMode(mode),
  );
}

function openExtractHereDialog(mode: ExtractMode) {
  const archivePath = archiveCurrentPath();
  const parent = nativeParentPath(archivePath);
  openExtractDialog(mode);
  if (parent) {
    updateOpenExtractDialogSnapshot({
      mode,
      formPatch: {
        destination: parent,
      },
      messageText: mode === "selection"
        ? message("extract.hereSelected", { archiveName: getArchiveName(archivePath, APP_TITLE) })
        : message("extract.hereArchive", { archiveName: getArchiveName(archivePath, APP_TITLE) }),
    });
  }
}

function showCreateWorkspace() {
  const snapshot = createWorkspace.getSnapshot();
  if (!snapshot.hasSources) {
    applyCreatePreferenceDefaults();
  }
  const { createDestinationHistory } = pathHistoryStore.getSnapshot();
  if (!createWorkspace.getSnapshot().options.destinationPath.trim() && createDestinationHistory[0]) {
    publishCreateWorkspaceSnapshot(createWorkspace.setDestinationPathIfBlank(createDestinationHistory[0]).snapshot);
  }
  setWorkspaceMode("compress");
  publishReactSnapshot();
}

async function loadArchive(request: ListArchiveRequest, options: ArchiveLoadOptions = {}) {
  const timing = {
    startedAt: performance.now(),
    firstPageRecorded: false,
  };
  activeArchiveLoadTiming = timing;
  const familyResolution = resolveExtractFamilyFromPath(request.archivePath);
  diagnostics.record({
    scope: "archiveLoad",
    name: "requested",
    fields: {
      format: familyResolution.kind === "known" ? familyResolution.family : "unknown",
      preserveState: options.preserveState ?? false,
    },
  });
  try {
    await archiveLoadController.loadArchive(request, options);
    const snapshot = archiveWorkspace.getSnapshot();
    diagnostics.record({
      scope: "archiveLoad",
      name: "settled",
      fields: {
        browseState: snapshot.browseState,
        elapsedMs: Math.round(performance.now() - timing.startedAt),
        entryCount: snapshot.entryCount,
        visibleRowCount: snapshot.entries.length,
      },
    });
  } finally {
    if (activeArchiveLoadTiming === timing) {
      activeArchiveLoadTiming = null;
    }
  }
}

function loadArchiveListingIntoState(listing: ArchiveFixture, options: ArchiveLoadOptions = {}) {
  const preserveState = options.preserveState ?? false;
  const previous = archiveWorkspace.getSnapshot();
  const preservedState = preserveState
    ? {
        currentFolder: previous.view.currentFolder,
        navigationHistory: previous.view.navigationHistory,
        searchQuery: previous.view.searchQuery,
        flatView: previous.view.flatView,
        expandedTreeFolders: previous.view.expandedTreeFolders,
        selectedPaths: previous.view.selection.selectedPaths,
        focusedPath: previous.view.selection.focusedPath,
        anchorPath: previous.view.selection.anchorPath,
        showParentFolderItem: appPreferences.showParentFolderItem,
        sortKey: previous.view.sort.key,
        sortAscending: previous.view.sort.ascending,
      }
    : false;

  clearTrackedPreviewState();
  contextMenuRuntime.hide();
  shellWorkspace.setWorkspaceMode("extract");
  const archivePath = archiveListingFromFixture(listing).archivePath;
  const familyRes = resolveExtractFamilyFromPath(archivePath);
  const resolved = resolveExtractColumns({
    familyResolution: familyRes,
    visibilityPrefs: columnVisibilityPrefs,
  });
  const defaultTableColumns = archiveSettingsFromResolved(resolved);
  const snapshot = archiveWorkspace.loadSucceeded(archiveListingFromFixture(listing), {
    preserveState: preservedState,
    defaultTableColumns,
  });
  applyExtractPreferenceDefaults(listing.archivePath);
  publishArchiveSnapshot(snapshot);
  setOperationalMessage("archive.loaded");
}

async function runPlan(revision?: number) {
  await createPlanController.runPlan(revision);
}

function addSources(paths: string[]) {
  const previousSnapshot = createWorkspace.getSnapshot();
  const result = createWorkspace.addSources(paths);
  let sourceSnapshot = result.snapshot;
  if (!result.changed) {
    return;
  }
  if (!previousSnapshot.hasSources && sourceSnapshot.hasSources && !sourceSnapshot.options.destinationPath.trim()) {
    sourceSnapshot = createWorkspace.suggestDestinationPathIfBlank(createDestinationSuggestionOptions()).snapshot;
  }
  publishCreateWorkspaceSnapshot(sourceSnapshot);
  queuePlanRun();
}

async function openQuickActionArchive(paths: string[]) {
  const archives = uniqueQuickActionPaths(paths);
  if (archives.length !== 1) {
    setBrowseState("error", message("archive.openSingle"));
    renderBrowse();
    return;
  }

  const archivePath = archives[0];
  if (!isSupportedArchivePath(archivePath)) {
    setBrowseState("error", message("archive.unsupported", { archivePath }));
    renderBrowse();
    return;
  }

  await loadArchive({ archivePath });
}

async function startQuickCreate(paths: string[], format: CreateArchiveFormat, cleanSource: boolean) {
  await quickActionController.startQuickCreate(paths, format, cleanSource);
}

async function openQuickCreateReview(
  paths: string[],
  format: CreateArchiveFormat,
  cleanSource: boolean,
) {
  await quickActionController.openQuickCreateReview(paths, format, cleanSource);
}

async function openQuickExtractReview(paths: string[]) {
  await quickActionController.openQuickExtractReview(paths);
}

async function startQuickExtract(paths: string[], action: QuickActionExtractMode) {
  await quickActionController.startQuickExtract(paths, action);
}

async function enqueueNativeCompressShare(paths: string[], clientRequestId: string) {
  const sources = uniqueQuickActionPaths(paths);
  const format = appPreferences.defaultArchiveFormat;
  const defaults = createDefaultsForFormat(appPreferences, format);
  let password: string | undefined;
  if (defaults.promptForPassword && createFormatSupportsPassword(format)) {
    password = jobPasswordPrompts.promptForNewArchivePassword() ?? undefined;
    if (!password) {
      throw new Error(message("quickCreate.cancelled"));
    }
  }
  const destinationPath = quickCreateDestination(sources, format, appPreferences, { nativeParentPath, joinNativePath });
  const requestResult = buildQuickCreateStartRequest({
    sources,
    destinationPath,
    format,
    cleanSource: defaults.cleanSource,
    replaceExisting: defaults.replaceExisting,
    preserveMetadata: defaults.preserveMetadata,
    password,
    compressionLevel: defaults.compressionLevel ?? undefined,
    volumeSize: defaults.volumeSize ?? undefined,
    respectGitignore: defaults.respectGitignore,
    followSymlinks: defaults.followSymlinks,
    tzapRecoveryPercentage: defaults.tzapRecoveryPercentage ?? undefined,
    tzapVolumeLossTolerance: defaults.tzapVolumeLossTolerance,
    zipCompression: defaults.zipCompression,
    sevenZSolid: defaults.sevenZSolid,
    sevenZThreads: defaults.sevenZThreads ?? undefined,
    sevenZChunkSize: defaults.sevenZChunkSize ?? undefined,
    sevenZEncryptFileNames: defaults.sevenZEncryptFileNames,
  });
  if (!requestResult.ok) {
    throw new Error(message(requestResult.reason === "needsSources" ? "quickCreate.needsSource" : "quickCreate.needsDestination"));
  }
  await shareQueueController.enqueue({ mode: "compressAndShare", clientRequestId, senderAlias: localSendAliasOrDefault(), createRequest: requestResult.request, receiver: null });
}

async function enqueueNativeDirectShare(paths: string[], clientRequestId: string) {
  const sources = uniqueQuickActionPaths(paths);
  if (sources.length !== 1) {
    throw new Error(message("command.singleFileRequired"));
  }
  await shareQueueController.enqueue({ mode: "directShare", clientRequestId, senderAlias: localSendAliasOrDefault(), artifactPath: sources[0], receiver: null });
}

async function executeQuickActionRequest(request: QuickActionRequestDto, identity?: Readonly<{ eventId: string; idempotencyKey: string | null }>) {
  const clientRequestId = identity?.idempotencyKey?.trim() || identity?.eventId || crypto.randomUUID();
  if (request.kind === "compressShareOnLan") {
    await enqueueNativeCompressShare(request.paths, clientRequestId);
    return;
  }
  if (request.kind === "shareOnLan") {
    await enqueueNativeDirectShare(request.paths, clientRequestId);
    return;
  }
  await quickActionController.handleQuickActionRequest(request);
}

async function routeQuickActionRequest(request: QuickActionRequestDto, identity?: Readonly<{ eventId: string; idempotencyKey: string | null }>) {
  diagnostics.record({
    scope: "quickActionRouting",
    name: "requestArrived",
    fields: {
      action: request.kind,
      pathCount: request.paths.length,
      quickActionOnlyCoordinator: disposableTaskLifecycle.getSnapshot().quickActionOnlyCoordinator,
    },
  });
  await runInboundQuickAction(request, {
    observeDisposableTaskLaunch: disposableTaskLifecycle.observeQuickActionLaunch,
    beginDisposableTaskRequest: disposableTaskLifecycle.beginQuickActionRequest,
    endDisposableTaskRequest: disposableTaskLifecycle.endQuickActionRequest,
    revealMainWindow: () => revealNormalAppWindow(true),
    onDispositionApplied: (disposition) => {
      const lifecycle = disposableTaskLifecycle.getSnapshot();
      diagnostics.record({
        scope: "quickActionLifecycle",
        name: "requestDispositionApplied",
        fields: {
          action: request.kind,
          disposition,
          normalLaunchObserved: lifecycle.normalLaunchObserved,
          quickActionOnlyCoordinator: lifecycle.quickActionOnlyCoordinator,
          pendingQuickActionRequests: lifecycle.pendingQuickActionRequests,
        },
      });
    },
    execute: (nextRequest) => executeQuickActionRequest(nextRequest, identity),
    onDisposableTaskRequestSettled: maybeCloseQuickActionOnlyCoordinator,
  });
}

async function handleStartupQuickAction() {
  await startupController.handleStartupQuickAction();
}

async function handleQuickActionStartupState(state: QuickActionStartupStateDto) {
  await startupController.handleQuickActionStartupState(state);
}

async function initializeDesktopRuntime() {
  await persistDiagnosticEvent({
    scope: "frontend",
    name: "desktopInitializationStarted",
  }).catch(() => {});
  await nativeInboundController.initialize();
  await listenDisposableTaskJobHandoffs((job) => {
    void jobHandoff.handoffAcceptedJob(job);
  });
  await listenDisposableTaskOutputActions((request) => {
    const effect = request.action === "open"
      ? openDesktopPath(request.path)
      : revealInFileManager(request.path);
    void effect.catch((error) => {
      setOperationalStatus(unknownErrorMessage(error, "Unable to open the task output."));
    });
  });
  await listenLocalSendEvents(({ payload }) => {
    handleLocalSendEvent(payload);
  });
  await shareQueueController.initialize();
  await listenNativeMenuCommands((commandId) => runRoutedCommand(commandId));
  await listenNativeFileDragOutcomes(({ payload }) => {
    const count = pendingNativeDragCounts.get(payload.sessionId) ?? 0;
    pendingNativeDragCounts.delete(payload.sessionId);
    if (payload.outcome === "cancelled") {
      setOperationalMessage("preview.dragCancelled");
    } else {
      setOperationalMessage("preview.draggedOut", { count });
    }
  });
  await subscribeToJobCatalog().catch((error) => {
    diagnostics.record({
      scope: "jobCatalog",
      name: "subscriptionFailed",
      fields: {
        error: unknownErrorMessage(error, "Unable to subscribe to the Job catalog."),
      },
    });
  });
  await startupController.initializeDesktopRuntime();
  syncLocalSendReceiverWithPreferences();

  initializeDeepLinkAdapter(accountController).catch(error => {
    console.error("Failed to initialize deep link adapter", error);
  });
}

async function handleHostedAuthCallback(
  payload: NativeInboundHostedAuthEvent["payload"],
): Promise<void> {
  await accountController.handleHostedCallback(payload);
}

async function onOpenArchive() {
  await archiveOpenController.onOpenArchive();
}

async function openArchiveFromPath(archivePath: string) {
  await archiveOpenController.openArchiveFromPath(archivePath);
}

async function openArchiveFromClipboard() {
  await archiveOpenController.openArchiveFromClipboard();
}

async function onTestArchive() {
  await archiveTestController.testArchive();
}

async function onDeleteTemporaryFiles() {
  if (!isDesktopRuntime()) {
    setOperationalMessage("preview.cleanupDesktopOnly");
    return;
  }

  if (!shellWorkspace.hasTrackedPreviewCleanup()) {
    setOperationalMessage("preview.cleanupNoneTracked");
    return;
  }

  try {
    await cleanupPreviewRoots();
    clearTrackedPreviewState();
    setOperationalMessage("preview.cleanupDeleted");
  } catch (error) {
    const commandError = asCommandError(error);
    setOperationalStatus(commandError?.message ?? message("preview.cleanupFailed"));
  }
}

async function copySelectedEntryPathsToClipboard() {
  const selectedPaths = getSelectedEntryPaths();
  if (selectedPaths.length === 0) {
    setOperationalMessage("command.singleFileRequired");
    return;
  }

  try {
    await writeClipboardText(selectedPaths.join("\n"));
    setOperationalStatus(`Copied ${selectedPaths.length} archive path${selectedPaths.length === 1 ? "" : "s"}.`);
  } catch {
    setOperationalStatus("Could not copy the selected archive paths.");
  }
}

async function copyTextToClipboard(value: string) {
  if (!value) {
    return;
  }

  try {
    await writeClipboardText(value);
    setOperationalMessage("status.copied");
  } catch {
    setOperationalStatus("Could not copy.");
  }
}

async function applyPreviewCleanupPolicyBeforeNextPreview(): Promise<void> {
  if (
    appPreferences.previewCleanupPolicy !== "beforeNextPreview" ||
    !shellWorkspace.hasPreviewCleanupRoot()
  ) {
    return;
  }

  try {
    await cleanupPreviewRoots();
  } catch {
    // Best effort cleanup only.
  }
  clearTrackedPreviewState();
}

function applyCleanupOnAppClose(): void {
  if (!isDesktopRuntime()) {
    return;
  }

  void appWindowController.persistCurrentWindowGeometry();
  if (appPreferences.previewCleanupPolicy === "whenAppCloses") {
    void cleanupPreviewRoots();
  }
}

function bindWindowLifecycleHandlers(): void {
  bindPreviewCleanupOnAppClose(applyCleanupOnAppClose);
  if (isDesktopRuntime()) {
    void appWindowController.listenCloseRequested((event) => {
      if (
        !disposableTaskWindows.hasOpenWindows()
        && !processJobs.hasActiveJobs()
      ) {
        return;
      }
      event.preventDefault();
      appWindowEffects.close();
    }).catch((error) => {
      diagnostics.record({
        scope: "mainWindow",
        name: "closeListenerFailed",
        fields: {
          error: unknownErrorMessage(error, "Unable to bind the Main Window close policy."),
        },
      });
    });
  }
}

function closeCurrentArchive(): void {
  clearTrackedPreviewState();
  contextMenuRuntime.hide();
  archiveWorkspace.reset();
  extractWorkspace.applyDefaults({
    ...extractionDefaultsForArchive(""),
    destinationPath: "",
  });
  publishArchiveSnapshot();
}

async function onRefreshArchive() {
  const archivePath = archiveCurrentPath();
  if (!archivePath) {
    return;
  }

  await loadArchive({
    archivePath,
  }, {
    preserveState: true,
  });
}

async function onSelectDestinationForExtract(form: ExtractDialogFormSnapshot = activeExtractDialogForm) {
  activeExtractDialogForm = form;
  const selected = await openNativeDialog({
    title: displayContext.translator.t("nativeDialog.chooseExtractDestination"),
    directory: true,
    multiple: false,
  });

  if (!selected || typeof selected !== "string") {
    return;
  }

  updateOpenExtractDialogSnapshot({
    form: patchExtractDialogFormSnapshot(form, {
      destination: selected,
    }),
  });
}

async function onSelectWorkspaceExtractDestination() {
  const current = extractWorkspace.getSnapshot().destinationPath;
  const selected = await openNativeDialog({
    title: displayContext.translator.t("nativeDialog.chooseExtractDestination"),
    directory: true,
    multiple: false,
    ...(current ? { defaultPath: current } : {}),
  });

  if (!selected || typeof selected !== "string") {
    return;
  }

  extractWorkspace.setOptions({ destinationPath: selected });
  publishReactSnapshot();
}

async function chooseTzapTrustedCAs() {
  const selected = await openNativeDialog({
    title: "Choose trusted CA certificates",
    directory: false,
    multiple: true,
    filters: [{ name: "Certificates", extensions: ["pem", "cer", "crt", "der"] }],
  });
  if (!selected) {
    return;
  }
  const paths = Array.isArray(selected) ? selected : [selected];
  const current = extractWorkspace.getSnapshot().tzapVerification.trustedCaCertificatePaths;
  extractWorkspace.setTzapVerificationOptions({ trustedCaCertificatePaths: [...current, ...paths] });
  publishReactSnapshot();
}

async function chooseCreateTzapCertificate(target: "recipients" | "identity" | "signer" | "privateKey" | "chain") {
  const multiple = target === "recipients" || target === "chain";
  const selected = await openNativeDialog({
    title: target === "privateKey"
      ? "Choose signing private key"
      : target === "identity"
        ? "Choose P12/PFX signing bundle"
        : "Choose certificate files",
    directory: false,
    multiple,
    filters: [{ name: target === "privateKey" ? "Private keys" : target === "identity" ? "PKCS#12 identity" : "Certificates", extensions: target === "privateKey" ? ["pem", "key"] : target === "identity" ? ["p12", "pfx"] : ["pem", "cer", "crt", "der"] }],
  });
  if (!selected) return;
  const value = (Array.isArray(selected) ? selected : [selected]).join(";");
  const patch = target === "recipients" ? { tzapRecipientCertificatePaths: value }
    : target === "identity" ? {
        tzapSigningIdentityPath: value,
        tzapSigningCertificatePath: "",
        tzapSigningPrivateKeyPath: "",
        tzapSigningChainPaths: "",
        tzapSigningMode: "advanced" as const,
      }
    : target === "signer" ? { tzapSigningCertificatePath: value }
    : target === "privateKey" ? { tzapSigningPrivateKeyPath: value }
    : { tzapSigningChainPaths: value };
  publishCreateWorkspaceSnapshot(createWorkspace.setOptions(patch).snapshot);
  queuePlanRun();
}

async function validateCreateTzapIdentity(identityPath: string, password: string) {
  if (!identityPath.trim()) return;
  try {
    const result = await validateTzapSigningIdentityCommand({
      identityPath: identityPath.trim(),
      ...(password ? { password } : {}),
    });
    const chainNote = result.chainCertificateCount > 0
      ? `${result.chainCertificateCount} intermediate certificate(s) found.`
      : "No intermediate certificate chain found; verification may be less portable.";
    setOperationalStatus(`P12/PFX valid for ${result.subject}. ${chainNote}`);
  } catch (error) {
    setOperationalStatus(asCommandError(error)?.message ?? unknownErrorMessage(error, "Unable to validate P12/PFX bundle."));
  }
}

async function createAccountSelfSignedCertificateStore(commonName: string) {
  return generateAccountSigningIdentity({ commonName, label: commonName });
}

async function chooseAndImportAccountSigningIdentity(password: string, label?: string) {
  const selected = await openNativeDialog({
    title: "Import P12/PFX signing identity",
    directory: false,
    multiple: false,
    filters: [{ name: "PKCS#12 identity", extensions: ["p12", "pfx"] }],
  });
  if (!selected || typeof selected !== "string") return;
  void accountController.importSigningIdentity(selected, password, label);
}

async function verifyCurrentTzapCertificate() {
  const archivePath = archiveCurrentPath();
  if (!archivePath.toLowerCase().includes(".tzap")) {
    return;
  }
  const verification = extractWorkspace.getSnapshot().tzapVerification;
  extractWorkspace.beginTzapVerification();
  publishReactSnapshot();
  try {
    const result = await verifyTzapCertificateCommand({
      archivePath,
      validateTrust: verification.validateTrust,
      trustedCaCertificatePaths: [...verification.trustedCaCertificatePaths],
      trustedSystemRoots: verification.trustedSystemRoots,
      includeOfficialTzapRoot: verification.includeOfficialTzapRoot,
      checkCurrentStatus: verification.checkCurrentStatus,
      environment: appPreferences.tzapEnvironment,
    });
    extractWorkspace.acceptTzapVerification(result);
  } catch (error) {
    extractWorkspace.rejectTzapVerification(asCommandError(error)?.message ?? unknownErrorMessage(error, "Certificate verification failed."));
  }
  publishReactSnapshot();
}

async function startExtract(destinationMode: ExtractMode, input: ExtractStartInput) {
  await extractStartController.startExtract(destinationMode, input);
}

async function onPreviewSelectedEntry() {
  await runPreviewSelectedEntry("preview");
}

async function onOpenOutsideSelectedEntry() {
  await runPreviewSelectedEntry("openOutside");
}

async function runPreviewSelectedEntry(mode: ArchivePreviewMode) {
  await archivePreviewController.previewSelectedEntry(mode);
}

async function addSourcePathsFromDialog(mode: "files" | "folder") {
  const selected = await openNativeDialog({
    title: displayContext.translator.t(mode === "files" ? "nativeDialog.addSourceFiles" : "nativeDialog.addSourceFolder"),
    directory: mode === "folder",
    multiple: mode === "files",
  });

  if (!selected) {
    return;
  }

  if (Array.isArray(selected)) {
    addSources(selected);
    return;
  }

  addSources([selected]);
}

async function onSelectCreateDestination() {
  const optionSnapshot = createWorkspace.getSnapshot().options;
  const defaultPath = createOutputFolderDefaultPath(optionSnapshot.destinationPath);
  const selected = await openNativeDialog({
    title: displayContext.translator.t("nativeDialog.chooseCreateOutputFolder"),
    directory: true,
    multiple: false,
    ...(defaultPath ? { defaultPath } : {}),
  });

  if (!selected || typeof selected !== "string") {
    return;
  }
  publishCreateWorkspaceSnapshot(createWorkspace.setDestinationPath(
    createWorkspace.destinationPathForOutputFolder(selected, optionSnapshot.destinationPath),
  ).snapshot);
}

async function runCreate(
  options: {
    destinationCollisionStrategy?: StartCreateRequest["destinationCollisionStrategy"];
    passwordInput: {
      password: string;
      passwordConfirm: string;
      signingIdentityPassword?: string;
    };
  },
) {
  const before = createWorkspace.getSnapshot();
  diagnostics.record({
    scope: "create",
    name: "uiSubmitRequested",
    fields: {
      sourceCount: before.sources.length,
      planState: before.plan.state,
      hasPlan: before.plan.hasPlan,
      planStatus: before.plan.status?.messageKey ?? before.plan.status?.fallbackText ?? null,
    },
  });
  try {
    await createStartController.runCreate(options);
  } finally {
    const after = createWorkspace.getSnapshot();
    diagnostics.record({
      scope: "create",
      name: "uiSubmitFinished",
      fields: {
        sourceCount: after.sources.length,
        planState: after.plan.state,
        hasPlan: after.plan.hasPlan,
        planStatus: after.plan.status?.messageKey ?? after.plan.status?.fallbackText ?? null,
      },
    });
  }
}

async function loadBootstrapState() {
  if (isDesktopRuntime()) {
    try {
      latestDiagnosticLogInfo = await fetchDiagnosticLogInfo();
    } catch {
      latestDiagnosticLogInfo = null;
    }
  }
  await startupController.loadBootstrapState();
  await accountController.refresh();
}

function runtimeDevToolsOptions() {
  return {
    isDev: import.meta.env.DEV,
    windowRef: window,
    normalWorkspaceRendered: () => normalWorkspaceRendered,
    api: {
      loadArchiveFixture: loadArchiveListingIntoState,
      setSystemIconFixtures: (fixtures: Record<string, string | null>) => {
        systemIconDataUrls = new Map(Object.entries(fixtures));
        syncSystemIconsSnapshot();
        renderBrowse();
      },
      setErrorSurfaceFixture: (fixture: RuntimeDevErrorSurfaceFixture) => {
        if (fixture === "account-notice-long-contacts") {
          accountWorkspace.replace({
            authStatus: "signedOut",
            pendingState: null,
            defaultSigningIdentityId: null,
            capabilities: {
              auth: "launch_only",
              enrollment: "unavailable",
              status: "offline_cache_only",
              accountManagement: "external_browser",
            },
            certificates: [],
            recipientKeys: [],
            contacts: Array.from({ length: 18 }, (_, index) => ({
              contactId: `fixture-contact-${index + 1}`,
              displayName: `Fixture contact ${index + 1} with a deliberately long display name for compact viewport verification`,
              signingCertificateSha256: `sha256:fixture-certificate-${index + 1}`,
              recipientPublicKeyFingerprint: `sha256:fixture-recipient-${index + 1}`,
              verificationState: "verified",
              missingStatusCaveat: false,
            })),
            displayName: null,
            publicSignerId: null,
            assuranceLevel: null,
            sessionExpiresAtUnixSeconds: null,
          });
          accountWorkspace.open();
          accountWorkspace.setNotice("Fixture notice: identity data is available from the local cache.");
          publishReactSnapshot();
          return;
        }

        if (fixture === "create-plan-error") {
          setWorkspaceMode("compress");
          publishCreateWorkspaceSnapshot(
            createWorkspace.setPlanError({ messageKey: "create.error.refreshPlan" }),
          );
          return;
        }

        setWorkspaceMode("extract");
        publishArchiveSnapshot(
          archiveWorkspace.loadFailed({
            code: "archive_open_failed",
            message: "Fixture error: the archive listing could not be loaded.",
            severity: "error",
            retryable: true,
          }),
        );
      },
      openSurface: (surface: "about" | "preferences" | "info") => {
        if (surface === "about") {
          openAboutDialog();
        } else if (surface === "preferences") {
          openPreferencesDialog();
        } else if (surface === "info") {
          showCurrentInfo();
        }
      },
      closeModal: () => {
        if (reactDialogSnapshot.kind !== "none") {
          closeReactDialog();
        }
        if (preferencesDialogDraft) {
          cancelReactPreferencesDialog();
        }
      },
    },
  };
}

function installRuntimeDevApi() {
  installRuntimeDevTools(runtimeDevToolsOptions());
}

function loadLocalDevFixtureFromUrl() {
  loadRuntimeLocalDevFixtureFromUrl(runtimeDevToolsOptions());
}

function handleInfoDialogAction(action?: string, copyValue?: string) {
  if (copyValue) {
    void copyTextToClipboard(copyValue);
    return;
  }

  const routedCommand = selectDetailsCommand(action);
  if (routedCommand) {
    runRoutedCommand(routedCommand.commandId, routedCommand.payload);
    return;
  }
  if (action === "clear-search") {
    clearSearch();
  }
}

startZManagerRuntime({
  bindWindowLifecycleHandlers,
  refreshDisplayFromPreferences,
  loadPathHistory: () => pathHistoryStore.load(),
  applyCreatePreferenceDefaults,
  setInitialBrowseState: () => setBrowseState("idle", displayContext.translator.t("browse.statusIdle")),
  installRuntimeDevTools: installRuntimeDevApi,
  bindFileDrop: bindTauriFileDrop,
  isDesktopRuntime,
  initializeDesktopRuntime,
  renderNormalWorkspaceOnce,
  loadLocalDevFixtureFromUrl,
  loadBootstrapState,
});
