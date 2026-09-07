import type {
  CreatePlanEntryDto,
  CreatePlanResponse,
  CreateState,
  PlanCreateRequest,
  StartCreateRequest,
} from "../../api/types";
import { getParentArchivePath, normalizeArchivePath } from "../archiveTree";
import { resolveDestinationCollisionStrategy } from "../collisionPolicy";
import {
  applyCreatePlanPathInclusion,
  buildStartCreateRequest as buildStartCreateRequestDto,
  buildCreatePlanRows,
  commonSourceParentDirectory,
  createArchiveUnavailableReason,
  createFormatSupportsPassword,
  createPlanEntriesForPath,
  createPlanRowInclusionState,
  filterCreatePlanByIncludedPaths,
  getArchiveName,
  isCreatePlanPathIncluded,
  normalizeCreateVolumeSize,
  normalizeTzapVolumeCount,
  normalizeTzapRecoveryPercentage,
  normalizeTzapVolumeLossTolerance,
  suggestedCreateArchiveName,
  TZAP_SPLIT_DEFAULT_VOLUME_LOSS_TOLERANCE,
  TZAP_RECOVERY_PERCENTAGE_DEFAULT,
  withCreateArchiveExtension,
  type CreateArchiveFormat,
  type CreateArchiveUnavailableReason,
  type CreatePlanInclusionState,
  type CreatePlanRow,
  type CreatePathHelpers,
  type TzapSplitMode,
} from "../createFlow";
import {
  applyHierarchicalRowSelectionIntent,
  cleanupHierarchicalTableSelection,
  clearHierarchicalTableSelection,
  ensureHierarchicalTablePathSelected,
  focusHierarchicalTablePath,
  selectableHierarchicalRowPaths,
  toggleHierarchicalTablePathSelection,
  type HierarchicalTableSelectionResult,
} from "../hierarchicalTable";
import type { FormatCreateDefaults } from "../preferences";
import {
  moveCreateColumn,
  normalizeCreateColumnSettings,
  reorderCreateColumn,
  resetCreateColumnSettings,
  setCreateColumnWidth,
  toggleCreateColumnVisibility,
  type CreateSourceColumnId,
  type CreateSourceColumnSettings,
} from "../createTableColumns";

export type CreateWorkspacePlanMessageKey =
  | "create.plan.noSources"
  | "create.plan.planning"
  | "create.error.pickDestination"
  | "create.error.refreshPlan"
  | "create.error.passwordMismatch"
  | "create.error.unableStart";

export type CreateWorkspacePlanStatus = Readonly<{
  messageKey?: CreateWorkspacePlanMessageKey;
  fallbackText?: string;
}>;

export type CreateWorkspacePlanSnapshot = Readonly<{
  state: CreateState;
  current: CreatePlanResponse | null;
  status: CreateWorkspacePlanStatus | null;
  warnings: readonly string[];
  revision: number;
  hasPlan: boolean;
}>;

export type CreateWorkspaceInclusionSnapshot = Readonly<{
  excludedArchivePaths: readonly string[];
  includedEntries: readonly CreatePlanEntryDto[];
  includedCount: number;
  hasIncludedEntries: boolean;
  filteredPlan: CreatePlanResponse | null;
}>;

export type CreateWorkspaceTreeFolder = Readonly<{
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}>;

export type CreateWorkspacePlanViewSnapshot = Readonly<{
  currentFolder: string;
  searchQuery: string;
  expandedTreeFolders: readonly string[];
  rows: readonly CreatePlanRow[];
  treeFolders: readonly CreateWorkspaceTreeFolder[];
  columnSettings: CreateSourceColumnSettings;
}>;

export type CreateWorkspaceSelectionSnapshot = Readonly<{
  selectedPaths: readonly string[];
  selectedCount: number;
  focusedPath: string;
  anchorPath: string;
  visibleSelectablePaths: readonly string[];
  visibleSelectedPaths: readonly string[];
}>;

export type CreateWorkspacePasswordOptionSnapshot = Readonly<{
  supportsPassword: boolean;
  visible: boolean;
  disabled: boolean;
}>;

export type CreateWorkspaceTzapRecoveryOptionSnapshot = Readonly<{
  supportsTzapRecovery: boolean;
  visible: boolean;
  disabled: boolean;
}>;

export type CreateWorkspaceReadinessSnapshot = Readonly<{
  canCreate: boolean;
  unavailableReason: CreateArchiveUnavailableReason | null;
}>;

export type CreateWorkspaceOptionsSnapshot = Readonly<{
  destinationPath: string;
  format: CreateArchiveFormat;
  cleanSource: boolean;
  respectGitignore: boolean;
  followSymlinks: boolean;
  replaceExisting: boolean;
  preserveMetadata: boolean;
  compressionLevel: number | null;
  splitMode: TzapSplitMode;
  volumeSize: number | null;
  volumeCount: number | null;
  tzapRecoveryPercentage: number;
  tzapVolumeLossTolerance: number;
  zipCompression: "store" | "deflate";
  sevenZSolid: boolean;
  sevenZThreads: number | null;
  sevenZChunkSize: number | null;
  sevenZEncryptFileNames: boolean;
  tzapRecipientCertificatePaths: string;
  tzapRecipientKeyIds: string;
  tzapContactRecipientIds: string;
  tzapSigningMode: "identity" | "advanced";
  tzapSigningIdentityId: string;
  tzapSigningIdentityPath: string;
  tzapSigningCertificatePath: string;
  tzapSigningPrivateKeyPath: string;
  tzapSigningChainPaths: string;
  tzapBootstrapSidecar: boolean;
  submissionInFlight: boolean;
  password: CreateWorkspacePasswordOptionSnapshot;
  tzapRecovery: CreateWorkspaceTzapRecoveryOptionSnapshot;
  readiness: CreateWorkspaceReadinessSnapshot;
}>;

export type CreateWorkspaceSnapshot = Readonly<{
  sources: readonly string[];
  sourceCount: number;
  hasSources: boolean;
  isEmpty: boolean;
  plan: CreateWorkspacePlanSnapshot;
  inclusion: CreateWorkspaceInclusionSnapshot;
  view: CreateWorkspacePlanViewSnapshot;
  selection: CreateWorkspaceSelectionSnapshot;
  options: CreateWorkspaceOptionsSnapshot;
}>;

export type CreateWorkspaceSourceMutation = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  changed: boolean;
  addedSources: readonly string[];
  removedSources: readonly string[];
  becameEmpty: boolean;
}>;

export type CreateWorkspacePlanOptions = Readonly<{
  cleanSource: boolean;
  respectGitignore: boolean;
  excludeNames?: readonly string[];
  excludeArchivePaths?: readonly string[];
  includeArchivePaths?: readonly string[];
  followSymlinks?: boolean;
}>;

export type CreateWorkspaceDestinationSuggestionOptions = Readonly<CreatePathHelpers & {
  defaultDirectory?: string | null;
}>;

export type CreateWorkspaceOptionPatch = Readonly<{
  destinationPath?: string;
  cleanSource?: boolean;
  respectGitignore?: boolean;
  followSymlinks?: boolean;
  replaceExisting?: boolean;
  preserveMetadata?: boolean;
  compressionLevel?: number | string | null;
  splitMode?: TzapSplitMode;
  volumeSize?: number | string | null;
  volumeCount?: number | string | null;
  tzapRecoveryPercentage?: number | string | null;
  tzapVolumeLossTolerance?: number | string | null;
  zipCompression?: "store" | "deflate";
  sevenZSolid?: boolean;
  sevenZThreads?: number | string | null;
  sevenZChunkSize?: number | string | null;
  sevenZEncryptFileNames?: boolean;
  tzapRecipientCertificatePaths?: string;
  tzapRecipientKeyIds?: string;
  tzapContactRecipientIds?: string;
  tzapSigningMode?: "identity" | "advanced";
  tzapSigningIdentityId?: string;
  tzapSigningIdentityPath?: string;
  tzapSigningCertificatePath?: string;
  tzapSigningPrivateKeyPath?: string;
  tzapSigningChainPaths?: string;
  tzapBootstrapSidecar?: boolean;
}>;

export type CreateWorkspacePlanQueueResult = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  revision: number;
  hasSources: boolean;
}>;

export type CreateWorkspacePlanRequestResult =
  | Readonly<{
      ready: true;
      snapshot: CreateWorkspaceSnapshot;
      revision: number;
      request: PlanCreateRequest;
    }>
  | Readonly<{
      ready: false;
      snapshot: CreateWorkspaceSnapshot;
      revision: number;
      reason: "needsSources" | "stale";
    }>;

export type CreateWorkspaceStartRequestUnavailableReason =
  | CreateArchiveUnavailableReason
  | "passwordMismatch";

export type CreateWorkspaceStartRequestInput = Readonly<{
  password?: string;
  passwordConfirm?: string;
  signingIdentityPassword?: string;
  destinationCollisionStrategy?: StartCreateRequest["destinationCollisionStrategy"];
}>;

export type CreateWorkspaceStartRequestResult =
  | Readonly<{
      ok: true;
      snapshot: CreateWorkspaceSnapshot;
      request: StartCreateRequest;
    }>
  | Readonly<{
      ok: false;
      snapshot: CreateWorkspaceSnapshot;
      reason: CreateWorkspaceStartRequestUnavailableReason;
      status: CreateWorkspacePlanStatus | null;
    }>;

export type QuickCreateStartRequestInput = Readonly<{
  sources: readonly unknown[];
  destinationPath: string;
  format: CreateArchiveFormat;
  cleanSource: boolean;
  replaceExisting: boolean;
  destinationCollisionStrategy?: StartCreateRequest["destinationCollisionStrategy"];
  preserveMetadata: boolean;
  password?: string;
  compressionLevel?: number | null;
  volumeSize?: number | null;
  respectGitignore?: boolean;
  followSymlinks?: boolean;
  tzapRecoveryPercentage?: number | null;
  tzapVolumeLossTolerance?: number;
  zipCompression?: "store" | "deflate";
  sevenZSolid?: boolean;
  sevenZThreads?: number | null;
  sevenZChunkSize?: number | null;
  sevenZEncryptFileNames?: boolean;
}>;

export type QuickCreateStartRequestResult =
  | Readonly<{
      ok: true;
      request: StartCreateRequest;
    }>
  | Readonly<{
      ok: false;
      reason: "needsSources" | "needsDestination";
    }>;

export type CreateWorkspacePlanResultAcceptance = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  revision: number;
  accepted: boolean;
}>;

export type CreateWorkspaceInclusionMutation = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  changed: boolean;
}>;

export type CreateWorkspaceNavigationMutation = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  accepted: boolean;
  changed: boolean;
}>;

export type CreateWorkspaceOptionsMutation = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  changed: boolean;
}>;

