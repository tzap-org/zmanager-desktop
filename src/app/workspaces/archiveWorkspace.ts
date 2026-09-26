import type {
  ArchiveEntryDto,
  ArchiveListingDto,
  BrowseState,
  CommandErrorDto,
  NativeFileDragRequest,
  PreviewEntryRequest,
  StartExtractRequest,
  TestArchiveRequest,
} from "../../api/types";
import {
  COMMAND_INVALID_PASSWORD,
  COMMAND_PASSWORD_REQUIRED,
} from "../constants";
import {
  buildStartExtractRequest,
  type ExtractMode,
} from "../extractFlow";
import {
  buildArchiveBrowserRows,
  normalizeColumnSettings,
  moveColumn,
  reorderColumn,
  resetColumnSettings,
  setColumnWidth,
  toggleColumnVisibility,
  sortArchiveRows,
  type ArchiveSortKey,
  type ArchiveTableColumnSettings,
  type ArchiveTableColumnId,
  type ArchiveTableRow,
} from "../archiveTable";
import {
  buildArchiveTree,
  type ArchiveBreadcrumb,
  type ArchiveFolderNode,
  getArchiveEntryName,
  archiveFolderExists,
  getArchiveBreadcrumbs,
  getParentArchivePath,
  normalizeArchivePath,
} from "../archiveTree";
import {
  clearHierarchicalTableSelection,
  replaceHierarchicalTableSelection,
  selectableHierarchicalRowPaths,
  type HierarchicalTableSelectionResult,
} from "../hierarchicalTable";
import { nativeDragStripComponents as nativeDragStripComponentsPolicy } from "../extractionPolicy";

const MAX_ARCHIVE_TREE_SUMMARIES = 10_000;

export type ArchiveWorkspaceSortState = {
  key: ArchiveSortKey;
  ascending: boolean;
};

export type ArchiveWorkspaceRowOptions = {
  showParentFolderItem: boolean;
};

export type ArchiveWorkspaceTreeFolder = {
  path: string;
  name: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
  isRoot: boolean;
};

export type SelectableArchiveWorkspaceRow = Extract<
  ArchiveTableRow,
  { rowType: "folder" | "entry" }
>;

export type ArchiveWorkspaceSelectionSnapshot = {
  allSelected: boolean;
  excludedPaths: readonly string[];
  selectedPaths: readonly string[];
  selectedCount: number;
  focusedPath: string;
  anchorPath: string;
  visibleSelectablePaths: readonly string[];
  visibleSelectedPaths: readonly string[];
  visibleSelectedRows: readonly SelectableArchiveWorkspaceRow[];
  visibleSelectedCount: number;
  selectedEntries: readonly ArchiveEntryDto[];
  selectedEntryPaths: readonly string[];
  visibleSelectedEntries: readonly ArchiveEntryDto[];
  focusedEntry: ArchiveEntryDto | null;
  visibleSelectedSize: number;
  hiddenBySearch: boolean;
  firstSelectedEntryPath: string;
  firstSelectedEntryName: string;
};

export type ArchiveWorkspaceDetailsModel =
  | { kind: "noArchive" }
  | {
      kind: "hiddenSelection";
      selectedCount: number;
      searchQuery: string;
      firstSelectedEntryPath: string;
      firstSelectedEntryName: string;
    }
  | {
      kind: "archiveSummary";
      archivePath: string;
      entryCount: number;
      currentFolder: string;
      unpackedSize: number | null;
      packedSize: number | null;
    }
  | {
      kind: "syntheticFolder";
      row: SelectableArchiveWorkspaceRow;
    }
  | {
      kind: "entry";
      entry: ArchiveEntryDto;
    }
  | {
      kind: "multipleSelection";
      selectedCount: number;
      selectedFiles: number;
      selectedFolders: number;
      totalSize: number | null;
      packedSize: number | null;
      pathPreviewPaths: readonly string[];
      rows: readonly SelectableArchiveWorkspaceRow[];
    };

export type ArchiveWorkspaceCommandSnapshot = {
  browseState: BrowseState;
  hasArchive: boolean;
  focusedRow: boolean;
  canNavigateUp: boolean;
  canOpenInside: boolean;
  selectedCount: number;
  visibleSelectableCount: number;
  canUseArchive: boolean;
  canListEntries: boolean;
  canSearchEntries: boolean;
  canNavigateBack: boolean;
};

export type ArchiveWorkspacePasswordRetryOperation =
  | "listArchive"
  | "testArchive"
  | "previewEntry"
  | "openOutsideEntry"
  | "nativeDragOut"
  | "extractArchive"
  | "extractSelection";

export type ArchiveWorkspacePasswordPromptKey =
  | "browse.passwordRequired"
  | "browse.passwordInvalid";

export type ArchiveWorkspacePasswordRetry = {
  operation: ArchiveWorkspacePasswordRetryOperation;
  archivePath: string;
  commandCode: typeof COMMAND_PASSWORD_REQUIRED | typeof COMMAND_INVALID_PASSWORD;
  promptKey: ArchiveWorkspacePasswordPromptKey;
  attemptCount: number;
};

export type ArchiveWorkspaceExtractUnavailableReason =
  | "noArchive"
  | "noSelectedEntries";

export type ArchiveWorkspaceTestUnavailableReason = "noArchive";

export type ArchiveWorkspacePreviewUnavailableReason =
  | "noArchive"
  | "singleFileRequired"
  | "directorySelected";

export type ArchiveWorkspaceNativeDragUnavailableReason =
  | "noArchive"
  | "noEntryPaths";

export type ArchiveWorkspaceRequestResult<TRequest, TReason extends string> =
  | { ok: true; request: TRequest }
  | { ok: false; reason: TReason };

export type BuildArchiveWorkspaceExtractRequestInput = {
  mode: ExtractMode;
  destinationPath: string;
  overwrite: StartExtractRequest["overwrite"];
  destinationCollisionStrategy?: StartExtractRequest["destinationCollisionStrategy"];
  stripComponents: number;
  tzapRestorePolicy?: StartExtractRequest["tzapRestorePolicy"];
  tzapAllowDegraded?: boolean;
  tzapAllowAbsoluteSymlinks?: boolean;
  ignoreSymlinks?: boolean;
  recipientKeyId?: string;
  password?: string;
};

export type BuildArchiveWorkspaceTestRequestInput = {
  password?: string;
};

export type BuildArchiveWorkspacePreviewRequestInput = {
  overwrite: PreviewEntryRequest["overwrite"];
  stripComponents: number;
  password?: string;
};

export type BuildArchiveWorkspaceNativeDragRequestInput = {
  entryPath: string;
  password?: string;
};

export type ArchiveWorkspaceMessageKey =
  | "browse.statusIdle"
  | "browse.statusLoading"
  | "browse.loadedEntries"
  | "browse.validEmpty"
  | "browse.failedList";

export type ArchiveWorkspaceMessagePayload = {
  key: ArchiveWorkspaceMessageKey;
  values?: Record<string, number | string>;
  fallbackText?: string;
};

export type ArchiveWorkspaceError = {
  code?: string;
  message?: string;
  messageKey?: ArchiveWorkspaceMessageKey;
  hint?: string | null;
  severity: CommandErrorDto["severity"];
  retryable: boolean;
};

export type ArchiveWorkspaceListingMetadata = {
  entryCount: number;
  totalSize: number | null;
};

export type ArchiveWorkspaceViewState = {
  currentFolder: string;
  breadcrumbs: readonly ArchiveBreadcrumb[];
  navigationHistory: readonly string[];
  searchQuery: string;
  flatView: boolean;
  expandedTreeFolders: readonly string[];
  treeFolders: readonly ArchiveWorkspaceTreeFolder[];
  sort: ArchiveWorkspaceSortState;
  tableColumns: ArchiveTableColumnSettings;
  rowOptions: ArchiveWorkspaceRowOptions;
  rows: readonly ArchiveTableRow[];
  selection: ArchiveWorkspaceSelectionSnapshot;
  details: ArchiveWorkspaceDetailsModel;
};

