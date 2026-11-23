import {
  ARCHIVE_TABLE_COLUMNS,
  archiveTableColumnLabel,
  normalizeColumnSettings,
  type ArchiveTableColumnId,
  type ArchiveTableColumnSettings,
} from "../archiveTable";
import {
  resolveArchiveFormatFamily,
} from "../archiveFormatFamily";
import {
  getExtractAvailableColumns,
  getUnknownExtractAvailableColumns,
} from "../extractColumnAvailability";
import {
  CREATE_SOURCE_TABLE_COLUMNS,
  createTableColumnLabel,
  normalizeCreateColumnSettings,
  type CreateSourceColumnId,
  type CreateSourceColumnSettings,
} from "../createTableColumns";
import {
  getColumnDefinition,
} from "../tableColumnCatalogue";
import type { Translator } from "../i18n/translator";

export const CONTEXT_MENU_ACTIONS = [
  "add-source-files",
  "add-source-folder",
  "clear-sources",
  "compress-open-folder",
  "deselect-by-type",
  "exclude-compress-path",
  "extract",
  "extract-here",
  "include-compress-path",
  "info",
  "open-archive",
  "open-entry",
  "open-folder",
  "open-outside",
  "open-recent-archive",
  "paste-archive-path",
  "remove-source",
  "reset-columns",
  "reveal-source",
  "select-by-type",
  "sort-ascending",
  "sort-descending",
  "test",
  "toggle-column",
] as const;

export type ContextMenuAction = typeof CONTEXT_MENU_ACTIONS[number];

export type ContextMenuActionPayload = Readonly<{
  action: ContextMenuAction;
  archivePath?: string;
  columnId?: ArchiveTableColumnId | CreateSourceColumnId;
  compressMenuPath?: string;
  entryPath?: string;
  folderPath?: string;
  sourcePath?: string;
}>;

export type ContextMenuActionItem = Readonly<{
  type: "action";
  label: string;
  payload: ContextMenuActionPayload;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
}>;

export type ContextMenuCheckboxItem = Readonly<{
  type: "checkbox";
  label: string;
  payload: ContextMenuActionPayload;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
}>;

export type ContextMenuCaptionItem = Readonly<{
  type: "caption";
  label: string;
}>;

export type ContextMenuSeparatorItem = Readonly<{
  type: "separator";
}>;

export type ContextMenuItem =
  | ContextMenuActionItem
  | ContextMenuCheckboxItem
  | ContextMenuCaptionItem
  | ContextMenuSeparatorItem;

export type StartupContextMenuInput = Readonly<{
  translator: Translator;
  canPastePath: boolean;
  recentArchiveHistory: readonly string[];
  recentLimit?: number;
}>;

export type ArchiveFolderContextMenuInput = Readonly<{
  translator: Translator;
  folderPath: string;
  entryPath?: string;
  selectedCount: number;
  hasArchive: boolean;
}>;

export type ArchiveEntryContextMenuInput = Readonly<{
  translator: Translator;
  entryPath: string;
  canOpenInside: boolean;
  canOpenNestedArchive?: boolean;
  canOpenOutside: boolean;
  selectedCount: number;
  selectedEntryCount: number;
  hasArchive: boolean;
}>;

export type ArchiveHeaderContextMenuInput = Readonly<{
  translator: Translator;
  tableColumnSettings: ArchiveTableColumnSettings;
  selectedColumnId?: ArchiveTableColumnId;
  archivePath?: string;
}>;

export type CreateHeaderContextMenuInput = Readonly<{
  translator: Translator;
  tableColumnSettings: CreateSourceColumnSettings;
  selectedColumnId?: CreateSourceColumnId;
  /** Columns the running backend can populate (capability-filtered). Omitting shows all. */
  availableColumnIds?: readonly CreateSourceColumnId[];
}>;

export type CompressRowContextMenuInput = Readonly<{
  translator: Translator;
  rowPath: string;
  folderPath?: string;
  sourcePath: string;
  contextRowCount: number;
  removableSourceCount: number;
  canInclude: boolean;
  canExclude: boolean;
  hasSources: boolean;
}>;

export type SourceContextMenuInput = Readonly<{
  translator: Translator;
  sourcePath: string;
}>;