export type CreateWorkspaceDestinationMutation = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  changed: boolean;
  destinationPath: string;
}>;

export type CreateWorkspaceSelectionMutation = Readonly<{
  snapshot: CreateWorkspaceSnapshot;
  changed: boolean;
}>;

export type CreateWorkspaceIncludeAllControlState = Readonly<{
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  affectedEntryCount: number;
  includedEntryCount: number;
}>;

export type CreateWorkspace = {
  getSnapshot(): CreateWorkspaceSnapshot;
  suggestedArchiveName(sources?: readonly string[]): string;
  suggestedDestinationPath(options: CreateWorkspaceDestinationSuggestionOptions): string;
  addSources(paths: readonly unknown[]): CreateWorkspaceSourceMutation;
  setSources(paths: readonly unknown[]): CreateWorkspaceSourceMutation;
  removeSources(paths: readonly unknown[]): CreateWorkspaceSourceMutation;
  clearSources(): CreateWorkspaceSourceMutation;
  reset(): CreateWorkspaceSourceMutation;
  resetAfterAcceptedStart(
    format?: CreateArchiveFormat,
    defaults?: FormatCreateDefaults,
  ): CreateWorkspaceSourceMutation;
  queuePlan(): CreateWorkspacePlanQueueResult;
  beginPlan(options?: Partial<CreateWorkspacePlanOptions>, revision?: number): CreateWorkspacePlanRequestResult;
  acceptPlanResult(revision: number, plan: CreatePlanResponse): CreateWorkspacePlanResultAcceptance;
  acceptPlanError(
    revision: number,
    status: CreateWorkspacePlanStatus,
  ): CreateWorkspacePlanResultAcceptance;
  setPlanError(status: CreateWorkspacePlanStatus): CreateWorkspaceSnapshot;
  refreshPlanAfterDestinationEdit(): CreateWorkspaceSnapshot;
  applyFormatDefaults(
    format: CreateArchiveFormat,
    defaults: FormatCreateDefaults,
    suggestionOptions?: CreateWorkspaceDestinationSuggestionOptions,
  ): CreateWorkspaceOptionsMutation;
  changeFormat(format: CreateArchiveFormat, defaults: FormatCreateDefaults): CreateWorkspaceOptionsMutation;
  setOptions(patch: CreateWorkspaceOptionPatch): CreateWorkspaceOptionsMutation;
  setDestinationPath(path: string): CreateWorkspaceDestinationMutation;
  setDestinationPathIfBlank(path: string): CreateWorkspaceDestinationMutation;
  suggestDestinationPathIfBlank(options: CreateWorkspaceDestinationSuggestionOptions): CreateWorkspaceDestinationMutation;
  destinationPathWithFormatExtension(path?: string): string;
  destinationPathForOutputFolder(folderPath: string, destinationPath?: string): string;
  ensureDestinationExtension(): CreateWorkspaceDestinationMutation;
  buildStartCreateRequest(input?: CreateWorkspaceStartRequestInput): CreateWorkspaceStartRequestResult;
  setSubmissionInFlight(inFlight: boolean): CreateWorkspaceOptionsMutation;
  navigateToFolder(folderPath: string): CreateWorkspaceNavigationMutation;
  setSearchQuery(query: string): CreateWorkspaceSnapshot;
  clearSearch(): CreateWorkspaceSnapshot;
  toggleTreeFolder(folderPath: string): CreateWorkspaceNavigationMutation;
  setTreeFolderExpanded(folderPath: string, expanded: boolean): CreateWorkspaceNavigationMutation;
  selectRow(
    path: string,
    modifiers?: Readonly<{ ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }>,
  ): CreateWorkspaceSelectionMutation;
  updateSelection(selection: HierarchicalTableSelectionResult): CreateWorkspaceSelectionMutation;
  toggleRowSelection(path: string): CreateWorkspaceSelectionMutation;
  focusRow(path: string): CreateWorkspaceSelectionMutation;
  ensureRowSelected(path: string): CreateWorkspaceSelectionMutation;
  clearSelection(): CreateWorkspaceSelectionMutation;
  setPathIncluded(path: string, included: boolean): CreateWorkspaceInclusionMutation;
  setAllPathsIncluded(included: boolean): CreateWorkspaceInclusionMutation;
  setCurrentFolderIncluded(folderPath: string | null | undefined, included: boolean): CreateWorkspaceInclusionMutation;
  setVisibleRowsIncluded(included: boolean): CreateWorkspaceInclusionMutation;
  getPathInclusionState(path: string): CreatePlanInclusionState;
  getRowInclusionState(row: CreatePlanRow): CreatePlanInclusionState;
  getIncludeAllControlState(path: string | null | undefined): CreateWorkspaceIncludeAllControlState;
  setColumnWidth(columnId: CreateSourceColumnId, width: number): CreateWorkspaceSnapshot;
  toggleColumnVisibility(columnId: CreateSourceColumnId): CreateWorkspaceSnapshot;
  moveColumn(columnId: CreateSourceColumnId, direction: "left" | "right"): CreateWorkspaceSnapshot;
  reorderColumn(sourceColumnId: CreateSourceColumnId, targetColumnId: CreateSourceColumnId): CreateWorkspaceSnapshot;
  resetColumns(settings?: CreateSourceColumnSettings): CreateWorkspaceSnapshot;
};

type MutableCreateWorkspaceState = {
  sources: string[];
  planState: CreateState;
  currentPlan: CreatePlanResponse | null;
  planStatus: CreateWorkspacePlanStatus | null;
  planRevision: number;
  excludedArchivePaths: Set<string>;
  currentFolder: string;
  searchQuery: string;
  expandedTreeFolders: Set<string>;
  selection: MutableCreateWorkspaceSelection;
  options: MutableCreateWorkspaceOptions;
  columnSettings: CreateSourceColumnSettings;
};

type MutableCreateWorkspaceSelection = {
  selectedPaths: string[];
  focusedPath: string;
  anchorPath: string;
};

type MutableCreateWorkspaceOptions = {
  destinationPath: string;
  format: CreateArchiveFormat;
  cleanSource: boolean;
  respectGitignore: boolean;
  followSymlinks: boolean;
  replaceExisting: boolean;
  preserveMetadata: boolean;
  compressionLevel: number | null;
  splitMode: TzapSplitMode;
  volumeSize: number | null;
  volumeCount: number | null;
  tzapRecoveryPercentage: number;
  tzapVolumeLossTolerance: number;
  zipCompression: "store" | "deflate";
  sevenZSolid: boolean;
  sevenZThreads: number | null;
  sevenZChunkSize: number | null;
  sevenZEncryptFileNames: boolean;
  tzapRecipientCertificatePaths: string;
  tzapRecipientKeyIds: string;
  tzapContactRecipientIds: string;
  tzapSigningMode: "identity" | "advanced";
  tzapSigningIdentityId: string;
  tzapSigningIdentityPath: string;
  tzapSigningCertificatePath: string;
  tzapSigningPrivateKeyPath: string;
  tzapSigningChainPaths: string;
  tzapBootstrapSidecar: boolean;
  submissionInFlight: boolean;
};

const CREATE_PLAN_ROOT_PATH = "";
const DEFAULT_CREATE_OPTIONS: MutableCreateWorkspaceOptions = {
  destinationPath: "",
  format: "tarZst",
  cleanSource: false,
  respectGitignore: true,
  followSymlinks: false,
  replaceExisting: false,
  preserveMetadata: true,
  compressionLevel: null,
  splitMode: "none",
  volumeSize: null,
  volumeCount: null,
  tzapRecoveryPercentage: TZAP_RECOVERY_PERCENTAGE_DEFAULT,
  tzapVolumeLossTolerance: 0,
  zipCompression: "deflate",
  sevenZSolid: true,
  sevenZThreads: null,
  sevenZChunkSize: 16 * 1024 * 1024,
  sevenZEncryptFileNames: true,
  tzapRecipientCertificatePaths: "",
  tzapRecipientKeyIds: "",
  tzapContactRecipientIds: "",
  tzapSigningMode: "identity",
  tzapSigningIdentityId: "",
  tzapSigningIdentityPath: "",
  tzapSigningCertificatePath: "",
  tzapSigningPrivateKeyPath: "",
  tzapSigningChainPaths: "",
  tzapBootstrapSidecar: false,
  submissionInFlight: false,
};

export function buildQuickCreateStartRequest(
  input: QuickCreateStartRequestInput,
): QuickCreateStartRequestResult {
  const sources = normalizeSourcePaths(input.sources);
  if (sources.length === 0) {
    return Object.freeze({
      ok: false,
      reason: "needsSources" as const,
    });
  }

  const destinationPath = input.destinationPath.trim();
  if (!destinationPath) {
    return Object.freeze({
      ok: false,
      reason: "needsDestination" as const,
    });
  }

  return Object.freeze({
    ok: true,
    request: buildStartCreateRequestDto({
      sources,
      destinationPath,
      format: input.format,
      cleanSource: input.cleanSource,
      replaceExisting: input.replaceExisting,
      destinationCollisionStrategy: resolveDestinationCollisionStrategy({
        replaceExisting: input.replaceExisting,
        destinationCollisionStrategy: input.destinationCollisionStrategy,
      }),
      preserveMetadata: input.preserveMetadata,
      password: input.password?.trim() || undefined,
      compressionLevel: input.compressionLevel ?? undefined,
      volumeSize: input.volumeSize ?? undefined,
      respectGitignore: input.respectGitignore,
      followSymlinks: input.followSymlinks,
      tzapRecoveryPercentage: input.tzapRecoveryPercentage ?? undefined,
      tzapVolumeLossTolerance: input.tzapVolumeLossTolerance,
      zipCompression: input.zipCompression,
      sevenZSolid: input.sevenZSolid,
      sevenZThreads: input.sevenZThreads ?? undefined,
      sevenZChunkSize: input.sevenZChunkSize ?? undefined,
      sevenZEncryptFileNames: input.sevenZEncryptFileNames,
    }),
  });
}

