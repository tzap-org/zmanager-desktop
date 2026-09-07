import {
  ChevronDown,
  File,
  Folder,
  GripVertical,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { formatBytes, getPathBasename } from "../../../app/formatting";
import {
  getParentArchivePath,
  isArchivePathInFolder,
  normalizeArchivePath,
} from "../../../app/archiveTree";
import {
  resolveTzapSigningIdentityId,
} from "../../../app/preferences";
import {
  sourcePathForCreatePlanRow,
  withCreateArchiveExtension,
  type CreatePlanInclusionState,
  type CreatePlanRow,
} from "../../../app/createFlow";
import type { Translator } from "../../../app/i18n/translator";
import { createFormatCapabilities, supportedCreateFormats } from "../../../app/createFormatCapabilities";
import { formatVolumeSize } from "../../../app/volumeSizePresets";
import { Checkbox } from "../../components/ui/checkbox";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { InfoTip } from "../../components/ui/info-tip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import { nativeIconDataUrlForPath } from "../systemFileIcons";
import type {
  ZManagerReactActions,
  ZManagerReactSnapshot,
} from "../appRuntime";
import { useCreatePasswordState } from "./CreatePasswordContext";
import { CompressionLevelSelect } from "./CompressionLevelSelect";
import { translatorForSnapshot } from "../shell/shellHelpers";
import {
  CREATE_SOURCE_TABLE_COLUMNS,
  createTableColumnLabel,
  formatCreateTableValue,
  resetCreateColumnSettings,
  visibleCreateColumns,
  type CreateSourceColumn,
  type CreateSourceColumnId,
} from "../../../app/createTableColumns";
import { WorkspaceBrowserShell } from "../workspace/WorkspaceBrowserShell";
import { WorkspacePathBar } from "../workspace/WorkspacePathBar";
import {
  armTableMarqueeSelectionGesture,
  continueTableMarqueeSelectionGesture,
  endTableMarqueeSelectionGesture,
  type TableMarqueeSelectionGesture,
  type ViewportRect,
} from "../workspace/tableMarqueeSelection";
import { MarqueeSelectionOverlay } from "../workspace/MarqueeSelectionOverlay";
import { treeDepthClass } from "../workspace/treeDepthClass";
import {
  tableColumnReorderClassName,
  useTableColumnReorder,
  type TableColumnReorderController,
} from "../workspace/useTableColumnReorder";

const COMPRESS_SOURCE_INCLUDE_COLUMN_WIDTH_PX = 28;
const COMPRESS_SOURCE_MAX_COLUMN_WIDTH_PX = 520;

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const FORMAT_LABELS: Record<string, string> = {
  zip: "ZIP",
  tarZst: "TZST",
  tarGz: "TGZ",
  tzap: "TZAP",
  sevenZ: "7Z",
  appleArchive: "AAR",
};

const ADVANCED_FIELD_CLASS =
  "grid !grid-cols-1 !items-stretch !gap-1.5 text-[11px] font-semibold leading-4 text-slate-600 dark:text-slate-300 [&>input]:!h-9 [&>input]:!min-h-9 [&>input]:!w-full [&>input]:!text-xs [&>input]:font-normal [&>select]:!h-9 [&>select]:!min-h-9 [&>select]:!w-full [&>select]:!text-xs [&>select]:font-normal";

function toggleDelimitedSelection(value: string, id: string, selected: boolean): string {
  const current = value.split(/[;,\r\n]+/).map((item) => item.trim()).filter(Boolean);
  const next = selected
    ? [...current, id].filter((item, index, items) => items.indexOf(item) === index)
    : current.filter((item) => item !== id);
  return next.join(";");
}

export function CreateWorkspace() {
  const snapshot = useZManagerSnapshot();
  const { reset: resetCreatePassword } = useCreatePasswordState();

  useBrowserLayoutEffect(() => {
    resetCreatePassword();
    return () => resetCreatePassword();
  }, [
    resetCreatePassword,
    snapshot.create.options.format,
    snapshot.create.options.password.visible,
  ]);

  return (
    <>
      <CreatePathBar />
      <WorkspaceBrowserShell
        ariaLabel="Create archive workspace"
        navigation={<CreateTree />}
        table={<CreateTable />}
        sidePane={<CreateOptions />}
      />
    </>
  );
}

function CreatePathBar() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const create = snapshot.create;
  const [destination, setDestination] = useState(
    create.options.destinationPath,
  );

  useEffect(() => {
    setDestination(create.options.destinationPath);
  }, [create.options.destinationPath]);

  const currentFolder = create.view.currentFolder;
  const fallbackTitle = i18n.t("compress.tableTitle");
  const archiveTitle = compressArchiveDisplayName(destination, fallbackTitle);
  const breadcrumbs = createBreadcrumbs(currentFolder, archiveTitle);
  const searchResultText = create.plan.current
    ? i18n.t(
        create.view.rows.filter((row) => row.rowType !== "parent").length === 1
          ? "search.oneResult"
          : "search.results",
        {
          count: create.view.rows.filter((row) => row.rowType !== "parent")
            .length,
        },
      )
    : "";

  return (
    <WorkspacePathBar
      ariaLabel={i18n.t("workspace.archiveLocation.aria")}
      locationLabel={i18n.t("compress.destination")}
      pathAriaLabel={i18n.t("compress.destination")}
      pathInputId="create-destination"
      displayPath={destination}
      pathDisabled={false}
      pathReadOnly={false}
      pathPlaceholder={i18n.t("compress.destination.placeholder")}
      onPathChange={(path) => {
        setDestination(path);
        actions.handleCreateIntent({
          type: "setDestinationPath",
          destinationPath: path,
        });
      }}
      crumbs={breadcrumbs}
      crumbsHidden={!create.hasSources}
      emptyCrumbsText={archiveTitle}
      onCrumbClick={(path) =>
        actions.handleCreateIntent({
          type: "navigateToFolder",
          folderPath: path,
        })
      }
      search={{
        query: create.view.searchQuery,
        disabled: !create.plan.current,
        clearDisabled: !create.view.searchQuery.trim(),
        resultText: searchResultText,
        entriesLabel: i18n.t("search.entries"),
        placeholder: i18n.t("search.sources.placeholder"),
        buttonLabel: i18n.t("search.button"),
        clearLabel: i18n.t("search.clear"),
        clearAriaLabel: i18n.t("search.clear.aria"),
        onChange: (query) =>
          actions.handleCreateIntent({ type: "setSearchQuery", query }),
        onSubmit: (query) =>
          actions.handleCreateIntent({ type: "setSearchQuery", query }),
        onClear: () => actions.handleCreateIntent({ type: "clearSearch" }),
      }}
    />
  );
}

function createBreadcrumbs(currentFolder: string, rootName: string) {
  const crumbs = [{ name: rootName, path: "" }];
  let path = "";
  for (const segment of currentFolder.split("/").filter(Boolean)) {
    path = path ? `${path}/${segment}` : segment;
    crumbs.push({ name: segment, path });
  }
  return crumbs;
}

function compressArchiveDisplayName(
  destinationPath: string,
  fallback: string,
): string {
  const archiveName = getPathBasename(destinationPath, "").trim();
  return archiveName || fallback;
}

