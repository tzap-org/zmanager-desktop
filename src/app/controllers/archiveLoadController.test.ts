import { describe, expect, it, vi } from "vitest";

import type { ArchiveChildrenPageDto, ArchiveIndexSnapshotDto, CommandErrorDto } from "../../api/types";
import { createArchiveWorkspace, type ArchiveWorkspaceSnapshot } from "../workspaces/archiveWorkspace";
import { createArchiveLoadController, type ArchiveLoadControllerOptions } from "./archiveLoadController";

function terminal(overrides: Partial<ArchiveIndexSnapshotDto> = {}): ArchiveIndexSnapshotDto {
  return {
    revision: "2",
    sessionId: "archive-1",
    archivePath: "C:/archives/demo.zip",
    status: "ready",
    discoveredEntries: 1,
    finalEntryCount: 1,
    finalTotalBytes: 12,
    ...overrides,
  };
}

function commandError(overrides: Partial<CommandErrorDto> = {}): CommandErrorDto {
  return { code: "failed", message: "Index failed", hint: null, severity: "error", retryable: false, ...overrides };
}

function createHarness(overrides: Partial<ArchiveLoadControllerOptions> = {}) {
  const workspace = createArchiveWorkspace();
  const calls = {
    loading: [] as ArchiveWorkspaceSnapshot[],
    pages: [] as ArchiveWorkspaceSnapshot[],
    errors: [] as string[],
    prompts: [] as string[],
  };
  const start = vi.fn(async () => ({
    sessionId: "archive-1",
    snapshot: terminal({ revision: "1", status: "indexing", finalEntryCount: undefined }),
  }));
  const wait = vi.fn(async () => terminal());
  const get = vi.fn(async (): Promise<ArchiveChildrenPageDto> => ({
    sessionId: "archive-1",
    revision: "2",
    parentPath: "",
    entries: [{ path: "readme.txt", kind: "file" as const, size: 12 }],
    nextCursor: undefined,
    complete: true,
    childCount: 1,
  }));
  const close = vi.fn(async () => undefined);
  const controller = createArchiveLoadController({
    workspace,
    enterExtractWorkspace: vi.fn(),
    startArchiveIndex: start,
    waitArchiveIndex: wait,
    getArchiveChildren: get,
    searchArchiveIndex: vi.fn(async () => ({
      sessionId: "archive-1",
      revision: "2",
      parentPath: "",
      entries: [],
      complete: true,
      childCount: 0,
    })),
    closeArchiveIndex: close,
    toCommandError: (error) => error && typeof error === "object" && "code" in error ? error as CommandErrorDto : null,
    renderLoading: (snapshot) => calls.loading.push(snapshot),
    renderPage: (snapshot) => calls.pages.push(snapshot),
    renderLoadError: (_snapshot, message) => calls.errors.push(message),
    failedListMessage: () => "Could not index archive.",
    loadErrorMessage: (error, options) => options.includeHint && error.hint ? `${error.message}\n${error.hint}` : error.message,
    promptForPasswordRetry: (retry) => {
      calls.prompts.push(retry.promptKey);
      return "secret";
    },
    resolveDefaultTableColumns: () => ({ visibleColumnIds: ["name", "size", "compressedSize", "modified"], columnOrderIds: ["name", "size", "compressedSize", "modified", "mode", "created", "accessed", "attributes", "encrypted", "method", "crc", "comment", "kind", "ratio", "solid", "linkTarget", "metadataDiagnostics", "uid", "gid", "owner", "group"], columnWidths: {} }),
    ...overrides,
  });
  return { calls, close, controller, get, start, wait, workspace };
}