export function createCreateWorkspace(initialColumnSettings?: CreateSourceColumnSettings): CreateWorkspace {
  let state: MutableCreateWorkspaceState = {
    sources: [],
    planState: "idle",
    currentPlan: null,
    planStatus: null,
    planRevision: 0,
    excludedArchivePaths: new Set(),
    currentFolder: CREATE_PLAN_ROOT_PATH,
    searchQuery: "",
    expandedTreeFolders: new Set([CREATE_PLAN_ROOT_PATH]),
    selection: emptyCreateSelection(),
    options: cloneDefaultCreateOptions(),
    columnSettings: initialColumnSettings
      ? normalizeCreateColumnSettings(initialColumnSettings)
      : resetCreateColumnSettings(),
  };

  return {
    getSnapshot() {
      return snapshotFromState(state);
    },

    suggestedArchiveName(sources) {
      return suggestedCreateArchiveName(
        [...(sources ?? state.sources)],
        state.options.format,
      );
    },

    suggestedDestinationPath(options) {
      return suggestedDestinationPathFromState(state, options);
    },

    addSources(paths) {
      const normalizedPaths = normalizeSourcePaths(paths);
      if (normalizedPaths.length === 0) {
        return mutationResult(state, false, [], []);
      }

      const existing = new Set(state.sources);
      const addedSources = normalizedPaths.filter((path) => !existing.has(path));
      if (addedSources.length === 0) {
        return mutationResult(state, false, [], []);
      }

      state = {
        ...resetPlanState(state),
        sources: [...state.sources, ...addedSources],
      };
      return mutationResult(state, true, addedSources, []);
    },

    setSources(paths) {
      const nextSources = normalizeSourcePaths(paths);
      const nextSourceSet = new Set(nextSources);
      const currentSourceSet = new Set(state.sources);
      const addedSources = nextSources.filter((path) => !currentSourceSet.has(path));
      const removedSources = state.sources.filter((path) => !nextSourceSet.has(path));
      const changed = !sameOrderedSources(state.sources, nextSources);

      if (changed) {
        state = {
          ...resetPlanState(state),
          sources: nextSources,
        };
      }

      return mutationResult(state, changed, addedSources, removedSources);
    },

    removeSources(paths) {
      const removals = new Set(normalizeSourcePaths(paths));
      if (removals.size === 0) {
        return mutationResult(state, false, [], []);
      }

      const nextSources = state.sources.filter((path) => !removals.has(path));
      const removedSources = state.sources.filter((path) => removals.has(path));
      if (removedSources.length === 0) {
        return mutationResult(state, false, [], []);
      }

      state = {
        ...resetPlanState(state),
        sources: nextSources,
      };
      return mutationResult(state, true, [], removedSources);
    },

    clearSources() {
      if (state.sources.length === 0) {
        return mutationResult(state, false, [], []);
      }

      const removedSources = state.sources;
      state = {
        ...resetPlanState(state),
        sources: [],
      };
      return mutationResult(state, true, [], removedSources);
    },

    reset() {
      if (state.sources.length === 0 && isPlanInitial(state)) {
        return mutationResult(state, false, [], []);
      }

      const removedSources = state.sources;
      state = {
        sources: [],
        planState: "idle",
        currentPlan: null,
        planStatus: null,
        planRevision: state.planRevision + 1,
        excludedArchivePaths: new Set(),
        currentFolder: CREATE_PLAN_ROOT_PATH,
        searchQuery: "",
        expandedTreeFolders: new Set([CREATE_PLAN_ROOT_PATH]),
        selection: emptyCreateSelection(),
        options: {
          ...state.options,
          destinationPath: "",
          submissionInFlight: false,
        },
        columnSettings: state.columnSettings,
      };
      return mutationResult(state, true, [], removedSources);
    },

    resetAfterAcceptedStart(format, defaults) {
      const removedSources = state.sources;
      const nextOptions = format && defaults
        ? applyDefaultsToOptions(state.options, format, defaults)
        : state.options;
      state = {
        sources: [],
        planState: "idle",
        currentPlan: null,
        planStatus: null,
        planRevision: state.planRevision + 1,
        excludedArchivePaths: new Set(),
        currentFolder: CREATE_PLAN_ROOT_PATH,
        searchQuery: "",
        expandedTreeFolders: new Set([CREATE_PLAN_ROOT_PATH]),
        selection: emptyCreateSelection(),
        options: {
          ...nextOptions,
          destinationPath: "",
          submissionInFlight: false,
        },
        columnSettings: state.columnSettings,
      };
      return mutationResult(state, true, [], removedSources);
    },

    queuePlan() {
      const revision = state.planRevision + 1;
      state = beginQueuedPlanState(state, revision);
      return Object.freeze({
        snapshot: snapshotFromState(state),
        revision,
        hasSources: state.sources.length > 0,
      });
    },

    beginPlan(options, revision) {
      const nextRevision = revision ?? state.planRevision + 1;
      if (revision !== undefined && revision !== state.planRevision) {
        return Object.freeze({
          ready: false,
          snapshot: snapshotFromState(state),
          revision,
          reason: "stale" as const,
        });
      }

      state = beginQueuedPlanState(state, nextRevision);
      if (state.sources.length === 0) {
        return Object.freeze({
          ready: false,
          snapshot: snapshotFromState(state),
          revision: nextRevision,
          reason: "needsSources" as const,
        });
      }

      return Object.freeze({
        ready: true,
        snapshot: snapshotFromState(state),
        revision: nextRevision,
        request: buildPlanCreateRequest(
          state.sources,
          {
            ...planOptionsFromState(state),
            ...(options ?? {}),
          },
        ),
      });
    },

    acceptPlanResult(revision, plan) {
      if (revision !== state.planRevision) {
        return stalePlanAcceptance(state, revision);
      }

      state = {
        ...state,
        planState: "ready",
        currentPlan: clonePlanResponse(plan),
        planStatus: null,
      };
      state = pruneExcludedPathsForPlan(state);
      state = reconcileViewForPlan(state);
      return Object.freeze({
        snapshot: snapshotFromState(state),
        revision,
        accepted: true,
      });
    },

    acceptPlanError(revision, status) {
      if (revision !== state.planRevision) {
        return stalePlanAcceptance(state, revision);
      }

      state = setPlanErrorState(state, status);
      return Object.freeze({
        snapshot: snapshotFromState(state),
        revision,
        accepted: true,
      });
    },

    setPlanError(status) {
      state = setPlanErrorState(state, status);
      return snapshotFromState(state);
    },

    refreshPlanAfterDestinationEdit() {
      if (state.planState === "error" && state.currentPlan !== null) {
        state = {
          ...state,
          planState: "ready",
          planStatus: null,
        };
      }
      return snapshotFromState(state);
    },

    applyFormatDefaults(format, defaults, suggestionOptions) {
      const nextOptions = applyDefaultsToOptions(state.options, format, defaults);
      if (!nextOptions.destinationPath.trim() && state.sources.length > 0 && suggestionOptions) {
        nextOptions.destinationPath = suggestedDestinationPathFromOptions(
          state.sources,
          nextOptions.format,
          suggestionOptions,
        );
      }
      const changed = !sameOptions(state.options, nextOptions);
      if (changed) {
        state = {
          ...state,
          options: nextOptions,
        };
      }
      return optionsMutationResult(state, changed);
    },

    changeFormat(format, defaults) {
      const nextOptions = applyDefaultsToOptions(state.options, format, defaults);
      if (state.options.destinationPath.trim()) {
        nextOptions.destinationPath = withCreateArchiveExtension(
          state.options.destinationPath,
          format,
        );
      }
      const changed = !sameOptions(state.options, nextOptions);
      if (changed) {
        state = {
          ...state,
          options: nextOptions,
        };
      }
      return optionsMutationResult(state, changed);
    },

    setOptions(patch) {
      const nextOptions = {
        ...state.options,
        ...(patch.destinationPath !== undefined ? { destinationPath: patch.destinationPath } : {}),
        ...(patch.cleanSource !== undefined ? { cleanSource: patch.cleanSource } : {}),
        ...(patch.respectGitignore !== undefined ? { respectGitignore: patch.respectGitignore } : {}),
        ...(patch.followSymlinks !== undefined ? { followSymlinks: patch.followSymlinks } : {}),
        ...(patch.replaceExisting !== undefined ? { replaceExisting: patch.replaceExisting } : {}),
        ...(patch.preserveMetadata !== undefined ? { preserveMetadata: patch.preserveMetadata } : {}),
        ...(patch.compressionLevel !== undefined
          ? { compressionLevel: normalizeOptionalNonNegativeInteger(patch.compressionLevel) }
          : {}),
        ...(patch.splitMode !== undefined ? { splitMode: patch.splitMode } : {}),
        ...(patch.volumeSize !== undefined
          ? { volumeSize: normalizeCreateVolumeSize(normalizeOptionalNumber(patch.volumeSize)) ?? null }
          : {}),
        ...(patch.volumeCount !== undefined
          ? { volumeCount: normalizeTzapVolumeCount(normalizeOptionalNumber(patch.volumeCount)) ?? null }
          : {}),
        ...(patch.tzapRecoveryPercentage !== undefined
          ? { tzapRecoveryPercentage: normalizeTzapRecoveryOption(patch.tzapRecoveryPercentage) }
          : {}),
        ...(patch.tzapVolumeLossTolerance !== undefined
          ? { tzapVolumeLossTolerance: normalizeTzapVolumeLossTolerance(normalizeOptionalNumber(patch.tzapVolumeLossTolerance)) ?? 0 }
          : {}),
        ...(patch.zipCompression !== undefined ? { zipCompression: patch.zipCompression } : {}),
        ...(patch.sevenZSolid !== undefined ? { sevenZSolid: patch.sevenZSolid } : {}),
        ...(patch.sevenZThreads !== undefined
          ? { sevenZThreads: normalizeOptionalNonNegativeInteger(patch.sevenZThreads) }
          : {}),
        ...(patch.sevenZChunkSize !== undefined
          ? { sevenZChunkSize: normalizeCreateVolumeSize(normalizeOptionalNumber(patch.sevenZChunkSize)) ?? null }
          : {}),
        ...(patch.sevenZEncryptFileNames !== undefined
          ? { sevenZEncryptFileNames: patch.sevenZEncryptFileNames }
          : {}),
        ...(patch.tzapRecipientCertificatePaths !== undefined ? { tzapRecipientCertificatePaths: patch.tzapRecipientCertificatePaths } : {}),
        ...(patch.tzapRecipientKeyIds !== undefined ? { tzapRecipientKeyIds: patch.tzapRecipientKeyIds } : {}),
        ...(patch.tzapContactRecipientIds !== undefined ? { tzapContactRecipientIds: patch.tzapContactRecipientIds } : {}),
        ...(patch.tzapSigningMode !== undefined ? { tzapSigningMode: patch.tzapSigningMode } : {}),
        ...(patch.tzapSigningIdentityId !== undefined ? { tzapSigningIdentityId: patch.tzapSigningIdentityId } : {}),
        ...(patch.tzapSigningIdentityPath !== undefined ? { tzapSigningIdentityPath: patch.tzapSigningIdentityPath } : {}),
        ...(patch.tzapSigningCertificatePath !== undefined ? { tzapSigningCertificatePath: patch.tzapSigningCertificatePath } : {}),
        ...(patch.tzapSigningPrivateKeyPath !== undefined ? { tzapSigningPrivateKeyPath: patch.tzapSigningPrivateKeyPath } : {}),
        ...(patch.tzapSigningChainPaths !== undefined ? { tzapSigningChainPaths: patch.tzapSigningChainPaths } : {}),
        ...(patch.tzapBootstrapSidecar !== undefined ? { tzapBootstrapSidecar: patch.tzapBootstrapSidecar } : {}),
      };
      if (patch.splitMode !== undefined) {
        if (nextOptions.splitMode === "none") {
          nextOptions.volumeSize = null;
          nextOptions.volumeCount = null;
        } else if (nextOptions.splitMode === "volumeSize") {
          nextOptions.volumeCount = null;
        } else {
          nextOptions.volumeSize = null;
        }
      }
      if (patch.volumeSize !== undefined) {
        nextOptions.splitMode = nextOptions.volumeSize === null ? "none" : "volumeSize";
        nextOptions.volumeCount = null;
      }
      if (patch.volumeCount !== undefined) {
        nextOptions.splitMode = nextOptions.volumeCount === null ? "none" : "volumeCount";
        nextOptions.volumeSize = null;
      }
      if (state.options.format === "tzap" && nextOptions.splitMode === "none") {
        nextOptions.tzapVolumeLossTolerance = 0;
      } else if (
        state.options.format === "tzap" &&
        (patch.volumeSize !== undefined || patch.volumeCount !== undefined) &&
        state.options.splitMode === "none" &&
        patch.tzapVolumeLossTolerance === undefined
      ) {
        nextOptions.tzapVolumeLossTolerance = TZAP_SPLIT_DEFAULT_VOLUME_LOSS_TOLERANCE;
      }
      const optionsChanged = !sameOptions(state.options, nextOptions);
      const planWillRefresh = state.planState === "error" && state.currentPlan !== null;
      if (!optionsChanged && !planWillRefresh) {
        return optionsMutationResult(state, false);
      }

      state = refreshPlanAfterTransientInputEdit({
        ...state,
        options: nextOptions,
      });
      return optionsMutationResult(state, true);
    },

    setDestinationPath(path) {
      const optionsChanged = state.options.destinationPath !== path;
      const planWillRefresh = state.planState === "error" && state.currentPlan !== null;
      if (!optionsChanged && !planWillRefresh) {
        return destinationMutationResult(state, false);
      }

      state = refreshPlanAfterTransientInputEdit({
        ...state,
        options: {
          ...state.options,
          destinationPath: path,
        },
      });
      return destinationMutationResult(state, true);
    },

    setDestinationPathIfBlank(path) {
      if (state.options.destinationPath.trim()) {
        return destinationMutationResult(state, false);
      }
      const nextPath = path.trim();
      const changed = state.options.destinationPath !== nextPath;
      if (changed) {
        state = {
          ...state,
          options: {
            ...state.options,
            destinationPath: nextPath,
          },
        };
      }
      return destinationMutationResult(state, changed);
    },

    suggestDestinationPathIfBlank(options) {
      if (state.options.destinationPath.trim()) {
        return destinationMutationResult(state, false);
      }
      const nextPath = suggestedDestinationPathFromState(state, options);
      const changed = state.options.destinationPath !== nextPath;
      if (changed) {
        state = {
          ...state,
          options: {
            ...state.options,
            destinationPath: nextPath,
          },
        };
      }
      return destinationMutationResult(state, changed);
    },

    destinationPathWithFormatExtension(path) {
      return withCreateArchiveExtension(path ?? state.options.destinationPath, state.options.format);
    },

    destinationPathForOutputFolder(folderPath, destinationPath) {
      return withCreateArchiveExtension(
        joinNativePath(folderPath, archiveNameForOutputFolder(state, destinationPath ?? state.options.destinationPath)),
        state.options.format,
      );
    },

    ensureDestinationExtension() {
      const destinationPath = withCreateArchiveExtension(
        state.options.destinationPath,
        state.options.format,
      );
      const changed = Boolean(destinationPath) && state.options.destinationPath !== destinationPath;
      if (changed) {
        state = {
          ...state,
          options: {
            ...state.options,
            destinationPath,
          },
        };
      }
      return destinationMutationResult(state, changed, destinationPath);
    },

    buildStartCreateRequest(input) {
      const destinationPath = withCreateArchiveExtension(
        state.options.destinationPath,
        state.options.format,
      );
      if (destinationPath && destinationPath !== state.options.destinationPath) {
        state = {
          ...state,
          options: {
            ...state.options,
            destinationPath,
          },
        };
      }

      if (state.options.submissionInFlight) {
        return startRequestUnavailableResult(state, "starting");
      }
      if (state.sources.length === 0) {
        return startRequestUnavailableResult(state, "needsSources");
      }
      if (!destinationPath) {
        state = setPlanErrorState(state, { messageKey: "create.error.pickDestination" });
        return startRequestUnavailableResult(state, "needsDestination", state.planStatus);
      }
      if (state.planState === "loading") {
        state = setPlanErrorState(state, { messageKey: "create.error.refreshPlan" });
        return startRequestUnavailableResult(state, "planning", state.planStatus);
      }
      if (state.planState !== "ready" || state.currentPlan === null) {
        state = setPlanErrorState(state, { messageKey: "create.error.refreshPlan" });
        return startRequestUnavailableResult(state, "needsPlan", state.planStatus);
      }

      const includedPlan = filterCreatePlanByIncludedPaths(state.currentPlan, state.excludedArchivePaths);
      if (includedPlan.planEntries.length === 0) {
        return startRequestUnavailableResult(state, "needsIncludedEntries");
      }

      const supportsPassword = createFormatSupportsPassword(state.options.format);
      const password = supportsPassword ? input?.password?.trim() ?? "" : "";
      const passwordConfirm = supportsPassword ? input?.passwordConfirm?.trim() ?? "" : "";
      if ((password || passwordConfirm) && password !== passwordConfirm) {
        state = setPlanErrorState(state, { messageKey: "create.error.passwordMismatch" });
        return startRequestUnavailableResult(state, "passwordMismatch", state.planStatus);
      }

      return Object.freeze({
        ok: true,
        snapshot: snapshotFromState(state),
        request: buildStartCreateRequestFromState(state, {
          password,
          signingIdentityPassword: input?.signingIdentityPassword ?? "",
          destinationCollisionStrategy: input?.destinationCollisionStrategy,
        }),
      });
    },

    setSubmissionInFlight(inFlight) {
      if (state.options.submissionInFlight === inFlight) {
        return optionsMutationResult(state, false);
      }
      state = {
        ...state,
        options: {
          ...state.options,
          submissionInFlight: inFlight,
        },
      };
      return optionsMutationResult(state, true);
    },

    navigateToFolder(folderPath) {
      const nextFolder = normalizeExistingCreateFolderPath(state.currentPlan?.planEntries ?? [], folderPath);
      if (nextFolder === null) {
        return navigationMutationResult(state, false, false);
      }

      if (nextFolder === state.currentFolder) {
        return navigationMutationResult(state, true, false);
      }

      state = {
        ...state,
        currentFolder: nextFolder,
        searchQuery: "",
        expandedTreeFolders: new Set(expandedFolderAndAncestors(
          [...state.expandedTreeFolders],
          nextFolder,
        )),
      };
      state = cleanupSelectionForState(state);
      return navigationMutationResult(state, true, true);
    },

    setSearchQuery(query) {
      const nextQuery = String(query ?? "");
      if (nextQuery === state.searchQuery) {
        return snapshotFromState(state);
      }
      state = {
        ...state,
        searchQuery: nextQuery,
      };
      state = cleanupSelectionForState(state);
      return snapshotFromState(state);
    },

    clearSearch() {
      if (!state.searchQuery) {
        return snapshotFromState(state);
      }
      state = {
        ...state,
        searchQuery: "",
      };
      state = cleanupSelectionForState(state);
      return snapshotFromState(state);
    },

    toggleTreeFolder(folderPath) {
      const normalizedFolder = normalizeExistingCreateFolderPath(state.currentPlan?.planEntries ?? [], folderPath);
      if (normalizedFolder === null || !normalizedFolder) {
        return navigationMutationResult(state, false, false);
      }

      const expandedTreeFolders = new Set(state.expandedTreeFolders);
      if (expandedTreeFolders.has(normalizedFolder)) {
        expandedTreeFolders.delete(normalizedFolder);
      } else {
        expandedTreeFolders.add(normalizedFolder);
      }

      const nextExpandedTreeFolders = new Set(expandedFolderAndAncestors(
        [...expandedTreeFolders],
        state.currentFolder,
      ));
      const changed = !sameStringSet(state.expandedTreeFolders, nextExpandedTreeFolders);
      if (changed) {
        state = {
          ...state,
          expandedTreeFolders: nextExpandedTreeFolders,
        };
      }
      return navigationMutationResult(state, true, changed);
    },

    setTreeFolderExpanded(folderPath, expanded) {
      const normalizedFolder = normalizeExistingCreateFolderPath(state.currentPlan?.planEntries ?? [], folderPath);
      if (normalizedFolder === null || !normalizedFolder) {
        return navigationMutationResult(state, false, false);
      }

      const expandedTreeFolders = new Set(state.expandedTreeFolders);
      if (expanded) {
        expandedTreeFolders.add(normalizedFolder);
      } else {
        expandedTreeFolders.delete(normalizedFolder);
      }

      const nextExpandedTreeFolders = new Set(expandedFolderAndAncestors(
        [...expandedTreeFolders],
        state.currentFolder,
      ));
      const changed = !sameStringSet(state.expandedTreeFolders, nextExpandedTreeFolders);
      if (changed) {
        state = {
          ...state,
          expandedTreeFolders: nextExpandedTreeFolders,
        };
      }
      return navigationMutationResult(state, true, changed);
    },

    selectRow(path, modifiers) {
      const result = applyHierarchicalRowSelectionIntent({
        path: normalizeCreateArchivePath(path),
        visiblePaths: visibleSelectablePathsForState(state),
        currentSelection: new Set(state.selection.selectedPaths),
        anchorPath: state.selection.anchorPath,
        ctrlKey: modifiers?.ctrlKey,
        metaKey: modifiers?.metaKey,
        shiftKey: modifiers?.shiftKey,
      });
      return applySelectionResult(result);
    },

    updateSelection(selection) {
      return applySelectionResult(selection);
    },

    toggleRowSelection(path) {
      return applySelectionResult(toggleHierarchicalTablePathSelection({
        selectedPaths: new Set(state.selection.selectedPaths),
        focusedPath: state.selection.focusedPath,
        anchorPath: state.selection.anchorPath,
        path: normalizeCreateArchivePath(path),
      }));
    },

    focusRow(path) {
      return applySelectionResult(focusHierarchicalTablePath({
        selectedPaths: new Set(state.selection.selectedPaths),
        focusedPath: state.selection.focusedPath,
        anchorPath: state.selection.anchorPath,
      }, normalizeCreateArchivePath(path)));
    },

    ensureRowSelected(path) {
      return applySelectionResult(ensureHierarchicalTablePathSelected({
        selectedPaths: new Set(state.selection.selectedPaths),
        focusedPath: state.selection.focusedPath,
        anchorPath: state.selection.anchorPath,
        path: normalizeCreateArchivePath(path),
      }));
    },

    clearSelection() {
      return applySelectionResult(clearHierarchicalTableSelection());
    },

    setPathIncluded(path, included) {
      const normalizedPath = normalizeCreateArchivePath(path);
      if (!state.currentPlan || !normalizedPath) {
        return inclusionMutationResult(state, false);
      }

      const nextExcludedPaths = applyCreatePlanPathInclusion({
        entries: state.currentPlan.planEntries,
        excludedPaths: state.excludedArchivePaths,
        path: normalizedPath,
        included,
      });
      const changed = !sameStringSet(state.excludedArchivePaths, nextExcludedPaths);
      if (changed) {
        state = {
          ...state,
          excludedArchivePaths: nextExcludedPaths,
        };
      }
      return inclusionMutationResult(state, changed);
    },

    setAllPathsIncluded(included) {
      const nextExcludedPaths = included
        ? new Set<string>()
        : new Set(plannedArchivePaths(state.currentPlan));
      const changed = !sameStringSet(state.excludedArchivePaths, nextExcludedPaths);
      if (changed) {
        state = {
          ...state,
          excludedArchivePaths: nextExcludedPaths,
        };
      }
      return inclusionMutationResult(state, changed);
    },

    setCurrentFolderIncluded(folderPath, included) {
      const normalizedFolderPath = normalizeCreateArchivePath(folderPath);
      if (!normalizedFolderPath) {
        const nextExcludedPaths = included
          ? new Set<string>()
          : new Set(plannedArchivePaths(state.currentPlan));
        const changed = !sameStringSet(state.excludedArchivePaths, nextExcludedPaths);
        if (changed) {
          state = {
            ...state,
            excludedArchivePaths: nextExcludedPaths,
          };
        }
        return inclusionMutationResult(state, changed);
      }

      if (!state.currentPlan) {
        return inclusionMutationResult(state, false);
      }
      const nextExcludedPaths = applyCreatePlanPathInclusion({
        entries: state.currentPlan.planEntries,
        excludedPaths: state.excludedArchivePaths,
        path: normalizedFolderPath,
        included,
      });
      const changed = !sameStringSet(state.excludedArchivePaths, nextExcludedPaths);
      if (changed) {
        state = {
          ...state,
          excludedArchivePaths: nextExcludedPaths,
        };
      }
      return inclusionMutationResult(state, changed);
    },

    setVisibleRowsIncluded(included) {
      if (!state.currentPlan) {
        return inclusionMutationResult(state, false);
      }

      const visiblePaths = visibleRowsForState(state)
        .filter((row) => row.rowType !== "parent")
        .map((row) => normalizeCreateArchivePath(row.path))
        .filter(Boolean);
      if (visiblePaths.length === 0) {
        return inclusionMutationResult(state, false);
      }

      let nextExcludedPaths = new Set(state.excludedArchivePaths);
      for (const path of visiblePaths) {
        nextExcludedPaths = applyCreatePlanPathInclusion({
          entries: state.currentPlan.planEntries,
          excludedPaths: nextExcludedPaths,
          path,
          included,
        });
      }
      const changed = !sameStringSet(state.excludedArchivePaths, nextExcludedPaths);
      if (changed) {
        state = {
          ...state,
          excludedArchivePaths: nextExcludedPaths,
        };
      }
      return inclusionMutationResult(state, changed);
    },

    getPathInclusionState(path) {
      return pathInclusionState(state, path);
    },

    getRowInclusionState(row) {
      return createPlanRowInclusionState(
        row,
        state.currentPlan?.planEntries ?? [],
        state.excludedArchivePaths,
      );
    },

    getIncludeAllControlState(path) {
      return includeAllControlState(state, path);
    },

    setColumnWidth(columnId, width) {
      state = {
        ...state,
        columnSettings: setCreateColumnWidth(state.columnSettings, columnId, width),
      };
      return snapshotFromState(state);
    },

    toggleColumnVisibility(columnId) {
      state = {
        ...state,
        columnSettings: toggleCreateColumnVisibility(state.columnSettings, columnId),
      };
      return snapshotFromState(state);
    },

    moveColumn(columnId, direction) {
      state = {
        ...state,
        columnSettings: moveCreateColumn(state.columnSettings, columnId, direction),
      };
      return snapshotFromState(state);
    },

    reorderColumn(sourceColumnId, targetColumnId) {
      state = {
        ...state,
        columnSettings: reorderCreateColumn(state.columnSettings, sourceColumnId, targetColumnId),
      };
      return snapshotFromState(state);
    },

    resetColumns(settings) {
      state = {
        ...state,
        columnSettings: settings ? normalizeCreateColumnSettings(settings) : resetCreateColumnSettings(),
      };
      return snapshotFromState(state);
    },
  };

  function applySelectionResult(selection: HierarchicalTableSelectionResult): CreateWorkspaceSelectionMutation {
    const nextSelection = selectionFromResult(cleanupHierarchicalTableSelection({
      selectedPaths: selection.selectedPaths,
      focusedPath: selection.focusedPath,
      anchorPath: selection.anchorPath,
      visiblePaths: visibleSelectablePathsForState(state),
      preserveHiddenSelection: false,
    }));
    const changed = !sameCreateSelection(state.selection, nextSelection);
    if (changed) {
      state = {
        ...state,
        selection: nextSelection,
      };
    }
    return selectionMutationResult(state, changed);
  }
}