export type ArchiveWorkspaceSnapshot = ArchiveWorkspaceListingMetadata & {
  currentArchivePath: string;
  browseState: BrowseState;
  status: ArchiveWorkspaceMessagePayload;
  error: ArchiveWorkspaceError | null;
  passwordRetry: ArchiveWorkspacePasswordRetry | null;
  entries: readonly ArchiveEntryDto[];
  listingRevision: number;
  page: Readonly<{
    number: number;
    childCount: number;
    hasPrevious: boolean;
    hasNext: boolean;
  }>;
  command: ArchiveWorkspaceCommandSnapshot;
  view: ArchiveWorkspaceViewState;
};

export type BeginArchiveLoadInput = {
  archivePath: string;
  preserveListing?: boolean;
  tableColumns?: ArchiveTableColumnSettings;
};

export type ArchiveWorkspaceUnknownLoadFailure = {
  kind: "unknown";
};

export type ArchiveWorkspacePreserveStateInput = {
  currentFolder?: string | null;
  navigationHistory?: readonly string[];
  searchQuery?: string | null;
  flatView?: boolean;
  expandedTreeFolders?: readonly string[];
  allSelected?: boolean;
  excludedPaths?: readonly string[];
  selectedPaths?: readonly string[];
  focusedPath?: string | null;
  anchorPath?: string | null;
  showParentFolderItem?: boolean;
  sortKey?: ArchiveSortKey;
  sortAscending?: boolean;
  tableColumns?: ArchiveTableColumnSettings;
};

export type ArchiveLoadSucceededOptions = {
  preserveState?: ArchiveWorkspacePreserveStateInput | false;
  defaultTableColumns?: ArchiveTableColumnSettings;
};

export type ArchiveWorkspacePage = {
  archivePath: string;
  parentPath: string;
  entries: readonly ArchiveEntryDto[];
  entryCount: number;
  totalSize?: number | null;
  pageNumber?: number;
  childCount?: number;
  hasPrevious?: boolean;
  hasNext?: boolean;
};

export type ArchiveWorkspace = {
  getSnapshot(): ArchiveWorkspaceSnapshot;
  beginLoading(input: BeginArchiveLoadInput): ArchiveWorkspaceSnapshot;
  loadSucceeded(
    listing: ArchiveListingDto,
    options?: ArchiveLoadSucceededOptions,
  ): ArchiveWorkspaceSnapshot;
  acceptPage(page: ArchiveWorkspacePage): ArchiveWorkspaceSnapshot;
  acceptTreePage(entries: readonly ArchiveEntryDto[]): ArchiveWorkspaceSnapshot;
  loadFailed(error: CommandErrorDto | ArchiveWorkspaceUnknownLoadFailure): ArchiveWorkspaceSnapshot;
  setBrowseState(browseState: BrowseState, fallbackText?: string): ArchiveWorkspaceSnapshot;
  navigateToFolder(folderPath: string): ArchiveWorkspaceSnapshot;
  navigateBack(): ArchiveWorkspaceSnapshot;
  navigateUp(): ArchiveWorkspaceSnapshot;
  setSearchQuery(query: string): ArchiveWorkspaceSnapshot;
  clearSearch(): ArchiveWorkspaceSnapshot;
  setFlatView(flatView: boolean): ArchiveWorkspaceSnapshot;
  setRowOptions(options: Partial<ArchiveWorkspaceRowOptions>): ArchiveWorkspaceSnapshot;
  applySortCommand(sortKey: ArchiveSortKey): ArchiveWorkspaceSnapshot;
  applySortDirection(sortKey: ArchiveSortKey, ascending: boolean): ArchiveWorkspaceSnapshot;
  getSelectedExtractEntryPaths(): readonly string[];
  getExtractReferencePaths(mode: ExtractMode): readonly string[];
  selectAllEntries(): ArchiveWorkspaceSnapshot;
  setPathSelected(path: string, selected: boolean): ArchiveWorkspaceSnapshot;
  buildExtractRequest(
    input: BuildArchiveWorkspaceExtractRequestInput,
  ): ArchiveWorkspaceRequestResult<StartExtractRequest, ArchiveWorkspaceExtractUnavailableReason>;
  buildTestRequest(
    input?: BuildArchiveWorkspaceTestRequestInput,
  ): ArchiveWorkspaceRequestResult<TestArchiveRequest, ArchiveWorkspaceTestUnavailableReason>;
  buildPreviewRequest(
    input: BuildArchiveWorkspacePreviewRequestInput,
  ): ArchiveWorkspaceRequestResult<PreviewEntryRequest, ArchiveWorkspacePreviewUnavailableReason>;
  buildNativeDragRequest(
    input: BuildArchiveWorkspaceNativeDragRequestInput,
  ): ArchiveWorkspaceRequestResult<NativeFileDragRequest, ArchiveWorkspaceNativeDragUnavailableReason>;
  requestPasswordRetry(input: {
    operation: ArchiveWorkspacePasswordRetryOperation;
    error: CommandErrorDto | null | undefined;
  }): ArchiveWorkspacePasswordRetry | null;
  clearPasswordRetry(): ArchiveWorkspaceSnapshot;
  resetAfterAcceptedOperation(): ArchiveWorkspaceSnapshot;
  toggleTreeFolder(folderPath: string): ArchiveWorkspaceSnapshot;
  updateSelection(selection: HierarchicalTableSelectionResult): ArchiveWorkspaceSnapshot;
  setColumnWidth(columnId: ArchiveTableColumnId, width: number): ArchiveWorkspaceSnapshot;
  toggleColumnVisibility(columnId: ArchiveTableColumnId): ArchiveWorkspaceSnapshot;
  moveColumn(columnId: ArchiveTableColumnId, direction: "left" | "right"): ArchiveWorkspaceSnapshot;
  reorderColumn(sourceColumnId: ArchiveTableColumnId, targetColumnId: ArchiveTableColumnId): ArchiveWorkspaceSnapshot;
  resetColumns(defaults?: ArchiveTableColumnSettings): ArchiveWorkspaceSnapshot;
  reset(): ArchiveWorkspaceSnapshot;
};

export type CreateArchiveWorkspaceOptions = {
  flatView?: boolean;
  showParentFolderItem?: boolean;
  sortKey?: ArchiveSortKey;
  sortAscending?: boolean;
  tableColumns?: ArchiveTableColumnSettings;
};

type MutableArchiveWorkspaceState = Omit<ArchiveWorkspaceSnapshot, "command" | "entries" | "view"> & {
  entries: ArchiveEntryDto[];
  treeEntries: ArchiveEntryDto[];
  view: {
    currentFolder: string;
    navigationHistory: string[];
    searchQuery: string;
    flatView: boolean;
    expandedTreeFolders: string[];
    sort: ArchiveWorkspaceSortState;
    tableColumns: ArchiveTableColumnSettings;
    rowOptions: ArchiveWorkspaceRowOptions;
    selection: {
      allSelected: boolean;
      excludedPaths: string[];
      selectedPaths: string[];
      focusedPath: string;
      anchorPath: string;
    };
  };
};

