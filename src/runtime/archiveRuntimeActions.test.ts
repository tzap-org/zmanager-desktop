import { describe, expect, it, vi } from "vitest";

import {
  createArchiveRuntimeActions,
  type ArchiveRuntimeActionEffects,
} from "./archiveRuntimeActions";

describe("archive runtime actions", () => {
  it("routes archive navigation and row activation by row kind", () => {
    const effects = createEffects();
    const actions = createArchiveRuntimeActions(effects);

    actions.handleIntent({ type: "navigateToFolder", folderPath: "docs" });
    actions.handleIntent({ type: "activateRow", rowKind: "folder", path: "docs", x: 0, y: 0 } as never);
    actions.handleIntent({ type: "activateRow", rowKind: "entry", path: "docs/readme.txt" });

    expect(effects.navigateToFolder).toHaveBeenCalledWith("docs");
    expect(effects.navigateToFolder).toHaveBeenCalledWith("docs");
    expect(effects.runEntryDefaultAction).toHaveBeenCalledWith("docs/readme.txt");
  });

  it("keeps selection replacement and native drag reusable between Job starts", () => {
    const effects = createEffects();
    const actions = createArchiveRuntimeActions(effects);

    actions.handleIntent({
      type: "applySelection",
      selectedPaths: ["a.txt"],
      focusedPath: "a.txt",
      anchorPath: "a.txt",
    });
    actions.handleIntent({ type: "startNativeDrag", entryPath: "a.txt" });

    expect(effects.applySelection).toHaveBeenCalled();
    expect(effects.startNativeDrag).toHaveBeenCalledWith("a.txt");
  });

  it("routes context menu intents through typed menu callbacks", () => {
    const effects = createEffects();
    const actions = createArchiveRuntimeActions(effects);

    actions.handleIntent({ type: "showEmptyContextMenu", x: 1, y: 2 });
    actions.handleIntent({ type: "showColumnContextMenu", columnId: "name", x: 3, y: 4 });
    actions.handleIntent({ type: "showRowContextMenu", rowKind: "entry", path: "a.txt", x: 5, y: 6 });
    actions.handleIntent({ type: "showRowContextMenu", rowKind: "parent", path: "..", x: 7, y: 8 });

    expect(effects.showEmptyContextMenu).toHaveBeenCalledWith(1, 2);
    expect(effects.showColumnContextMenu).toHaveBeenCalledWith("name", 3, 4);
    expect(effects.showEntryContextMenu).toHaveBeenCalledWith("a.txt", 5, 6);
    expect(effects.showFolderContextMenu).toHaveBeenCalledWith("..", 7, 8);
  });

  it("routes direct extraction destination, options, and start intents", () => {
    const effects = createEffects();
    const actions = createArchiveRuntimeActions(effects);

    actions.handleIntent({ type: "setExtractDestination", destinationPath: "C:/output" });
    actions.handleIntent({ type: "setExtractOptions", patch: { overwrite: "rename" } });
    actions.handleIntent({ type: "browseExtractDestination" });
    actions.handleIntent({ type: "resetExtractDefaults" });
    actions.handleIntent({ type: "runExtract", mode: "archive", password: "secret" });

    expect(effects.setExtractDestination).toHaveBeenCalledWith("C:/output");
    expect(effects.setExtractOptions).toHaveBeenCalledWith({ overwrite: "rename" });
    expect(effects.browseExtractDestination).toHaveBeenCalled();
    expect(effects.resetExtractDefaults).toHaveBeenCalled();
    expect(effects.runExtract).toHaveBeenCalledWith("archive", "secret");
  });

  it("routes column width and reorder intents to their respective effects", () => {
    const effects = createEffects();
    const actions = createArchiveRuntimeActions(effects);

    actions.handleIntent({ type: "setColumnWidth", columnId: "size", width: 200, persist: true });
    actions.handleIntent({ type: "reorderColumn", sourceColumnId: "size", targetColumnId: "modified" });

    expect(effects.setColumnWidth).toHaveBeenCalledWith("size", 200, true);
    expect(effects.reorderColumn).toHaveBeenCalledWith("size", "modified");
  });

  it("marks a submitted search as immediate and a typed one as debounceable", () => {
    const effects = createEffects();
    const actions = createArchiveRuntimeActions(effects);

    actions.handleIntent({ type: "setSearchQuery", query: "rep" });
    actions.handleIntent({ type: "setSearchQuery", query: "report", immediate: true });

    expect(effects.setSearchQuery).toHaveBeenNthCalledWith(1, "rep", false);
    expect(effects.setSearchQuery).toHaveBeenNthCalledWith(2, "report", true);
  });
});

function createEffects(
  overrides: Partial<ArchiveRuntimeActionEffects> = {},
): ArchiveRuntimeActionEffects {
  return {
    navigateToFolder: vi.fn(),
    navigateBack: vi.fn(),
    navigateUp: vi.fn(),
    loadNextPage: vi.fn(),
    loadPreviousPage: vi.fn(),
    setSearchQuery: vi.fn(),
    clearSearch: vi.fn(),
    setFlatView: vi.fn(),
    setColumnWidth: vi.fn(),
    reorderColumn: vi.fn(),
    toggleTreeFolder: vi.fn(),
    sortByColumn: vi.fn(),
    selectAllVisible: vi.fn(),
    clearSelection: vi.fn(),
    selectRow: vi.fn(),
    setRowSelected: vi.fn(),
    applySelection: vi.fn(),
    runEntryDefaultAction: vi.fn(),
    startNativeDrag: vi.fn(),
    copyDetailsValue: vi.fn(),
    setExtractDestination: vi.fn(),
    browseExtractDestination: vi.fn(),
    setExtractOptions: vi.fn(),
    resetExtractDefaults: vi.fn(),
    setTzapVerificationOptions: vi.fn(),
    chooseTzapTrustedCAs: vi.fn(),
    removeTzapTrustedCA: vi.fn(),
    verifyTzapCertificate: vi.fn(),
    runExtract: vi.fn(),
    showEmptyContextMenu: vi.fn(),
    showColumnContextMenu: vi.fn(),
    showFolderContextMenu: vi.fn(),
    showEntryContextMenu: vi.fn(),
    runDetailsAction: vi.fn(),
    ...overrides,
  };
}
