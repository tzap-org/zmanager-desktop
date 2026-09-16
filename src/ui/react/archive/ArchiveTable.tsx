import { Archive, File, Folder, GripVertical, Search } from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { archiveRowIconDescriptor } from "../../../app/archiveEntryIcons";
import {
  archiveTableColumnLabel,
  formatArchiveTableValue,
  normalizeColumnSettings,
  visibleColumns,
  type ArchiveTableColumn,
  type ArchiveTableColumnId,
  type ArchiveTableRow,
} from "../../../app/archiveTable";
import { useZManagerActions, useZManagerSnapshot } from "../AppProviders";
import type {
  ZManagerReactActions,
  ZManagerReactSnapshot,
} from "../appRuntime";
import { translatorForSnapshot } from "../shell/shellHelpers";
import {
  armTableMarqueeSelectionGesture,
  continueTableMarqueeSelectionGesture,
  endTableMarqueeSelectionGesture,
  type TableMarqueeSelectionGesture,
  type ViewportRect,
} from "../workspace/tableMarqueeSelection";
import { MarqueeSelectionOverlay } from "../workspace/MarqueeSelectionOverlay";
import {
  tableColumnReorderClassName,
  useTableColumnReorder,
  type TableColumnReorderController,
} from "../workspace/useTableColumnReorder";
import { nativeIconDataUrlForRow } from "./archiveNativeIcons";

const NATIVE_DRAG_THRESHOLD_PX = 6;