export function createArchiveWorkspace(options: CreateArchiveWorkspaceOptions = {}): ArchiveWorkspace {
  let state = createInitialState(options);

  // `snapshotFromState` rebuilds and re-sorts the visible rows and deep-clones
  // the entries, and every caller used to get a fresh object graph. That churn
  // defeated `useMemo`/`memo` downstream, so an unrelated publish (a toolbar
  // toggle, a job progress tick) re-rendered every row in the table.
  //
  // State is only ever replaced wholesale, never mutated in place, so its
  // identity is an exact invalidation signal - including for the mutators that
  // return the state unchanged, which correctly keep the cached snapshot.
  let cachedSnapshotState: MutableArchiveWorkspaceState | null = null;
  let cachedSnapshot: ArchiveWorkspaceSnapshot | null = null;

  function currentSnapshot(): ArchiveWorkspaceSnapshot {
    if (cachedSnapshot === null || cachedSnapshotState !== state) {
      cachedSnapshot = snapshotFromState(state);
      cachedSnapshotState = state;
      // Callers share one instance, so a stray mutation would corrupt workspace
      // state instead of being absorbed by a private copy. Freezing costs about
      // twice the snapshot build, so only development and tests pay for it; that
      // is where a mutation gets introduced, and it throws on the first attempt.
      if (import.meta.env.DEV) {
        deepFreezeSnapshot(cachedSnapshot);
      }
    }
    return cachedSnapshot;
  }

  return {
    getSnapshot() {
      return currentSnapshot();
    },

    beginLoading(input) {
      const archivePath = input.archivePath.trim();
      state = {
        ...state,
        currentArchivePath: archivePath,
        browseState: "loading",
        status: { key: "browse.statusLoading" },
        error: null,
        passwordRetry: retryForArchivePath(state.passwordRetry, archivePath),
        ...(input.preserveListing
          ? {}
          : {
              entries: [],
              treeEntries: [],
              entryCount: 0,
              totalSize: null,
              page: { number: 1, childCount: 0, hasPrevious: false, hasNext: false },
              view: resetViewState({
                flatView: state.view.flatView,
                sort: state.view.sort,
                tableColumns: input.tableColumns ?? state.view.tableColumns,
                rowOptions: state.view.rowOptions,
              }),
            }),
      };
      return currentSnapshot();
    },

    loadSucceeded(listing, options = {}) {
      const entries = cloneEntries(listing.entries);
      const metadata = normalizeListingMetadata(listing, entries.length);
      const view = restoreViewState(entries, options.preserveState, {
        flatView: state.view.flatView,
        sort: state.view.sort,
        tableColumns: options.preserveState && options.preserveState.tableColumns 
          ? options.preserveState.tableColumns 
          : options.defaultTableColumns ?? state.view.tableColumns,
        rowOptions: state.view.rowOptions,
      });
      state = {
        currentArchivePath: listing.archivePath.trim(),
        browseState: entries.length > 0 ? "loaded" : "empty",
        status: entries.length > 0
          ? { key: "browse.loadedEntries", values: { count: entries.length } }
          : { key: "browse.validEmpty" },
        error: null,
        passwordRetry: null,
        entries,
        treeEntries: entries,
        listingRevision: state.listingRevision + 1,
        page: { number: 1, childCount: entries.length, hasPrevious: false, hasNext: false },
        ...metadata,
        view,
      };
      return currentSnapshot();
    },

    acceptPage(page) {
      const entries = cloneEntries(page.entries);
      state = {
        ...state,
        currentArchivePath: page.archivePath.trim(),
        browseState: "loaded",
        status: { key: "browse.loadedEntries", values: { count: page.entryCount } },
        error: null,
        passwordRetry: null,
        entries,
        treeEntries: mergeTreeEntries(state.treeEntries, entries),
        entryCount: page.entryCount,
        totalSize: page.totalSize ?? null,
        listingRevision: state.listingRevision + 1,
        page: {
          number: page.pageNumber ?? 1,
          childCount: page.childCount ?? entries.length,
          hasPrevious: page.hasPrevious ?? false,
          hasNext: page.hasNext ?? false,
        },
        view: {
          ...state.view,
          currentFolder: normalizeArchivePath(page.parentPath),
          expandedTreeFolders: expandedFolderAndAncestors(
            state.view.expandedTreeFolders,
            page.parentPath,
          ),
          selection: state.view.selection.allSelected
            ? state.view.selection
            : selectionFromResult(clearHierarchicalTableSelection()),
        },
      };
      return currentSnapshot();
    },

    acceptTreePage(entries) {
      state = {
        ...state,
        treeEntries: mergeTreeEntries(state.treeEntries, entries),
        listingRevision: state.listingRevision + 1,
      };
      return currentSnapshot();
    },

    loadFailed(error) {
      const normalizedError = normalizeLoadError(error);
      const fallbackText = errorMessageText(normalizedError);
      state = {
        ...state,
        browseState: "error",
        status: {
          key: "browse.failedList",
          ...(fallbackText ? { fallbackText } : {}),
        },
        error: normalizedError,
        passwordRetry: null,
      };
      return currentSnapshot();
    },

    setBrowseState(browseState, fallbackText) {
      state = {
        ...state,
        browseState,
        status: browseState === "error" && fallbackText
          ? { key: "browse.failedList", fallbackText }
          : statusForBrowseState(state, browseState),
        error: browseState === "error" ? state.error : null,
        passwordRetry: browseState === "error" ? null : state.passwordRetry,
      };
      return currentSnapshot();
    },

    navigateToFolder(folderPath) {
      state = navigateStateToFolder(state, folderPath, {
        pushHistory: true,
        clearSearch: true,
      });
      return currentSnapshot();
    },

    navigateBack() {
      const navigationHistory = [...state.view.navigationHistory];
      const previousFolder = navigationHistory.pop();
      if (previousFolder === undefined) {
        return currentSnapshot();
      }

      const currentFolder = normalizeExistingFolderPath(state.entries, previousFolder);
      state = {
        ...state,
        view: {
          ...state.view,
          currentFolder,
          navigationHistory,
          expandedTreeFolders: expandedFolderAndAncestors(
            state.view.expandedTreeFolders,
            currentFolder,
          ),
          selection: selectionFromResult(clearHierarchicalTableSelection()),
        },
      };
      return currentSnapshot();
    },

    navigateUp() {
      if (!state.view.currentFolder) {
        return currentSnapshot();
      }
      state = navigateStateToFolder(state, getParentArchivePath(state.view.currentFolder) ?? "", {
        pushHistory: true,
        clearSearch: true,
      });
      return currentSnapshot();
    },

    setSearchQuery(query) {
      state = {
        ...state,
        view: {
          ...state.view,
          searchQuery: query,
        },
      };
      return currentSnapshot();
    },

    clearSearch() {
      if (!state.view.searchQuery.trim()) {
        return currentSnapshot();
      }
      state = {
        ...state,
        view: {
          ...state.view,
          searchQuery: "",
        },
      };
      return currentSnapshot();
    },

    setFlatView(flatView) {
      state = {
        ...state,
        view: {
          ...state.view,
          flatView,
        },
      };
      return currentSnapshot();
    },

    setRowOptions(options) {
      state = {
        ...state,
        view: {
          ...state.view,
          rowOptions: {
            ...state.view.rowOptions,
            ...options,
          },
        },
      };
      return currentSnapshot();
    },

    applySortCommand(sortKey) {
      state = {
        ...state,
        view: {
          ...state.view,
          sort: sortKey === state.view.sort.key
            ? {
                key: state.view.sort.key,
                ascending: !state.view.sort.ascending,
              }
            : {
                key: sortKey,
                ascending: true,
              },
        },
      };
      return currentSnapshot();
    },

    applySortDirection(sortKey, ascending) {
      state = {
        ...state,
        view: {
          ...state.view,
          sort: {
            key: sortKey,
            ascending,
          },
        },
      };
      return currentSnapshot();
    },

    getSelectedExtractEntryPaths() {
      return selectedExtractEntryPaths(state);
    },

    getExtractReferencePaths(mode) {
      return mode === "selection"
        ? state.view.selection.allSelected
          ? state.entries.map((entry) => entry.path)
          : selectedExtractEntryPaths(state)
        : state.entries.map((entry) => entry.path);
    },

    selectAllEntries() {
      const firstVisiblePath = selectableHierarchicalRowPaths(visibleRowsForState(state))[0] ?? "";
      state = {
        ...state,
        view: {
          ...state.view,
          selection: {
            allSelected: true,
            excludedPaths: [],
            selectedPaths: [],
            focusedPath: firstVisiblePath,
            anchorPath: firstVisiblePath,
          },
        },
      };
      return currentSnapshot();
    },

    setPathSelected(path, selected) {
      const normalizedPath = normalizeArchivePath(path);
      if (!normalizedPath) {
        return currentSnapshot();
      }

      if (state.view.selection.allSelected) {
        const excludedPaths = new Set(state.view.selection.excludedPaths);
        if (selected) {
          excludedPaths.delete(normalizedPath);
        } else {
          excludedPaths.add(normalizedPath);
        }
        state = {
          ...state,
          view: {
            ...state.view,
            selection: {
              ...state.view.selection,
              excludedPaths: [...excludedPaths],
              focusedPath: normalizedPath,
              anchorPath: normalizedPath,
            },
          },
        };
        return currentSnapshot();
      }

      const selectedPaths = new Set(state.view.selection.selectedPaths);
      if (selected) {
        selectedPaths.add(normalizedPath);
      } else {
        selectedPaths.delete(normalizedPath);
      }
      state = {
        ...state,
        view: {
          ...state.view,
          selection: {
            allSelected: false,
            excludedPaths: [],
            selectedPaths: [...selectedPaths],
            focusedPath: normalizedPath,
            anchorPath: normalizedPath,
          },
        },
      };
      return currentSnapshot();
    },

    buildExtractRequest(input) {
      if (!state.currentArchivePath) {
        return { ok: false, reason: "noArchive" };
      }

      const allSelected = input.mode === "selection" && state.view.selection.allSelected;
      const entryPaths = input.mode === "selection" && !allSelected
        ? selectedExtractEntryPaths(state)
        : [];
      if (input.mode === "selection" && !allSelected && entryPaths.length === 0) {
        return { ok: false, reason: "noSelectedEntries" };
      }

      return {
        ok: true,
        request: buildStartExtractRequest({
          archivePath: state.currentArchivePath,
          destinationPath: input.destinationPath,
          overwrite: input.overwrite,
          ...(input.destinationCollisionStrategy
            ? { destinationCollisionStrategy: input.destinationCollisionStrategy }
            : {}),
          ...(input.mode === "selection" && !allSelected ? { entryPaths } : {}),
          ...(allSelected ? {
            selectAll: true,
            ...(state.view.selection.excludedPaths.length
              ? { excludedEntryPaths: [...state.view.selection.excludedPaths] }
              : {}),
          } : {}),
          stripComponents: input.stripComponents,
          tzapRestorePolicy: input.tzapRestorePolicy ?? "portable",
          // Always allow degraded restore; see extractFlow.buildStartExtractRequest.
          tzapAllowDegraded: true,
          tzapAllowAbsoluteSymlinks: input.tzapAllowAbsoluteSymlinks ?? false,
          ignoreSymlinks: input.ignoreSymlinks ?? false,
          ...(input.recipientKeyId?.trim() ? { recipientKeyId: input.recipientKeyId.trim() } : {}),
          ...(input.password ? { password: input.password } : {}),
        }),
      };
    },

    buildTestRequest(input = {}) {
      if (!state.currentArchivePath) {
        return { ok: false, reason: "noArchive" };
      }

      const entryPaths = selectedExtractEntryPaths(state);
      return {
        ok: true,
        request: {
          archivePath: state.currentArchivePath,
          ...(entryPaths.length ? { entryPaths } : {}),
          ...(input.password ? { password: input.password } : {}),
        },
      };
    },

    buildPreviewRequest(input) {
      if (!state.currentArchivePath) {
        return { ok: false, reason: "noArchive" };
      }

      const selectedPaths = [...state.view.selection.selectedPaths];
      if (selectedPaths.length !== 1) {
        return { ok: false, reason: "singleFileRequired" };
      }

      const entry = entryByPath(state.entries, selectedPaths[0]);
      if (!entry || entry.kind === "directory") {
        return { ok: false, reason: "directorySelected" };
      }

      return {
        ok: true,
        request: {
          archivePath: state.currentArchivePath,
          entryPath: entry.path,
          overwrite: input.overwrite,
          stripComponents: input.stripComponents,
          ...(input.password ? { password: input.password } : {}),
        },
      };
    },

    buildNativeDragRequest(input) {
      if (!state.currentArchivePath) {
        return { ok: false, reason: "noArchive" };
      }

      const allSelected = state.view.selection.allSelected;
      const entryPaths = allSelected ? [] : nativeDragEntryPaths(state, input.entryPath);
      if (!allSelected && entryPaths.length === 0) {
        return { ok: false, reason: "noEntryPaths" };
      }

      return {
        ok: true,
        request: {
          archivePath: state.currentArchivePath,
          entryPaths,
          ...(allSelected ? {
            selectAll: true,
            ...(state.view.selection.excludedPaths.length
              ? { excludedEntryPaths: [...state.view.selection.excludedPaths] }
              : {}),
          } : {}),
          stripComponents: allSelected
            ? 0
            : nativeDragStripComponentsPolicy({
              entryPaths,
              currentFolder: state.view.currentFolder,
              flatView: state.view.flatView,
              searchQuery: state.view.searchQuery,
            }),
          ...(input.password ? { password: input.password } : {}),
        },
      };
    },

    requestPasswordRetry(input) {
      const nextPasswordRetry = passwordRetryForCommandError({
        operation: input.operation,
        archivePath: state.currentArchivePath,
        error: input.error,
        previous: state.passwordRetry,
      });
      state = {
        ...state,
        passwordRetry: nextPasswordRetry,
      };
      return clonePasswordRetry(nextPasswordRetry);
    },

    clearPasswordRetry() {
      if (!state.passwordRetry) {
        return currentSnapshot();
      }
      state = {
        ...state,
        passwordRetry: null,
      };
      return currentSnapshot();
    },

    resetAfterAcceptedOperation() {
      state = {
        ...state,
        passwordRetry: null,
        view: {
          ...state.view,
          selection: selectionFromResult(clearHierarchicalTableSelection()),
        },
      };
      return currentSnapshot();
    },

    toggleTreeFolder(folderPath) {
      const normalizedFolder = normalizeArchivePath(folderPath);
      if (!normalizedFolder) {
        return currentSnapshot();
      }

      const expandedTreeFolders = new Set(state.view.expandedTreeFolders);
      if (expandedTreeFolders.has(normalizedFolder)) {
        expandedTreeFolders.delete(normalizedFolder);
      } else {
        expandedTreeFolders.add(normalizedFolder);
      }

      state = {
        ...state,
        view: {
          ...state.view,
          expandedTreeFolders: expandedFolderAndAncestors(
            [...expandedTreeFolders],
            state.view.currentFolder,
          ),
        },
      };
      return currentSnapshot();
    },

    updateSelection(selection) {
      state = {
        ...state,
        view: {
          ...state.view,
          selection: selectionFromResult(selection),
        },
      };
      return currentSnapshot();
    },

    setColumnWidth(columnId, width) {
      state = {
        ...state,
        view: {
          ...state.view,
          tableColumns: setColumnWidth(state.view.tableColumns, columnId, width),
        },
      };
      return currentSnapshot();
    },

    toggleColumnVisibility(columnId) {
      state = {
        ...state,
        view: {
          ...state.view,
          tableColumns: toggleColumnVisibility(state.view.tableColumns, columnId),
        },
      };
      return currentSnapshot();
    },

    moveColumn(columnId, direction) {
      state = {
        ...state,
        view: {
          ...state.view,
          tableColumns: moveColumn(state.view.tableColumns, columnId, direction),
        },
      };
      return currentSnapshot();
    },

    reorderColumn(sourceColumnId, targetColumnId) {
      state = {
        ...state,
        view: {
          ...state.view,
          tableColumns: reorderColumn(state.view.tableColumns, sourceColumnId, targetColumnId),
        },
      };
      return currentSnapshot();
    },

    resetColumns(defaults) {
      state = {
        ...state,
        view: {
          ...state.view,
          tableColumns: defaults ?? resetColumnSettings(),
        },
      };
      return currentSnapshot();
    },

    reset() {
      state = createInitialState({
        flatView: state.view.flatView,
        showParentFolderItem: state.view.rowOptions.showParentFolderItem,
        sortKey: state.view.sort.key,
        sortAscending: state.view.sort.ascending,
      });
      return currentSnapshot();
    },
  };
}