export function buildStartupContextMenuItems(input: StartupContextMenuInput): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    actionItem(input.translator.t("browse.emptyOpenAction"), { action: "open-archive" }),
  ];

  if (input.canPastePath) {
    items.push(actionItem(input.translator.t("command.pastePath"), { action: "paste-archive-path" }));
  }

  const recentArchives = input.recentArchiveHistory.slice(0, input.recentLimit ?? 4);
  if (recentArchives.length > 0) {
    items.push(
      separatorItem(),
      captionItem(input.translator.t("command.openRecent")),
      ...recentArchives.map((archivePath) =>
        actionItem(middleTruncateMenuLabel(archivePath, 46), {
          action: "open-recent-archive",
          archivePath,
        }),
      ),
    );
  }

  return items;
}

export function buildAddSourcesContextMenuItems(translator: Translator): ContextMenuItem[] {
  return [
    actionItem(translator.t("command.filesWithEllipsis"), { action: "add-source-files" }),
    actionItem(translator.t("command.folderWithEllipsis"), { action: "add-source-folder" }),
  ];
}

export function buildArchiveFolderContextMenuItems(input: ArchiveFolderContextMenuInput): ContextMenuItem[] {
  if (input.selectedCount > 1) {
    return [
      actionItem(input.translator.t("extract.selectedAction"), entryPayload("extract", input.entryPath)),
      actionItem(input.translator.t("command.extractHere"), entryPayload("extract-here", input.entryPath)),
      actionItem(input.translator.t("command.test"), entryPayload("test", input.entryPath), {
        disabled: !input.hasArchive,
      }),
      actionItem(input.translator.t("command.properties"), entryPayload("info", input.entryPath)),
    ];
  }

  const items: ContextMenuItem[] = [
    actionItem(input.translator.t("command.openFolder"), {
      action: "open-folder",
      folderPath: input.folderPath,
      entryPath: input.entryPath,
    }),
  ];

  items.push(
    actionItem(input.translator.t("command.extractWithEllipsis"), entryPayload("extract", input.entryPath)),
    actionItem(input.translator.t("command.extractHere"), entryPayload("extract-here", input.entryPath)),
    actionItem(input.translator.t("command.test"), entryPayload("test", input.entryPath), {
      disabled: !input.hasArchive,
    }),
    actionItem(input.translator.t("command.properties"), entryPayload("info", input.entryPath)),
  );

  return items;
}

export function buildArchiveEntryContextMenuItems(input: ArchiveEntryContextMenuInput): ContextMenuItem[] {
  const hasSingleSelection = input.selectedCount === 1;
  const entryScoped = (action: ContextMenuAction): ContextMenuActionPayload =>
    entryPayload(action, input.entryPath);
  const selectedItems = hasSingleSelection
    ? singleArchiveEntryContextMenuItems(input, entryScoped)
    : multiArchiveEntryContextMenuItems(input, entryScoped);

  return [
    ...selectedItems,
    separatorItem(),
    actionItem(input.translator.t("command.selectByType"), entryScoped("select-by-type")),
    actionItem(input.translator.t("command.deselectByType"), entryScoped("deselect-by-type"), {
      disabled: input.selectedEntryCount === 0,
    }),
  ];
}