function normalizeSourcePaths(paths: readonly unknown[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();

  for (const value of paths) {
    if (typeof value !== "string") {
      continue;
    }

    const source = value.trim();
    if (!source || seen.has(source)) {
      continue;
    }

    seen.add(source);
    sources.push(source);
  }

  return sources;
}

function cloneDefaultCreateOptions(): MutableCreateWorkspaceOptions {
  return { ...DEFAULT_CREATE_OPTIONS };
}

function emptyCreateSelection(): MutableCreateWorkspaceSelection {
  return {
    selectedPaths: [],
    focusedPath: "",
    anchorPath: "",
  };
}

function applyDefaultsToOptions(
  options: MutableCreateWorkspaceOptions,
  format: CreateArchiveFormat,
  defaults: FormatCreateDefaults,
): MutableCreateWorkspaceOptions {
  return {
    ...options,
    format,
    cleanSource: defaults.cleanSource,
    respectGitignore: Boolean(defaults.respectGitignore),
    followSymlinks: Boolean(defaults.followSymlinks),
    replaceExisting: defaults.replaceExisting,
    preserveMetadata: defaults.preserveMetadata,
    compressionLevel: normalizeOptionalNonNegativeInteger(defaults.compressionLevel),
    splitMode: normalizeCreateVolumeSize(defaults.volumeSize ?? undefined) === undefined ? "none" : "volumeSize",
    volumeSize: normalizeCreateVolumeSize(defaults.volumeSize ?? undefined) ?? null,
    volumeCount: null,
    tzapRecoveryPercentage: format === "tzap"
      ? normalizeTzapRecoveryOption(defaults.tzapRecoveryPercentage)
      : TZAP_RECOVERY_PERCENTAGE_DEFAULT,
    tzapVolumeLossTolerance: format === "tzap" && defaults.volumeSize
      ? normalizeTzapVolumeLossTolerance(defaults.tzapVolumeLossTolerance) ?? TZAP_SPLIT_DEFAULT_VOLUME_LOSS_TOLERANCE
      : 0,
    zipCompression: format === "zip" ? defaults.zipCompression ?? "deflate" : "deflate",
    sevenZSolid: format === "sevenZ" ? defaults.sevenZSolid ?? true : true,
    sevenZThreads: format === "sevenZ" ? defaults.sevenZThreads ?? null : null,
    sevenZChunkSize: format === "sevenZ" ? defaults.sevenZChunkSize ?? 16 * 1024 * 1024 : null,
    sevenZEncryptFileNames: format === "sevenZ" ? defaults.sevenZEncryptFileNames ?? true : true,
    tzapRecipientCertificatePaths: "",
    tzapRecipientKeyIds: "",
    tzapContactRecipientIds: "",
    // Persist only the enrolled identity ID. Private key material and passwords remain
    // create-time/native-secure-store data.
    tzapSigningMode: "identity",
    tzapSigningIdentityId: format === "tzap" && defaults.tzapSigningDefault === "identity"
      ? defaults.tzapDefaultSigningIdentityId ?? ""
      : "",
    tzapSigningIdentityPath: "",
    tzapSigningCertificatePath: "",
    tzapSigningPrivateKeyPath: "",
    tzapSigningChainPaths: "",
    tzapBootstrapSidecar: format === "tzap" ? (defaults.tzapBootstrapSidecar ?? false) : false,
  };
}

function planOptionsFromState(state: MutableCreateWorkspaceState): CreateWorkspacePlanOptions {
  return {
    cleanSource: state.options.cleanSource,
    respectGitignore: state.options.respectGitignore,
    excludeNames: [],
    excludeArchivePaths: [],
    includeArchivePaths: [],
    followSymlinks: state.options.followSymlinks,
  };
}

function buildStartCreateRequestFromState(
  state: MutableCreateWorkspaceState,
  input: Pick<CreateWorkspaceStartRequestInput, "destinationCollisionStrategy" | "signingIdentityPassword"> & { password: string },
): StartCreateRequest {
  return buildStartCreateRequestDto({
    sources: [...state.sources],
    destinationPath: state.options.destinationPath,
    format: state.options.format,
    cleanSource: state.options.cleanSource,
    excludeArchivePaths: sortedExcludedArchivePaths(state.excludedArchivePaths),
    respectGitignore: state.options.respectGitignore,
    followSymlinks: state.options.followSymlinks,
    replaceExisting: state.options.replaceExisting,
    destinationCollisionStrategy: input.destinationCollisionStrategy,
    preserveMetadata: state.options.preserveMetadata,
    password: input.password || undefined,
    compressionLevel: state.options.compressionLevel ?? undefined,
    splitMode: state.options.splitMode,
    volumeSize: state.options.volumeSize ?? undefined,
    volumeCount: state.options.volumeCount ?? undefined,
    tzapRecoveryPercentage: state.options.format === "tzap"
      ? state.options.tzapRecoveryPercentage
      : undefined,
    tzapVolumeLossTolerance: state.options.format === "tzap"
      ? state.options.tzapVolumeLossTolerance
      : undefined,
    zipCompression: state.options.format === "zip" ? state.options.zipCompression : undefined,
    sevenZSolid: state.options.format === "sevenZ" ? state.options.sevenZSolid : undefined,
    sevenZThreads: state.options.format === "sevenZ" ? state.options.sevenZThreads ?? undefined : undefined,
    sevenZChunkSize: state.options.format === "sevenZ" ? state.options.sevenZChunkSize ?? undefined : undefined,
    sevenZEncryptFileNames: state.options.format === "sevenZ"
      ? state.options.sevenZEncryptFileNames
      : undefined,
    tzapCertificates: state.options.format === "tzap"
      ? tzapCertificateRequestFromState(state.options, input.signingIdentityPassword)
      : undefined,
    tzapBootstrapSidecar: state.options.format === "tzap"
      ? state.options.tzapBootstrapSidecar
      : undefined,
  });
}

function tzapCertificateRequestFromState(
  options: MutableCreateWorkspaceOptions,
  signingIdentityPassword = "",
): StartCreateRequest["tzapCertificates"] | undefined {
  const recipientCertificatePaths = splitCertificatePaths(options.tzapRecipientCertificatePaths);
  const recipientKeyIds = splitSelectionIds(options.tzapRecipientKeyIds);
  const contactRecipientIds = splitSelectionIds(options.tzapContactRecipientIds);
  const signingP12Path = options.tzapSigningMode === "advanced" ? options.tzapSigningIdentityPath.trim() : "";
  const signingChainPaths = options.tzapSigningMode === "advanced" ? splitCertificatePaths(options.tzapSigningChainPaths) : [];
  const signingCertificatePath = options.tzapSigningMode === "advanced" ? options.tzapSigningCertificatePath.trim() : "";
  const signingPrivateKeyPath = options.tzapSigningMode === "advanced" ? options.tzapSigningPrivateKeyPath.trim() : "";
  const signingIdentityId = options.tzapSigningMode === "identity" ? options.tzapSigningIdentityId.trim() : "";
  const hasRecipientSelection = recipientCertificatePaths.length > 0 || recipientKeyIds.length > 0 || contactRecipientIds.length > 0;
  if (!hasRecipientSelection && !signingIdentityId && !signingP12Path && !signingCertificatePath && !signingPrivateKeyPath && !signingChainPaths.length) {
    return undefined;
  }
  return {
    ...(hasRecipientSelection
      ? {
          recipientSelection: {
            recipientKeyIds,
            contactRecipientIds,
            oneTimeCertificatePaths: recipientCertificatePaths,
          },
        }
      : {}),
    signingSelection: signingIdentityId
      ? { mode: "enrolledIdentity", signingIdentityId }
      : signingP12Path
        ? {
            mode: "oneTimePkcs12",
            path: signingP12Path,
            password: signingIdentityPassword,
          }
      : signingCertificatePath || signingPrivateKeyPath || signingChainPaths.length
        ? {
            mode: "oneTimeCertificateAndKey",
            certificatePath: signingCertificatePath,
            privateKeyPath: signingPrivateKeyPath,
            chainPaths: signingChainPaths,
            ...(signingIdentityPassword ? { password: signingIdentityPassword } : {}),
          }
        : { mode: "none" },
  };
}

function splitCertificatePaths(value: string): string[] {
  return value.split(/[;\r\n]+/).map((path) => path.trim()).filter(Boolean);
}

function splitSelectionIds(value: string): string[] {
  return value.split(/[;,\r\n]+/).map((id) => id.trim()).filter(Boolean);
}

function suggestedDestinationPathFromState(
  state: MutableCreateWorkspaceState,
  options: CreateWorkspaceDestinationSuggestionOptions,
): string {
  return suggestedDestinationPathFromOptions(state.sources, state.options.format, options);
}

function archiveNameForOutputFolder(
  state: MutableCreateWorkspaceState,
  destinationPath: string,
): string {
  const archiveName = getArchiveName(
    withCreateArchiveExtension(destinationPath, state.options.format),
    "",
  ).trim();
  return archiveName || suggestedCreateArchiveName(state.sources, state.options.format);
}

function suggestedDestinationPathFromOptions(
  sources: readonly string[],
  format: CreateArchiveFormat,
  options: CreateWorkspaceDestinationSuggestionOptions,
): string {
  const sourceParentDirectory = commonSourceParentDirectory(sources, options);
  const directory =
    normalizedOptionalPath(options.defaultDirectory) ??
    sourceParentDirectory;
  const nameSource = sources.length > 1
    ? sourceParentDirectory ? [sourceParentDirectory] : []
    : [...sources];
  const name = suggestedCreateArchiveName(nameSource, format);
  return directory ? joinNativePath(directory, name) : name;
}

function joinNativePath(parentPath: string, childName: string): string {
  const trimmedParent = parentPath.trim().replace(/[\\/]+$/, "");
  if (!trimmedParent) {
    return childName;
  }
  const separator = trimmedParent.includes("\\") ? "\\" : "/";
  return `${trimmedParent}${separator}${childName}`;
}

function normalizedOptionalPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim() ?? "";
  return trimmed || null;
}