function navigateStateToFolder(
  state: MutableArchiveWorkspaceState,
  folderPath: string,
  options: { pushHistory: boolean; clearSearch: boolean },
): MutableArchiveWorkspaceState {
  const nextFolder = resolveFolderForNavigation(state, folderPath);
  if (nextFolder === state.view.currentFolder) {
    return state;
  }

  return {
    ...state,
    view: {
      ...state.view,
      currentFolder: nextFolder,
      navigationHistory: options.pushHistory
        ? [...state.view.navigationHistory, state.view.currentFolder]
        : state.view.navigationHistory,
      searchQuery: options.clearSearch ? "" : state.view.searchQuery,
      expandedTreeFolders: expandedFolderAndAncestors(
        state.view.expandedTreeFolders,
        nextFolder,
      ),
      selection: selectionFromResult(clearHierarchicalTableSelection()),
    },
  };
}

function createInitialState(
  options: CreateArchiveWorkspaceOptions = {},
): MutableArchiveWorkspaceState {
  return {
    currentArchivePath: "",
    browseState: "idle",
    status: { key: "browse.statusIdle" },
    error: null,
    passwordRetry: null,
    entries: [],
    treeEntries: [],
    entryCount: 0,
    totalSize: null,
    listingRevision: 0,
    page: { number: 1, childCount: 0, hasPrevious: false, hasNext: false },
    view: resetViewState({
      flatView: options.flatView,
      sort: normalizeSortState({
        key: options.sortKey,
        ascending: options.sortAscending,
      }),
      rowOptions: normalizeRowOptions(options),
    }),
  };
}

