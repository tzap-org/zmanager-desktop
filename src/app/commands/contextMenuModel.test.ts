import { describe, expect, it } from "vitest";

import { resetColumnSettings } from "../archiveTable";
import { resetCreateColumnSettings } from "../createTableColumns";
import { createTranslator } from "../i18n/translator";
import {
  buildArchiveEntryContextMenuItems,
  buildArchiveFolderContextMenuItems,
  buildArchiveHeaderContextMenuItems,
  buildAddSourcesContextMenuItems,
  buildCompressRowContextMenuItems,
  buildCreateHeaderContextMenuItems,
  buildSourceContextMenuItems,
  buildStartupContextMenuItems,
  CONTEXT_MENU_ACTIONS,
  type ContextMenuActionItem,
  type ContextMenuCheckboxItem,
  type ContextMenuItem,
} from "./contextMenuModel";

const translator = createTranslator("en");

describe("context menu model", () => {
  it("emits every declared context action from at least one visible menu", () => {
    const menus: ContextMenuItem[][] = [
      buildStartupContextMenuItems({ translator, canPastePath: true, recentArchiveHistory: ["C:/archives/demo.zip"] }),
      buildAddSourcesContextMenuItems(translator),
      buildArchiveFolderContextMenuItems({ translator, folderPath: "docs", entryPath: "docs", selectedCount: 1, hasArchive: true }),
      buildArchiveFolderContextMenuItems({ translator, folderPath: "", selectedCount: 1, hasArchive: true }),
      buildArchiveEntryContextMenuItems({ translator, entryPath: "docs/readme.txt", canOpenInside: false, canOpenOutside: true, selectedCount: 1, selectedEntryCount: 1, hasArchive: true }),
      buildArchiveHeaderContextMenuItems({ translator, tableColumnSettings: resetColumnSettings(), selectedColumnId: "size", archivePath: "archive.zip" }),
      buildCompressRowContextMenuItems({ translator, rowPath: "src/app", folderPath: "src", sourcePath: "C:/work/source", contextRowCount: 1, removableSourceCount: 1, canInclude: true, canExclude: true, hasSources: true }),
      buildSourceContextMenuItems({ translator, sourcePath: "C:/work/source" }),
    ];
    const emittedActions = new Set(menus.flatMap((items) => [
      ...actionItems(items),
      ...checkboxItems(items),
    ].map((item) => item.payload.action)));

    expect([...emittedActions].sort()).toEqual([...CONTEXT_MENU_ACTIONS].sort());
  });

  it("builds startup empty-menu typed actions for open, paste, and recent archives", () => {
    const items = buildStartupContextMenuItems({
      translator,
      canPastePath: true,
      recentArchiveHistory: [
        "C:/archives/demo.zip",
        "C:/archives/another.zip",
      ],
    });

    expect(actionItems(items).map((item) => item.payload)).toEqual([
      { action: "open-archive" },
      { action: "paste-archive-path" },
      { action: "open-recent-archive", archivePath: "C:/archives/demo.zip" },
      { action: "open-recent-archive", archivePath: "C:/archives/another.zip" },
    ]);
    expect(items.map((item) => item.type)).toEqual(["action", "action", "separator", "caption", "action", "action"]);
    expect(items).not.toContainEqual(expect.objectContaining({ html: expect.any(String) }));
  });

  it("builds archive folder and entry menus with the same command payloads", () => {
    const folderItems = buildArchiveFolderContextMenuItems({
      translator,
      folderPath: "docs",
      entryPath: "docs",
      selectedCount: 1,
      hasArchive: true,
    });
    const entryItems = buildArchiveEntryContextMenuItems({
      translator,
      entryPath: "docs/readme.txt",
      canOpenInside: false,
      canOpenOutside: true,
      selectedCount: 1,
      selectedEntryCount: 1,
      hasArchive: false,
    });

    expect(actionItems(folderItems).map((item) => item.payload)).toEqual([
      { action: "open-folder", folderPath: "docs", entryPath: "docs" },
      { action: "extract", entryPath: "docs" },
      { action: "extract-here", entryPath: "docs" },
      { action: "test", entryPath: "docs" },
      { action: "info", entryPath: "docs" },
    ]);
    expect(actionItems(entryItems).map((item) => item.payload)).toEqual([
      { action: "open-entry", entryPath: "docs/readme.txt" },
      { action: "open-outside", entryPath: "docs/readme.txt" },
      { action: "extract", entryPath: "docs/readme.txt" },
      { action: "extract-here", entryPath: "docs/readme.txt" },
      { action: "test", entryPath: "docs/readme.txt" },
      { action: "info", entryPath: "docs/readme.txt" },
      { action: "select-by-type", entryPath: "docs/readme.txt" },
      { action: "deselect-by-type", entryPath: "docs/readme.txt" },
    ]);
    expect(actionItems(entryItems)[0]?.label).toBe("View");
    expect(actionItems(entryItems).find((item) => item.payload.action === "test")?.disabled).toBe(true);
  });

  it("labels nested archive drill-in separately from opening outside", () => {
    const items = actionItems(buildArchiveEntryContextMenuItems({
      translator,
      entryPath: "docs/nested.jar",
      canOpenInside: false,
      canOpenNestedArchive: true,
      canOpenOutside: true,
      selectedCount: 1,
      selectedEntryCount: 1,
      hasArchive: true,
    }));

    expect(items[0]).toEqual(expect.objectContaining({
      label: "Open in Archive",
      payload: { action: "open-entry", entryPath: "docs/nested.jar" },
    }));
    expect(items[1]).toEqual(expect.objectContaining({
      label: "Open Outside",
      payload: { action: "open-outside", entryPath: "docs/nested.jar" },
    }));
  });

  it("does not advertise duplicate folder actions or selection-only archive testing", () => {
    const folderItems = actionItems(buildArchiveFolderContextMenuItems({
      translator,
      folderPath: "docs",
      entryPath: "docs",
      selectedCount: 1,
      hasArchive: true,
    }));
    const selectedItems = actionItems(buildArchiveEntryContextMenuItems({
      translator,
      entryPath: "docs/readme.txt",
      canOpenInside: false,
      canOpenOutside: false,
      selectedCount: 2,
      selectedEntryCount: 2,
      hasArchive: true,
    }));

    expect(folderItems.filter((item) => item.payload.action === "open-folder")).toHaveLength(1);
    expect(selectedItems.find((item) => item.payload.action === "test")?.label).toBe("Test");
  });

  it("builds archive header sort, visibility, and reset actions", () => {
    const items = buildArchiveHeaderContextMenuItems({
      translator,
      tableColumnSettings: resetColumnSettings(),
      selectedColumnId: "size",
      archivePath: "archive.zip",
    });
    const actions = actionItems(items);
    const checkboxes = checkboxItems(items);

    expect(items[0]).toEqual({ type: "caption", label: "Column: Size" });
    expect(actions.map((item) => item.payload)).toContainEqual({ action: "sort-ascending", columnId: "size" });
    expect(actions.map((item) => item.payload)).toContainEqual({ action: "sort-descending", columnId: "size" });
    expect(actions.map((item) => item.payload)).toContainEqual({ action: "reset-columns" });
    expect(checkboxes.find((item) => item.payload.columnId === "name")).toEqual(expect.objectContaining({
      checked: true,
      disabled: true,
      payload: { action: "toggle-column", columnId: "name" },
    }));
    expect(checkboxes.find((item) => item.payload.columnId === "kind")).toEqual(expect.objectContaining({
      checked: true,
      payload: { action: "toggle-column", columnId: "kind" },
    }));
  });

  it("builds create workspace header context menu with reset and column toggle actions", () => {
    const items = buildCreateHeaderContextMenuItems({
      translator,
      tableColumnSettings: resetCreateColumnSettings(),
      selectedColumnId: "size",
    });
    const actions = actionItems(items);
    const checkboxes = checkboxItems(items);

    expect(items[0]).toEqual({ type: "caption", label: "Column: Size" });
    expect(actions.map((item) => item.payload)).toContainEqual({ action: "reset-columns" });

    expect(checkboxes.find((item) => item.payload.columnId === "name")).toEqual(expect.objectContaining({
      checked: true,
      disabled: true,
    }));
    expect(checkboxes.find((item) => item.payload.columnId === "sourcePath")).toEqual(expect.objectContaining({
      checked: false,
      payload: { action: "toggle-column", columnId: "sourcePath" },
    }));
    // All compress-applicable columns appear in the header menu when unfiltered
    expect(checkboxes.map((item) => item.payload.columnId)).toContain("created");
    expect(checkboxes.map((item) => item.payload.columnId)).toContain("accessed");
    expect(checkboxes.find((item) => item.payload.columnId === "attributes")).toEqual(expect.objectContaining({
      payload: { action: "toggle-column", columnId: "attributes" },
      title: "Windows filesystem attributes. On macOS and Linux, these values will be empty.",
    }));
  });

  it("filters create header menu columns to the backend capability set", () => {
    const items = buildCreateHeaderContextMenuItems({
      translator,
      tableColumnSettings: resetCreateColumnSettings(),
      selectedColumnId: "size",
      availableColumnIds: ["name", "kind", "size", "modified", "sourcePath"],
    });
    const checkboxes = checkboxItems(items);
    const ids = checkboxes.map((item) => item.payload.columnId);

    expect(ids).toContain("name");
    expect(ids).toContain("size");
    expect(ids).toContain("sourcePath");
    // Not in the capability set — must be absent from the menu
    expect(ids).not.toContain("created");
    expect(ids).not.toContain("mode");
  });

  it("builds create row and source menus for reveal, include, exclude, remove, and clear actions", () => {
    const rowItems = buildCompressRowContextMenuItems({
      translator,
      rowPath: "src/app",
      folderPath: "src",
      sourcePath: "C:/work/source",
      contextRowCount: 2,
      removableSourceCount: 2,
      canInclude: true,
      canExclude: false,
      hasSources: true,
    });
    const sourceItems = buildSourceContextMenuItems({
      translator,
      sourcePath: "C:/work/source",
    });

    expect(actionItems(rowItems).map((item) => item.payload)).toEqual([
      { action: "compress-open-folder", folderPath: "src" },
      { action: "reveal-source", sourcePath: "C:/work/source" },
      { action: "include-compress-path", compressMenuPath: "src/app" },
      { action: "exclude-compress-path", compressMenuPath: "src/app" },
      { action: "remove-source", sourcePath: "C:/work/source" },
      { action: "clear-sources" },
    ]);
    expect(actionItems(rowItems).find((item) => item.payload.action === "include-compress-path")?.label).toBe("Include 2 Selected in Archive");
    expect(actionItems(rowItems).find((item) => item.payload.action === "exclude-compress-path")?.disabled).toBe(true);
    expect(actionItems(rowItems).find((item) => item.payload.action === "remove-source")?.label).toBe("Remove 2 Sources");
    expect(actionItems(sourceItems).map((item) => item.payload)).toEqual([
      { action: "reveal-source", sourcePath: "C:/work/source" },
      { action: "remove-source", sourcePath: "C:/work/source" },
      { action: "clear-sources" },
    ]);
  });

  it("keeps the in-app context menu free of macOS-only shell action identifiers", () => {
    // OS-level context menu actions (like compressAppleArchive) are generated
    // from the shell-actions manifest and handled by platform-specific packaging.
    // They must never leak into the in-app context menu action set.
    const macOsOnlyActions = ["compressAppleArchive", "AddToAar", "compress-aar"];
    for (const action of macOsOnlyActions) {
      expect(CONTEXT_MENU_ACTIONS as readonly string[]).not.toContain(action);
    }
  });
});

function actionItems(items: readonly ContextMenuItem[]): ContextMenuActionItem[] {
  return items.filter((item): item is ContextMenuActionItem => item.type === "action");
}

function checkboxItems(items: readonly ContextMenuItem[]): ContextMenuCheckboxItem[] {
  return items.filter((item): item is ContextMenuCheckboxItem => item.type === "checkbox");
}