function normalizeOptionalNonNegativeInteger(value: number | string | null | undefined): number | null {
  const numeric = normalizeOptionalNumber(value);
  if (numeric === undefined || numeric < 0) {
    return null;
  }
  return Math.floor(numeric);
}

function normalizeOptionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return Number.isFinite(value) ? value : undefined;
}

function normalizeTzapRecoveryOption(value: number | string | null | undefined): number {
  return normalizeTzapRecoveryPercentage(normalizeOptionalNumber(value)) ?? TZAP_RECOVERY_PERCENTAGE_DEFAULT;
}

function refreshPlanAfterTransientInputEdit(
  state: MutableCreateWorkspaceState,
): MutableCreateWorkspaceState {
  if (state.planState !== "error" || state.currentPlan === null) {
    return state;
  }
  return {
    ...state,
    planState: "ready",
    planStatus: null,
  };
}

function sameOptions(left: MutableCreateWorkspaceOptions, right: MutableCreateWorkspaceOptions): boolean {
  return (
    left.destinationPath === right.destinationPath &&
    left.format === right.format &&
    left.cleanSource === right.cleanSource &&
    left.respectGitignore === right.respectGitignore &&
    left.followSymlinks === right.followSymlinks &&
    left.replaceExisting === right.replaceExisting &&
    left.preserveMetadata === right.preserveMetadata &&
    left.compressionLevel === right.compressionLevel &&
    left.splitMode === right.splitMode &&
    left.volumeSize === right.volumeSize &&
    left.volumeCount === right.volumeCount &&
    left.tzapRecoveryPercentage === right.tzapRecoveryPercentage &&
    left.tzapVolumeLossTolerance === right.tzapVolumeLossTolerance &&
    left.zipCompression === right.zipCompression &&
    left.sevenZSolid === right.sevenZSolid &&
    left.sevenZThreads === right.sevenZThreads &&
    left.sevenZChunkSize === right.sevenZChunkSize &&
    left.sevenZEncryptFileNames === right.sevenZEncryptFileNames &&
    left.tzapRecipientCertificatePaths === right.tzapRecipientCertificatePaths &&
    left.tzapRecipientKeyIds === right.tzapRecipientKeyIds &&
    left.tzapContactRecipientIds === right.tzapContactRecipientIds &&
    left.tzapSigningMode === right.tzapSigningMode &&
    left.tzapSigningIdentityId === right.tzapSigningIdentityId &&
    left.tzapSigningIdentityPath === right.tzapSigningIdentityPath &&
    left.tzapSigningCertificatePath === right.tzapSigningCertificatePath &&
    left.tzapSigningPrivateKeyPath === right.tzapSigningPrivateKeyPath &&
    left.tzapSigningChainPaths === right.tzapSigningChainPaths &&
    left.tzapBootstrapSidecar === right.tzapBootstrapSidecar &&
    left.submissionInFlight === right.submissionInFlight
  );
}