function resetViewState(
  options: {
    flatView?: boolean;
    sort?: ArchiveWorkspaceSortState;
    rowOptions?: Partial<ArchiveWorkspaceRowOptions>;
    tableColumns?: ArchiveTableColumnSettings;
  } = {},
): MutableArchiveWorkspaceState["view"] {
  return {
    currentFolder: "",
    navigationHistory: [],
    searchQuery: "",
    flatView: options.flatView ?? false,
    expandedTreeFolders: [""],
    sort: normalizeSortState(options.sort),
    tableColumns: options.tableColumns ?? normalizeColumnSettings({}),
    rowOptions: normalizeRowOptions(options.rowOptions),
    selection: {
      allSelected: false,
      excludedPaths: [],
      selectedPaths: [],
      focusedPath: "",
      anchorPath: "",
    },
  };
}

function restoreViewState(
  entries: readonly ArchiveEntryDto[],
  preserveState: ArchiveWorkspacePreserveStateInput | false | undefined,
  defaults: {
    flatView: boolean;
    sort: ArchiveWorkspaceSortState;
    rowOptions: ArchiveWorkspaceRowOptions;
    tableColumns: ArchiveTableColumnSettings;
  },
): MutableArchiveWorkspaceState["view"] {
  if (!preserveState) {
    return resetViewState({
      flatView: defaults.flatView,
      sort: defaults.sort,
      rowOptions: defaults.rowOptions,
      tableColumns: defaults.tableColumns,
    });
  }

  const currentFolder = archiveFolderExists(entries, preserveState.currentFolder)
    ? normalizeArchivePath(preserveState.currentFolder)
    : "";
  const searchQuery = preserveState.searchQuery ?? "";
  const flatView = preserveState.flatView ?? false;
  const sort = normalizeSortState({
    key: preserveState.sortKey ?? defaults.sort.key,
    ascending: preserveState.sortAscending ?? defaults.sort.ascending,
  });
  const rowOptions = normalizeRowOptions({
    showParentFolderItem: preserveState.showParentFolderItem
      ?? defaults.rowOptions.showParentFolderItem,
  });
  const navigationHistory = (preserveState.navigationHistory ?? [])
    .map((folder) => normalizeArchivePath(folder));
  const listedPaths = new Set(entries.map((entry) => normalizeArchivePath(entry.path)));
  const selectedPaths = (preserveState.selectedPaths ?? [])
    .map((path) => normalizeArchivePath(path))
    .filter((path) => Boolean(path) && (listedPaths.has(path) || archiveFolderExists(entries, path)));
  const visiblePaths = selectableHierarchicalRowPaths(buildArchiveBrowserRows({
    entries,
    currentFolder,
    searchQuery,
    flatView,
    showParentFolderItem: rowOptions.showParentFolderItem,
  }));
  const preservedFocusedPath = normalizeArchivePath(preserveState.focusedPath);
  const focusedEntryStillVisible = Boolean(
    preservedFocusedPath && visiblePaths.includes(preservedFocusedPath),
  );
  const selection = focusedEntryStillVisible
    ? replaceHierarchicalTableSelection({
        paths: selectedPaths,
        focusedPath: preservedFocusedPath,
        anchorPath: normalizeArchivePath(preserveState.anchorPath)
          || (selectedPaths.includes(preservedFocusedPath) ? preservedFocusedPath : ""),
      })
    : replaceHierarchicalTableSelection({
        paths: selectedPaths,
        focusedPath: "",
        anchorPath: normalizeArchivePath(preserveState.anchorPath) || (selectedPaths[0] ?? ""),
      });

  return {
    currentFolder,
    navigationHistory,
    searchQuery,
    flatView,
    sort,
    tableColumns: defaults.tableColumns,
    rowOptions,
    expandedTreeFolders: expandedFolderAndAncestors(
      preserveState.expandedTreeFolders,
      currentFolder,
    ),
    selection: {
      allSelected: preserveState.allSelected ?? false,
      excludedPaths: normalizeSelectedPaths(preserveState.excludedPaths ?? []),
      selectedPaths: [...selection.selectedPaths],
      focusedPath: selection.focusedPath,
      anchorPath: selection.anchorPath,
    },
  };
}

function normalizeExistingFolderPath(
  entries: readonly ArchiveEntryDto[],
  folderPath: string | null | undefined,
): string {
  const normalized = normalizeArchivePath(folderPath);
  if (!normalized) return "";
  return archiveFolderExists(entries, normalized) ? normalized : "";
}

function resolveFolderForNavigation(
  state: MutableArchiveWorkspaceState,
  folderPath: string | null | undefined,
): string {
  const normalized = normalizeArchivePath(folderPath);
  if (!normalized) return "";
  // Check both current page entries (immediate children) and treeEntries
  // (all loaded directories). Sibling folders may only be in treeEntries
  // after navigating away from the parent.
  return archiveFolderExists(state.entries, normalized) ||
    archiveFolderExists(state.treeEntries, normalized)
    ? normalized
    : "";
}

function expandedFolderAndAncestors(
  expandedFolders: readonly string[] | undefined,
  folderPath: string,
): string[] {
  const expanded = new Set(normalizeExpandedTreeFolders(expandedFolders));
  let current = normalizeArchivePath(folderPath);
  while (current) {
    expanded.add(current);
    current = getParentArchivePath(current) ?? "";
  }
  return normalizeExpandedTreeFolders([...expanded]);
}

function normalizeExpandedTreeFolders(
  expandedFolders: readonly string[] | undefined,
): string[] {
  const normalized = new Set<string>([""]);
  for (const folder of expandedFolders ?? []) {
    normalized.add(normalizeArchivePath(folder));
  }
  return [...normalized];
}