export function buildArchiveHeaderContextMenuItems(input: ArchiveHeaderContextMenuInput): ContextMenuItem[] {
  const familyRes = input.archivePath
    ? resolveArchiveFormatFamily(input.archivePath)
    : { kind: "unknown" as const };
  const availableColumns = familyRes.kind === "known"
    ? getExtractAvailableColumns(familyRes.family)
    : getUnknownExtractAvailableColumns();
  const availableSet = new Set(availableColumns);
  const selectedColumn =
    input.selectedColumnId && availableSet.has(input.selectedColumnId)
      ? ARCHIVE_TABLE_COLUMNS.find((column) => column.id === input.selectedColumnId)
      : undefined;
  const normalizedSettings = normalizeColumnSettings(input.tableColumnSettings);
  const visibleColumnOrder = normalizedSettings.columnOrderIds.filter((id) =>
    normalizedSettings.visibleColumnIds.includes(id),
  );
  const selectedColumnIndex = selectedColumn && input.selectedColumnId
    ? visibleColumnOrder.indexOf(input.selectedColumnId)
    : -1;
  const items: ContextMenuItem[] = [];

  if (selectedColumn) {
    items.push(
      captionItem(input.translator.t("detail.columnCaption", {
        label: archiveTableColumnLabel(selectedColumn, input.translator),
      })),
      actionItem(input.translator.t("command.sortAscending"), {
        action: "sort-ascending",
        columnId: selectedColumn.id,
      }),
      actionItem(input.translator.t("command.sortDescending"), {
        action: "sort-descending",
        columnId: selectedColumn.id,
      }),
      separatorItem(),
    );
  }

  items.push(
    actionItem(input.translator.t("command.resetColumns"), { action: "reset-columns" }),
    separatorItem(),
    captionItem(input.translator.t("command.chooseColumns")),
    ...ARCHIVE_TABLE_COLUMNS
      .filter((column) => availableSet.has(column.id))
      .map((column) => {
        const isNameColumn = column.id === "name";
        const def = getColumnDefinition(column.id);
        const title = def?.tooltipKey ? input.translator.t(def.tooltipKey) : undefined;
        return checkboxItem(archiveTableColumnLabel(column, input.translator), {
          action: "toggle-column",
          columnId: column.id,
        }, {
          checked: isNameColumn || normalizedSettings.visibleColumnIds.includes(column.id),
          disabled: isNameColumn,
          title,
        });
      }),
  );

  return items;
}

export function buildCreateHeaderContextMenuItems(input: CreateHeaderContextMenuInput): ContextMenuItem[] {
  const normalizedSettings = normalizeCreateColumnSettings(input.tableColumnSettings);
  const availableSet = input.availableColumnIds
    ? new Set(input.availableColumnIds)
    : new Set(CREATE_SOURCE_TABLE_COLUMNS.map((c) => c.id));

  const selectedColumn = CREATE_SOURCE_TABLE_COLUMNS.find(
    (column) => column.id === input.selectedColumnId && availableSet.has(column.id),
  );
  const items: ContextMenuItem[] = [];

  if (selectedColumn) {
    items.push(
      captionItem(input.translator.t("detail.columnCaption", {
        label: createTableColumnLabel(selectedColumn, input.translator),
      })),
      separatorItem(),
    );
  }

  items.push(
    actionItem(input.translator.t("command.resetColumns"), { action: "reset-columns" }),
    separatorItem(),
    captionItem(input.translator.t("command.chooseColumns")),
    ...CREATE_SOURCE_TABLE_COLUMNS
      .filter((column) => availableSet.has(column.id))
      .map((column) => {
        const isNameColumn = column.id === "name";
        const def = getColumnDefinition(column.id);
        const title = def?.tooltipKey ? input.translator.t(def.tooltipKey) : undefined;
        return checkboxItem(createTableColumnLabel(column, input.translator), {
          action: "toggle-column",
          columnId: column.id,
        }, {
          checked: isNameColumn || normalizedSettings.visibleColumnIds.includes(column.id),
          disabled: isNameColumn,
          title,
        });
      }),
  );

  return items;
}

export function buildCompressRowContextMenuItems(input: CompressRowContextMenuInput): ContextMenuItem[] {
  const includeLabel = input.contextRowCount > 1
    ? input.translator.t("command.includeSelectedInArchive", { count: input.contextRowCount })
    : input.translator.t("command.includeInArchive");
  const excludeLabel = input.contextRowCount > 1
    ? input.translator.t("command.excludeSelectedFromArchive", { count: input.contextRowCount })
    : input.translator.t("command.excludeFromArchive");
  const removeLabel = input.removableSourceCount > 1
    ? input.translator.t("command.removeSelectedSources", { count: input.removableSourceCount })
    : input.translator.t("command.removeSource");
  const items: ContextMenuItem[] = [
    actionItem(input.translator.t("command.openFolder"), optionalFolderPayload("compress-open-folder", input.folderPath), {
      disabled: input.folderPath === undefined,
    }),
    actionItem(input.translator.t("command.revealInFileManager"), optionalSourcePayload("reveal-source", input.sourcePath), {
      disabled: !input.sourcePath,
    }),
    separatorItem(),
    actionItem(includeLabel, {
      action: "include-compress-path",
      compressMenuPath: input.rowPath,
    }, {
      disabled: !input.canInclude,
    }),
    actionItem(excludeLabel, {
      action: "exclude-compress-path",
      compressMenuPath: input.rowPath,
    }, {
      disabled: !input.canExclude,
    }),
    separatorItem(),
  ];

  if (input.removableSourceCount > 0) {
    items.push(actionItem(removeLabel, optionalSourcePayload("remove-source", input.sourcePath)));
  }

  items.push(actionItem(input.translator.t("command.clearAllSources"), { action: "clear-sources" }, {
    disabled: !input.hasSources,
  }));

  return items;
}

