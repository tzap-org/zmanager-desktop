import type { BrowseState } from "../api/types";
import type { MessageKey, Translator } from "./i18n/translator";

export const UNSUPPORTED_OPERATION_MESSAGE = "Operation is not supported.";
export const SINGLE_FILE_REQUIRED_MESSAGE = "You must select one file.";
export const SINGLE_FOLDER_REQUIRED_MESSAGE = "You must select one folder.";
export const NO_ARCHIVE_OPEN_MESSAGE = "Open an archive first.";
export const ARCHIVE_NOT_READY_MESSAGE = "Archive contents are not ready.";
export const NO_SELECTION_MESSAGE = "Select one or more entries first.";
export const NO_ENTRIES_MESSAGE = "No entries are available.";

import {
  COMMAND_DEFINITIONS,
  CLASSIC_MENU_GROUPS,
  CLASSIC_TOOLBAR_GROUPS,
  CLASSIC_TOOLBAR_ORDER,
  type GeneratedCommandId,
} from "../api/generated/applicationCommands.generated";

export type CommandId = GeneratedCommandId;

export {
  COMMAND_DEFINITIONS,
  CLASSIC_MENU_GROUPS,
  CLASSIC_TOOLBAR_GROUPS,
  CLASSIC_TOOLBAR_ORDER
};

export type CommandDefinition = {
  id: CommandId;
  label: string;
  labelKey?: MessageKey;
  shortcut?: string;
  tooltip?: string;
  unsupported?: boolean;
  mutation?: boolean;
};

export type MenuItem =
  | { kind: "command"; id: CommandId }
  | { kind: "separator" }
  | { kind: "submenu"; label: string; labelKey?: MessageKey; items: MenuItem[] };

export type MenuGroup = {
  label: "File" | "Edit" | "View" | "Favorites" | "Tools" | "Help";
  items: MenuItem[];
};

export type CommandBarGroupId = "compress" | "extract" | "table" | "settings" | "help";

export type CommandBarGroup = {
  id: CommandBarGroupId;
  label: string;
  items: CommandId[];
};



export type ToolbarWorkspaceMode = "compress" | "extract";

const TOOLBAR_GROUP_IDS_BY_MODE: Record<ToolbarWorkspaceMode, readonly CommandBarGroupId[]> = {
  compress: ["compress"],
  extract: ["extract", "table"],
};

export function toolbarGroupsForWorkspaceMode(mode: ToolbarWorkspaceMode): CommandBarGroup[] {
  const visibleGroupIds = TOOLBAR_GROUP_IDS_BY_MODE[mode];

  return CLASSIC_TOOLBAR_GROUPS.filter((group) => visibleGroupIds.includes(group.id));
}

export type CommandContext = {
  browseState: BrowseState;
  hasArchive: boolean;
  focusedRow: boolean;
  canNavigateUp?: boolean;
  canOpenInside?: boolean;
  canOpenNestedArchive?: boolean;
  selectedCount: number;
  visibleSelectableCount: number;
  mutableOperationsSupported: boolean;
};

export type CommandState = {
  enabled: boolean;
  reason?: string;
};

export type CommandStateMap = Record<CommandId, CommandState>;

export function commandTooltip(id: CommandId): string {
  const command = COMMAND_DEFINITIONS[id];
  return command.tooltip ?? (command.shortcut ? `${command.label} (${command.shortcut})` : command.label);
}

export function commandLabel(id: CommandId, i18n?: Translator): string {
  const command = COMMAND_DEFINITIONS[id];
  return command.labelKey && i18n ? i18n.t(command.labelKey) : command.label;
}

export function commandTooltipText(id: CommandId, i18n?: Translator): string {
  const command = COMMAND_DEFINITIONS[id];
  const label = commandLabel(id, i18n);
  return command.shortcut ? `${label} (${command.shortcut})` : label;
}