function normalizeSortState(
  sort?: Partial<ArchiveWorkspaceSortState> | null,
): ArchiveWorkspaceSortState {
  return {
    key: sort?.key ?? "name",
    ascending: sort?.ascending ?? true,
  };
}

function normalizeRowOptions(
  options?: Partial<ArchiveWorkspaceRowOptions> | null,
): ArchiveWorkspaceRowOptions {
  return {
    showParentFolderItem: options?.showParentFolderItem ?? false,
  };
}

function selectionFromResult(
  selection: HierarchicalTableSelectionResult,
): MutableArchiveWorkspaceState["view"]["selection"] {
  return {
    allSelected: false,
    excludedPaths: [],
    selectedPaths: normalizeSelectedPaths(selection.selectedPaths),
    focusedPath: normalizeArchivePath(selection.focusedPath),
    anchorPath: normalizeArchivePath(selection.anchorPath),
  };
}

function normalizeSelectedPaths(paths: Iterable<string>): string[] {
  const normalized = new Set<string>();
  for (const path of paths) {
    const normalizedPath = normalizeArchivePath(path);
    if (normalizedPath) {
      normalized.add(normalizedPath);
    }
  }
  return [...normalized];
}

function normalizeListingMetadata(
  listing: ArchiveListingDto,
  fallbackEntryCount: number,
): ArchiveWorkspaceListingMetadata {
  return {
    entryCount: Number.isFinite(listing.entryCount)
      ? listing.entryCount
      : fallbackEntryCount,
    totalSize: typeof listing.totalSize === "number" && Number.isFinite(listing.totalSize)
      ? listing.totalSize
      : null,
  };
}

function normalizeLoadError(error: CommandErrorDto | ArchiveWorkspaceUnknownLoadFailure): ArchiveWorkspaceError {
  if (isUnknownLoadFailure(error)) {
    return {
      code: "unknown",
      messageKey: "browse.failedList",
      severity: "error",
      retryable: false,
    };
  }

  return {
    code: error.code,
    message: error.message,
    hint: error.hint,
    severity: error.severity,
    retryable: error.retryable,
  };
}

function isUnknownLoadFailure(
  error: CommandErrorDto | ArchiveWorkspaceUnknownLoadFailure,
): error is ArchiveWorkspaceUnknownLoadFailure {
  return "kind" in error && error.kind === "unknown";
}

function errorMessageText(error: ArchiveWorkspaceError): string | undefined {
  if (!error.message) {
    return undefined;
  }
  return `${error.message}${error.hint ? `\n${error.hint}` : ""}`;
}

function statusForBrowseState(
  state: MutableArchiveWorkspaceState,
  browseState: BrowseState,
): ArchiveWorkspaceMessagePayload {
  switch (browseState) {
    case "idle":
      return { key: "browse.statusIdle" };
    case "loading":
      return { key: "browse.statusLoading" };
    case "empty":
      return { key: "browse.validEmpty" };
    case "error":
      return state.status.key === "browse.failedList"
        ? cloneStatus(state.status)
        : { key: "browse.failedList" };
    case "loaded":
      return state.status.key === "browse.loadedEntries"
        ? cloneStatus(state.status)
        : { key: "browse.loadedEntries", values: { count: state.entries.length } };
  }
}

function retryForArchivePath(
  retry: ArchiveWorkspacePasswordRetry | null,
  archivePath: string,
): ArchiveWorkspacePasswordRetry | null {
  return retry?.archivePath === archivePath ? { ...retry } : null;
}

function passwordRetryForCommandError(input: {
  operation: ArchiveWorkspacePasswordRetryOperation;
  archivePath: string;
  error: CommandErrorDto | null | undefined;
  previous: ArchiveWorkspacePasswordRetry | null;
}): ArchiveWorkspacePasswordRetry | null {
  if (!input.error || !isPasswordRetryCommandCode(input.error.code)) {
    return null;
  }

  const previousAttemptCount = input.previous
    && input.previous.operation === input.operation
    && input.previous.archivePath === input.archivePath
    ? input.previous.attemptCount
    : 0;

  return {
    operation: input.operation,
    archivePath: input.archivePath,
    commandCode: input.error.code,
    promptKey: passwordPromptKeyForCommandCode(input.error.code),
    attemptCount: previousAttemptCount + 1,
  };
}

function isPasswordRetryCommandCode(
  code: string | undefined,
): code is typeof COMMAND_PASSWORD_REQUIRED | typeof COMMAND_INVALID_PASSWORD {
  return code === COMMAND_PASSWORD_REQUIRED || code === COMMAND_INVALID_PASSWORD;
}

function passwordPromptKeyForCommandCode(
  code: typeof COMMAND_PASSWORD_REQUIRED | typeof COMMAND_INVALID_PASSWORD,
): ArchiveWorkspacePasswordPromptKey {
  return code === COMMAND_PASSWORD_REQUIRED
    ? "browse.passwordRequired"
    : "browse.passwordInvalid";
}

function visibleRowsForState(state: MutableArchiveWorkspaceState): ArchiveTableRow[] {
  return sortArchiveRows(buildArchiveBrowserRows({
    entries: state.entries,
    currentFolder: state.view.currentFolder,
    searchQuery: state.view.searchQuery,
    flatView: state.view.flatView,
    showParentFolderItem: state.view.rowOptions.showParentFolderItem,
  }), state.view.sort.key, state.view.sort.ascending);
}

const STRUCTURAL_TREE_CACHE = new WeakMap<readonly ArchiveEntryDto[], ArchiveFolderNode>();

function getStructuralTree(treeEntries: readonly ArchiveEntryDto[]): ArchiveFolderNode {
  let root = STRUCTURAL_TREE_CACHE.get(treeEntries);
  if (!root) {
    root = buildArchiveTree(treeEntries, { rootName: "" });
    STRUCTURAL_TREE_CACHE.set(treeEntries, root);
  }
  return root;
}