export function ArchiveTable() {
  const snapshot = useZManagerSnapshot();
  const actions = useZManagerActions();
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const tableShellRef = useRef<HTMLDivElement | null>(null);
  const marqueeGestureRef = useRef<TableMarqueeSelectionGesture | null>(null);
  const suppressMarqueeClickRef = useRef(false);
  const [marqueeRect, setMarqueeRect] = useState<ViewportRect | null>(null);
  const i18n = translatorForSnapshot(snapshot);
  const archive = snapshot.archive;
  const openCommandState = snapshot.commands.states.open;
  const columns = useMemo(
    () => visibleColumns(archive.view.tableColumns),
    [archive.view.tableColumns],
  );
  const columnReorder = useTableColumnReorder(
    columns
      .filter((column) => column.id !== "name")
      .map((column) => column.id),
    (sourceColumnId, targetColumnId) => {
      actions.handleArchiveIntent({
        type: "reorderColumn",
        sourceColumnId,
        targetColumnId,
      });
    },
  );
  const showStartEmpty = !archive.currentArchivePath;
  const rows = archive.view.rows;
  const selectedPathSet = useMemo(
    () => new Set(archive.view.selection.allSelected
      ? archive.view.selection.visibleSelectedPaths
      : archive.view.selection.selectedPaths),
    [
      archive.view.selection.allSelected,
      archive.view.selection.selectedPaths,
      archive.view.selection.visibleSelectedPaths,
    ],
  );
  const focusedPath = archive.view.selection.focusedPath;
  const showSecondaryPath =
    archive.view.flatView || Boolean(snapshot.archive.view.searchQuery.trim());

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950"
      aria-label={i18n.t("workspace.archiveEntries.aria")}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 dark:border-slate-800">
        <div>
          <h1 id="workspace-title" className="text-sm font-semibold">
            {i18n.t("extract.tableTitle")}
          </h1>
          <p
            id="browse-meta"
            className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400"
          >
            {archiveMetaText(snapshot.archive, i18n.t("browse.statusReady"))}
          </p>
        </div>
        <button
          id="refresh-archive"
          className="min-h-8 rounded-md border border-transparent bg-transparent px-2 text-xs hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
          type="button"
          data-command-id="refresh"
          disabled={!snapshot.commands.states.refresh.enabled}
          onClick={() => actions.executeCommand("refresh")}
        >
          {i18n.t("common.refresh")}
        </button>
      </div>
      <p
        id="browse-message"
        className={archiveStatusClassName(archive.browseState)}
        role={archive.browseState === "error" ? "alert" : undefined}
      >
        {archive.status.fallbackText ??
          i18n.t(archive.status.key, archive.status.values)}
      </p>
      <div
        ref={tableShellRef}
        data-archive-table-shell
        className="relative min-h-0 flex-1 select-none overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
        tabIndex={0}
        onDragStart={(event) => event.preventDefault()}
        onPointerDownCapture={(event) => {
          armMarqueeSelectionGesture({
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
          actions.handleArchiveIntent({
            type: "showEmptyContextMenu",
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <div
          id="marquee-hit-surface"
          className="absolute inset-0 z-0"
          aria-hidden="true"
        />
        {marqueeRect ? <MarqueeSelectionOverlay rect={marqueeRect} /> : null}
        <div
          id="archive-empty-state"
          className="absolute inset-0 z-10 grid place-items-center bg-white p-6 dark:bg-slate-950"
          hidden={!showStartEmpty}
          onContextMenu={(event) => {
            event.preventDefault();
            actions.handleArchiveIntent({
              type: "showEmptyContextMenu",
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          <div className="grid max-w-md place-items-center gap-3 text-center">
            <span
              className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300"
              aria-hidden="true"
            >
              <Archive className="size-7" />
            </span>
            <div>
              <h2 className="text-base font-semibold">
                {i18n.t("browse.emptyTitle")}
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {i18n.t("browse.emptyDescription")}
              </p>
            </div>
            <button
              className="min-h-9 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              type="button"
              data-empty-action="open-archive"
              disabled={!openCommandState.enabled}
              title={
                openCommandState.enabled ? undefined : openCommandState.reason
              }
              onClick={() => actions.executeCommand("open")}
            >
              {i18n.t("browse.emptyOpenAction")}
            </button>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {i18n.t("browse.emptyDropHint")}
            </p>
          </div>
        </div>
        <table id="entry-table" className={archiveTableClassName(snapshot)}>
          <colgroup>
            <col />
            {columns.map((column) => (
              <col width={column.width} key={column.id} />
            ))}
          </colgroup>
          <thead id="entry-table-head">
            <tr>
              <th className="sticky top-0 z-10 w-9 border-b border-slate-200 bg-slate-50 p-2 text-center dark:border-slate-800 dark:bg-slate-900">
                <SelectAllCheckbox
                  disabled={archive.browseState !== "loaded"}
                  checked={
                    archive.view.selection.visibleSelectablePaths.length > 0 &&
                    (archive.view.selection.allSelected
                      ? archive.view.selection.excludedPaths.length === 0
                      : archive.view.selection.visibleSelectedCount ===
                        archive.view.selection.visibleSelectablePaths.length)
                  }
                  indeterminate={
                    archive.view.selection.allSelected
                      ? archive.view.selection.excludedPaths.length > 0
                      : archive.view.selection.visibleSelectedCount > 0 &&
                        archive.view.selection.visibleSelectedCount <
                          archive.view.selection.visibleSelectablePaths.length
                  }
                />
              </th>
              {columns.map((column) => (
                <HeaderCell
                  column={column}
                  activeSortKey={archive.view.sort.key}
                  sortAscending={archive.view.sort.ascending}
                  columnReorder={columnReorder}
                  key={column.id}
                />
              ))}
            </tr>
          </thead>
          <tbody id="entry-table-body" ref={tableBodyRef}>
            {tableBodyRows(
              rows,
              archive.currentArchivePath,
              archive.browseState,
              columns,
              snapshot.archive.view.searchQuery,
              i18n.t("browse.statusEmpty"),
            ).map((row) =>
              typeof row === "string" ? (
                <tr data-empty-table-row key="empty">
                  <td
                    colSpan={columns.length + 1}
                    className="h-32 p-6 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    {row}
                  </td>
                </tr>
              ) : (
                <ArchiveTableRowView
                  row={row}
                  columns={columns}
                  selected={selectedPathSet.has(row.path)}
                  focused={focusedPath === row.path}
                  showSecondaryPath={showSecondaryPath}
                  iconDataUrl={nativeIconDataUrlForRow(snapshot, row)}
                  i18n={i18n}
                  actions={actions}
                  key={row.rowId}
                />
              ),
            )}
          </tbody>
        </table>
      </div>
      {archive.page.hasPrevious || archive.page.hasNext ? (
        <nav
          className="flex h-10 shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-3 dark:border-slate-800"
          aria-label={i18n.t("browse.pageSummary", {
            page: archive.page.number,
            count: archive.page.childCount,
          })}
        >
          <span className="mr-auto text-xs text-slate-500 dark:text-slate-400">
            {i18n.t("browse.pageSummary", {
              page: archive.page.number,
              count: archive.page.childCount,
            })}
          </span>
          <button
            type="button"
            className="min-h-8 rounded-md border border-slate-200 px-3 text-xs disabled:opacity-40 dark:border-slate-700"
            disabled={!archive.page.hasPrevious}
            onClick={() => actions.handleArchiveIntent({ type: "loadPreviousArchivePage" })}
          >
            {i18n.t("common.previous")}
          </button>
          <button
            type="button"
            className="min-h-8 rounded-md border border-slate-200 px-3 text-xs disabled:opacity-40 dark:border-slate-700"
            disabled={!archive.page.hasNext}
            onClick={() => actions.handleArchiveIntent({ type: "loadNextArchivePage" })}
          >
            {i18n.t("common.next")}
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function SelectAllCheckbox({
  checked,
  disabled,
  indeterminate,
}: Readonly<{ checked: boolean; disabled: boolean; indeterminate: boolean }>) {
  const actions = useZManagerActions();
  const snapshot = useZManagerSnapshot();
  const i18n = translatorForSnapshot(snapshot);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      id="select-all"
      ref={ref}
      type="checkbox"
      aria-label={i18n.t("table.selectVisibleEntries")}
      disabled={disabled}
      checked={checked}
      onChange={(event) =>
        actions.handleArchiveIntent({
          type: event.currentTarget.checked
            ? "selectAllVisible"
            : "clearSelection",
        })
      }
    />
  );
}

function HeaderCell({
  column,
  activeSortKey,
  sortAscending,
  columnReorder,
}: Readonly<{
  column: ArchiveTableColumn;
  activeSortKey: ArchiveTableColumnId;
  sortAscending: boolean;
  columnReorder: TableColumnReorderController<ArchiveTableColumnId>;
}>) {
  const actions = useZManagerActions();
  const snapshot = useZManagerSnapshot();
  const i18n = translatorForSnapshot(snapshot);
  const active = activeSortKey === column.id;
  const label = archiveTableColumnLabel(column, i18n);
  const resizeRef = useRef<{
    latestWidth: number;
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);

  const movable = column.id !== "name";
  const isDragSource =
    columnReorder.dragState?.sourceColumnId === column.id;
  const dropPosition =
    columnReorder.dragState?.targetColumnId === column.id
      ? columnReorder.dragState.dropPosition
      : null;

  return (
    <th
      data-table-column-header
      data-table-column-id={column.id}
      data-column-drag-source={isDragSource || undefined}
      data-column-drop-position={dropPosition ?? undefined}
      data-column-id={column.id}
      data-sort-key={column.id}
      {...columnReorder.headerPointerHandlers(column.id, movable)}
      className={`group sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-semibold text-slate-600 transition-[background-color,color,box-shadow,opacity,transform] duration-150 ease-out dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 ${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""} ${tableColumnReorderClassName({ movable, isSource: isDragSource, dropPosition })}`}
      aria-sort={active ? (sortAscending ? "ascending" : "descending") : "none"}
      aria-keyshortcuts="Enter Space ContextMenu Shift+F10"
      tabIndex={0}
      title={label}
      onClick={() =>
        actions.handleArchiveIntent({
          type: "sortByColumn",
          columnId: column.id,
        })
      }
      onContextMenu={(event) => {
        event.preventDefault();
        actions.handleArchiveIntent({
          type: "showColumnContextMenu",
          columnId: column.id,
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          actions.handleArchiveIntent({
            type: "sortByColumn",
            columnId: column.id,
          });
          return;
        }
        if (
          event.key === "ContextMenu" ||
          (event.key === "F10" && event.shiftKey)
        ) {
          event.preventDefault();
          const point = contextMenuPointForElement(event.currentTarget);
          actions.handleArchiveIntent({
            type: "showColumnContextMenu",
            columnId: column.id,
            x: point.x,
            y: point.y,
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
        {active ? (
          <span className="shrink-0 text-[10px] text-slate-500" aria-hidden="true">
            {sortAscending ? "^" : "v"}
          </span>
        ) : null}
      </span>
      <span
        className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize hover:bg-blue-500/30"
        data-column-resizer={column.id}
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
            latestWidth: column.width,
            pointerId: event.pointerId,
            startWidth: column.width,
            startX: event.clientX,
          };
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          resize.latestWidth =
            resize.startWidth + event.clientX - resize.startX;
          actions.handleArchiveIntent({
            type: "setColumnWidth",
            columnId: column.id,
            width: resize.latestWidth,
            persist: false,
          });
        }}
        onPointerUp={(event) =>
          finishArchiveColumnResize(event, column.id, actions, resizeRef)
        }
        onPointerCancel={(event) =>
          finishArchiveColumnResize(event, column.id, actions, resizeRef)
        }
      />
    </th>
  );
}

function finishArchiveColumnResize(
  event: ReactPointerEvent<HTMLElement>,
  columnId: ArchiveTableColumnId,
  actions: ZManagerReactActions,
  resizeRef: MutableRefObject<{
    latestWidth: number;
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>,
) {
  const resize = resizeRef.current;
  if (!resize || resize.pointerId !== event.pointerId) return;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  resizeRef.current = null;
  actions.handleArchiveIntent({
    type: "setColumnWidth",
    columnId,
    width: resize.latestWidth,
    persist: true,
  });
}

type ArchiveTableRowViewProps = Readonly<{
  row: ArchiveTableRow;
  columns: readonly ArchiveTableColumn[];
  selected: boolean;
  focused: boolean;
  showSecondaryPath: boolean;
  iconDataUrl?: string | null;
  i18n: ReturnType<typeof translatorForSnapshot>;
  actions: ZManagerReactActions;
}>;

const ArchiveTableRowView = memo(function ArchiveTableRowView({
  row,
  columns,
  selected,
  focused,
  showSecondaryPath,
  iconDataUrl,
  i18n,
  actions,
}: ArchiveTableRowViewProps) {
  const selectable = row.rowType !== "parent";
  const nativeDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressNativeDragClickRef = useRef(false);
  const isFolder = row.rowType === "folder" || row.rowType === "parent";
  const rowKind =
    row.rowType === "parent"
      ? "parent"
      : row.rowType === "folder"
        ? "folder"
        : "entry";
  const className =
    "group border-b border-slate-100 hover:bg-blue-50/70 aria-selected:bg-blue-100 aria-selected:text-blue-950 data-[focused=true]:ring-2 data-[focused=true]:ring-inset data-[focused=true]:ring-blue-500/50 dark:border-slate-900 dark:hover:bg-blue-950/40 dark:aria-selected:bg-blue-950 dark:aria-selected:text-blue-50";

  return (
    <tr
      className={className}
      data-folder-path={isFolder ? row.path : undefined}
      data-entry-path={selectable ? row.path : undefined}
      tabIndex={0}
      draggable={selectable}
      data-native-drag={selectable ? "entry" : undefined}
      data-focused={focused ? "true" : undefined}
      aria-selected={selectable ? selected : undefined}
      aria-keyshortcuts="Space Enter ContextMenu Shift+F10"
      onClick={(event) => {
        if (suppressNativeDragClickRef.current) {
          suppressNativeDragClickRef.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!selectable) {
          return;
        }
        actions.handleArchiveIntent({
          type: "selectRow",
          path: row.path,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
      }}
      onDoubleClick={() =>
        actions.handleArchiveIntent({
          type: "activateRow",
          path: row.path,
          rowKind,
        })
      }
      onPointerDown={(event) => {
        if (!selectable || !canStartNativeDragGesture(event)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        nativeDragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const gesture = nativeDragRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (
          Math.hypot(
            event.clientX - gesture.startX,
            event.clientY - gesture.startY,
          ) < NATIVE_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        event.preventDefault();
        nativeDragRef.current = null;
        suppressNativeDragClickRef.current = true;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        actions.handleArchiveIntent({
          type: "startNativeDrag",
          entryPath: row.path,
        });
      }}
      onPointerUp={(event) => finishNativeDragGesture(event, nativeDragRef)}
      onPointerCancel={(event) => finishNativeDragGesture(event, nativeDragRef)}
      onDragStart={(event) => {
        if (selectable) {
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        if (!selectable) {
          return;
        }
        event.preventDefault();
        actions.handleArchiveIntent({
          type: "showRowContextMenu",
          path: row.path,
          rowKind,
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onKeyDown={(event) => {
        if (!selectable) {
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          actions.handleArchiveIntent({
            type: "activateRow",
            path: row.path,
            rowKind,
          });
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          actions.handleArchiveIntent({
            type: "selectRow",
            path: row.path,
            ctrlKey: true,
          });
          return;
        }
        if (
          event.key === "ContextMenu" ||
          (event.key === "F10" && event.shiftKey)
        ) {
          event.preventDefault();
          const point = contextMenuPointForElement(event.currentTarget);
          actions.handleArchiveIntent({
            type: "showRowContextMenu",
            path: row.path,
            rowKind,
            x: point.x,
            y: point.y,
          });
        }
      }}
    >
      <td className="w-9 p-2 text-center">
        {selectable ? (
          <input
            data-entry-path={row.path}
            type="checkbox"
            aria-label={i18n.t("browse.selectEntry.aria", { name: row.name })}
            checked={selected}
            onChange={(event) =>
              actions.handleArchiveIntent({
                type: "setRowSelected",
                path: row.path,
                selected: event.currentTarget.checked,
              })
            }
          />
        ) : null}
      </td>
      {columns.map((column) => (
        <td className={cellClassName(column)} key={column.id}>
          {column.id === "name" ? (
            <NameCell
              row={row}
              showSecondaryPath={showSecondaryPath}
              iconDataUrl={iconDataUrl}
              i18n={i18n}
            />
          ) : (
            cellValue(row, column, i18n)
          )}
        </td>
      ))}
    </tr>
  );
});

type NameCellProps = Readonly<{
  row: ArchiveTableRow;
  showSecondaryPath: boolean;
  iconDataUrl?: string | null;
  i18n: ReturnType<typeof translatorForSnapshot>;
}>;

const NameCell = memo(function NameCell({
  row,
  showSecondaryPath,
  iconDataUrl,
  i18n,
}: NameCellProps) {
  const Icon =
    row.rowType === "parent"
      ? Folder
      : row.rowType === "folder"
        ? Folder
        : File;
  const descriptor = archiveRowIconDescriptor(row, i18n);
  const secondaryPath = row.rowType === "entry" ? row.entry.path : row.path;
  const isSecondaryVisible =
    showSecondaryPath && (row.rowType === "entry" || row.rowType === "folder");

  return (
    <>
      <span className="flex min-w-0 items-center gap-2" data-row-primary>
        <span
          className={`relative flex size-[18px] shrink-0 items-center justify-center ${descriptor.kind === "folder" ? "text-amber-600" : descriptor.kind === "archive" ? "text-blue-600" : "text-slate-500"}`}
          data-row-icon
          title={descriptor.label}
          aria-hidden="true"
          draggable={false}
        >
          <Icon className="size-4" aria-hidden="true" />
          {iconDataUrl ? (
            <img
              className="absolute inset-0 size-[18px] object-contain"
              src={iconDataUrl}
              alt=""
              draggable={false}
            />
          ) : null}
        </span>
        <span className="sr-only">{descriptor.label}:</span>
        <span className="min-w-0 truncate" data-row-name>
          {row.name}
        </span>
        {row.rowType === "entry" && row.entry.encrypted ? (
          <Search
            className="size-3 shrink-0 text-slate-400"
            aria-hidden="true"
          />
        ) : null}
      </span>
      {isSecondaryVisible ? (
        <span
          className="mt-0.5 block truncate pl-[26px] text-[10px] text-slate-500 dark:text-slate-400"
          data-row-secondary
        >
          {secondaryPath}
        </span>
      ) : null}
    </>
  );
});

function cellClassName(column: ArchiveTableColumn): string | undefined {
  return `px-2 py-1.5 text-xs ${column.id === "name" ? "min-w-[140px]" : "truncate tabular-nums"} ${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""}`;
}

function cellValue(
  row: ArchiveTableRow,
  column: ArchiveTableColumn,
  i18n: ReturnType<typeof translatorForSnapshot>,
): string {
  if (row.rowType === "parent" || !row.entry) {
    return "";
  }
  return formatArchiveTableValue(row.entry, column.id, i18n);
}

function tableBodyRows(
  rows: readonly ArchiveTableRow[],
  archivePath: string,
  browseState: string,
  _columns: readonly ArchiveTableColumn[],
  searchQuery: string,
  emptyLabel: string,
): readonly ArchiveTableRow[] | readonly [string] {
  if (browseState === "loading") {
    return ["Loading archive entries..."];
  }
  if (!archivePath) {
    return [emptyLabel];
  }
  if (!rows.length) {
    return [
      searchQuery.trim()
        ? `No entries match "${searchQuery.trim()}".`
        : "This folder has no visible entries.",
    ];
  }
  return rows;
}

function archiveMetaText(
  archive: ReturnType<typeof useZManagerSnapshot>["archive"],
  emptyText: string,
): string {
  if (!archive.currentArchivePath) {
    return emptyText;
  }
  const folderLabel = archive.view.currentFolder
    ? ` > ${archive.view.currentFolder}`
    : "";
  return `${getPathBasename(archive.currentArchivePath, "ZManager")}${folderLabel} - ${archive.view.rows.length} entries`;
}

function archiveTableClassName(snapshot: ZManagerReactSnapshot): string {
  return `relative z-[1] w-full border-collapse table-fixed ${snapshot.preferences.showGridLines ? "[&_td]:border-r [&_td]:border-slate-100 dark:[&_td]:border-slate-800" : ""}`;
}

function archiveStatusClassName(state: string): string {
  const base =
    "mx-3 my-2 rounded-md border px-2 py-1.5 text-xs whitespace-pre-line";
  if (state === "error")
    return `${base} border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200`;
  if (state === "loading")
    return `${base} border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200`;
  return `${base} border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300`;
}

function getPathBasename(path: string, fallback: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? fallback;
}

function contextMenuPointForElement(element: HTMLElement): {
  x: number;
  y: number;
} {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + 24,
    y: rect.top + Math.min(rect.height - 2, 24),
  };
}

function canStartNativeDragGesture(
  event: ReactPointerEvent<HTMLTableRowElement>,
): boolean {
  return (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    isNativeDragTarget(event.target)
  );
}

function isNativeDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest("button, a, input, select, textarea")) {
    return false;
  }

  return Boolean(target.closest("[data-row-primary]"));
}

function finishNativeDragGesture(
  event: ReactPointerEvent<HTMLTableRowElement>,
  gestureRef: MutableRefObject<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>,
) {
  if (gestureRef.current?.pointerId !== event.pointerId) return;
  gestureRef.current = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function armMarqueeSelectionGesture(
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
      selectedPaths: snapshot.archive.view.selection.selectedPaths,
      visiblePaths: snapshot.archive.view.selection.visibleSelectablePaths,
      rowSelector: "tr[data-entry-path]",
      rowPath: (row) => row.dataset.entryPath,
      canStart: (candidate) => canStartMarqueeSelection(candidate, snapshot),
      setMarqueeRect,
      applySelection: (selection) =>
        actions.handleArchiveIntent({
          type: "applySelection",
          selectedPaths: [...selection.selectedPaths],
          focusedPath: selection.focusedPath,
          anchorPath: selection.anchorPath,
        }),
    },
    gestureRef,
  );
}

function canStartMarqueeSelection(
  event: ReactPointerEvent<HTMLElement>,
  snapshot: ZManagerReactSnapshot,
): boolean {
  if (
    event.button !== 0 ||
    !snapshot.archive.currentArchivePath ||
    snapshot.archive.browseState !== "loaded"
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

  return !event.target.closest("[data-row-primary], [data-row-secondary]");
}