export function buildSourceContextMenuItems(input: SourceContextMenuInput): ContextMenuItem[] {
  return [
    actionItem(input.translator.t("command.revealInFileManager"), {
      action: "reveal-source",
      sourcePath: input.sourcePath,
    }),
    actionItem(input.translator.t("command.removeSource"), {
      action: "remove-source",
      sourcePath: input.sourcePath,
    }),
    separatorItem(),
    actionItem(input.translator.t("command.clearAllSources"), { action: "clear-sources" }),
  ];
}

function singleArchiveEntryContextMenuItems(
  input: ArchiveEntryContextMenuInput,
  payload: (action: ContextMenuAction) => ContextMenuActionPayload,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    actionItem(input.translator.t(
      input.canOpenInside
        ? "command.openFolder"
        : input.canOpenNestedArchive
          ? "command.openInside"
          : "command.view",
    ), payload("open-entry")),
  ];

  if (input.canOpenOutside) {
    items.push(actionItem(input.translator.t("command.openOutside"), payload("open-outside")));
  }

  items.push(
    actionItem(input.translator.t("command.extractWithEllipsis"), payload("extract")),
    actionItem(input.translator.t("command.extractHere"), payload("extract-here")),
    actionItem(input.translator.t("command.test"), payload("test"), {
      disabled: !input.hasArchive,
    }),
    actionItem(input.translator.t("command.properties"), payload("info")),
  );

  return items;
}

function multiArchiveEntryContextMenuItems(
  input: ArchiveEntryContextMenuInput,
  payload: (action: ContextMenuAction) => ContextMenuActionPayload,
): ContextMenuItem[] {
  return [
    actionItem(input.translator.t("extract.selectedAction"), payload("extract")),
    actionItem(input.translator.t("command.extractHere"), payload("extract-here")),
    actionItem(input.translator.t("command.test"), payload("test"), {
      disabled: !input.hasArchive,
    }),
    actionItem(input.translator.t("command.properties"), payload("info")),
  ];
}

type ItemOptions = Readonly<{
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
}>;

type CheckboxOptions = ItemOptions & Readonly<{
  checked: boolean;
}>;

function actionItem(
  label: string,
  payload: ContextMenuActionPayload,
  options: ItemOptions = {},
): ContextMenuActionItem {
  return {
    type: "action",
    label,
    payload,
    ...optionalItemOptions(options),
  };
}

function checkboxItem(
  label: string,
  payload: ContextMenuActionPayload,
  options: CheckboxOptions,
): ContextMenuCheckboxItem {
  return {
    type: "checkbox",
    label,
    payload,
    checked: options.checked,
    ...optionalItemOptions(options),
  };
}

function captionItem(label: string): ContextMenuCaptionItem {
  return { type: "caption", label };
}

function separatorItem(): ContextMenuSeparatorItem {
  return { type: "separator" };
}

function entryPayload(action: ContextMenuAction, entryPath?: string): ContextMenuActionPayload {
  return entryPath ? { action, entryPath } : { action };
}

function optionalFolderPayload(action: ContextMenuAction, folderPath?: string): ContextMenuActionPayload {
  return folderPath === undefined ? { action } : { action, folderPath };
}

function optionalSourcePayload(action: ContextMenuAction, sourcePath: string): ContextMenuActionPayload {
  return sourcePath ? { action, sourcePath } : { action };
}

function optionalItemOptions(options: ItemOptions): ItemOptions {
  return {
    ...(options.disabled ? { disabled: true } : {}),
    ...(options.disabledReason ? { disabledReason: options.disabledReason } : {}),
    ...(options.title ? { title: options.title } : {}),
  };
}

function middleTruncateMenuLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.max(12, Math.ceil((maxLength - 3) * 0.52));
  const tailLength = Math.max(12, maxLength - headLength - 3);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}