function treeFoldersForState(state: MutableArchiveWorkspaceState): ArchiveWorkspaceTreeFolder[] {
  if (!state.currentArchivePath) {
    return [];
  }

  const expandedFolders = new Set(normalizeExpandedTreeFolders(state.view.expandedTreeFolders));
  const folders: ArchiveWorkspaceTreeFolder[] = [];
  const root = getStructuralTree(state.treeEntries);

  function visit(node: ArchiveFolderNode) {
    folders.push({
      path: node.path,
      name: node.name,
      depth: node.depth,
      hasChildren: node.children.length > 0,
      isExpanded: node.isRoot || expandedFolders.has(node.path),
      isActive: state.view.currentFolder === node.path,
      isRoot: node.isRoot,
    });

    if (!node.isRoot && !expandedFolders.has(node.path)) {
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(root);
  return folders;
}

const ENTRIES_LOOKUP_CACHE = new WeakMap<readonly ArchiveEntryDto[], Map<string, ArchiveEntryDto>>();

function getEntryMap(entries: readonly ArchiveEntryDto[]): Map<string, ArchiveEntryDto> {
  let map = ENTRIES_LOOKUP_CACHE.get(entries);
  if (!map) {
    map = new Map<string, ArchiveEntryDto>();
    for (const entry of entries) {
      map.set(normalizeArchivePath(entry.path), entry);
    }
    ENTRIES_LOOKUP_CACHE.set(entries, map);
  }
  return map;
}

function entryByPath(
  entries: readonly ArchiveEntryDto[],
  path: string | null | undefined,
): ArchiveEntryDto | null {
  if (!path) {
    return null;
  }
  const normalized = normalizeArchivePath(path);
  return getEntryMap(entries).get(normalized) ?? null;
}

function archiveEntryIsUnderFolder(entryPath: string, folderPath: string): boolean {
  const normalizedEntry = normalizeArchivePath(entryPath);
  const normalizedFolder = normalizeArchivePath(folderPath);
  if (!normalizedFolder) {
    return true;
  }
  return normalizedEntry === normalizedFolder || normalizedEntry.startsWith(`${normalizedFolder}/`);
}

function fileDescendantEntryPaths(
  entries: readonly ArchiveEntryDto[],
  folderPath: string,
): string[] {
  return entries
    .filter((entry) => entry.kind !== "directory" && archiveEntryIsUnderFolder(entry.path, folderPath))
    .map((entry) => entry.path);
}

function selectedExtractEntryPaths(state: MutableArchiveWorkspaceState): string[] {
  if (state.view.selection.allSelected) {
    return [];
  }
  const extractPaths = new Set<string>();

  for (const selectedPath of state.view.selection.selectedPaths) {
    const entry = entryByPath(state.entries, selectedPath) ?? entryByPath(state.treeEntries, selectedPath);
    if (!entry) {
      for (const descendantPath of fileDescendantEntryPaths(state.entries, selectedPath)) {
        extractPaths.add(descendantPath);
      }
      for (const descendantPath of fileDescendantEntryPaths(state.treeEntries, selectedPath)) {
        extractPaths.add(descendantPath);
      }
      if (extractPaths.size === 0 && selectedPath.trim().length > 0) {
        extractPaths.add(selectedPath);
      }
      continue;
    }

    if (entry.kind !== "directory") {
      extractPaths.add(entry.path);
      continue;
    }

    const descendantPaths = Array.from(
      new Set([
        ...fileDescendantEntryPaths(state.entries, entry.path),
        ...fileDescendantEntryPaths(state.treeEntries, entry.path),
      ]),
    );
    if (descendantPaths.length === 0) {
      extractPaths.add(entry.path);
      continue;
    }

    for (const descendantPath of descendantPaths) {
      extractPaths.add(descendantPath);
    }
  }

  return [...extractPaths];
}

function archiveFolderHasFileDescendants(
  entries: readonly ArchiveEntryDto[],
  folderPath: string,
): boolean {
  return fileDescendantEntryPaths(entries, folderPath).length > 0;
}

function nativeDragEntryPaths(
  state: MutableArchiveWorkspaceState,
  entryPath: string,
): string[] {
  const normalizedEntryPath = normalizeArchivePath(entryPath);
  if (!normalizedEntryPath) {
    return [];
  }

  if (state.view.selection.selectedPaths.includes(normalizedEntryPath)) {
    return [...state.view.selection.selectedPaths];
  }

  const entry = entryByPath(state.entries, normalizedEntryPath);
  if (entry) {
    return [entry.path];
  }

  return archiveFolderHasFileDescendants(state.entries, normalizedEntryPath)
    ? [normalizedEntryPath]
    : [];
}

function isSelectableRow(row: ArchiveTableRow): row is SelectableArchiveWorkspaceRow {
  return row.rowType === "folder" || row.rowType === "entry";
}

function selectionSnapshotFromState(
  state: MutableArchiveWorkspaceState,
  rows: readonly ArchiveTableRow[],
): ArchiveWorkspaceSelectionSnapshot {
  const allSelected = state.view.selection.allSelected;
  const excludedPaths = [...state.view.selection.excludedPaths];
  const selectedPaths = [...state.view.selection.selectedPaths];
  const selectedPathSet = new Set(selectedPaths);
  const visibleSelectablePaths = selectableHierarchicalRowPaths(rows);
  const visibleSelectedRows = rows.filter((row): row is SelectableArchiveWorkspaceRow =>
    isSelectableRow(row) && (allSelected
      ? !excludedPaths.includes(row.path)
      : selectedPathSet.has(row.path))
  );
  const visibleSelectedPaths = visibleSelectedRows.map((row) => row.path);
  const selectedEntries = allSelected ? [] : selectedPaths
    .map((path) => entryByPath(state.entries, path))
    .filter((entry): entry is ArchiveEntryDto => entry !== null);
  const visibleSelectedEntries = visibleSelectedRows
    .map((row) => row.entry ?? entryByPath(state.entries, row.path))
    .filter((entry): entry is ArchiveEntryDto => entry !== null);
  const focusedPath = normalizeArchivePath(state.view.selection.focusedPath);
  const focusedEntry = focusedPath && visibleSelectablePaths.includes(focusedPath)
    ? entryByPath(state.entries, focusedPath)
    : null;
  const firstSelectedEntry = selectedEntries[0] ?? null;
  const firstSelectedEntryPath = firstSelectedEntry?.path ?? "";

  return {
    allSelected,
    excludedPaths,
    selectedPaths,
    selectedCount: allSelected
      ? Math.max(0, state.entryCount - excludedPaths.length)
      : selectedPaths.length,
    focusedPath,
    anchorPath: normalizeArchivePath(state.view.selection.anchorPath),
    visibleSelectablePaths,
    visibleSelectedPaths,
    visibleSelectedRows,
    visibleSelectedCount: visibleSelectedRows.length,
    selectedEntries,
    selectedEntryPaths: selectedEntries.map((entry) => entry.path),
    visibleSelectedEntries,
    focusedEntry,
    visibleSelectedSize: visibleSelectedRows.reduce((total, row) => {
      const value = row.entry?.size;
      return typeof value === "number" && Number.isFinite(value) ? total + value : total;
    }, 0),
    hiddenBySearch: !allSelected && selectedPaths.length > 0
      && visibleSelectedRows.length === 0
      && Boolean(state.view.searchQuery.trim()),
    firstSelectedEntryPath,
    firstSelectedEntryName: firstSelectedEntryPath
      ? getArchiveEntryName(firstSelectedEntryPath) || firstSelectedEntryPath
      : "",
  };
}

function detailsModelFromState(
  state: MutableArchiveWorkspaceState,
  selection: ArchiveWorkspaceSelectionSnapshot,
): ArchiveWorkspaceDetailsModel {
  if (!state.currentArchivePath) {
    return { kind: "noArchive" };
  }

  if (selection.hiddenBySearch) {
    return {
      kind: "hiddenSelection",
      selectedCount: selection.selectedCount,
      searchQuery: state.view.searchQuery.trim(),
      firstSelectedEntryPath: selection.firstSelectedEntryPath,
      firstSelectedEntryName: selection.firstSelectedEntryName,
    };
  }

  if (selection.visibleSelectedRows.length === 0) {
    return {
      kind: "archiveSummary",
      archivePath: state.currentArchivePath,
      entryCount: state.entryCount,
      currentFolder: state.view.currentFolder,
      unpackedSize: state.totalSize ?? sumKnownEntryBytes(state.entries, (entry) => entry.size),
      packedSize: sumKnownEntryBytes(state.entries, (entry) => entry.compressedSize),
    };
  }

  if (!selection.allSelected && selection.visibleSelectedRows.length === 1) {
    const row = selection.visibleSelectedRows[0];
    const entry = row.entry ?? entryByPath(state.entries, row.path);
    if (!entry) {
      return {
        kind: "syntheticFolder",
        row,
      };
    }
    return {
      kind: "entry",
      entry,
    };
  }

  const selectedEntries = selection.visibleSelectedRows
    .map((row) => row.entry ?? entryByPath(state.entries, row.path))
    .filter((entry): entry is ArchiveEntryDto => entry !== null);

  return {
    kind: "multipleSelection",
    selectedCount: selection.allSelected
      ? selection.selectedCount
      : selection.visibleSelectedRows.length,
    selectedFiles: selection.visibleSelectedRows.filter((row) =>
      row.rowType === "entry" && row.entry?.kind !== "directory"
    ).length,
    selectedFolders: selection.visibleSelectedRows.filter((row) =>
      row.rowType === "folder" || row.entry?.kind === "directory"
    ).length,
    totalSize: sumKnownEntryBytes(selectedEntries, (entry) => entry.size),
    packedSize: sumKnownEntryBytes(selectedEntries, (entry) => entry.compressedSize),
    pathPreviewPaths: selection.visibleSelectedRows.map((row) => row.path),
    rows: selection.visibleSelectedRows,
  };
}

function sumKnownEntryBytes(
  entries: readonly ArchiveEntryDto[],
  selector: (entry: ArchiveEntryDto) => number | undefined,
): number | null {
  let total = 0;
  let hasKnownValue = false;
  for (const entry of entries) {
    const value = selector(entry);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      total += value;
      hasKnownValue = true;
    }
  }
  return hasKnownValue ? total : null;
}

function commandSnapshotFromState(
  state: MutableArchiveWorkspaceState,
  selection: ArchiveWorkspaceSelectionSnapshot,
): ArchiveWorkspaceCommandSnapshot {
  const hasArchive = Boolean(state.currentArchivePath);
  const canUseArchive =
    hasArchive &&
    state.browseState !== "idle";
  const selectedEntry = selection.selectedEntries.length === 1
    ? selection.selectedEntries[0]
    : null;

  return {
    browseState: state.browseState,
    hasArchive,
    focusedRow: Boolean(selection.focusedPath),
    canNavigateUp: Boolean(state.view.currentFolder),
    canOpenInside: selectedEntry?.kind === "directory",
    selectedCount: selection.selectedCount,
    visibleSelectableCount: selection.visibleSelectablePaths.length,
    canUseArchive,
    canListEntries: canUseArchive && state.browseState === "loaded",
    canSearchEntries: hasArchive && state.browseState === "loaded",
    canNavigateBack: state.view.navigationHistory.length > 0,
  };
}

function deepFreezeSnapshot(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreezeSnapshot(inner);
  }
}

