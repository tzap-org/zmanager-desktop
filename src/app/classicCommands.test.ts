import { describe, expect, it } from "vitest";

import {
  ARCHIVE_NOT_READY_MESSAGE,
  CLASSIC_MENU_GROUPS,
  CLASSIC_TOOLBAR_GROUPS,
  CLASSIC_TOOLBAR_ORDER,
  COMMAND_DEFINITIONS,
  NO_ARCHIVE_OPEN_MESSAGE,
  NO_ENTRIES_MESSAGE,
  NO_SELECTION_MESSAGE,
  SINGLE_FILE_REQUIRED_MESSAGE,
  SINGLE_FOLDER_REQUIRED_MESSAGE,
  commandLabel,
  commandTooltipText,
  type CommandId,
  type MenuItem,
  UNSUPPORTED_OPERATION_MESSAGE,
  selectCommandState,
  toolbarGroupsForWorkspaceMode,
} from "./classicCommands";
import { createTranslatorFromCatalog } from "./i18n/translator";
import { zhCnMessages } from "./i18n/messages.zh-CN";

function collectMenuCommandIds(items: readonly MenuItem[]): CommandId[] {
  return items.flatMap((item) => {
    if (item.kind === "command") {
      return [item.id];
    }
    if (item.kind === "submenu") {
      return collectMenuCommandIds(item.items);
    }
    return [];
  });
}

describe("classic command definitions", () => {
  it("keeps the required top-level menu groups visible", () => {
    expect(CLASSIC_MENU_GROUPS.map((group) => group.label)).toEqual([
      "File",
      "Edit",
      "View",
      "Tools",
      "Help",
    ]);
  });

  it("does not expose unsupported commands in the menu bar", () => {
    const visibleMenuCommandIds = CLASSIC_MENU_GROUPS.flatMap((group) => collectMenuCommandIds(group.items));

    for (const id of visibleMenuCommandIds) {
      expect(COMMAND_DEFINITIONS[id].unsupported).not.toBe(true);
    }
  });

  it("keeps redundant navigation commands out of the View menu", () => {
    const viewMenu = CLASSIC_MENU_GROUPS.find((group) => group.label === "View");
    expect(viewMenu).toBeDefined();

    const viewMenuCommandIds = collectMenuCommandIds(viewMenu?.items ?? []);
    expect(viewMenuCommandIds).toEqual([
      "sortName",
      "sortType",
      "sortDate",
      "sortSize",
      "flatView",
      "showButtonText",
    ]);
  });

  it("keeps the classic toolbar command order", () => {
    expect(CLASSIC_TOOLBAR_GROUPS.map((group) => group.id)).toEqual([
      "compress",
      "extract",
      "table",
      "settings",
      "help",
    ]);
    expect(CLASSIC_TOOLBAR_ORDER.map((id) => COMMAND_DEFINITIONS[id].label)).toEqual([
      "Add",
      "Open...",
      "Close Archive",
      "Extract",
      "Test",
      "View",
      "Copy",
      "Info",
      "Refresh",
      "Select All",
      "Flat View",
      "Options...",
      "Delete Temporary Files...",
      "Contents...",
      "About ZManager...",
    ]);
  });

  it("selects mode-relevant toolbar command groups", () => {
    expect(toolbarGroupsForWorkspaceMode("compress").map((group) => group.id)).toEqual([
      "compress",
    ]);
    expect(toolbarGroupsForWorkspaceMode("compress").flatMap((group) => group.items)).toEqual([
      "add",
    ]);

    expect(toolbarGroupsForWorkspaceMode("extract").map((group) => group.id)).toEqual([
      "extract",
      "table",
    ]);
    expect(toolbarGroupsForWorkspaceMode("extract").flatMap((group) => group.items)).toEqual([
      "open",
      "closeArchive",
      "extract",
      "test",
      "view",
      "copy",
      "info",
      "refresh",
      "selectAll",
      "flatView",
    ]);
  });

  it("localizes labels and composes tooltips with stable shortcuts", () => {
    const zhCn = createTranslatorFromCatalog("zh-CN", zhCnMessages);

    expect(commandLabel("open", zhCn)).toBe("打开...");
    expect(commandTooltipText("open", zhCn)).toBe("打开... (Ctrl+O)");
    expect(COMMAND_DEFINITIONS.open.shortcut).toBe("Ctrl+O");
  });
});

