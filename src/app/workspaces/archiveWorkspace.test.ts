import { describe, expect, it } from "vitest";

import type { ArchiveEntryDto, CommandErrorDto } from "../../api/types";
import { selectCommandState } from "../classicCommands";
import {
  createArchiveWorkspace,
  type ArchiveWorkspace,
  type ArchiveWorkspaceRequestResult,
} from "./archiveWorkspace";

describe("archive workspace load state", () => {
  const entries: ArchiveEntryDto[] = [
    { path: "docs", kind: "directory" },
    { path: "docs/readme.txt", kind: "file", size: 12 },
    { path: "docs/guide.txt", kind: "file", size: 30 },
    { path: "docs/guides/intro.txt", kind: "file", size: 10 },
    { path: "src/main.rs", kind: "file", size: 20 },
  ];

  it("starts with an idle language-neutral load snapshot", () => {
    const workspace = createArchiveWorkspace();

    expect(workspace.getSnapshot()).toMatchObject({
      currentArchivePath: "",
      browseState: "idle",
      status: { key: "browse.statusIdle" },
      error: null,
      entries: [],
      entryCount: 0,
      totalSize: null,
      listingRevision: 0,
    });
  });

  it("resets only submitted archive-operation state after an accepted start", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 62,
    });
    workspace.navigateToFolder("docs");
    selectPaths(workspace, ["docs/readme.txt"]);
    workspace.requestPasswordRetry({
      operation: "extractSelection",
      error: commandError("password_required"),
    });

    const snapshot = workspace.resetAfterAcceptedOperation();

    expect(snapshot.currentArchivePath).toBe("C:/tmp/project.zip");
    expect(snapshot.entries).toEqual(entries);
    expect(snapshot.view.currentFolder).toBe("docs");
    expect(snapshot.view.selection.selectedPaths).toEqual([]);
    expect(snapshot.passwordRetry).toBeNull();
  });

  it("begins loading an archive without keeping password input in the snapshot", () => {
    const workspace = createArchiveWorkspace();

    const snapshot = workspace.beginLoading({
      archivePath: " C:/tmp/photos.zip ",
      password: "secret",
    } as Parameters<typeof workspace.beginLoading>[0] & { password: string });

    expect(snapshot.currentArchivePath).toBe("C:/tmp/photos.zip");
    expect(snapshot.browseState).toBe("loading");
    expect(snapshot.status).toEqual({ key: "browse.statusLoading" });
    expect(snapshot.entries).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });

  it("records loaded entries and listing metadata from a successful listing", () => {
    const workspace = createArchiveWorkspace();
    workspace.beginLoading({ archivePath: "C:/tmp/project.zip" });

    const snapshot = workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: 10,
      totalSize: 62,
    });

    expect(snapshot).toMatchObject({
      currentArchivePath: "C:/tmp/project.zip",
      browseState: "loaded",
      status: { key: "browse.loadedEntries", values: { count: entries.length } },
      entryCount: 10,
      totalSize: 62,
      listingRevision: 1,
    });
    expect(snapshot.entries).toEqual(entries);
  });

  it("falls back to entry length and null total size for incomplete metadata", () => {
    const workspace = createArchiveWorkspace();

    const snapshot = workspace.loadSucceeded({
      archivePath: "C:/tmp/empty.zip",
      entries: [],
      entryCount: Number.NaN,
    });

    expect(snapshot.browseState).toBe("empty");
    expect(snapshot.status).toEqual({ key: "browse.validEmpty" });
    expect(snapshot.entryCount).toBe(0);
    expect(snapshot.totalSize).toBeNull();
  });

  it("keeps refresh listing metadata while a preserved load is in progress", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 62,
    });

    const snapshot = workspace.beginLoading({
      archivePath: "C:/tmp/project.zip",
      preserveListing: true,
    });

    expect(snapshot.browseState).toBe("loading");
    expect(snapshot.entries).toEqual(entries);
    expect(snapshot.entryCount).toBe(entries.length);
    expect(snapshot.totalSize).toBe(62);
  });

  it("stores command error payloads without translating them into workflow state", () => {
    const workspace = createArchiveWorkspace();
    const error: CommandErrorDto = {
      code: "password_required",
      message: "Password required",
      hint: "Try again",
      severity: "warning",
      retryable: true,
    };

    const snapshot = workspace.loadFailed(error);

    expect(snapshot.browseState).toBe("error");
    expect(snapshot.status).toEqual({
      key: "browse.failedList",
      fallbackText: "Password required\nTry again",
    });
    expect(snapshot.error).toEqual(error);
  });

  it("keeps unknown load failures language-neutral", () => {
    const workspace = createArchiveWorkspace();

    const snapshot = workspace.loadFailed({ kind: "unknown" });

    expect(snapshot.browseState).toBe("error");
    expect(snapshot.status).toEqual({ key: "browse.failedList" });
    expect(snapshot.error).toEqual({
      code: "unknown",
      messageKey: "browse.failedList",
      severity: "error",
      retryable: false,
    });
  });

  it("preserves current view inputs only when they are valid for the new listing", () => {
    const workspace = createArchiveWorkspace();

    const snapshot = workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 62,
    }, {
      preserveState: {
        currentFolder: "docs",
        navigationHistory: ["old", "docs"],
        searchQuery: "readme",
        flatView: false,
        expandedTreeFolders: ["src"],
        selectedPaths: ["docs/readme.txt", "missing.txt"],
        focusedPath: "docs/readme.txt",
        showParentFolderItem: true,
      },
    });

    expect(snapshot.view).toMatchObject({
      currentFolder: "docs",
      navigationHistory: ["old", "docs"],
      searchQuery: "readme",
      flatView: false,
      selection: {
        selectedPaths: ["docs/readme.txt"],
        focusedPath: "docs/readme.txt",
        anchorPath: "docs/readme.txt",
      },
    });
    expect(snapshot.view.breadcrumbs.map((crumb) => crumb.path)).toEqual(["", "docs"]);
    expect(snapshot.view.expandedTreeFolders).toEqual(["", "src", "docs"]);
  });

  it("navigates through valid folders while clearing search and selection", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.setSearchQuery("readme");
    workspace.updateSelection({
      selectedPaths: new Set(["docs/readme.txt"]),
      focusedPath: "docs/readme.txt",
      anchorPath: "docs/readme.txt",
    });

    const snapshot = workspace.navigateToFolder("docs/guides");

    expect(snapshot.view.currentFolder).toBe("docs/guides");
    expect(snapshot.view.navigationHistory).toEqual([""]);
    expect(snapshot.view.searchQuery).toBe("");
    expect(snapshot.view.selection).toMatchObject({
      selectedPaths: [],
      focusedPath: "",
      anchorPath: "",
    });
    expect(snapshot.view.breadcrumbs.map((crumb) => crumb.path)).toEqual([
      "",
      "docs",
      "docs/guides",
    ]);
    expect(snapshot.view.expandedTreeFolders).toEqual(["", "docs/guides", "docs"]);
  });

  it("normalizes missing navigation targets back to the archive root", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.navigateToFolder("docs");

    const snapshot = workspace.navigateToFolder("missing");

    expect(snapshot.view.currentFolder).toBe("");
    expect(snapshot.view.navigationHistory).toEqual(["", "docs"]);
    expect(snapshot.view.breadcrumbs.map((crumb) => crumb.path)).toEqual([""]);
  });

  it("restores the previous folder on back without clearing the current search query", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.navigateToFolder("docs");
    workspace.navigateToFolder("docs/guides");
    workspace.setSearchQuery("intro");

    const snapshot = workspace.navigateBack();

    expect(snapshot.view.currentFolder).toBe("docs");
    expect(snapshot.view.navigationHistory).toEqual([""]);
    expect(snapshot.view.searchQuery).toBe("intro");
    expect(snapshot.view.selection).toMatchObject({
      selectedPaths: [],
      focusedPath: "",
      anchorPath: "",
    });
  });

  it("navigates up through the same folder navigation rules", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.navigateToFolder("docs/guides");
    workspace.setSearchQuery("intro");

    const snapshot = workspace.navigateUp();

    expect(snapshot.view.currentFolder).toBe("docs");
    expect(snapshot.view.navigationHistory).toEqual(["", "docs/guides"]);
    expect(snapshot.view.searchQuery).toBe("");
  });

  it("keeps search query and flat view state behind the snapshot", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.updateSelection({
      selectedPaths: new Set(["docs/readme.txt"]),
      focusedPath: "docs/readme.txt",
      anchorPath: "docs/readme.txt",
    });

    const searched = workspace.setSearchQuery(" readme ");
    const flattened = workspace.setFlatView(true);
    const cleared = workspace.clearSearch();

    expect(searched.view.searchQuery).toBe(" readme ");
    expect(flattened.view.flatView).toBe(true);
    expect(cleared.view.searchQuery).toBe("");
    expect(cleared.view.selection.selectedPaths).toEqual(["docs/readme.txt"]);
  });

  it("tracks expanded tree folders without exposing a mutable set", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const expanded = workspace.toggleTreeFolder("src");
    const collapsed = workspace.toggleTreeFolder("src");

    expect(expanded.view.expandedTreeFolders).toEqual(["", "src"]);
    expect(collapsed.view.expandedTreeFolders).toEqual([""]);
  });

  it("derives archive tree folders from workspace state", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    expect(workspace.getSnapshot().view.treeFolders.map((folder) => ({
      path: folder.path,
      name: folder.name,
      depth: folder.depth,
      hasChildren: folder.hasChildren,
      isExpanded: folder.isExpanded,
      isActive: folder.isActive,
      isRoot: folder.isRoot,
    }))).toEqual([
      { path: "", name: "", depth: 0, hasChildren: true, isExpanded: true, isActive: true, isRoot: true },
      { path: "docs", name: "docs", depth: 1, hasChildren: true, isExpanded: false, isActive: false, isRoot: false },
      { path: "src", name: "src", depth: 1, hasChildren: false, isExpanded: false, isActive: false, isRoot: false },
    ]);

    const expanded = workspace.toggleTreeFolder("docs");

    expect(expanded.view.treeFolders.map((folder) => `${folder.depth}:${folder.path}:${folder.isActive}`)).toEqual([
      "0::true",
      "1:docs:false",
      "2:docs/guides:false",
      "1:src:false",
    ]);

    const nested = workspace.navigateToFolder("docs/guides");

    expect(nested.view.treeFolders.map((folder) => `${folder.path}:${folder.isExpanded}:${folder.isActive}`)).toEqual([
      ":true:false",
      "docs:true:false",
      "docs/guides:true:true",
      "src:false:false",
    ]);
  });

  it("keeps the active tree branch expanded when toggling its ancestor", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.navigateToFolder("docs/guides");

    const snapshot = workspace.toggleTreeFolder("docs");

    expect(snapshot.view.currentFolder).toBe("docs/guides");
    expect(snapshot.view.expandedTreeFolders).toEqual(["", "docs/guides", "docs"]);
  });

  it("owns archive table sort state and row ordering", () => {
    const workspace = createArchiveWorkspace({
      flatView: true,
      sortKey: "name",
      sortAscending: true,
    });
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const sizeAscending = workspace.applySortCommand("size");
    const ascendingFileSizes = sizeAscending.view.rows
      .filter((row) => row.rowType === "entry")
      .map((row) => row.entry.size);

    expect(sizeAscending.view.sort).toEqual({ key: "size", ascending: true });
    expect(ascendingFileSizes).toEqual([10, 12, 20, 30]);

    const sizeDescending = workspace.applySortCommand("size");
    const descendingFileSizes = sizeDescending.view.rows
      .filter((row) => row.rowType === "entry")
      .map((row) => row.entry.size);

    expect(sizeDescending.view.sort).toEqual({ key: "size", ascending: false });
    expect(descendingFileSizes).toEqual([30, 20, 12, 10]);

    const nextKey = workspace.applySortCommand("modified");

    expect(nextKey.view.sort).toEqual({ key: "modified", ascending: true });
  });

  it("derives visible rows from folder, search, flat view, parent-row, and sort state", () => {
    const workspace = createArchiveWorkspace({
      showParentFolderItem: true,
      sortKey: "name",
      sortAscending: true,
    });
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const folderSnapshot = workspace.navigateToFolder("docs");

    expect(folderSnapshot.view.rows.map((row) => `${row.rowType}:${row.path}`)).toEqual([
      "parent:",
      "folder:docs/guides",
      "entry:docs/guide.txt",
      "entry:docs/readme.txt",
    ]);

    const searchSnapshot = workspace.setSearchQuery("main");

    expect(searchSnapshot.view.rows.map((row) => row.path)).toEqual(["src/main.rs"]);

    workspace.clearSearch();
    const flatSnapshot = workspace.setFlatView(true);

    expect(flatSnapshot.view.rows.map((row) => row.path)).toEqual([
      "docs",
      "docs/guide.txt",
      "docs/guides/intro.txt",
      "src/main.rs",
      "docs/readme.txt",
    ]);
  });

  it("reuses one snapshot per state so renders keep stable identities", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    // Repeated reads must be identity-stable, or `useMemo`/`memo` downstream
    // re-render the whole table on every unrelated publish.
    const first = workspace.getSnapshot();
    expect(workspace.getSnapshot()).toBe(first);
    expect(workspace.getSnapshot().view.rows).toBe(first.view.rows);

    // A mutator that changes nothing keeps the snapshot; a real change replaces it.
    expect(workspace.navigateToFolder("")).toBe(first);
    expect(workspace.navigateToFolder("docs")).not.toBe(first);
    expect(workspace.getSnapshot().view.currentFolder).toBe("docs");
  });

  it("exposes selection facts while preserving hidden search selections", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.navigateToFolder("docs");

    const selected = workspace.updateSelection({
      selectedPaths: new Set(["docs/readme.txt"]),
      focusedPath: "docs/readme.txt",
      anchorPath: "docs/readme.txt",
    });

    // A mutator returns the same snapshot a later `getSnapshot` observes;
    // snapshots are shared immutable values, not per-caller copies.
    expect(workspace.getSnapshot()).toBe(selected);
    expect(workspace.getSnapshot().view.selection.selectedEntries[0].path).toBe("docs/readme.txt");
    expect(workspace.getSnapshot().view.selection).toMatchObject({
      selectedPaths: ["docs/readme.txt"],
      selectedCount: 1,
      visibleSelectedPaths: ["docs/readme.txt"],
      visibleSelectedCount: 1,
      selectedEntryPaths: ["docs/readme.txt"],
      focusedPath: "docs/readme.txt",
      anchorPath: "docs/readme.txt",
      hiddenBySearch: false,
    });

    const hidden = workspace.setSearchQuery("nomatch");

    expect(hidden.view.selection).toMatchObject({
      selectedPaths: ["docs/readme.txt"],
      visibleSelectedPaths: [],
      visibleSelectedCount: 0,
      hiddenBySearch: true,
      firstSelectedEntryPath: "docs/readme.txt",
      firstSelectedEntryName: "readme.txt",
    });
  });

  it("builds language-neutral details models for archive and selection states", () => {
    const workspace = createArchiveWorkspace();

    expect(workspace.getSnapshot().view.details).toEqual({ kind: "noArchive" });

    const archiveSummary = workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: 42,
      totalSize: 72,
    }).view.details;

    expect(archiveSummary).toEqual({
      kind: "archiveSummary",
      archivePath: "C:/tmp/project.zip",
      entryCount: 42,
      currentFolder: "",
      unpackedSize: 72,
      packedSize: null,
    });

    const syntheticFolder = workspace.updateSelection({
      selectedPaths: new Set(["src"]),
      focusedPath: "src",
      anchorPath: "src",
    }).view.details;

    expect(syntheticFolder).toMatchObject({
      kind: "syntheticFolder",
      row: {
        rowType: "folder",
        path: "src",
        name: "src",
        isSynthetic: true,
      },
    });

    workspace.navigateToFolder("docs");

    const singleEntry = workspace.updateSelection({
      selectedPaths: new Set(["docs/readme.txt"]),
      focusedPath: "docs/readme.txt",
      anchorPath: "docs/readme.txt",
    }).view.details;

    expect(singleEntry).toMatchObject({
      kind: "entry",
      entry: {
        path: "docs/readme.txt",
        size: 12,
      },
    });

    const multipleSelection = workspace.updateSelection({
      selectedPaths: new Set(["docs/readme.txt", "docs/guide.txt"]),
      focusedPath: "docs/guide.txt",
      anchorPath: "docs/readme.txt",
    }).view.details;

    expect(multipleSelection).toMatchObject({
      kind: "multipleSelection",
      selectedCount: 2,
      selectedFiles: 2,
      selectedFolders: 0,
      totalSize: 42,
      packedSize: null,
      pathPreviewPaths: ["docs/guide.txt", "docs/readme.txt"],
    });

    const hiddenSelection = workspace.setSearchQuery("nomatch").view.details;

    expect(hiddenSelection).toEqual({
      kind: "hiddenSelection",
      selectedCount: 2,
      searchQuery: "nomatch",
      firstSelectedEntryPath: "docs/readme.txt",
      firstSelectedEntryName: "readme.txt",
    });
  });

  it("derives command context and readiness from archive workflow state", () => {
    const idleWorkspace = createArchiveWorkspace();

    expect(idleWorkspace.getSnapshot().command).toMatchObject({
      browseState: "idle",
      hasArchive: false,
      focusedRow: false,
      canNavigateUp: false,
      canOpenInside: false,
      selectedCount: 0,
      visibleSelectableCount: 0,
      canUseArchive: false,
      canListEntries: false,
      canSearchEntries: false,
      canNavigateBack: false,
    });

    const loadingWorkspace = createArchiveWorkspace();
    expect(loadingWorkspace.beginLoading({ archivePath: "C:/tmp/project.zip" }).command).toMatchObject({
      browseState: "loading",
      hasArchive: true,
      canUseArchive: true,
      canListEntries: false,
      canSearchEntries: false,
    });

    const rootWorkspace = createArchiveWorkspace();
    const loadedRoot = rootWorkspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    }).command;

    expect(loadedRoot).toMatchObject({
      browseState: "loaded",
      hasArchive: true,
      focusedRow: false,
      canNavigateUp: false,
      canOpenInside: false,
      selectedCount: 0,
      visibleSelectableCount: 2,
      canUseArchive: true,
      canListEntries: true,
      canSearchEntries: true,
      canNavigateBack: false,
    });

    const loadedNested = rootWorkspace.navigateToFolder("docs").command;

    expect(loadedNested).toMatchObject({
      canNavigateUp: true,
      visibleSelectableCount: 3,
      canNavigateBack: true,
    });

    const directoryWorkspace = createArchiveWorkspace();
    directoryWorkspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    const singleDirectory = selectPaths(directoryWorkspace, ["docs"]).command;

    expect(singleDirectory).toMatchObject({
      focusedRow: true,
      canOpenInside: true,
      selectedCount: 1,
    });

    const fileWorkspace = createArchiveWorkspace();
    fileWorkspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    fileWorkspace.navigateToFolder("docs");
    const singleFile = selectPaths(fileWorkspace, ["docs/readme.txt"]).command;

    expect(singleFile).toMatchObject({
      focusedRow: true,
      canOpenInside: false,
      selectedCount: 1,
      canNavigateUp: true,
    });

    const multipleSelection = selectPaths(fileWorkspace, [
      "docs/readme.txt",
      "docs/guide.txt",
    ]).command;

    expect(multipleSelection).toMatchObject({
      focusedRow: true,
      canOpenInside: false,
      selectedCount: 2,
    });

    const emptyArchive = createArchiveWorkspace().loadSucceeded({
      archivePath: "C:/tmp/empty.zip",
      entries: [],
      entryCount: 0,
      totalSize: 0,
    }).command;

    expect(emptyArchive).toMatchObject({
      browseState: "empty",
      hasArchive: true,
      canUseArchive: true,
      canListEntries: false,
      visibleSelectableCount: 0,
      canSearchEntries: false,
    });
  });

  it("feeds the classic command selector from the workspace command context", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const selectedDirectory = selectPaths(workspace, ["docs"]);
    const rootCommandState = selectCommandState({
      ...selectedDirectory.command,
      mutableOperationsSupported: false,
    });

    expect(rootCommandState.openInside.enabled).toBe(true);
    expect(rootCommandState.selectAll.enabled).toBe(true);
    expect(rootCommandState.upOneLevel.enabled).toBe(false);

    const nested = workspace.navigateToFolder("docs");
    const nestedCommandState = selectCommandState({
      ...nested.command,
      mutableOperationsSupported: false,
    });

    expect(nestedCommandState.upOneLevel.enabled).toBe(true);
  });

  it("keeps command context aligned with non-listing browse state transitions", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const failed = workspace.setBrowseState("error");
    const failedCommandState = selectCommandState({
      ...failed.command,
      mutableOperationsSupported: false,
    });

    expect(failed.command).toMatchObject({
      browseState: "error",
      hasArchive: true,
      canUseArchive: true,
      canListEntries: false,
      canSearchEntries: false,
    });
    expect(failedCommandState.extract.enabled).toBe(true);
    expect(failedCommandState.refresh.enabled).toBe(true);

    const recovered = workspace.setBrowseState("loaded");
    const recoveredCommandState = selectCommandState({
      ...recovered.command,
      mutableOperationsSupported: false,
    });

    expect(recovered.command.canUseArchive).toBe(true);
    expect(recoveredCommandState.extract.enabled).toBe(true);
    expect(recoveredCommandState.refresh.enabled).toBe(true);
  });

  it("keeps an operation failure message visible in the browse status", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 62,
    });

    const snapshot = workspace.setBrowseState("error", "Unable to preview entry.");

    expect(snapshot.status).toEqual({
      key: "browse.failedList",
      fallbackText: "Unable to preview entry.",
    });
  });

  it("builds extract archive requests from workspace state", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const request = requestOf(workspace.buildExtractRequest({
      mode: "archive",
      destinationPath: "D:/out",
      overwrite: "rename",
      stripComponents: 2,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      password: "secret",
    }));

    expect(request).toEqual({
      archivePath: "C:/tmp/project.zip",
      destinationPath: "D:/out",
      overwrite: "rename",
      stripComponents: 2,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: true,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      password: "secret",
    });
    expect("entryPaths" in request).toBe(false);
    expect(workspace.getExtractReferencePaths("archive")).toEqual(entries.map((entry) => entry.path));
    expect(reasonOf(createArchiveWorkspace().buildExtractRequest({
      mode: "archive",
      destinationPath: "D:/out",
      overwrite: "rename",
      stripComponents: 0,
    }))).toBe("noArchive");
  });

  it("builds extract selection requests with folder expansion and empty-folder fallback", () => {
    const workspace = createArchiveWorkspace();
    const extractEntries: ArchiveEntryDto[] = [
      { path: "docs", kind: "directory" },
      { path: "docs/readme.txt", kind: "file", size: 12 },
      { path: "docs/guides/intro.txt", kind: "file", size: 10 },
      { path: "empty", kind: "directory" },
      { path: "generated/file.txt", kind: "file", size: 8 },
      { path: "loose.txt", kind: "file", size: 4 },
    ];
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries: extractEntries,
      entryCount: extractEntries.length,
      totalSize: 34,
    });
    selectPaths(workspace, ["docs", "empty", "generated", "loose.txt"]);

    const request = requestOf(workspace.buildExtractRequest({
      mode: "selection",
      destinationPath: "D:/out",
      overwrite: "replace",
      stripComponents: 1,
    }));

    expect(request.entryPaths).toEqual([
      "docs/readme.txt",
      "docs/guides/intro.txt",
      "empty",
      "generated/file.txt",
      "loose.txt",
    ]);
    expect(workspace.getSelectedExtractEntryPaths()).toEqual(request.entryPaths);
    expect(workspace.getExtractReferencePaths("selection")).toEqual(request.entryPaths);

    selectPaths(workspace, []);
    expect(reasonOf(workspace.buildExtractRequest({
      mode: "selection",
      destinationPath: "D:/out",
      overwrite: "replace",
      stripComponents: 1,
    }))).toBe("noSelectedEntries");
  });

  it("keeps archive-wide select-all across pages and records unchecked rows as exclusions", () => {
    const workspace = createArchiveWorkspace();
    const allEntries: ArchiveEntryDto[] = [
      { path: "page-1-a.txt", kind: "file", size: 1 },
      { path: "page-1-b.txt", kind: "file", size: 2 },
      { path: "page-2-a.txt", kind: "file", size: 3 },
      { path: "page-2-b.txt", kind: "file", size: 4 },
    ];

    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries: allEntries,
      entryCount: allEntries.length,
      totalSize: 10,
    });
    workspace.acceptPage({
      archivePath: "C:/tmp/project.zip",
      parentPath: "",
      entries: allEntries.slice(0, 2),
      entryCount: allEntries.length,
      pageNumber: 1,
      childCount: allEntries.length,
      hasNext: true,
    });

    workspace.selectAllEntries();
    workspace.setPathSelected("page-1-b.txt", false);
    workspace.acceptPage({
      archivePath: "C:/tmp/project.zip",
      parentPath: "",
      entries: allEntries.slice(2),
      entryCount: allEntries.length,
      pageNumber: 2,
      childCount: allEntries.length,
      hasPrevious: true,
    });

    const snapshot = workspace.getSnapshot();
    expect(snapshot.view.selection.allSelected).toBe(true);
    expect(snapshot.view.selection.excludedPaths).toEqual(["page-1-b.txt"]);
    expect(snapshot.view.selection.selectedCount).toBe(3);
    expect(snapshot.view.selection.visibleSelectedPaths).toEqual([
      "page-2-a.txt",
      "page-2-b.txt",
    ]);

    const extractRequest = requestOf(workspace.buildExtractRequest({
      mode: "selection",
      destinationPath: "D:/out",
      overwrite: "replace",
      stripComponents: 0,
    }));
    expect(extractRequest).toMatchObject({
      selectAll: true,
      excludedEntryPaths: ["page-1-b.txt"],
    });
    expect("entryPaths" in extractRequest).toBe(false);

    expect(workspace.buildNativeDragRequest({ entryPath: "page-2-a.txt" })).toMatchObject({
      ok: true,
      request: {
        selectAll: true,
        excludedEntryPaths: ["page-1-b.txt"],
      },
    });
  });

  it("builds test archive requests with selected extract paths when present", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const allEntriesRequest = requestOf(workspace.buildTestRequest({ password: "secret" }));

    expect(allEntriesRequest).toEqual({
      archivePath: "C:/tmp/project.zip",
      password: "secret",
    });

    selectPaths(workspace, ["docs"]);
    const selectedRequest = requestOf(workspace.buildTestRequest());

    expect(selectedRequest).toEqual({
      archivePath: "C:/tmp/project.zip",
      entryPaths: [
        "docs/readme.txt",
        "docs/guide.txt",
        "docs/guides/intro.txt",
      ],
    });
    expect(reasonOf(createArchiveWorkspace().buildTestRequest())).toBe("noArchive");
  });

  it("builds preview and open-outside requests only for a single selected file", () => {
    const emptyWorkspace = createArchiveWorkspace();

    expect(reasonOf(emptyWorkspace.buildPreviewRequest({
      overwrite: "replace",
      stripComponents: 0,
    }))).toBe("noArchive");

    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    expect(reasonOf(workspace.buildPreviewRequest({
      overwrite: "replace",
      stripComponents: 0,
    }))).toBe("singleFileRequired");

    selectPaths(workspace, ["docs/readme.txt", "src/main.rs"]);
    expect(reasonOf(workspace.buildPreviewRequest({
      overwrite: "replace",
      stripComponents: 0,
    }))).toBe("singleFileRequired");

    selectPaths(workspace, ["docs"]);
    expect(reasonOf(workspace.buildPreviewRequest({
      overwrite: "replace",
      stripComponents: 0,
    }))).toBe("directorySelected");

    selectPaths(workspace, ["docs/readme.txt"]);
    const request = requestOf(workspace.buildPreviewRequest({
      overwrite: "ask",
      stripComponents: 1,
      password: "secret",
    }));

    expect(request).toEqual({
      archivePath: "C:/tmp/project.zip",
      entryPath: "docs/readme.txt",
      overwrite: "ask",
      stripComponents: 1,
      password: "secret",
    });
  });

  it("builds native drag requests with a direct name for one dragged item", () => {
    const emptyWorkspace = createArchiveWorkspace();

    expect(reasonOf(emptyWorkspace.buildNativeDragRequest({ entryPath: "docs/readme.txt" }))).toBe("noArchive");

    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });

    const unselectedFile = requestOf(workspace.buildNativeDragRequest({ entryPath: "docs/readme.txt" }));

    expect(unselectedFile).toEqual({
      archivePath: "C:/tmp/project.zip",
      entryPaths: ["docs/readme.txt"],
      stripComponents: 1,
    });

    selectPaths(workspace, ["docs/readme.txt", "src/main.rs"]);
    const selectedRows = requestOf(workspace.buildNativeDragRequest({
      entryPath: "docs/readme.txt",
      password: "secret",
    }));

    expect(selectedRows).toEqual({
      archivePath: "C:/tmp/project.zip",
      entryPaths: ["docs/readme.txt", "src/main.rs"],
      stripComponents: 0,
      password: "secret",
    });

    const unselectedWhileOthersSelected = requestOf(workspace.buildNativeDragRequest({
      entryPath: "docs/guide.txt",
    }));

    expect(unselectedWhileOthersSelected.entryPaths).toEqual(["docs/guide.txt"]);

    workspace.navigateToFolder("docs");
    const syntheticFolder = requestOf(workspace.buildNativeDragRequest({ entryPath: "docs/guides" }));

    expect(syntheticFolder.entryPaths).toEqual(["docs/guides"]);
    expect(syntheticFolder.stripComponents).toBe(1);

    workspace.setFlatView(true);
    const flatRequest = requestOf(workspace.buildNativeDragRequest({ entryPath: "docs/guides/intro.txt" }));

    expect(flatRequest.stripComponents).toBe(2);

    workspace.setFlatView(false);
    workspace.setSearchQuery("intro");
    const searchRequest = requestOf(workspace.buildNativeDragRequest({ entryPath: "docs/guides/intro.txt" }));

    expect(searchRequest.stripComponents).toBe(2);
    expect(reasonOf(workspace.buildNativeDragRequest({ entryPath: "missing" }))).toBe("noEntryPaths");
  });

  it("preserves the archive tree when dragging an archive-wide select-all", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    workspace.navigateToFolder("docs/guides");
    workspace.selectAllEntries();

    expect(requestOf(workspace.buildNativeDragRequest({ entryPath: "docs/guides/intro.txt" }))).toEqual({
      archivePath: "C:/tmp/project.zip",
      entryPaths: [],
      selectAll: true,
      stripComponents: 0,
    });

    workspace.setPathSelected("docs", false);
    expect(requestOf(workspace.buildNativeDragRequest({ entryPath: "src/main.rs" }))).toEqual({
      archivePath: "C:/tmp/project.zip",
      entryPaths: [],
      selectAll: true,
      excludedEntryPaths: ["docs"],
      stripComponents: 0,
    });
  });

  it("copies password input into request output without storing it in snapshots", () => {
    const workspace = createArchiveWorkspace();
    const secret = "dont-store-this-password";
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    selectPaths(workspace, ["docs/readme.txt"]);

    const request = requestOf(workspace.buildPreviewRequest({
      overwrite: "replace",
      stripComponents: 0,
      password: secret,
    }));

    expect(request.password).toBe(secret);
    expect(JSON.stringify(workspace.getSnapshot())).not.toContain(secret);
  });

  it("resets back to idle state", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 62,
    });

    expect(workspace.reset()).toMatchObject({
      currentArchivePath: "",
      browseState: "idle",
      entries: [],
      entryCount: 0,
      totalSize: null,
      listingRevision: 0,
    });
  });

  it("creates password retry prompts for required and invalid password errors", () => {
    const workspace = createArchiveWorkspace();
    workspace.beginLoading({ archivePath: "C:/tmp/project.zip" });

    const requiredRetry = workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("password_required"),
    });

    expect(requiredRetry).toEqual({
      operation: "listArchive",
      archivePath: "C:/tmp/project.zip",
      commandCode: "password_required",
      promptKey: "browse.passwordRequired",
      attemptCount: 1,
    });
    expect(workspace.getSnapshot().passwordRetry).toEqual(requiredRetry);

    const invalidRetry = workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("invalid_password"),
    });

    expect(invalidRetry).toEqual({
      operation: "listArchive",
      archivePath: "C:/tmp/project.zip",
      commandCode: "invalid_password",
      promptKey: "browse.passwordInvalid",
      attemptCount: 2,
    });
  });

  it("replaces password retry attempts when the operation or archive changes", () => {
    const workspace = createArchiveWorkspace();
    workspace.beginLoading({ archivePath: "C:/tmp/project.zip" });
    workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("password_required"),
    });

    const operationReplacement = workspace.requestPasswordRetry({
      operation: "testArchive",
      error: commandError("invalid_password"),
    });

    expect(operationReplacement).toMatchObject({
      operation: "testArchive",
      archivePath: "C:/tmp/project.zip",
      attemptCount: 1,
    });

    workspace.beginLoading({ archivePath: "C:/tmp/other.zip" });
    const archiveReplacement = workspace.requestPasswordRetry({
      operation: "testArchive",
      error: commandError("invalid_password"),
    });

    expect(archiveReplacement).toMatchObject({
      operation: "testArchive",
      archivePath: "C:/tmp/other.zip",
      attemptCount: 1,
    });
  });

  it("does not request password retry for non-password errors", () => {
    const workspace = createArchiveWorkspace();
    workspace.beginLoading({ archivePath: "C:/tmp/project.zip" });
    workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("password_required"),
    });

    const retry = workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("permission_denied"),
    });

    expect(retry).toBeNull();
    expect(workspace.getSnapshot().passwordRetry).toBeNull();
  });

  it("clears password retry state on success, failure, explicit clear, and reset", () => {
    const workspace = createArchiveWorkspace();
    workspace.beginLoading({ archivePath: "C:/tmp/project.zip" });
    workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("password_required"),
    });

    workspace.loadSucceeded({
      archivePath: "C:/tmp/project.zip",
      entries,
      entryCount: entries.length,
      totalSize: 72,
    });
    expect(workspace.getSnapshot().passwordRetry).toBeNull();

    workspace.requestPasswordRetry({
      operation: "previewEntry",
      error: commandError("invalid_password"),
    });
    expect(workspace.clearPasswordRetry().passwordRetry).toBeNull();

    workspace.requestPasswordRetry({
      operation: "previewEntry",
      error: commandError("invalid_password"),
    });
    workspace.loadFailed(commandError("permission_denied"));
    expect(workspace.getSnapshot().passwordRetry).toBeNull();

    workspace.requestPasswordRetry({
      operation: "previewEntry",
      error: commandError("invalid_password"),
    });
    expect(workspace.reset().passwordRetry).toBeNull();
  });

  it("keeps password retry snapshots serializable and password-free", () => {
    const workspace = createArchiveWorkspace();
    const secret = "dont-store-this-password";
    workspace.beginLoading({
      archivePath: "C:/tmp/project.zip",
      password: secret,
    } as Parameters<typeof workspace.beginLoading>[0] & { password: string });
    workspace.requestPasswordRetry({
      operation: "listArchive",
      error: commandError("password_required"),
    });

    const snapshotJson = JSON.stringify(workspace.getSnapshot());

    expect(JSON.parse(snapshotJson).passwordRetry).toMatchObject({
      operation: "listArchive",
      promptKey: "browse.passwordRequired",
      attemptCount: 1,
    });
    expect(snapshotJson).not.toContain(secret);
  });

  it("reorders columns by dragging source to target position", () => {
    const workspace = createArchiveWorkspace();
    workspace.loadSucceeded({
      entries,
      archivePath: "test.zip",
      entryCount: entries.length,
    });
    const before = workspace.getSnapshot().view.tableColumns;
    const visibleBefore = before.columnOrderIds.filter((id) =>
      before.visibleColumnIds.includes(id),
    );

    const snapshot = workspace.reorderColumn(visibleBefore[3], visibleBefore[1]);
    const after = snapshot.view.tableColumns;
    const visibleAfter = after.columnOrderIds.filter((id) =>
      after.visibleColumnIds.includes(id),
    );

    expect(visibleAfter[1]).toBe(visibleBefore[3]);
    expect(visibleAfter[0]).toBe("name");
  });
});

function commandError(code: string): CommandErrorDto {
  return {
    code,
    message: "Command failed",
    hint: null,
    severity: "error",
    retryable: code === "password_required" || code === "invalid_password",
  };
}

function selectPaths(
  workspace: ArchiveWorkspace,
  paths: readonly string[],
): ReturnType<ArchiveWorkspace["updateSelection"]> {
  return workspace.updateSelection({
    selectedPaths: new Set(paths),
    focusedPath: paths[0] ?? "",
    anchorPath: paths[0] ?? "",
  });
}

function requestOf<TRequest, TReason extends string>(
  result: ArchiveWorkspaceRequestResult<TRequest, TReason>,
): TRequest {
  if (!result.ok) {
    throw new Error(`Expected request, got ${result.reason}`);
  }
  return result.request;
}

function reasonOf<TRequest, TReason extends string>(
  result: ArchiveWorkspaceRequestResult<TRequest, TReason>,
): TReason {
  if (result.ok) {
    throw new Error("Expected unavailable reason, got request");
  }
  return result.reason;
}