function sameOrderedSources(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isPlanInitial(state: MutableCreateWorkspaceState): boolean {
  return (
    state.planState === "idle" &&
    state.currentPlan === null &&
    state.planStatus === null &&
    state.excludedArchivePaths.size === 0 &&
    state.currentFolder === CREATE_PLAN_ROOT_PATH &&
    state.searchQuery === "" &&
    sameStringSet(state.expandedTreeFolders, new Set([CREATE_PLAN_ROOT_PATH])) &&
    sameCreateSelection(state.selection, emptyCreateSelection()) &&
    sameOptions(state.options, DEFAULT_CREATE_OPTIONS)
  );
}

function resetPlanState(state: MutableCreateWorkspaceState): MutableCreateWorkspaceState {
  return {
    ...state,
    planState: "idle",
    currentPlan: null,
    planStatus: null,
    excludedArchivePaths: new Set(),
    currentFolder: CREATE_PLAN_ROOT_PATH,
    searchQuery: "",
    expandedTreeFolders: new Set([CREATE_PLAN_ROOT_PATH]),
    selection: emptyCreateSelection(),
  };
}

function beginQueuedPlanState(
  state: MutableCreateWorkspaceState,
  revision: number,
): MutableCreateWorkspaceState {
  if (state.sources.length === 0) {
    return {
      ...state,
      planState: "idle",
      currentPlan: null,
      planStatus: freezePlanStatus({ messageKey: "create.plan.noSources" }),
      planRevision: revision,
      excludedArchivePaths: new Set(),
      currentFolder: CREATE_PLAN_ROOT_PATH,
      searchQuery: "",
      expandedTreeFolders: new Set([CREATE_PLAN_ROOT_PATH]),
      selection: emptyCreateSelection(),
    };
  }

  return {
    ...state,
    planState: "loading",
    planStatus: freezePlanStatus({ messageKey: "create.plan.planning" }),
    planRevision: revision,
  };
}

function buildPlanCreateRequest(
  sources: readonly string[],
  options: CreateWorkspacePlanOptions,
): PlanCreateRequest {
  return {
    sources: [...sources],
    cleanSource: options.cleanSource,
    respectGitignore: options.respectGitignore,
    ...(options.excludeNames?.length ? { excludeNames: normalizeOptionalStrings(options.excludeNames) } : {}),
    ...(options.excludeArchivePaths?.length
      ? { excludeArchivePaths: normalizeOptionalStrings(options.excludeArchivePaths) }
      : {}),
    ...(options.includeArchivePaths?.length
      ? { includeArchivePaths: normalizeOptionalStrings(options.includeArchivePaths) }
      : {}),
    followSymlinks: options.followSymlinks ?? false,
  };
}

function normalizeOptionalStrings(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function freezePlanStatus(
  status: CreateWorkspacePlanStatus | null | undefined,
): CreateWorkspacePlanStatus | null {
  if (!status || (!status.messageKey && !status.fallbackText)) {
    return null;
  }
  return Object.freeze({
    ...(status.messageKey ? { messageKey: status.messageKey } : {}),
    ...(status.fallbackText ? { fallbackText: status.fallbackText } : {}),
  });
}

function setPlanErrorState(
  state: MutableCreateWorkspaceState,
  status: CreateWorkspacePlanStatus,
): MutableCreateWorkspaceState {
  const nextView = state.currentPlan
    ? {
        currentFolder: state.currentFolder,
        searchQuery: state.searchQuery,
        expandedTreeFolders: state.expandedTreeFolders,
      }
    : {
        currentFolder: CREATE_PLAN_ROOT_PATH,
        searchQuery: "",
        expandedTreeFolders: new Set<string>([CREATE_PLAN_ROOT_PATH]),
      };
  return {
    ...state,
    planState: "error",
    planStatus: freezePlanStatus(status),
    currentFolder: nextView.currentFolder,
    searchQuery: nextView.searchQuery,
    expandedTreeFolders: nextView.expandedTreeFolders,
    selection: state.currentPlan ? state.selection : emptyCreateSelection(),
  };
}

function startRequestUnavailableResult(
  state: MutableCreateWorkspaceState,
  reason: CreateWorkspaceStartRequestUnavailableReason,
  status: CreateWorkspacePlanStatus | null = null,
): Extract<CreateWorkspaceStartRequestResult, { ok: false }> {
  return Object.freeze({
    ok: false,
    snapshot: snapshotFromState(state),
    reason,
    status,
  });
}

function stalePlanAcceptance(
  state: MutableCreateWorkspaceState,
  revision: number,
): CreateWorkspacePlanResultAcceptance {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    revision,
    accepted: false,
  });
}