describe("command state selector", () => {
  const baseContext = {
    browseState: "idle" as const,
    hasArchive: false,
    focusedRow: false,
    selectedCount: 0,
    visibleSelectableCount: 0,
    mutableOperationsSupported: false,
  };

  it("enables open and add-source commands before an archive is open", () => {
    const state = selectCommandState(baseContext);

    expect(state.open.enabled).toBe(true);
    expect(state.add.enabled).toBe(true);
    expect(state.extract.enabled).toBe(false);
    expect(state.extract.reason).toBe(NO_ARCHIVE_OPEN_MESSAGE);
    expect(state.test.enabled).toBe(false);
    expect(state.test.reason).toBe(NO_ARCHIVE_OPEN_MESSAGE);
    expect(state.info.enabled).toBe(false);
    expect(state.info.reason).toBe(NO_ARCHIVE_OPEN_MESSAGE);
    expect(state.selectAll.reason).toBe(NO_ARCHIVE_OPEN_MESSAGE);
  });

  it("enables archive-level commands after a listing is available", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      visibleSelectableCount: 2,
    });

    expect(state.test.enabled).toBe(true);
    expect(state.info.enabled).toBe(true);
    expect(state.properties.enabled).toBe(true);
    expect(state.selectAll.enabled).toBe(true);
    expect(state.upOneLevel.enabled).toBe(false);
    expect(state.upOneLevel.reason).toBe("Already at the archive root.");
    expect(state.view.enabled).toBe(false);
    expect(state.view.reason).toBe(SINGLE_FILE_REQUIRED_MESSAGE);
  });

  it("enables row commands for a single selected entry and keeps mutations disabled", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      focusedRow: true,
      selectedCount: 1,
      visibleSelectableCount: 3,
    });

    expect(state.view.enabled).toBe(true);
    expect(state.copy.enabled).toBe(true);
    expect(state.openInside.enabled).toBe(false);
    expect(state.openInside.reason).toBe(SINGLE_FOLDER_REQUIRED_MESSAGE);
    expect(state.delete.enabled).toBe(false);
    expect(state.rename.enabled).toBe(false);
  });

  it("enables selection actions and disables single-file actions for multiple selected entries", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      focusedRow: true,
      selectedCount: 2,
      visibleSelectableCount: 4,
    });

    expect(state.copy.enabled).toBe(true);
    expect(state.deselectAll.enabled).toBe(true);
    expect(state.selectByType.enabled).toBe(true);
    expect(state.view.enabled).toBe(false);
    expect(state.view.reason).toBe(SINGLE_FILE_REQUIRED_MESSAGE);
    expect(state.openOutside.enabled).toBe(false);
    expect(state.openOutside.reason).toBe(SINGLE_FILE_REQUIRED_MESSAGE);
  });

  it("keeps whole-archive operations available while loading and row operations bounded", () => {
    const loadingState = selectCommandState({
      ...baseContext,
      browseState: "loading",
      hasArchive: true,
    });
    const emptyLoadedState = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      visibleSelectableCount: 0,
    });

    expect(loadingState.extract.enabled).toBe(true);
    expect(loadingState.test.enabled).toBe(true);
    expect(emptyLoadedState.selectAll.enabled).toBe(false);
    expect(emptyLoadedState.selectAll.reason).toBe(NO_ENTRIES_MESSAGE);
    expect(emptyLoadedState.copy.enabled).toBe(false);
    expect(emptyLoadedState.copy.reason).toBe(NO_SELECTION_MESSAGE);
  });

  it("keeps job-starting commands available for reusable manager workflows", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      selectedCount: 1,
      visibleSelectableCount: 3,
    });

    expect(state.info.enabled).toBe(true);
    expect(state.open.enabled).toBe(true);
    expect(state.closeArchive.enabled).toBe(true);
    expect(state.add.enabled).toBe(true);
    expect(state.extract.enabled).toBe(true);
    expect(state.test.enabled).toBe(true);
    expect(state.refresh.enabled).toBe(true);
  });

  it("enables navigation commands only when their target exists", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      focusedRow: true,
      selectedCount: 1,
      visibleSelectableCount: 3,
      canNavigateUp: true,
      canOpenInside: true,
    });

    expect(state.upOneLevel.enabled).toBe(true);
    expect(state.openInside.enabled).toBe(true);
  });

  it("enables View and Open in Archive for a selected nested archive file", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      focusedRow: true,
      selectedCount: 1,
      visibleSelectableCount: 3,
      canOpenInside: false,
      canOpenNestedArchive: true,
    });

    expect(state.view.enabled).toBe(true);
    expect(state.openOutside.enabled).toBe(true);
    expect(state.openInside.enabled).toBe(true);
  });

  it("covers representative create, browse, job, menu, details, and row-action commands", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      focusedRow: true,
      selectedCount: 1,
      visibleSelectableCount: 3,
      canOpenInside: true,
    });

    expect(state.add.enabled).toBe(true);
    expect(state.extract.enabled).toBe(true);
    expect(state.test.enabled).toBe(true);
    expect(state.options.enabled).toBe(true);
    expect(state.properties.enabled).toBe(true);
    expect(state.info.enabled).toBe(true);
    expect(state.view.enabled).toBe(false);
    expect(state.openInside.enabled).toBe(true);
  });

  it("disables unsupported commands with a shared message", () => {
    const state = selectCommandState({
      ...baseContext,
      browseState: "loaded",
      hasArchive: true,
      visibleSelectableCount: 3,
    });

    const unsupportedCommands = Object.entries(COMMAND_DEFINITIONS)
      .filter(([, definition]) => definition.unsupported)
      .map(([id]) => id as keyof typeof COMMAND_DEFINITIONS);

    for (const id of unsupportedCommands) {
      const cmdId = id as CommandId;
      expect(state[cmdId].enabled).toBe(false);
      expect(state[cmdId].reason).toBe(UNSUPPORTED_OPERATION_MESSAGE);
    }
  });
});