export function menuGroupLabel(label: MenuGroup["label"], i18n?: Translator): string {
  if (!i18n) {
    return label;
  }

  switch (label) {
    case "File":
      return i18n.t("commandMenu.file");
    case "Edit":
      return i18n.t("commandMenu.edit");
    case "View":
      return i18n.t("commandMenu.view");
    case "Favorites":
      return "Favorites";
    case "Tools":
      return i18n.t("commandMenu.tools");
    case "Help":
      return i18n.t("commandMenu.help");
  }
}

export function selectCommandState(context: CommandContext): CommandStateMap {
  const canOperateArchive = context.hasArchive;
  const canUseArchive =
    context.hasArchive &&
    context.browseState !== "loading" &&
    (context.browseState === "loaded" || context.browseState === "empty");
  const canListEntries = canUseArchive && context.browseState === "loaded";
  const hasSelection = context.selectedCount > 0;
  const hasOneSelection = context.selectedCount === 1;
  const hasFocusedOrSelected = context.focusedRow || hasSelection;
  const canNavigateUp = Boolean(context.canNavigateUp);
  const canOpenInside = Boolean(context.canOpenInside);
  const canOpenNestedArchive = Boolean(context.canOpenNestedArchive);
  const mutationsEnabled = context.mutableOperationsSupported;
  const archiveReason = context.hasArchive ? ARCHIVE_NOT_READY_MESSAGE : NO_ARCHIVE_OPEN_MESSAGE;

  const state = Object.fromEntries(
    (Object.keys(COMMAND_DEFINITIONS) as CommandId[]).map((id) => [id, { enabled: false }]),
  ) as CommandStateMap;

  const enable = (ids: CommandId[], enabled = true, reason?: string) => {
    for (const id of ids) {
      state[id] = { enabled, reason };
    }
  };

  enable(["open", "add", "options", "helpContents", "about", "standardToolbar", "showButtonText", "exit"]);
  enable(["closeArchive", "extract", "test", "properties", "info", "refresh"], canOperateArchive, archiveReason);
  enable(["copyTo", "flatView"], canUseArchive, archiveReason);
  enable(["copy"], hasSelection && canListEntries, hasSelection ? archiveReason : NO_SELECTION_MESSAGE);
  enable(["view", "openOutside"], hasOneSelection && canListEntries && (!canOpenInside || canOpenNestedArchive), hasOneSelection && (!canOpenInside || canOpenNestedArchive) ? archiveReason : SINGLE_FILE_REQUIRED_MESSAGE);
  enable(["openInside"], hasOneSelection && (canOpenInside || canOpenNestedArchive) && canListEntries, hasOneSelection ? SINGLE_FOLDER_REQUIRED_MESSAGE : SINGLE_FILE_REQUIRED_MESSAGE);
  enable(["selectAll"], canListEntries && context.visibleSelectableCount > 0, canListEntries ? NO_ENTRIES_MESSAGE : archiveReason);
  enable(["deselectAll"], hasSelection, NO_SELECTION_MESSAGE);
  enable(["invertSelection"], canListEntries && context.visibleSelectableCount > 0, canListEntries ? NO_ENTRIES_MESSAGE : archiveReason);
  enable(["selectByType", "deselectByType"], hasFocusedOrSelected && canListEntries, hasFocusedOrSelected ? archiveReason : NO_SELECTION_MESSAGE);
  enable(["detailsView", "sortName", "sortType", "sortDate", "sortSize"], canListEntries, archiveReason);
  enable(["openRoot"], canUseArchive, archiveReason);
  enable(["upOneLevel"], canUseArchive && canNavigateUp, canUseArchive ? "Already at the archive root." : archiveReason);
  enable(["deleteTempFiles"], true);

  const mutationIds: CommandId[] = ["edit", "rename", "moveTo", "delete", "comment", "createFolder", "move"];
  enable(mutationIds, mutationsEnabled && hasSelection, NO_SELECTION_MESSAGE);

  for (const id of Object.keys(COMMAND_DEFINITIONS) as CommandId[]) {
    if (COMMAND_DEFINITIONS[id].unsupported) {
      state[id] = { enabled: false, reason: UNSUPPORTED_OPERATION_MESSAGE };
    }
  }

  return state;
}