function clonePlanResponse(plan: CreatePlanResponse): CreatePlanResponse {
  const planEntries = plan.planEntries.map((entry) => Object.freeze({ ...entry }) as CreatePlanEntryDto);
  return Object.freeze({
    includedCount: plan.includedCount,
    excludedCount: plan.excludedCount,
    totalBytes: plan.totalBytes,
    excludedBytes: plan.excludedBytes,
    entries: Object.freeze([...plan.entries]) as unknown as string[],
    planEntries: Object.freeze(planEntries) as unknown as CreatePlanEntryDto[],
    excludedEntries: Object.freeze([...plan.excludedEntries]) as unknown as string[],
    warnings: Object.freeze([...plan.warnings]) as unknown as string[],
  }) as CreatePlanResponse;
}

function pruneExcludedPathsForPlan(state: MutableCreateWorkspaceState): MutableCreateWorkspaceState {
  if (!state.currentPlan) {
    return state;
  }

  const plannedPaths = new Set(plannedArchivePaths(state.currentPlan));
  const excludedArchivePaths = new Set(
    [...state.excludedArchivePaths].filter((path) => plannedPaths.has(path)),
  );
  return {
    ...state,
    excludedArchivePaths,
  };
}

function reconcileViewForPlan(state: MutableCreateWorkspaceState): MutableCreateWorkspaceState {
  if (!state.currentPlan) {
    return {
      ...state,
      currentFolder: CREATE_PLAN_ROOT_PATH,
      searchQuery: "",
      expandedTreeFolders: new Set([CREATE_PLAN_ROOT_PATH]),
    };
  }

  const currentFolder = createPlanFolderExists(state.currentPlan.planEntries, state.currentFolder)
    ? state.currentFolder
    : CREATE_PLAN_ROOT_PATH;
  const expandedTreeFolders = expandedFolderAndAncestors(
    pruneExpandedTreeFolders(state.expandedTreeFolders, state.currentPlan.planEntries),
    currentFolder,
  );

  return {
    ...state,
    currentFolder,
    expandedTreeFolders: new Set(expandedTreeFolders),
    selection: cleanupSelectionForRows(state.selection, buildCreatePlanRows({
      entries: state.currentPlan.planEntries,
      currentFolder,
      searchQuery: state.searchQuery,
    })),
  };
}

function plannedArchivePaths(plan: CreatePlanResponse | null): string[] {
  return (plan?.planEntries ?? [])
    .map((entry) => normalizeCreateArchivePath(entry.path))
    .filter(Boolean);
}

function sortedExcludedArchivePaths(paths: ReadonlySet<string>): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function normalizeExistingCreateFolderPath(
  entries: readonly CreatePlanEntryDto[],
  folderPath: string | null | undefined,
): string | null {
  const normalizedFolder = normalizeCreateArchivePath(folderPath);
  if (!normalizedFolder) {
    return CREATE_PLAN_ROOT_PATH;
  }
  return createPlanFolderExists(entries, normalizedFolder) ? normalizedFolder : null;
}

function createPlanFolderExists(
  entries: readonly CreatePlanEntryDto[],
  folderPath: string | null | undefined,
): boolean {
  const normalizedFolder = normalizeCreateArchivePath(folderPath);
  if (!normalizedFolder) {
    return true;
  }

  return entries.some((entry) => {
    const normalizedEntryPath = normalizeCreateArchivePath(entry.path);
    return (
      (normalizedEntryPath === normalizedFolder && entry.kind === "directory") ||
      normalizedEntryPath.startsWith(`${normalizedFolder}/`)
    );
  });
}

function expandedFolderAndAncestors(
  expandedFolders: readonly string[] | ReadonlySet<string> | undefined,
  folderPath: string,
): string[] {
  const expanded = new Set(normalizeExpandedTreeFolders(expandedFolders));
  let current = normalizeCreateArchivePath(folderPath);
  while (current) {
    expanded.add(current);
    current = getParentArchivePath(current) ?? "";
  }
  return normalizeExpandedTreeFolders(expanded);
}

function pruneExpandedTreeFolders(
  expandedFolders: readonly string[] | ReadonlySet<string>,
  entries: readonly CreatePlanEntryDto[],
): string[] {
  return normalizeExpandedTreeFolders(expandedFolders)
    .filter((folderPath) => createPlanFolderExists(entries, folderPath));
}

function normalizeExpandedTreeFolders(
  expandedFolders: readonly string[] | ReadonlySet<string> | undefined,
): string[] {
  const normalized = new Set<string>([CREATE_PLAN_ROOT_PATH]);
  for (const folderPath of expandedFolders ?? []) {
    normalized.add(normalizeCreateArchivePath(folderPath));
  }

  return [...normalized].sort(compareCreateArchivePaths);
}

function compareCreateArchivePaths(left: string, right: string): number {
  if (!left && right) {
    return -1;
  }
  if (left && !right) {
    return 1;
  }
  return left.localeCompare(right);
}

function createPlanTreeFolders(
  entries: readonly CreatePlanEntryDto[],
  currentFolder: string,
  expandedTreeFolders: readonly string[] | ReadonlySet<string>,
): readonly CreateWorkspaceTreeFolder[] {
  const childrenByParent = buildCreatePlanTreeChildren(entries);
  const expandedFolders = new Set(expandedFolderAndAncestors(expandedTreeFolders, currentFolder));
  const folders: CreateWorkspaceTreeFolder[] = [freezeTreeFolder({
    path: CREATE_PLAN_ROOT_PATH,
    name: "",
    depth: 0,
    hasChildren: childrenByParent.has(CREATE_PLAN_ROOT_PATH),
    isExpanded: true,
  })];

  const addChildFolders = (parentPath: string, depth: number) => {
    const children = childrenByParent.get(parentPath);
    if (!children?.length) {
      return;
    }

    for (const childName of children) {
      const childPath = parentPath ? `${parentPath}/${childName}` : childName;
      const childHasChildren = childrenByParent.has(childPath);
      const isExpanded = expandedFolders.has(childPath);
      folders.push(freezeTreeFolder({
        path: childPath,
        name: childName,
        depth,
        hasChildren: childHasChildren,
        isExpanded,
      }));
      if (childHasChildren && isExpanded) {
        addChildFolders(childPath, depth + 1);
      }
    }
  };

  addChildFolders(CREATE_PLAN_ROOT_PATH, 1);
  return Object.freeze(folders);
}

function buildCreatePlanTreeChildren(entries: readonly CreatePlanEntryDto[]): Map<string, string[]> {
  const childrenByParent = new Map<string, Set<string>>();
  const addChild = (parentPath: string, childName: string) => {
    const current = childrenByParent.get(parentPath);
    if (current) {
      current.add(childName);
      return;
    }
    childrenByParent.set(parentPath, new Set([childName]));
  };

  for (const entry of entries) {
    const normalizedPath = normalizeCreateArchivePath(entry.path);
    if (!normalizedPath) {
      continue;
    }

    const segments = normalizedPath.split("/").filter(Boolean);
    if (!segments.length) {
      continue;
    }

    const folderDepth = entry.kind === "directory" ? segments.length : segments.length - 1;
    for (let index = 0; index < folderDepth; index += 1) {
      const parentPath = index === 0 ? CREATE_PLAN_ROOT_PATH : segments.slice(0, index).join("/");
      addChild(parentPath, segments[index]);
    }
  }

  const sortedChildren = new Map<string, string[]>();
  for (const [parentPath, childSet] of childrenByParent) {
    sortedChildren.set(
      parentPath,
      [...childSet].sort((left, right) => left.localeCompare(right)),
    );
  }
  return sortedChildren;
}

function freezeTreeFolder(folder: CreateWorkspaceTreeFolder): CreateWorkspaceTreeFolder {
  return Object.freeze({ ...folder });
}

function pathInclusionState(
  state: MutableCreateWorkspaceState,
  path: string,
): CreatePlanInclusionState {
  const normalizedPath = normalizeCreateArchivePath(path);
  if (!state.currentPlan || !normalizedPath) {
    return "included";
  }

  const affectedEntries = createPlanEntriesForPath(state.currentPlan.planEntries, normalizedPath);
  if (affectedEntries.length === 0) {
    return isCreatePlanPathIncluded(state.excludedArchivePaths, normalizedPath) ? "included" : "excluded";
  }

  const includedCount = affectedEntries.filter((entry) =>
    isCreatePlanPathIncluded(state.excludedArchivePaths, entry.path),
  ).length;
  if (includedCount === 0) {
    return "excluded";
  }
  if (includedCount === affectedEntries.length) {
    return "included";
  }
  return "partial";
}

function normalizeCreateArchivePath(path?: string | null): string {
  return normalizeArchivePath(path?.trim() ?? "");
}

function includeAllControlState(
  state: MutableCreateWorkspaceState,
  path: string | null | undefined,
): CreateWorkspaceIncludeAllControlState {
  if (state.sources.length === 0 || state.planState === "loading" || !state.currentPlan) {
    return freezeIncludeAllControlState({
      checked: false,
      indeterminate: false,
      disabled: true,
      affectedEntryCount: 0,
      includedEntryCount: 0,
    });
  }

  const entries = createPlanEntriesForPath(state.currentPlan.planEntries, normalizeCreateArchivePath(path));
  if (entries.length === 0) {
    return freezeIncludeAllControlState({
      checked: false,
      indeterminate: false,
      disabled: true,
      affectedEntryCount: 0,
      includedEntryCount: 0,
    });
  }

  const includedEntryCount = entries.filter((entry) =>
    isCreatePlanPathIncluded(state.excludedArchivePaths, entry.path),
  ).length;
  return freezeIncludeAllControlState({
    checked: includedEntryCount === entries.length,
    indeterminate: includedEntryCount > 0 && includedEntryCount < entries.length,
    disabled: false,
    affectedEntryCount: entries.length,
    includedEntryCount,
  });
}