describe("archive load controller", () => {
  it("publishes opening immediately and keeps only the bounded page in workspace state", async () => {
    let resolveWait!: (snapshot: ArchiveIndexSnapshotDto) => void;
    const waiting = new Promise<ArchiveIndexSnapshotDto>((resolve) => { resolveWait = resolve; });
    const harness = createHarness({ waitArchiveIndex: () => waiting });

    const load = harness.controller.loadArchive({ archivePath: "C:/archives/demo.zip" });
    await vi.waitFor(() => expect(harness.calls.loading).toHaveLength(1));
    expect(harness.calls.loading[0].browseState).toBe("loading");
    expect(harness.calls.pages).toHaveLength(0);

    resolveWait(terminal());
    await load;
    expect(harness.get).toHaveBeenCalledWith({
      sessionId: "archive-1",
      parentPath: "",
      limit: 200,
      sortKey: "name",
      sortAscending: true,
    });
    expect(harness.workspace.getSnapshot().entries).toHaveLength(1);
    expect(harness.workspace.getSnapshot().entryCount).toBe(1);
  });

  it("keeps an on-demand root page selectable when indexing reports empty", async () => {
    const harness = createHarness();
    harness.wait.mockResolvedValueOnce(terminal({ status: "empty", discoveredEntries: 0, finalEntryCount: 0, finalTotalBytes: 0 }));
    harness.get.mockResolvedValueOnce({
      sessionId: "archive-1",
      revision: "2",
      parentPath: "",
      entries: [{ path: "src", kind: "directory" }],
      complete: true,
      childCount: 1,
    });

    await harness.controller.loadArchive({ archivePath: "C:/archives/demo.tzap" });

    expect(harness.workspace.getSnapshot().browseState).toBe("loaded");
    expect(harness.workspace.getSnapshot().entries.map((entry) => entry.path)).toEqual(["src"]);
  });

  it("marks an on-demand archive empty when its fetched root page has no children", async () => {
    const harness = createHarness();
    harness.wait.mockResolvedValueOnce(terminal({ status: "empty", discoveredEntries: 0, finalEntryCount: 0, finalTotalBytes: 0 }));
    harness.get.mockResolvedValueOnce({
      sessionId: "archive-1",
      revision: "2",
      parentPath: "",
      entries: [],
      complete: true,
      childCount: 0,
    });

    await harness.controller.loadArchive({ archivePath: "C:/archives/empty.tzap" });

    expect(harness.workspace.getSnapshot().browseState).toBe("empty");
  });

  it("renders current-folder rows from an indexing revision without waiting for the whole archive", async () => {
    let resolveTerminal!: (snapshot: ArchiveIndexSnapshotDto) => void;
    const terminalWait = new Promise<ArchiveIndexSnapshotDto>((resolve) => { resolveTerminal = resolve; });
    const harness = createHarness();
    harness.wait
      .mockResolvedValueOnce(terminal({
        revision: "2",
        status: "indexing",
        discoveredEntries: 256,
        finalEntryCount: undefined,
        finalTotalBytes: undefined,
      }))
      .mockImplementationOnce(() => terminalWait);
    harness.get.mockResolvedValueOnce({
      sessionId: "archive-1",
      revision: "2",
      parentPath: "",
      entries: [{ path: "root.txt", kind: "file", size: 12 }],
      complete: true,
      childCount: 1,
    });

    const load = harness.controller.loadArchive({ archivePath: "C:/archives/demo.zip" });
    await vi.waitFor(() => expect(harness.calls.pages).toHaveLength(1));
    expect(harness.workspace.getSnapshot().entries[0]?.path).toBe("root.txt");

    resolveTerminal(terminal({ revision: "3" }));
    await load;
  });

  it("skips redundant partial page renders while forcing the terminal metadata update", async () => {
    const harness = createHarness();
    harness.wait
      .mockResolvedValueOnce(terminal({
        revision: "2",
        status: "indexing",
        discoveredEntries: 256,
        finalEntryCount: undefined,
        finalTotalBytes: undefined,
      }))
      .mockResolvedValueOnce(terminal({
        revision: "3",
        status: "indexing",
        discoveredEntries: 512,
        finalEntryCount: undefined,
        finalTotalBytes: undefined,
      }))
      .mockResolvedValueOnce(terminal({ revision: "4" }));

    await harness.controller.loadArchive({ archivePath: "C:/archives/demo.zip" });

    expect(harness.get).toHaveBeenCalledTimes(3);
    expect(harness.calls.pages).toHaveLength(2);
    expect(harness.calls.pages.at(-1)?.entryCount).toBe(1);
  });

  it("closes the previous session when another archive is opened", async () => {
    const harness = createHarness();
    await harness.controller.loadArchive({ archivePath: "C:/archives/one.zip" });
    await harness.controller.loadArchive({ archivePath: "C:/archives/two.zip" });
    expect(harness.close).toHaveBeenCalledWith({ sessionId: "archive-1" });
  });

  it("replaces visible pages with opaque next and previous cursors", async () => {
    const harness = createHarness();
    harness.get
      .mockResolvedValueOnce({
        sessionId: "archive-1",
        revision: "2",
        parentPath: "",
        entries: [{ path: "a.txt", kind: "file" }],
        nextCursor: "opaque-next",
        complete: false,
        childCount: 2,
      })
      .mockResolvedValueOnce({
        sessionId: "archive-1",
        revision: "2",
        parentPath: "",
        entries: [{ path: "b.txt", kind: "file" }],
        complete: true,
        childCount: 2,
      })
      .mockResolvedValueOnce({
        sessionId: "archive-1",
        revision: "2",
        parentPath: "",
        entries: [{ path: "a.txt", kind: "file" }],
        nextCursor: "opaque-next",
        complete: false,
        childCount: 2,
      });

    await harness.controller.loadArchive({ archivePath: "C:/archives/demo.zip" });
    expect(harness.workspace.getSnapshot().page).toMatchObject({ number: 1, hasNext: true });
    await harness.controller.loadNextPage();
    expect(harness.workspace.getSnapshot().entries[0]?.path).toBe("b.txt");
    expect(harness.workspace.getSnapshot().page).toMatchObject({ number: 2, hasPrevious: true });
    await harness.controller.loadPreviousPage();
    expect(harness.workspace.getSnapshot().entries[0]?.path).toBe("a.txt");
    expect(harness.get).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "opaque-next" }));
  });

  it("restarts the session after a password-required terminal snapshot", async () => {
    const harness = createHarness();
    harness.wait
      .mockResolvedValueOnce(terminal({
        status: "failed",
        latestFailure: commandError({ code: "password_required", message: "Password required" }),
      }))
      .mockResolvedValueOnce(terminal());

    await harness.controller.loadArchive({ archivePath: "C:/archives/demo.zip" });

    expect(harness.calls.prompts).toEqual(["browse.passwordRequired"]);
    expect(harness.start).toHaveBeenNthCalledWith(2, {
      archivePath: "C:/archives/demo.zip",
      password: "secret",
    });
  });

  it("renders a secret-free terminal error when retry is unavailable", async () => {
    const harness = createHarness();
    harness.wait.mockResolvedValueOnce(terminal({
      status: "failed",
      latestFailure: commandError({ message: "Bad archive", hint: "Try another file." }),
    }));

    await harness.controller.loadArchive({ archivePath: "C:/archives/demo.zip" });
    expect(harness.calls.errors).toEqual(["Bad archive\nTry another file."]);
  });
});
