import { describe, expect, it, vi } from "vitest";

import {
  createCreateRuntimeActions,
  type CreateRuntimeActionEffects,
} from "./createRuntimeActions";

describe("create runtime actions", () => {
  it("routes source and destination intents to create effects", () => {
    const effects = createEffects();
    const actions = createCreateRuntimeActions(effects);

    actions.handleIntent({ type: "showAddSourcesMenu", x: 10, y: 20 });
    actions.handleIntent({ type: "removeSources", sourcePaths: ["a", "b"] });
    actions.handleIntent({ type: "setDestinationPath", destinationPath: "out.zip" });

    expect(effects.showAddSourcesMenu).toHaveBeenCalledWith(10, 20);
    expect(effects.removeSources).toHaveBeenCalledWith(["a", "b"]);
    expect(effects.setDestinationPath).toHaveBeenCalledWith("out.zip");
  });

  it("routes selection and inclusion intents without mutating payloads", () => {
    const effects = createEffects();
    const actions = createCreateRuntimeActions(effects);
    const selectedPaths = Object.freeze(["a.txt"]);

    actions.handleIntent({
      type: "applySelection",
      selectedPaths,
      focusedPath: "a.txt",
      anchorPath: "a.txt",
    });
    actions.handleIntent({ type: "setPathIncluded", path: "a.txt", included: false });
    actions.handleIntent({ type: "setVisibleRowsIncluded", included: false });

    expect(effects.applySelection).toHaveBeenCalledWith({
      type: "applySelection",
      selectedPaths,
      focusedPath: "a.txt",
      anchorPath: "a.txt",
    });
    expect(effects.setPathIncluded).toHaveBeenCalledWith("a.txt", false);
    expect(effects.setVisibleRowsIncluded).toHaveBeenCalledWith(false);
  });

  it("fire-and-forgets create submission with password inputs", () => {
    const effects = createEffects();
    const actions = createCreateRuntimeActions(effects);

    actions.handleIntent({ type: "runCreate", password: "one", passwordConfirm: "two", signingIdentityPassword: "identity" });

    expect(effects.runCreate).toHaveBeenCalledWith("one", "two", "identity");
  });

  it("routes compressAndShareOnLan to its effect", () => {
    const effects = createEffects();
    const actions = createCreateRuntimeActions(effects);

    actions.handleIntent({ type: "compressAndShareOnLan", password: "archive", passwordConfirm: "archive", signingIdentityPassword: "identity" });

    expect(effects.compressAndShareOnLan).toHaveBeenCalledExactlyOnceWith("archive", "archive", "identity");
  });

  it("routes column context menu, width, and reorder intents to their effects", () => {
    const effects = createEffects();
    const actions = createCreateRuntimeActions(effects);

    actions.handleIntent({ type: "showColumnContextMenu", columnId: "size", x: 10, y: 20 });
    actions.handleIntent({ type: "setColumnWidth", columnId: "modified", width: 180 });
    actions.handleIntent({ type: "reorderColumn", sourceColumnId: "kind", targetColumnId: "size" });

    expect(effects.showColumnContextMenu).toHaveBeenCalledWith("size", 10, 20);
    expect(effects.setColumnWidth).toHaveBeenCalledWith("modified", 180);
    expect(effects.reorderColumn).toHaveBeenCalledWith("kind", "size");
  });
});

function createEffects(
  overrides: Partial<CreateRuntimeActionEffects> = {},
): CreateRuntimeActionEffects {
  return {
    showWorkspace: vi.fn(),
    showAddSourcesMenu: vi.fn(),
    clearSources: vi.fn(),
    removeSources: vi.fn(),
    showSourceContextMenu: vi.fn(),
    setDestinationPath: vi.fn(),
    browseDestination: vi.fn(),
    changeFormat: vi.fn(),
    setOptions: vi.fn(),
    chooseTzapCertificate: vi.fn(),
    validateTzapSigningIdentity: vi.fn(),
    navigateToFolder: vi.fn(),
    setSearchQuery: vi.fn(),
    clearSearch: vi.fn(),
    toggleTreeFolder: vi.fn(),
    setPathIncluded: vi.fn(),
    setCurrentFolderIncluded: vi.fn(),
    setVisibleRowsIncluded: vi.fn(),
    selectRow: vi.fn(),
    applySelection: vi.fn(),
    toggleRowSelection: vi.fn(),
    focusRow: vi.fn(),
    removeSelectedSources: vi.fn(),
    showCompressRowContextMenu: vi.fn(),
    showColumnContextMenu: vi.fn(),
    setColumnWidth: vi.fn(),
    reorderColumn: vi.fn(),
    runCreate: vi.fn(),
    compressAndShareOnLan: vi.fn(),
    ...overrides,
  };
}