function CreateTree() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const i18n = translatorForSnapshot(snapshot);
  const folders = snapshot.create.view.treeFolders;

  return (
    <aside
      id="navigation-pane"
      className="flex min-h-0 min-w-[150px] flex-col overflow-hidden border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70"
      aria-label={i18n.t("workspace.archiveNavigation.aria")}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex h-10 shrink-0 items-center border-b border-slate-200 px-3 dark:border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {i18n.t("pane.folders")}
        </h2>
      </div>
      <div id="tree-content" className="min-h-0 flex-1 overflow-auto p-1.5">
        {folders.length ? (
          folders.map((folder) => (
            <button
              className={`flex min-h-8 w-full min-w-0 items-center gap-1 rounded-md border-0 bg-transparent pr-2 text-left text-sm hover:bg-slate-100 aria-selected:bg-blue-100 aria-selected:text-blue-800 dark:hover:bg-slate-800 dark:aria-selected:bg-blue-950 dark:aria-selected:text-blue-200 ${treeDepthClass(folder.depth)}`}
              type="button"
              data-compress-folder-path={folder.path}
              aria-selected={folder.path === snapshot.create.view.currentFolder}
              key={folder.path || "__root__"}
              onClick={() =>
                actions.handleCreateIntent({
                  type: "navigateToFolder",
                  folderPath: folder.path,
                })
              }
            >
              <span
                className="flex size-5 shrink-0 items-center justify-center text-xs"
                aria-hidden="true"
              >
                {folder.hasChildren ? (folder.isExpanded ? "v" : ">") : ""}
              </span>
              <Folder
                className="size-4 shrink-0 text-amber-600"
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{folder.name}</span>
            </button>
          ))
        ) : (
          <div className="grid min-h-24 place-items-center p-4 text-center text-xs text-slate-500 dark:text-slate-400">
            <p>{i18n.t("compress.noSources")}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function CreateTable() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const marqueeGestureRef = useRef<TableMarqueeSelectionGesture | null>(null);
  const suppressMarqueeClickRef = useRef(false);
  const [marqueeRect, setMarqueeRect] = useState<ViewportRect | null>(null);
  const columnSettings =
    snapshot.create.view.columnSettings ?? resetCreateColumnSettings();
  const visibleCols = useMemo(
    () => visibleCreateColumns(columnSettings),
    [columnSettings],
  );
  const columnReorder = useTableColumnReorder(
    visibleCols
      .filter((column) => column.id !== "name")
      .map((column) => column.id),
    (sourceColumnId, targetColumnId) => {
      actions.handleCreateIntent({
        type: "reorderColumn",
        sourceColumnId,
        targetColumnId,
      });
    },
  );
  const columnWidths = useMemo(
    () => Object.fromEntries(visibleCols.map((col) => [col.id, col.width])),
    [visibleCols],
  );
  const i18n = translatorForSnapshot(snapshot);
  const rows = snapshot.create.view.rows;
  const planEntries = snapshot.create.plan.current?.planEntries ?? [];
  const sources = snapshot.create.sources;
  const excludedPaths = snapshot.create.inclusion.excludedArchivePaths;
  const selectedPaths = snapshot.create.selection.selectedPaths;
  const focusedPath = snapshot.create.selection.focusedPath;
  const singleClickOpen = snapshot.preferences.singleClickOpen;

  const selectedSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const sourcePathMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!planEntries.length || !sources.length) {
      return map;
    }
    const rootEntries = planEntries
      .filter((entry) => sources.includes(entry.sourcePath))
      .sort((left, right) => normalizeArchivePath(right.path).length - normalizeArchivePath(left.path).length);

    for (const row of rows) {
      if (row.rowType === "parent") {
        map.set(row.path, "");
        continue;
      }
      if (row.entry?.sourcePath) {
        map.set(row.path, row.entry.sourcePath);
        continue;
      }
      const rootEntry = rootEntries.find((entry) => isArchivePathInFolder(row.path, entry.path));
      if (rootEntry) {
        map.set(row.path, rootEntry.sourcePath);
        continue;
      }
      map.set(row.path, sourcePathForCreatePlanRow(row, planEntries, sources));
    }
    return map;
  }, [rows, planEntries, sources]);

  const inclusionMap = useMemo(() => {
    const excludedSet = new Set(excludedPaths);
    const map = new Map<string, CreatePlanInclusionState>();
    if (!planEntries.length) {
      for (const row of rows) {
        map.set(row.path, excludedSet.has(row.path) ? "excluded" : "included");
      }
      return map;
    }

    const folderStats = new Map<string, { total: number; included: number }>();
    for (const entry of planEntries) {
      const isIncluded = !excludedSet.has(entry.path);
      let folder = getParentArchivePath(entry.path);
      while (folder !== null) {
        let stats = folderStats.get(folder);
        if (!stats) {
          stats = { total: 0, included: 0 };
          folderStats.set(folder, stats);
        }
        stats.total += 1;
        if (isIncluded) {
          stats.included += 1;
        }
        folder = getParentArchivePath(folder);
      }
    }

    for (const row of rows) {
      if (row.rowType === "parent") {
        map.set(row.path, "included");
        continue;
      }
      if (row.rowType === "entry") {
        map.set(row.path, excludedSet.has(row.path) ? "excluded" : "included");
        continue;
      }
      const stats = folderStats.get(row.path);
      if (!stats || stats.total === 0) {
        map.set(row.path, excludedSet.has(row.path) ? "excluded" : "included");
      } else if (stats.included === 0) {
        map.set(row.path, "excluded");
      } else if (stats.included === stats.total) {
        map.set(row.path, "included");
      } else {
        map.set(row.path, "partial");
      }
    }
    return map;
  }, [rows, planEntries, excludedPaths]);

  const includeAll = useMemo(() => {
    const selectableRows = rows.filter((row) => row.rowType !== "parent");
    const includedCount = selectableRows.filter(
      (row) => inclusionMap.get(row.path) !== "excluded",
    ).length;
    return {
      checked: selectableRows.length > 0 && includedCount === selectableRows.length,
      indeterminate: includedCount > 0 && includedCount < selectableRows.length,
      disabled: selectableRows.length === 0,
    };
  }, [rows, inclusionMap]);

  const isRefreshing =
    snapshot.create.plan.state === "loading" &&
    snapshot.create.plan.current !== null;
  const workspaceTitle = compressArchiveDisplayName(
    snapshot.create.options.destinationPath,
    i18n.t("compress.tableTitle"),
  );

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950"
      aria-label={i18n.t("workspace.archiveEntries.aria")}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 dark:border-slate-800">
        <div>
          <h1 id="workspace-title" className="text-sm font-semibold">
            {workspaceTitle}
          </h1>
          <p
            id="browse-meta"
            className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400"
          >
            {i18n.t("compress.tableDescription")}
          </p>
        </div>
        {isRefreshing ? (
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/[0.07] px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
            <span>{i18n.t("create.plan.refreshing")}</span>
          </div>
        ) : null}
      </div>
      <p id="browse-message" className="hidden" hidden />
      <div id="compress-surface" className="min-h-0 flex-1 overflow-hidden">
        <ul id="source-list" className="hidden" hidden>
          {snapshot.create.sources.map((source) => (
            <li data-source-path={source} key={source}>
              {source}
            </li>
          ))}
        </ul>
        <div
          ref={tableShellRef}
          data-create-table-shell
          className={`relative h-full min-h-0 select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40 ${rows.length ? "overflow-auto" : "overflow-hidden"}`}
          tabIndex={0}
          onDragStart={(event) => event.preventDefault()}
          onPointerDownCapture={(event) => {
            armCreateMarqueeSelectionGesture({
              event,
              snapshot,
              actions,
              tableBody: tableBodyRef.current,
              setMarqueeRect,
              gestureRef: marqueeGestureRef,
            });
          }}
          onPointerMoveCapture={(event) =>
            continueTableMarqueeSelectionGesture(event, marqueeGestureRef)
          }
          onPointerUpCapture={(event) => {
            suppressMarqueeClickRef.current = endTableMarqueeSelectionGesture(
              event,
              marqueeGestureRef,
            );
          }}
          onPointerCancelCapture={(event) => {
            endTableMarqueeSelectionGesture(event, marqueeGestureRef);
          }}
          onClickCapture={(event) => {
            if (suppressMarqueeClickRef.current) {
              suppressMarqueeClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onContextMenu={(event) => {
            if (event.defaultPrevented) return;
            event.preventDefault();
          }}
        >
          <div
            id="compress-marquee-hit-surface"
            className="absolute inset-0 z-0"
            aria-hidden="true"
          />
          {marqueeRect ? <MarqueeSelectionOverlay rect={marqueeRect} /> : null}
          {rows.length ? (
            <table
              id="compress-source-table"
              className={createTableClassName(snapshot)}
              width={compressSourceTableWidth(columnWidths, visibleCols.map((col) => col.id))}
            >
              <colgroup>
                <col width={COMPRESS_SOURCE_INCLUDE_COLUMN_WIDTH_PX} />
                {visibleCols.map((col) => (
                  <col width={columnWidths[col.id] ?? col.width} key={col.id} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 w-9 border-b border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-800 dark:bg-slate-900">
                    <input
                      id="compress-include-all"
                      type="checkbox"
                      aria-label={i18n.t("compress.includeAll")}
                      disabled={includeAll.disabled}
                      checked={includeAll.checked}
                      ref={(node) => {
                        if (node) node.indeterminate = includeAll.indeterminate;
                      }}
                      onChange={(event) =>
                        actions.handleCreateIntent({
                          type: "setCurrentFolderIncluded",
                          included: event.currentTarget.checked,
                        })
                      }
                    />
                  </th>
                  {visibleCols.map((col) => (
                    <CompressSourceHeader
                      columnId={col.id}
                      label={createTableColumnLabel(col, i18n)}
                      width={columnWidths[col.id] ?? col.width}
                      columnReorder={columnReorder}
                      onWidthChange={(width) =>
                        actions.handleCreateIntent({
                          type: "setColumnWidth",
                          columnId: col.id,
                          width,
                        })
                      }
                      key={col.id}
                    />
                  ))}
                </tr>
              </thead>
              <tbody id="compress-source-body" ref={tableBodyRef}>
                {rows.map((row) => {
                  const srcPath = sourcePathMap.get(row.path) ?? "";
                  const isFolder = row.rowType !== "entry" || row.entry.kind === "directory";
                  return (
                    <CreateTableRow
                      key={row.rowId}
                      row={row}
                      visibleCols={visibleCols}
                      sourcePath={srcPath}
                      inclusion={inclusionMap.get(row.path) ?? "included"}
                      nativeIconDataUrl={srcPath ? nativeIconDataUrlForPath(snapshot, srcPath, isFolder) : null}
                      selected={selectedSet.has(row.path)}
                      focused={focusedPath === row.path}
                      singleClickOpen={singleClickOpen}
                      i18n={i18n}
                      actions={actions}
                    />
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div
              id="compress-empty-state"
              className="absolute inset-0 z-10 grid place-items-center p-6 text-center text-sm text-slate-500 dark:text-slate-400"
            >
              <div className="grid gap-1">
                <strong className="font-semibold text-slate-700 dark:text-slate-200">
                  {i18n.t("compress.emptyTable")}
                </strong>
                <span>{i18n.t("compress.dragSourcesHint")}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function armCreateMarqueeSelectionGesture(
  input: Readonly<{
    event: ReactPointerEvent<HTMLElement>;
    snapshot: ZManagerReactSnapshot;
    actions: ZManagerReactActions;
    tableBody: HTMLTableSectionElement | null;
    setMarqueeRect: (rect: ViewportRect | null) => void;
    gestureRef: MutableRefObject<TableMarqueeSelectionGesture | null>;
  }>,
) {
  const { event, snapshot, actions, tableBody, setMarqueeRect, gestureRef } =
    input;
  armTableMarqueeSelectionGesture(
    {
      event,
      tableBody,
      selectedPaths: snapshot.create.selection.selectedPaths,
      visiblePaths: createVisibleSelectablePaths(snapshot),
      rowSelector: "tr[data-compress-path]",
      rowPath: (row) => row.dataset.compressPath,
      canStart: (candidate) =>
        canStartCreateMarqueeSelection(candidate, snapshot),
      setMarqueeRect,
      applySelection: (selection) =>
        actions.handleCreateIntent({
          type: "applySelection",
          selectedPaths: [...selection.selectedPaths],
          focusedPath: selection.focusedPath,
          anchorPath: selection.anchorPath,
        }),
    },
    gestureRef,
  );
}

function canStartCreateMarqueeSelection(
  event: ReactPointerEvent<HTMLElement>,
  snapshot: ZManagerReactSnapshot,
): boolean {
  if (
    event.button !== 0 ||
    snapshot.create.plan.state === "loading" ||
    createVisibleSelectablePaths(snapshot).length === 0
  ) {
    return false;
  }

  if (!(event.target instanceof HTMLElement)) {
    return false;
  }

  if (
    event.target.closest(
      "button, a, input, select, textarea, [data-column-resizer], [data-table-column-header]",
    )
  ) {
    return false;
  }

  return !event.target.closest("[data-row-primary]");
}

function createVisibleSelectablePaths(
  snapshot: ZManagerReactSnapshot,
): string[] {
  return snapshot.create.view.rows
    .filter((row) => row.rowType !== "parent")
    .map((row) => row.path);
}

function createTableClassName(snapshot: ZManagerReactSnapshot): string {
  return `relative z-[1] w-full table-fixed border-collapse ${snapshot.preferences.showGridLines ? "[&_td]:border-r [&_td]:border-slate-100 dark:[&_td]:border-slate-800" : ""}`;
}

function CompressSourceHeader({
  columnId,
  label,
  onWidthChange,
  width,
  columnReorder,
}: Readonly<{
  columnId: CreateSourceColumnId;
  label: string;
  onWidthChange(width: number): void;
  width: number;
  columnReorder: TableColumnReorderController<CreateSourceColumnId>;
}>) {
  const actions = useZManagerActions();
  const movable = columnId !== "name";
  const isDragSource =
    columnReorder.dragState?.sourceColumnId === columnId;
  const dropPosition =
    columnReorder.dragState?.targetColumnId === columnId
      ? columnReorder.dragState.dropPosition
      : null;
  const resizeRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  return (
    <th
      className={`group sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-semibold text-slate-600 transition-[background-color,color,box-shadow,opacity,transform] duration-150 ease-out dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ${tableColumnReorderClassName({ movable, isSource: isDragSource, dropPosition })}`}
      data-table-column-header
      data-table-column-id={columnId}
      data-column-drag-source={isDragSource || undefined}
      data-column-drop-position={dropPosition ?? undefined}
      data-compress-column-id={columnId}
      {...columnReorder.headerPointerHandlers(columnId, movable)}
      tabIndex={0}
      title={label}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.handleCreateIntent({
          type: "showColumnContextMenu",
          columnId,
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onKeyDown={(event) => {
        if (
          event.key === "ContextMenu" ||
          (event.key === "F10" && event.shiftKey)
        ) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          actions.handleCreateIntent({
            type: "showColumnContextMenu",
            columnId,
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          });
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-1 pr-2">
        {movable ? (
          <GripVertical
            className="size-3 shrink-0 opacity-35 transition-opacity group-hover:opacity-80"
            data-column-drag-grip
            aria-hidden="true"
          />
        ) : null}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span
        className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize hover:bg-blue-500/30"
        data-column-resizer={columnId}
        aria-hidden="true"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = {
            pointerId: event.pointerId,
            startWidth: width,
            startX: event.clientX,
          };
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          onWidthChange(
            clampCompressSourceColumnWidth(
              columnId,
              resize.startWidth + event.clientX - resize.startX,
            ),
          );
        }}
        onPointerUp={(event) =>
          finishCompressSourceColumnResize(event, resizeRef)
        }
        onPointerCancel={(event) =>
          finishCompressSourceColumnResize(event, resizeRef)
        }
      />
    </th>
  );
}

function finishCompressSourceColumnResize(
  event: ReactPointerEvent<HTMLElement>,
  resizeRef: MutableRefObject<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>,
): void {
  if (resizeRef.current?.pointerId !== event.pointerId) return;
  resizeRef.current = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function compressSourceTableWidth(
  widths: Record<string, number>,
  columnIds: readonly string[],
): number {
  return (
    COMPRESS_SOURCE_INCLUDE_COLUMN_WIDTH_PX +
    columnIds.reduce(
      (total, columnId) => total + (widths[columnId] ?? 120),
      0,
    )
  );
}

function clampCompressSourceColumnWidth(
  columnId: CreateSourceColumnId,
  width: number,
): number {
  const colDef = CREATE_SOURCE_TABLE_COLUMNS.find((col) => col.id === columnId);
  const minWidth = colDef?.minWidth ?? 64;
  return Math.min(
    COMPRESS_SOURCE_MAX_COLUMN_WIDTH_PX,
    Math.max(minWidth, Math.round(width)),
  );
}

type CreateTableRowProps = Readonly<{
  row: CreatePlanRow;
  visibleCols: readonly CreateSourceColumn[];
  sourcePath: string;
  inclusion: CreatePlanInclusionState;
  nativeIconDataUrl: string | null;
  selected: boolean;
  focused: boolean;
  singleClickOpen: boolean;
  i18n: Translator;
  actions: ZManagerReactActions;
}>;

const CreateTableRow = memo(function CreateTableRow({
  row,
  visibleCols,
  sourcePath,
  inclusion,
  nativeIconDataUrl,
  selected,
  focused,
  singleClickOpen,
  i18n,
  actions,
}: CreateTableRowProps) {
  const isFolder = row.rowType !== "entry" || row.entry.kind === "directory";
  const path = row.path;
  const selectable = row.rowType !== "parent";
  const rowClassName =
    "group border-b border-slate-100 hover:bg-blue-50/70 aria-selected:bg-blue-100 aria-selected:text-blue-950 data-[focused=true]:ring-2 data-[focused=true]:ring-inset data-[focused=true]:ring-blue-500/50 data-[excluded=true]:opacity-50 dark:border-slate-900 dark:hover:bg-blue-950/40 dark:aria-selected:bg-blue-950 dark:aria-selected:text-blue-50";

  return (
    <tr
      className={rowClassName}
      tabIndex={0}
      data-compress-path={row.rowType === "parent" ? undefined : path}
      data-compress-folder-row={isFolder ? path : undefined}
      data-compress-entry-row={!isFolder ? path : undefined}
      data-compress-source-path={sourcePath || undefined}
      data-focused={focused ? "true" : undefined}
      data-excluded={
        selectable && inclusion === "excluded" ? "true" : undefined
      }
      aria-label={row.name}
      aria-selected={selectable ? selected : undefined}
      aria-keyshortcuts={
        selectable
          ? "Space Enter Delete ContextMenu Shift+F10"
          : "Enter ContextMenu Shift+F10"
      }
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-compress-include]")) {
          return;
        }
        const plainPrimaryClick =
          !event.ctrlKey && !event.metaKey && !event.shiftKey;
        if (selectable) {
          event.currentTarget.focus();
          actions.handleCreateIntent({
            type: "selectRow",
            path,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          });
        }
        if (
          isFolder &&
          (event.detail >= 2 ||
            (singleClickOpen && plainPrimaryClick))
        ) {
          actions.handleCreateIntent({
            type: "navigateToFolder",
            folderPath: path,
          });
        }
      }}
      onFocus={() => {
        if (selectable) {
          actions.handleCreateIntent({ type: "focusRow", path });
        }
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest("[data-compress-include]")) {
          return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          focusRelativeCreateRow(
            event.currentTarget,
            event.key === "ArrowDown" ? 1 : -1,
          );
          return;
        }
        if ((event.key === " " || event.key === "Spacebar") && selectable) {
          event.preventDefault();
          event.stopPropagation();
          actions.handleCreateIntent({ type: "toggleRowSelection", path });
          return;
        }
        if (
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
          const point = createRowContextMenuPoint(event.currentTarget);
          actions.handleCreateIntent({
            type: "showCompressRowContextMenu",
            path,
            sourcePath: sourcePath || undefined,
            x: point.x,
            y: point.y,
          });
          return;
        }
        if (event.key === "Delete" && selectable) {
          event.preventDefault();
          actions.handleCreateIntent({
            type: "removeSelectedSources",
            fallbackSourcePath: sourcePath || undefined,
          });
          return;
        }
        if (event.key === "Enter" && isFolder) {
          event.preventDefault();
          event.stopPropagation();
          actions.handleCreateIntent({
            type: "navigateToFolder",
            folderPath: path,
          });
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        actions.handleCreateIntent({
          type: "showCompressRowContextMenu",
          path,
          sourcePath: sourcePath || undefined,
          x: event.clientX,
          y: event.clientY,
        });
      }}
    >
      <td className="w-9 p-2 text-center">
        {row.rowType === "parent" ? null : (
          <input
            data-compress-include
            data-compress-path={path}
            data-compress-inclusion-state={inclusion}
            type="checkbox"
            checked={inclusion !== "excluded"}
            ref={(node) => {
              if (node) node.indeterminate = inclusion === "partial";
            }}
            aria-label={i18n.t("compress.includeItem.aria", { name: row.name })}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              actions.handleCreateIntent({
                type: "setPathIncluded",
                path,
                included: event.currentTarget.checked,
              })
            }
          />
        )}
      </td>
      {visibleCols.map((col) => (
        <CreateTableCell
          key={col.id}
          columnId={col.id}
          row={row}
          i18n={i18n}
          selectable={selectable}
          inclusion={inclusion}
          isFolder={isFolder}
          nativeIconDataUrl={nativeIconDataUrl}
          sourcePath={sourcePath}
        />
      ))}
    </tr>
  );
});

function CreateTableCell({
  columnId,
  row,
  i18n,
  selectable,
  inclusion,
  isFolder,
  nativeIconDataUrl,
  sourcePath: _sourcePath,
}: Readonly<{
  columnId: CreateSourceColumnId;
  row: CreatePlanRow;
  i18n: Translator;
  selectable: boolean;
  inclusion: CreatePlanInclusionState;
  isFolder: boolean;
  nativeIconDataUrl: string | null;
  sourcePath: string | null;
}>) {
  const data = row.rowType === "parent" ? undefined : row.entry;

  // Name column has visual structure (icons, badges) — keep inline
  if (columnId === "name") {
    return (
      <td className="min-w-[140px] px-2 py-1.5 text-xs">
        <span className="flex min-w-0 items-center gap-2" data-row-primary>
          <span
            className={`flex size-[18px] shrink-0 items-center justify-center ${isFolder ? "text-amber-600" : "text-slate-500"}`}
            data-row-icon
            aria-hidden="true"
          >
            {nativeIconDataUrl ? (
              <img
                className="size-[18px] object-contain"
                src={nativeIconDataUrl}
                alt=""
              />
            ) : isFolder ? (
              <Folder className="size-4" />
            ) : (
              <File className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate">{row.name}</span>
          {selectable ? (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${inclusion === "excluded" ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : inclusion === "partial" ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"}`}
            >
              {compressInclusionText(inclusion, i18n)}
            </span>
          ) : null}
        </span>
      </td>
    );
  }

  // All other columns: delegate value formatting to the app layer
  const value = formatCreateTableValue(data, columnId, i18n);
  const colDef = CREATE_SOURCE_TABLE_COLUMNS.find((c) => c.id === columnId);
  const alignClass = colDef?.align === "right" ? "text-right tabular-nums" : colDef?.align === "center" ? "text-center" : "";
  const mutedClass = columnId === "sourcePath" || columnId === "linkTarget" ? "text-slate-500 dark:text-slate-400" : "";

  return (
    <td className={`truncate px-2 py-1.5 text-xs ${alignClass} ${mutedClass}`}>
      {value}
    </td>
  );
}

function focusRelativeCreateRow(
  currentRow: HTMLTableRowElement,
  direction: 1 | -1,
): void {
  const rows = Array.from(
    currentRow
      .closest("tbody")
      ?.querySelectorAll<HTMLTableRowElement>(
        "tr[data-compress-folder-row], tr[data-compress-entry-row]",
      ) ?? [],
  );
  const currentIndex = rows.indexOf(currentRow);
  if (currentIndex < 0) {
    return;
  }
  const nextIndex = Math.max(
    0,
    Math.min(rows.length - 1, currentIndex + direction),
  );
  rows[nextIndex]?.focus();
}

function createRowContextMenuPoint(
  row: HTMLTableRowElement,
): Readonly<{ x: number; y: number }> {
  const rect = row.getBoundingClientRect();
  return {
    x: rect.left + 24,
    y: rect.top + Math.min(rect.height - 2, 24),
  };
}

function compressInclusionText(
  inclusion: "included" | "excluded" | "partial",
  i18n: Translator,
): string {
  switch (inclusion) {
    case "included":
      return i18n.t("compress.inclusion.included");
    case "excluded":
      return i18n.t("compress.inclusion.excluded");
    case "partial":
      return i18n.t("compress.inclusion.partial");
  }
}

function CreateOptions() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const {
    password,
    passwordConfirm,
    showPassword,
    setPassword,
    setPasswordConfirm,
    setShowPassword,
    signingIdentityPassword,
    setSigningIdentityPassword,
  } = useCreatePasswordState();
  const i18n = translatorForSnapshot(snapshot);
  const options = snapshot.create.options;
  const selectableContacts = snapshot.account.contacts.filter((contact) => isSelectableTzapContact(contact.verificationState));
  const contactGroups = useMemo(() => {
    const groups = new Map<string, typeof selectableContacts>();
    for (const contact of selectableContacts) {
      const groupId = contact.publicSignerId ? `person:${contact.publicSignerId}` : `device:${contact.contactId}`;
      const group = groups.get(groupId) ?? [];
      group.push(contact);
      groups.set(groupId, group);
    }
    return [...groups.values()];
  }, [selectableContacts]);

  useEffect(() => {
    if (options.format !== "tzap") return;
    const tzapDefaults = snapshot.preferences.createFormatDefaults.tzap;
    const defaultIdentityId = resolveTzapSigningIdentityId(
      tzapDefaults,
      snapshot.account.defaultSigningIdentityId,
      snapshot.account.certificates
        .filter((certificate) => certificate.state === "active")
        .map((certificate) => certificate.identityId),
    );
    if (
      options.tzapSigningMode === "identity" &&
      !options.tzapSigningIdentityId &&
      defaultIdentityId &&
      snapshot.account.certificates.some(
        (certificate) => certificate.identityId === defaultIdentityId && certificate.state === "active",
      )
    ) {
      actions.handleCreateIntent({
        type: "setOptions",
        patch: { tzapSigningIdentityId: defaultIdentityId },
      });
    }
  }, [
    actions,
    options.format,
    options.tzapSigningMode,
    options.tzapSigningIdentityId,
    snapshot.account.certificates,
    snapshot.account.defaultSigningIdentityId,
    snapshot.preferences.createFormatDefaults.tzap,
  ]);

  useEffect(() => {
    if (options.format !== "tzap" || options.tzapSigningMode !== "identity" || !options.tzapSigningIdentityId) {
      return;
    }
    if (!snapshot.account.certificates.some(
      (certificate) => certificate.identityId === options.tzapSigningIdentityId && certificate.state === "active",
    )) {
      actions.handleCreateIntent({
        type: "setOptions",
        patch: { tzapSigningIdentityId: "" },
      });
    }
  }, [options.format, options.tzapSigningMode, options.tzapSigningIdentityId, snapshot.account.certificates]);

  // Sync .aar ↔ .aea extension when format or password changes for Apple Archive
  useEffect(() => {
    if (options.format !== "appleArchive") return;
    const desiredPath = withCreateArchiveExtension(
      options.destinationPath,
      "appleArchive",
      Boolean(password),
    );
    if (desiredPath !== options.destinationPath) {
      actions.handleCreateIntent({
        type: "setOptions",
        patch: { destinationPath: desiredPath },
      });
    }
  }, [options.format, password]);

  const capabilities = createFormatCapabilities(options.format);
  const planStatus = snapshot.create.plan.status;
  const planHasError =
    snapshot.create.plan.state === "error" && planStatus !== null;
  const planStatusText = planStatus
    ? planStatus.fallbackText ??
      (planStatus.messageKey ? i18n.t(planStatus.messageKey) : "")
    : "";
  const volumeSizeChoices =
    options.volumeSize !== null &&
    !snapshot.preferences.volumeSizePresets.includes(options.volumeSize)
      ? [options.volumeSize, ...snapshot.preferences.volumeSizePresets]
      : snapshot.preferences.volumeSizePresets;
  const [manualPanelOpen, setManualPanelOpen] = useState<boolean | null>(null);
  const panelOpen = manualPanelOpen ?? true;

  return (
    <aside
      id="details-pane"
      data-workspace-content
      className="min-h-0 min-w-[220px] overflow-x-hidden overflow-y-auto bg-slate-50/70 pb-5 dark:bg-slate-950/70"
      aria-label={i18n.t("workspace.details.aria")}
    >
      <details
        id="compress-options-panel"
        className="group min-w-0 overflow-x-hidden px-3"
        open={panelOpen}
        onToggle={(event) => setManualPanelOpen(event.currentTarget.open)}
      >
        <summary className="hidden min-h-8 cursor-pointer list-none items-center text-xs font-semibold [&::-webkit-details-marker]:hidden max-[760px]:flex">
          <span>{i18n.t("create.options.title")}</span>
        </summary>
        <div className="mb-4 flex items-start gap-3 border-b border-slate-200 px-1 pb-4 pt-3 dark:border-slate-800">
          <div className="mt-0.5 rounded-lg bg-blue-600 p-2 text-white shadow-sm">
            <SlidersHorizontal className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold tracking-tight">
              {i18n.t("create.options.title")}
            </h3>
            <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
              {i18n.t("create.options.description")}
            </p>
          </div>
        </div>
        <div
          id="create-plan-summary"
          className={`mb-3 rounded-xl border px-3 py-2.5 text-[11px] shadow-sm ${planHasError ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" : "border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400"}`}
          role={planHasError ? "alert" : undefined}
        >
          {planHasError ? (
            <p>{planStatusText}</p>
          ) : snapshot.create.inclusion.filteredPlan ? (
            <p>
              {i18n.t("create.status.ready", {
                count: snapshot.create.inclusion.filteredPlan.includedCount,
                size: formatBytes(
                  snapshot.create.inclusion.filteredPlan.totalBytes,
                  { locale: snapshot.display.resolvedLocale },
                ),
              })}
            </p>
          ) : (
            <p>{i18n.t("create.plan.empty")}</p>
          )}
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
          <label className="!grid-cols-1 !items-stretch !gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 [@media(max-height:560px)]:!hidden">
              {i18n.t("create.archiveFormat")}
            </span>
            <Select
              value={options.format}
              onValueChange={(value) =>
                actions.handleCreateIntent({
                  type: "changeFormat",
                  format: value as typeof options.format,
                })
              }
            >
              <SelectTrigger id="create-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supportedCreateFormats(snapshot.runtime.isMacOs).map((format) => (
                  <SelectItem key={format} value={format}>
                    {FORMAT_LABELS[format] ?? format}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="!grid-cols-1 !items-stretch !gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 [@media(max-height:560px)]:!hidden">
              {i18n.t("create.compressionLevel")}
            </span>
            <CompressionLevelSelect
              id="create-compression-level"
              className="w-full"
              value={options.compressionLevel}
              i18n={i18n}
              onChange={(value) =>
                actions.handleCreateIntent({
                  type: "setOptions",
                  patch: { compressionLevel: value },
                })
              }
            />
          </label>
          <div className="col-span-full grid gap-1.5 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <label className="grid min-h-9 grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
              <input
                id="create-clean-source"
                type="checkbox"
                checked={options.cleanSource}
                onChange={(event) =>
                  actions.handleCreateIntent({
                    type: "setOptions",
                    patch: { cleanSource: event.currentTarget.checked },
                  })
                }
              />
              <span className="inline-flex items-center gap-1">
                {i18n.t("create.cleanSource")}
                <InfoTip content={i18n.t("create.cleanSource.tooltip")} />
              </span>
            </label>
            <label className="grid min-h-9 grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
                <input
                  id="create-respect-gitignore"
                  type="checkbox"
                  checked={options.respectGitignore}
                  onChange={(event) =>
                    actions.handleCreateIntent({
                      type: "setOptions",
                      patch: { respectGitignore: event.currentTarget.checked },
                    })
                  }
                />
                <span className="inline-flex items-center gap-1">
                  {i18n.t("create.respectGitignore")}
                  <InfoTip content={i18n.t("create.respectGitignore.tooltip")} />
                </span>
              </label>
            <label className="grid min-h-9 grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
              <input
                id="create-preserve-metadata"
                type="checkbox"
                checked={options.preserveMetadata}
                onChange={(event) =>
                  actions.handleCreateIntent({
                    type: "setOptions",
                    patch: { preserveMetadata: event.currentTarget.checked },
                  })
                }
              />
              <span className="inline-flex items-center gap-1">
                {i18n.t("create.preserveMetadata")}
                <InfoTip
                  content={i18n.t(
                    `create.preserveMetadata.${options.format}.tooltip`,
                  )}
                />
              </span>
            </label>
            <label className="grid min-h-9 grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
              <input
                id="create-replace-existing"
                type="checkbox"
                checked={options.replaceExisting}
                onChange={(event) =>
                  actions.handleCreateIntent({
                    type: "setOptions",
                    patch: { replaceExisting: event.currentTarget.checked },
                  })
                }
              />
              <span className="inline-flex items-center gap-1">
                {i18n.t("create.replaceExisting")}
                <InfoTip content={i18n.t("create.replaceExisting.tooltip")} />
              </span>
            </label>
            <label className="grid min-h-9 grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800">
              <input
                id="create-follow-symlinks"
                type="checkbox"
                checked={options.followSymlinks}
                onChange={(event) =>
                  actions.handleCreateIntent({
                    type: "setOptions",
                    patch: { followSymlinks: event.currentTarget.checked },
                  })
                }
              />
              <span className="inline-flex items-center gap-1">
                {i18n.t("create.followSymlinks")}
                <InfoTip content={i18n.t("create.followSymlinks.tooltip")} />
              </span>
            </label>
          </div>
        </div>
        <details
          id="create-advanced-options"
          className="group mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/80"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-xs font-semibold transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
            <span>{i18n.t("extract.advancedOptions")}</span>
            <ChevronDown
              className="size-4 opacity-55 transition-transform duration-200 group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="grid gap-4 border-t border-black/10 px-4 py-4 dark:border-white/10">
            {options.password.visible ? (
              <section
                className="grid gap-3 border-b border-black/10 pb-4 dark:border-white/10"
                aria-labelledby="create-password-title"
              >
                <h4
                  id="create-password-title"
                  className="text-xs font-semibold"
                >
                  {i18n.t("extract.password")}
                </h4>
                <div id="create-password-options" className="grid gap-2">
                  <label className={ADVANCED_FIELD_CLASS}>
                    <span>{i18n.t("extract.password")}</span>
                    <input
                      id="create-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      disabled={options.password.disabled}
                      onChange={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className={ADVANCED_FIELD_CLASS}>
                    <span>{i18n.t("create.reenterPassword")}</span>
                    <input
                      id="create-password-confirm"
                      type={showPassword ? "text" : "password"}
                      value={passwordConfirm}
                      disabled={options.password.disabled}
                      onChange={(event) =>
                        setPasswordConfirm(event.currentTarget.value)
                      }
                    />
                  </label>
                  <label className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg px-1 py-1">
                    <input
                      id="create-show-password"
                      type="checkbox"
                      checked={showPassword}
                      disabled={options.password.disabled}
                      onChange={(event) =>
                        setShowPassword(event.currentTarget.checked)
                      }
                    />
                    <span>{i18n.t("extract.showPassword")}</span>
                  </label>
                </div>
              </section>
            ) : null}
            <div className="grid gap-3">
              <label
                className={ADVANCED_FIELD_CLASS}
                hidden={!capabilities.splitVolumes}
              >
                <span>{options.format === "tzap" ? i18n.t("create.splitMode") : i18n.t("create.splitSize")}</span>
                {options.format === "tzap" ? (
                  <Select
                    value={options.splitMode}
                    onValueChange={(value) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: { splitMode: value as typeof options.splitMode },
                      })
                    }
                  >
                    <SelectTrigger id="create-volume">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{i18n.t("create.noSplit")}</SelectItem>
                      <SelectItem value="volumeSize">{i18n.t("create.splitBySize")}</SelectItem>
                      <SelectItem value="volumeCount">{i18n.t("create.splitByCount")}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Select
                    value={
                      options.volumeSize !== null &&
                      options.volumeSize !== undefined
                        ? String(options.volumeSize)
                        : "noSplit"
                    }
                    onValueChange={(value) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: { volumeSize: value === "noSplit" ? "" : value },
                      })
                    }
                  >
                    <SelectTrigger id="create-volume">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="noSplit">{i18n.t("create.noSplit")}</SelectItem>
                      {volumeSizeChoices.map((bytes) => (
                        <SelectItem value={String(bytes)} key={bytes}>
                          {formatVolumeSize(bytes)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </label>
              {options.format === "tzap" && options.splitMode === "volumeCount" ? (
                <label className={ADVANCED_FIELD_CLASS}>
                  <span>{i18n.t("create.volumeCount")}</span>
                  <input
                    id="create-volume-count"
                    type="number"
                    min="2"
                    step="1"
                    value={options.volumeCount ?? ""}
                    onChange={(event) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: { volumeCount: event.currentTarget.value },
                      })
                    }
                  />
                </label>
              ) : null}
              <label
                className={ADVANCED_FIELD_CLASS}
                hidden={!capabilities.zipCompression}
              >
                <span>{i18n.t("create.zipCompression")}</span>
                <Select
                  value={options.zipCompression}
                  onValueChange={(value) =>
                    actions.handleCreateIntent({
                      type: "setOptions",
                      patch: {
                        zipCompression: value as
                          | "store"
                          | "deflate",
                      },
                    })
                  }
                >
                  <SelectTrigger id="create-zip-compression">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deflate">Deflate</SelectItem>
                    <SelectItem value="store">{i18n.t("common.store")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label
                className={ADVANCED_FIELD_CLASS}
                id="create-tzap-recovery-field"
                hidden={!options.tzapRecovery.visible}
              >
                <span>{i18n.t("create.tzapRecovery")}</span>
                <input
                  id="create-tzap-recovery"
                  type="number"
                  value={options.tzapRecoveryPercentage}
                  disabled={options.tzapRecovery.disabled}
                  onChange={(event) =>
                    actions.handleCreateIntent({
                      type: "setOptions",
                      patch: {
                        tzapRecoveryPercentage: event.currentTarget.value,
                      },
                    })
                  }
                />
              </label>
              <label
                className={ADVANCED_FIELD_CLASS}
                hidden={!capabilities.tzapVolumeLossTolerance}
              >
                <span>{i18n.t("create.tzapVolumeLossTolerance")}</span>
                <input
                  id="create-tzap-volume-tolerance"
                  type="number"
                  min="0"
                  max="16"
                  disabled={options.splitMode === "none"}
                  value={options.tzapVolumeLossTolerance}
                  onChange={(event) =>
                    actions.handleCreateIntent({
                      type: "setOptions",
                      patch: {
                        tzapVolumeLossTolerance: event.currentTarget.value,
                      },
                    })
                  }
                />
              </label>
              {options.format === "tzap" ? (
                <label className="flex items-center gap-2">
                  <input
                    id="create-tzap-bootstrap-sidecar"
                    type="checkbox"
                    checked={options.tzapBootstrapSidecar}
                    onChange={(event) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: {
                          tzapBootstrapSidecar: event.currentTarget.checked,
                        },
                      })
                    }
                  />
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("create.tzapBootstrapSidecar")}
                    <InfoTip content={i18n.t("create.tzapBootstrapSidecar.tooltip")} />
                  </span>
                </label>
              ) : null}
            </div>
            {capabilities.sevenZAdvanced ? (
              <section className="grid gap-3 border-t border-black/10 pt-4 dark:border-white/10">
                <h4 className="text-xs font-semibold">
                  {i18n.t("create.sevenZAdvanced")}
                </h4>
                <label className={ADVANCED_FIELD_CLASS}>
                  <span>{i18n.t("create.sevenZThreads")}</span>
                  <input
                    id="create-7z-threads"
                    type="number"
                    min="1"
                    max="256"
                    value={options.sevenZThreads ?? ""}
                    onChange={(event) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: { sevenZThreads: event.currentTarget.value },
                      })
                    }
                  />
                </label>
                <label className={ADVANCED_FIELD_CLASS}>
                  <span>{i18n.t("create.sevenZChunkSize")}</span>
                  <input
                    id="create-7z-chunk-size"
                    type="number"
                    min="1"
                    value={options.sevenZChunkSize ?? ""}
                    onChange={(event) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: { sevenZChunkSize: event.currentTarget.value },
                      })
                    }
                  />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    id="create-7z-solid"
                    type="checkbox"
                    checked={options.sevenZSolid}
                    onChange={(event) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: { sevenZSolid: event.currentTarget.checked },
                      })
                    }
                  />
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("create.sevenZSolid")}
                    <InfoTip content={i18n.t("create.sevenZSolid.tooltip")} />
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="create-7z-encrypt-names"
                    checked={options.sevenZEncryptFileNames}
                    onCheckedChange={(checked) =>
                      actions.handleCreateIntent({
                        type: "setOptions",
                        patch: {
                          sevenZEncryptFileNames: checked === true,
                        },
                      })
                    }
                  />
                  <span className="inline-flex items-center gap-1">
                    {i18n.t("create.sevenZEncryptFileNames")}
                    <InfoTip content={i18n.t("create.sevenZEncryptFileNames.tooltip")} />
                  </span>
                </label>
              </section>
            ) : null}
            {options.format === "tzap" ? (
              <section
                className="grid gap-3 rounded-xl border border-black/10 bg-white/60 p-3 dark:border-white/10 dark:bg-black/10"
                aria-labelledby="create-tzap-certificates-title"
              >
                <div>
                  <h4
                    id="create-tzap-certificates-title"
                    className="text-xs font-semibold"
                  >
                    {i18n.t("create.tzapCertificates")}
                  </h4>
                  <p className="mt-1 text-[11px] leading-relaxed opacity-65">
                    {i18n.t("create.tzapCertificatesHelp")}
                  </p>
                </div>
                <CertificatePicker
                  title={i18n.t("create.tzapRecipientCertificates")}
                  value={options.tzapRecipientCertificatePaths}
                  icon={<ShieldCheck className="size-4" />}
                  onChoose={() =>
                    actions.handleCreateIntent({
                      type: "chooseTzapCertificate",
                      target: "recipients",
                    })
                  }
                  onClear={() =>
                    actions.handleCreateIntent({
                      type: "setOptions",
                      patch: { tzapRecipientCertificatePaths: "" },
                    })
                  }
                />
                <div className="grid gap-2 rounded-lg border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.035]">
                  <span className="text-[11px] font-semibold">Account-managed recipients</span>
                  {snapshot.account.recipientKeys.filter((key) => key.lifecycle === "active").map((key) => (
                    <label key={key.keyId} className="flex items-center gap-2 text-[11px] font-normal">
                      <Checkbox
                        checked={options.tzapRecipientKeyIds.split(/[;,\\r\\n]+/).map((id) => id.trim()).includes(key.keyId)}
                        onCheckedChange={(checked) =>
                          actions.handleCreateIntent({
                            type: "setOptions",
                            patch: {
                              tzapRecipientKeyIds: toggleDelimitedSelection(options.tzapRecipientKeyIds, key.keyId, checked === true),
                            },
                          })
                        }
                      />
                      <span className="truncate">{key.label?.trim() || key.publicKeyFingerprint}</span>
                    </label>
                  ))}
                  {contactGroups.map((group) => (
                    <div key={group[0]?.publicSignerId ? `person:${group[0].publicSignerId}` : `device:${group[0]?.contactId}`} className="grid gap-1">
                      {group[0]?.publicSignerId ? (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Person · {group[0].displayName}
                        </span>
                      ) : null}
                      {group.map((contact) => (
                        <label key={contact.contactId} className="flex items-center gap-2 pl-1 text-[11px] font-normal">
                          <Checkbox
                            checked={options.tzapContactRecipientIds.split(/[;,\\r\\n]+/).map((id) => id.trim()).includes(contact.contactId)}
                            onCheckedChange={(checked) =>
                              actions.handleCreateIntent({
                                type: "setOptions",
                                patch: {
                                  tzapContactRecipientIds: toggleDelimitedSelection(options.tzapContactRecipientIds, contact.contactId, checked === true),
                                },
                              })
                            }
                          />
                          <span className="truncate">
                            {group[0]?.publicSignerId ? `Device · ${contact.displayName}` : contact.displayName}
                            {` · ${tzapContactTrustLabel(contact.verificationState)}`}
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                  {!snapshot.account.recipientKeys.some((key) => key.lifecycle === "active") && !snapshot.account.contacts.some((contact) => isSelectableTzapContact(contact.verificationState)) ? (
                    <span className="text-[10px] leading-4 opacity-65">Open TZAP Account &amp; Identity to enroll or trust a recipient.</span>
                  ) : null}
                </div>
                <div className="rounded-xl border border-black/10 bg-black/[0.025] p-3 dark:border-white/10 dark:bg-white/[0.035]">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                    <KeyRound className="size-4" />
                    {i18n.t("create.tzapSigningIdentity")}
                  </div>
                  <div className="mb-3 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] rounded-lg bg-black/[0.06] p-1 dark:bg-white/[0.06]">
                    <button
                      type="button"
                      className={`min-h-8 min-w-0 truncate rounded-md !px-1 !py-1.5 !text-[10px] !font-semibold ${options.tzapSigningMode === "identity" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 opacity-80 dark:text-slate-300"}`}
                      onClick={() =>
                        actions.handleCreateIntent({
                          type: "setOptions",
                          patch: { tzapSigningMode: "identity" },
                        })
                      }
                    >
                      {i18n.t("create.tzapLocalSigningIdentity")}
                    </button>
                    <button
                      type="button"
                      className={`min-h-8 min-w-0 truncate rounded-md !px-1 !py-1.5 !text-[10px] !font-semibold ${options.tzapSigningMode === "advanced" ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 opacity-80 dark:text-slate-300"}`}
                      onClick={() =>
                        actions.handleCreateIntent({
                          type: "setOptions",
                          patch: { tzapSigningMode: "advanced" },
                        })
                      }
                    >
                      Advanced one-time
                    </button>
                  </div>
                  {options.tzapSigningMode === "identity" ? (
                    <div className="grid gap-2">
                      <label className={ADVANCED_FIELD_CLASS}>
                        <span>{i18n.t("create.tzapLocalSigningIdentity")}</span>
                        <Select
                          value={options.tzapSigningIdentityId || "none"}
                          onValueChange={(value) =>
                            actions.handleCreateIntent({
                              type: "setOptions",
                              patch: { tzapSigningIdentityId: value === "none" ? "" : value },
                            })
                          }
                        >
                          <SelectTrigger aria-label={i18n.t("create.tzapLocalSigningIdentity")}>
                            <SelectValue placeholder="No signing identity" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No signing identity</SelectItem>
                            {snapshot.account.certificates.filter((certificate) => certificate.state === "active").map((certificate) => (
                              <SelectItem key={certificate.identityId} value={certificate.identityId}>
                                {certificate.identityType === "hosted" ? i18n.t("create.tzapHostedIdentity") : i18n.t("create.tzapOfflineIdentity")} · {certificate.label || certificate.certificateSha256}{certificate.renewalRecommended ? ` · ${i18n.t("create.tzapRenewalRecommended")}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <p className="text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                        {i18n.t("create.tzapLocalSigningIdentityHelp")} Private key material stays in the native secure store and is resolved by ID at start time.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <CertificatePicker
                        compact
                        title="P12/PFX signing bundle"
                        value={options.tzapSigningIdentityPath}
                        onChoose={() =>
                          actions.handleCreateIntent({
                            type: "chooseTzapCertificate",
                            target: "identity",
                          })
                        }
                        onClear={() =>
                          actions.handleCreateIntent({
                            type: "setOptions",
                            patch: { tzapSigningIdentityPath: "" },
                          })
                        }
                      />
                      <label className={ADVANCED_FIELD_CLASS}>
                        <span>P12/PFX password (optional)</span>
                        <Input
                          type="password"
                          className="text-xs font-normal"
                          value={signingIdentityPassword}
                          onChange={(event) => setSigningIdentityPassword(event.currentTarget.value)}
                          autoComplete="off"
                        />
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-fit"
                        disabled={!options.tzapSigningIdentityPath.trim()}
                        onClick={() => actions.handleCreateIntent({
                          type: "validateTzapSigningIdentity",
                          identityPath: options.tzapSigningIdentityPath,
                          password: signingIdentityPassword,
                        })}
                      >
                        Validate bundle
                      </Button>
                      <p className="text-[10px] opacity-60">
                        The bundle must contain the signing certificate and matching private key. Intermediate certificates are optional and remain inside the bundle for this one-time operation.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </details>
      </details>
    </aside>
  );
}

function CertificatePicker({
  title,
  value,
  icon,
  compact = false,
  onChoose,
  onClear,
}: {
  title: string;
  value: string;
  icon?: ReactNode;
  compact?: boolean;
  onChoose(): void;
  onClear(): void;
}) {
  const paths = value
    .split(";")
    .map((path) => path.trim())
    .filter(Boolean);
  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-xl border border-black/10 bg-white/60 ${compact ? "p-2.5" : "p-3"} dark:border-white/10 dark:bg-black/10`}
    >
      <div className="col-span-full flex items-center gap-2 text-[11px] font-semibold leading-4">
        {icon}
        {title}
      </div>
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1 overflow-hidden">
        {paths.length ? (
          paths.map((path) => (
            <span
              key={path}
              title={path}
              className="max-w-full truncate rounded-md bg-blue-500/10 px-2 py-1 text-[10px] text-blue-700 dark:text-blue-300"
            >
              {getPathBasename(path)}
            </span>
          ))
        ) : (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {i18nFallbackNone()}
          </span>
        )}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 py-1.5 !text-[11px] !font-medium hover:bg-black/5 dark:hover:bg-white/5"
          onClick={onChoose}
        >
          <Plus className="size-3" />
          Choose
        </button>
        {paths.length ? (
          <button
            type="button"
            aria-label={`Clear ${title}`}
            className="rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/5"
            onClick={onClear}
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function i18nFallbackNone() {
  return "Not configured";
}

function isSelectableTzapContact(verificationState: string): boolean {
  return verificationState === "valid_now"
    || verificationState === "valid_at_trusted_time"
    || verificationState === "cryptographically_intact_offline";
}

function tzapContactTrustLabel(verificationState: string): string {
  switch (verificationState) {
    case "valid_now": return "Verified now";
    case "valid_at_trusted_time": return "Verified with trusted-time caveat";
    case "cryptographically_intact_offline": return "Verified offline";
    case "status_expired": return "Expired";
    case "status_mismatch": return "Status unavailable";
    case "invalid": return "Invalid contact card";
    default: return "Verification unavailable";
  }
}

function includeAllState(snapshot: ReturnType<typeof useZManagerSnapshot>) {
  const rows = snapshot.create.view.rows.filter(
    (row) => row.rowType !== "parent",
  );
  const included = rows.filter(
    (row) => inclusionStateForPath(snapshot, row.path) !== "excluded",
  );
  return {
    checked: rows.length > 0 && included.length === rows.length,
    indeterminate: included.length > 0 && included.length < rows.length,
    disabled: rows.length === 0,
  };
}

function inclusionStateForPath(
  snapshot: ReturnType<typeof useZManagerSnapshot>,
  path: string,
): "included" | "excluded" | "partial" {
  const excludedPaths = snapshot.create.inclusion.excludedArchivePaths;
  const excludedSet = new Set(excludedPaths);
  const planEntries = snapshot.create.plan.current?.planEntries;

  if (!planEntries || planEntries.length === 0) {
    return excludedSet.has(path) ? "excluded" : "included";
  }

  const affected = planEntries.filter((entry) => isArchivePathInFolder(entry.path, path));
  if (affected.length === 0) {
    return excludedSet.has(path) ? "excluded" : "included";
  }

  let includedCount = 0;
  for (const entry of affected) {
    if (!excludedSet.has(entry.path)) {
      includedCount += 1;
    }
  }

  if (includedCount === 0) {
    return "excluded";
  }
  if (includedCount === affected.length) {
    return "included";
  }
  return "partial";
}