function snapshotFromState(state: MutableArchiveWorkspaceState): ArchiveWorkspaceSnapshot {
  const rows = visibleRowsForState(state);
  const treeFolders = treeFoldersForState(state);
  const selection = selectionSnapshotFromState(state, rows);
  const details = detailsModelFromState(state, selection);
  const command = commandSnapshotFromState(state, selection);

  return {
    currentArchivePath: state.currentArchivePath,
    browseState: state.browseState,
    status: cloneStatus(state.status),
    error: state.error ? { ...state.error } : null,
    passwordRetry: clonePasswordRetry(state.passwordRetry),
    entries: cloneEntries(state.entries),
    entryCount: state.entryCount,
    totalSize: state.totalSize,
    listingRevision: state.listingRevision,
    page: { ...state.page },
    command: { ...command },
    view: {
      currentFolder: state.view.currentFolder,
      breadcrumbs: getArchiveBreadcrumbs(state.view.currentFolder),
      navigationHistory: [...state.view.navigationHistory],
      searchQuery: state.view.searchQuery,
      flatView: state.view.flatView,
      expandedTreeFolders: [...state.view.expandedTreeFolders],
      treeFolders: cloneTreeFolders(treeFolders),
      sort: { ...state.view.sort },
      tableColumns: {
        visibleColumnIds: [...state.view.tableColumns.visibleColumnIds],
        columnOrderIds: [...state.view.tableColumns.columnOrderIds],
        columnWidths: { ...state.view.tableColumns.columnWidths },
      },
      rowOptions: { ...state.view.rowOptions },
      rows: cloneRows(rows),
      selection: cloneSelectionSnapshot(selection),
      details: cloneDetailsModel(details),
    },
  };
}

function clonePasswordRetry(
  retry: ArchiveWorkspacePasswordRetry | null,
): ArchiveWorkspacePasswordRetry | null {
  return retry ? { ...retry } : null;
}

function cloneStatus(status: ArchiveWorkspaceMessagePayload): ArchiveWorkspaceMessagePayload {
  return {
    key: status.key,
    ...(status.values ? { values: { ...status.values } } : {}),
    ...(status.fallbackText ? { fallbackText: status.fallbackText } : {}),
  };
}

function cloneEntries(entries: readonly ArchiveEntryDto[]): ArchiveEntryDto[] {
  return entries.map((entry) => ({ ...entry }));
}

function mergeTreeEntries(
  existing: readonly ArchiveEntryDto[],
  visiblePage: readonly ArchiveEntryDto[],
): ArchiveEntryDto[] {
  const byPath = new Map(
    existing
      .filter((entry) => entry.kind === "directory")
      .map((entry) => [normalizeArchivePath(entry.path), { ...entry }] as const),
  );
  for (const entry of visiblePage) {
    if (
      entry.kind === "directory" &&
      (byPath.has(normalizeArchivePath(entry.path)) || byPath.size < MAX_ARCHIVE_TREE_SUMMARIES)
    ) {
      byPath.set(normalizeArchivePath(entry.path), { ...entry });
    }
  }
  return [...byPath.values()];
}

function cloneRows(rows: readonly ArchiveTableRow[]): ArchiveTableRow[] {
  return rows.map((row) => cloneRow(row));
}

function cloneTreeFolders(
  folders: readonly ArchiveWorkspaceTreeFolder[],
): ArchiveWorkspaceTreeFolder[] {
  return folders.map((folder) => ({ ...folder }));
}

function cloneRow(row: ArchiveTableRow): ArchiveTableRow {
  if (row.rowType === "parent") {
    return { ...row };
  }
  if (row.rowType === "folder") {
    return {
      ...row,
      ...(row.entry ? { entry: { ...row.entry } } : {}),
    };
  }
  return {
    ...row,
    entry: { ...row.entry },
  };
}

function cloneSelectableRows(
  rows: readonly SelectableArchiveWorkspaceRow[],
): SelectableArchiveWorkspaceRow[] {
  return rows.map((row) => cloneRow(row) as SelectableArchiveWorkspaceRow);
}

function cloneSelectionSnapshot(
  selection: ArchiveWorkspaceSelectionSnapshot,
): ArchiveWorkspaceSelectionSnapshot {
  return {
    allSelected: selection.allSelected,
    excludedPaths: [...selection.excludedPaths],
    selectedPaths: [...selection.selectedPaths],
    selectedCount: selection.selectedCount,
    focusedPath: selection.focusedPath,
    anchorPath: selection.anchorPath,
    visibleSelectablePaths: [...selection.visibleSelectablePaths],
    visibleSelectedPaths: [...selection.visibleSelectedPaths],
    visibleSelectedRows: cloneSelectableRows(selection.visibleSelectedRows),
    visibleSelectedCount: selection.visibleSelectedCount,
    selectedEntries: cloneEntries(selection.selectedEntries),
    selectedEntryPaths: [...selection.selectedEntryPaths],
    visibleSelectedEntries: cloneEntries(selection.visibleSelectedEntries),
    focusedEntry: selection.focusedEntry ? { ...selection.focusedEntry } : null,
    visibleSelectedSize: selection.visibleSelectedSize,
    hiddenBySearch: selection.hiddenBySearch,
    firstSelectedEntryPath: selection.firstSelectedEntryPath,
    firstSelectedEntryName: selection.firstSelectedEntryName,
  };
}

function cloneDetailsModel(details: ArchiveWorkspaceDetailsModel): ArchiveWorkspaceDetailsModel {
  switch (details.kind) {
    case "noArchive":
      return { kind: "noArchive" };
    case "hiddenSelection":
      return { ...details };
    case "archiveSummary":
      return { ...details };
    case "syntheticFolder":
      return {
        kind: "syntheticFolder",
        row: cloneRow(details.row) as SelectableArchiveWorkspaceRow,
      };
    case "entry":
      return {
        kind: "entry",
        entry: { ...details.entry },
      };
    case "multipleSelection":
      return {
        ...details,
        pathPreviewPaths: [...details.pathPreviewPaths],
        rows: cloneSelectableRows(details.rows),
      };
  }
}