function freezeIncludeAllControlState(
  state: CreateWorkspaceIncludeAllControlState,
): CreateWorkspaceIncludeAllControlState {
  return Object.freeze({ ...state });
}

function visibleRowsForState(state: MutableCreateWorkspaceState): readonly CreatePlanRow[] {
  return buildCreatePlanRows({
    entries: state.currentPlan?.planEntries ?? [],
    currentFolder: state.currentFolder,
    searchQuery: state.searchQuery,
  });
}

function visibleSelectablePathsForState(state: MutableCreateWorkspaceState): string[] {
  return selectableHierarchicalRowPaths(visibleRowsForState(state));
}

function cleanupSelectionForState(state: MutableCreateWorkspaceState): MutableCreateWorkspaceState {
  const selection = cleanupSelectionForRows(state.selection, visibleRowsForState(state));
  if (sameCreateSelection(state.selection, selection)) {
    return state;
  }
  return {
    ...state,
    selection,
  };
}

function cleanupSelectionForRows(
  selection: MutableCreateWorkspaceSelection,
  rows: readonly CreatePlanRow[],
): MutableCreateWorkspaceSelection {
  return selectionFromResult(cleanupHierarchicalTableSelection({
    selectedPaths: new Set(selection.selectedPaths),
    focusedPath: selection.focusedPath,
    anchorPath: selection.anchorPath,
    visiblePaths: selectableHierarchicalRowPaths(rows),
    preserveHiddenSelection: false,
  }));
}

function selectionFromResult(
  selection: HierarchicalTableSelectionResult,
): MutableCreateWorkspaceSelection {
  return {
    selectedPaths: normalizeCreateSelectedPaths(selection.selectedPaths),
    focusedPath: normalizeCreateArchivePath(selection.focusedPath),
    anchorPath: normalizeCreateArchivePath(selection.anchorPath),
  };
}

function normalizeCreateSelectedPaths(paths: Iterable<string>): string[] {
  const normalized = new Set<string>();
  for (const path of paths) {
    const normalizedPath = normalizeCreateArchivePath(path);
    if (normalizedPath) {
      normalized.add(normalizedPath);
    }
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}

function sameCreateSelection(
  left: MutableCreateWorkspaceSelection,
  right: MutableCreateWorkspaceSelection,
): boolean {
  return (
    sameOrderedSources(left.selectedPaths, right.selectedPaths) &&
    left.focusedPath === right.focusedPath &&
    left.anchorPath === right.anchorPath
  );
}

function selectionMutationResult(
  state: MutableCreateWorkspaceState,
  changed: boolean,
): CreateWorkspaceSelectionMutation {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    changed,
  });
}

function mutationResult(
  state: MutableCreateWorkspaceState,
  changed: boolean,
  addedSources: readonly string[],
  removedSources: readonly string[],
): CreateWorkspaceSourceMutation {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    changed,
    addedSources: Object.freeze([...addedSources]),
    removedSources: Object.freeze([...removedSources]),
    becameEmpty: changed && state.sources.length === 0,
  });
}

function inclusionMutationResult(
  state: MutableCreateWorkspaceState,
  changed: boolean,
): CreateWorkspaceInclusionMutation {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    changed,
  });
}

function navigationMutationResult(
  state: MutableCreateWorkspaceState,
  accepted: boolean,
  changed: boolean,
): CreateWorkspaceNavigationMutation {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    accepted,
    changed,
  });
}

function optionsMutationResult(
  state: MutableCreateWorkspaceState,
  changed: boolean,
): CreateWorkspaceOptionsMutation {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    changed,
  });
}

function destinationMutationResult(
  state: MutableCreateWorkspaceState,
  changed: boolean,
  destinationPath = state.options.destinationPath,
): CreateWorkspaceDestinationMutation {
  return Object.freeze({
    snapshot: snapshotFromState(state),
    changed,
    destinationPath,
  });
}

function snapshotFromState(state: MutableCreateWorkspaceState): CreateWorkspaceSnapshot {
  const sources = Object.freeze([...state.sources]);
  const currentPlan = state.currentPlan;
  const warnings = Object.freeze([...(currentPlan?.warnings ?? [])]);
  const plan = Object.freeze({
    state: state.planState,
    current: currentPlan,
    status: state.planStatus,
    warnings,
    revision: state.planRevision,
    hasPlan: currentPlan !== null,
  });
  const filteredPlan = currentPlan
    ? clonePlanResponse(filterCreatePlanByIncludedPaths(currentPlan, state.excludedArchivePaths))
    : null;
  const includedEntries = Object.freeze([...(filteredPlan?.planEntries ?? [])]) as readonly CreatePlanEntryDto[];
  const inclusion = Object.freeze({
    excludedArchivePaths: Object.freeze(sortedExcludedArchivePaths(state.excludedArchivePaths)),
    includedEntries,
    includedCount: includedEntries.length,
    hasIncludedEntries: includedEntries.length > 0,
    filteredPlan,
  });
  const currentFolder = state.currentFolder;
  const searchQuery = state.searchQuery;
  const expandedTreeFolders = Object.freeze(expandedFolderAndAncestors(
    state.expandedTreeFolders,
    currentFolder,
  ));
  const rows = freezeCreatePlanRows(visibleRowsForState(state));
  const selection = createSelectionSnapshot(state, rows);
  const view = Object.freeze({
    currentFolder,
    searchQuery,
    expandedTreeFolders,
    rows,
    treeFolders: createPlanTreeFolders(
      currentPlan?.planEntries ?? [],
      currentFolder,
      expandedTreeFolders,
    ),
    columnSettings: state.columnSettings,
  });
  const options = createOptionsSnapshot(state, includedEntries.length);
  return Object.freeze({
    sources,
    sourceCount: sources.length,
    hasSources: sources.length > 0,
    isEmpty: sources.length === 0,
    plan,
    inclusion,
    view,
    selection,
    options,
  });
}

function createSelectionSnapshot(
  state: MutableCreateWorkspaceState,
  rows: readonly CreatePlanRow[],
): CreateWorkspaceSelectionSnapshot {
  const visibleSelectablePaths = selectableHierarchicalRowPaths(rows);
  const visiblePathSet = new Set(visibleSelectablePaths);
  const selectedPaths = [...state.selection.selectedPaths];
  const visibleSelectedPaths = selectedPaths.filter((path) => visiblePathSet.has(path));
  return Object.freeze({
    selectedPaths: Object.freeze(selectedPaths),
    selectedCount: selectedPaths.length,
    focusedPath: state.selection.focusedPath,
    anchorPath: state.selection.anchorPath,
    visibleSelectablePaths: Object.freeze(visibleSelectablePaths),
    visibleSelectedPaths: Object.freeze(visibleSelectedPaths),
  });
}

function createOptionsSnapshot(
  state: MutableCreateWorkspaceState,
  includedEntryCount: number,
): CreateWorkspaceOptionsSnapshot {
  const supportsPassword = createFormatSupportsPassword(state.options.format);
  const supportsTzapRecovery = state.options.format === "tzap";
  const unavailableReason = createArchiveUnavailableReason({
    sourceCount: state.sources.length,
    includedEntryCount: state.currentPlan ? includedEntryCount : undefined,
    destinationPath: state.options.destinationPath,
    planState: state.planState,
    hasPlan: state.currentPlan !== null,
    submissionInFlight: state.options.submissionInFlight,
  });

  return Object.freeze({
    destinationPath: state.options.destinationPath,
    format: state.options.format,
    cleanSource: state.options.cleanSource,
    respectGitignore: state.options.respectGitignore,
    followSymlinks: state.options.followSymlinks,
    replaceExisting: state.options.replaceExisting,
    preserveMetadata: state.options.preserveMetadata,
    compressionLevel: state.options.compressionLevel,
    splitMode: state.options.splitMode,
    volumeSize: state.options.volumeSize,
    volumeCount: state.options.volumeCount,
    tzapRecoveryPercentage: supportsTzapRecovery
      ? state.options.tzapRecoveryPercentage
      : TZAP_RECOVERY_PERCENTAGE_DEFAULT,
    tzapVolumeLossTolerance: state.options.tzapVolumeLossTolerance,
    zipCompression: state.options.zipCompression,
    sevenZSolid: state.options.sevenZSolid,
    sevenZThreads: state.options.sevenZThreads,
    sevenZChunkSize: state.options.sevenZChunkSize,
    sevenZEncryptFileNames: state.options.sevenZEncryptFileNames,
    tzapRecipientCertificatePaths: state.options.tzapRecipientCertificatePaths,
    tzapRecipientKeyIds: state.options.tzapRecipientKeyIds,
    tzapContactRecipientIds: state.options.tzapContactRecipientIds,
    tzapSigningMode: state.options.tzapSigningMode,
    tzapSigningIdentityId: state.options.tzapSigningIdentityId,
    tzapSigningIdentityPath: state.options.tzapSigningIdentityPath,
    tzapSigningCertificatePath: state.options.tzapSigningCertificatePath,
    tzapSigningPrivateKeyPath: state.options.tzapSigningPrivateKeyPath,
    tzapSigningChainPaths: state.options.tzapSigningChainPaths,
    tzapBootstrapSidecar: state.options.tzapBootstrapSidecar,
    submissionInFlight: state.options.submissionInFlight,
    password: Object.freeze({
      supportsPassword,
      visible: supportsPassword,
      disabled: !supportsPassword,
    }),
    tzapRecovery: Object.freeze({
      supportsTzapRecovery,
      visible: supportsTzapRecovery,
      disabled: !supportsTzapRecovery,
    }),
    readiness: Object.freeze({
      canCreate: unavailableReason === null,
      unavailableReason,
    }),
  });
}

function freezeCreatePlanRows(rows: readonly CreatePlanRow[]): readonly CreatePlanRow[] {
  return Object.freeze(rows.map((row) => {
    if (row.rowType === "parent") {
      return Object.freeze({ ...row }) as CreatePlanRow;
    }
    if (row.rowType === "folder") {
      return Object.freeze({
        ...row,
        ...(row.entry ? { entry: Object.freeze({ ...row.entry }) } : {}),
      }) as CreatePlanRow;
    }
    return Object.freeze({
      ...row,
      entry: Object.freeze({ ...row.entry }),
    }) as CreatePlanRow;
  }));
}
