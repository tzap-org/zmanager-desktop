import type {
  ArchiveChildrenPageDto,
  ArchiveChildrenRequest,
  ArchiveIndexSessionRequest,
  ArchiveIndexSnapshotDto,
  ArchiveIndexStartResponseDto,
  ArchiveSearchRequest,
  CommandErrorDto,
  ListArchiveRequest,
} from "../../api/types";
import type {
  ArchiveTableColumnSettings,
} from "../archiveTable";
import type {
  ArchiveWorkspace,
  ArchiveWorkspacePasswordRetry,
  ArchiveWorkspacePasswordRetryOperation,
  ArchiveWorkspaceSnapshot,
} from "../workspaces/archiveWorkspace";

export type ArchiveLoadOptions = Readonly<{ preserveState?: boolean }>;

export type ArchiveLoadControllerWorkspace = Pick<
  ArchiveWorkspace,
  "acceptPage" | "acceptTreePage" | "beginLoading" | "getSnapshot" | "loadFailed" | "requestPasswordRetry" | "setBrowseState"
>;

export type ArchiveLoadControllerOptions = Readonly<{
  workspace: ArchiveLoadControllerWorkspace;
  enterExtractWorkspace(): void;
  startArchiveIndex(request: ListArchiveRequest): Promise<ArchiveIndexStartResponseDto>;
  waitArchiveIndex(request: ArchiveIndexSessionRequest): Promise<ArchiveIndexSnapshotDto>;
  getArchiveChildren(request: ArchiveChildrenRequest): Promise<ArchiveChildrenPageDto>;
  searchArchiveIndex(request: ArchiveSearchRequest): Promise<ArchiveChildrenPageDto>;
  closeArchiveIndex(request: ArchiveIndexSessionRequest): Promise<void>;
  toCommandError(error: unknown): CommandErrorDto | null;
  renderLoading(snapshot: ArchiveWorkspaceSnapshot): void;
  renderPage(snapshot: ArchiveWorkspaceSnapshot): void;
  renderLoadError(snapshot: ArchiveWorkspaceSnapshot, message: string): void;
  failedListMessage(): string;
  loadErrorMessage(error: CommandErrorDto, options: { includeHint: boolean }): string;
  promptForPasswordRetry(retry: ArchiveWorkspacePasswordRetry): string | null;
  resolveDefaultTableColumns(archivePath: string): ArchiveTableColumnSettings;
}>;

export type ArchiveLoadController = Readonly<{
  loadArchive(request: ListArchiveRequest, options?: ArchiveLoadOptions): Promise<void>;
  loadFolder(parentPath: string): Promise<void>;
  loadSearch(query: string): Promise<void>;
  loadTreeFolder(parentPath: string): Promise<void>;
  loadNextPage(): Promise<void>;
  loadPreviousPage(): Promise<void>;
  close(): Promise<void>;
}>;

const LIST_ARCHIVE_OPERATION: ArchiveWorkspacePasswordRetryOperation = "listArchive";
const VISIBLE_PAGE_LIMIT = 200;
const MAX_TREE_SUMMARY_ENTRIES = 2_048;

function requestWithPassword(archivePath: string, password: string | undefined): ListArchiveRequest {
  return { archivePath, ...(password ? { password } : {}) };
}

export function createArchiveLoadController(options: ArchiveLoadControllerOptions): ArchiveLoadController {
  let active: {
    sessionId: string;
    revision: string;
    archivePath: string;
    entryCount: number;
    totalSize: number | null;
    parentPath: string;
    cursor: string | null;
    nextCursor: string | null;
    previousCursors: readonly (string | null)[];
    pageNumber: number;
    query: string | null;
  } | null = null;
  let generation = 0;
  let pageRequestId = 0;
  let lastRenderedPageSignature: string | null = null;

  async function closeActive(): Promise<void> {
    const previous = active;
    active = null;
    if (previous) {
      await options.closeArchiveIndex({ sessionId: previous.sessionId }).catch(() => undefined);
    }
  }

  async function acceptFolder(
    parentPath: string,
    expectedGeneration: number,
    cursor: string | null = null,
    pageNumber = 1,
    previousCursors: readonly (string | null)[] = [],
    query: string | null = null,
    renderUnchanged = true,
  ): Promise<ArchiveChildrenPageDto | null> {
    const session = active;
    if (!session) return null;
    const requestId = ++pageRequestId;
    const sort = options.workspace.getSnapshot().view.sort;
    const page = await (query === null ? options.getArchiveChildren({
      sessionId: session.sessionId,
      parentPath,
      ...(cursor ? { cursor } : {}),
      limit: VISIBLE_PAGE_LIMIT,
      sortKey: sort.key,
      sortAscending: sort.ascending,
    }) : options.searchArchiveIndex({
      sessionId: session.sessionId,
      query,
      ...(cursor ? { cursor } : {}),
      limit: VISIBLE_PAGE_LIMIT,
      sortKey: sort.key,
      sortAscending: sort.ascending,
    }));
    if (requestId !== pageRequestId || expectedGeneration !== generation || active?.sessionId !== page.sessionId) return null;
    active = {
      ...session,
      parentPath: page.parentPath,
      cursor,
      nextCursor: page.nextCursor ?? null,
      previousCursors,
      pageNumber,
      query,
    };
    const pageSignature = JSON.stringify({
      parentPath: page.parentPath,
      cursor,
      nextCursor: page.nextCursor ?? null,
      childCount: page.childCount,
      entries: page.entries.map((entry) => [
        entry.path,
        entry.kind,
        entry.size ?? null,
        entry.compressedSize ?? null,
      ]),
    });
    if (!renderUnchanged && pageSignature === lastRenderedPageSignature) {
      return page;
    }
    lastRenderedPageSignature = pageSignature;
    options.renderPage(options.workspace.acceptPage({
      archivePath: session.archivePath,
      parentPath,
      entries: page.entries,
      entryCount: session.entryCount,
      totalSize: session.totalSize,
      pageNumber,
      childCount: page.childCount,
      hasPrevious: previousCursors.length > 0,
      hasNext: Boolean(page.nextCursor),
    }));
    return page;
  }

  async function loadArchive(request: ListArchiveRequest, loadOptions: ArchiveLoadOptions = {}): Promise<void> {
    let password = request.password?.trim();
    const preserveState = loadOptions.preserveState ?? false;
    const preservedFolder = preserveState ? options.workspace.getSnapshot().view.currentFolder : "";
    options.enterExtractWorkspace();

    while (true) {
      const requestGeneration = ++generation;
      await closeActive();
      lastRenderedPageSignature = null;
      options.renderLoading(options.workspace.beginLoading({
        archivePath: request.archivePath,
        preserveListing: preserveState,
        tableColumns: options.resolveDefaultTableColumns(request.archivePath),
      }));

      try {
        const started = await options.startArchiveIndex(requestWithPassword(request.archivePath, password));
        if (requestGeneration !== generation) {
          await options.closeArchiveIndex({ sessionId: started.sessionId }).catch(() => undefined);
          return;
        }
        active = {
          sessionId: started.sessionId,
          revision: started.snapshot.revision,
          archivePath: started.snapshot.archivePath,
          entryCount: started.snapshot.discoveredEntries,
          totalSize: null,
          parentPath: "",
          cursor: null,
          nextCursor: null,
          previousCursors: [],
          pageNumber: 1,
          query: null,
        };
        let terminal = started.snapshot;
        while (terminal.status === "indexing") {
          terminal = await options.waitArchiveIndex({
            sessionId: started.sessionId,
            afterRevision: terminal.revision,
          });
          if (requestGeneration !== generation || active?.sessionId !== terminal.sessionId) return;
          active = {
            sessionId: terminal.sessionId,
            revision: terminal.revision,
            archivePath: terminal.archivePath,
            entryCount: terminal.discoveredEntries,
            totalSize: terminal.discoveredBytes ?? null,
            parentPath: preservedFolder,
            cursor: null,
            nextCursor: null,
            previousCursors: [],
            pageNumber: 1,
            query: null,
          };
          if (terminal.status === "indexing" && terminal.discoveredEntries > 0) {
            await acceptFolder(
              preservedFolder,
              requestGeneration,
              null,
              1,
              [],
              null,
              false,
            );
          }
        }
        if (requestGeneration !== generation || active?.sessionId !== terminal.sessionId) return;
        if (terminal.status === "failed" || terminal.status === "cancelled") {
          throw terminal.latestFailure ?? new Error("Archive indexing failed.");
        }
        active = {
          sessionId: terminal.sessionId,
          revision: terminal.revision,
          archivePath: terminal.archivePath,
          entryCount: terminal.finalEntryCount ?? terminal.discoveredEntries,
          totalSize: terminal.finalTotalBytes ?? null,
          parentPath: preservedFolder,
          cursor: null,
          nextCursor: null,
          previousCursors: [],
          pageNumber: 1,
          query: null,
        };
        const initialPage = await acceptFolder(preservedFolder, requestGeneration);
        if ((terminal.finalEntryCount ?? 0) === 0 && initialPage?.childCount === 0) {
          options.renderPage(options.workspace.setBrowseState("empty"));
        }
        return;
      } catch (error) {
        if (requestGeneration !== generation) return;
        const commandError = options.toCommandError(error);
        const retry = options.workspace.requestPasswordRetry({ operation: LIST_ARCHIVE_OPERATION, error: commandError });
        if (!retry) {
          options.renderLoadError(
            options.workspace.loadFailed(commandError ?? { kind: "unknown" }),
            commandError ? options.loadErrorMessage(commandError, { includeHint: true }) : options.failedListMessage(),
          );
          return;
        }
        await closeActive();
        const nextPassword = options.promptForPasswordRetry(retry);
        if (!nextPassword) {
          options.renderLoadError(
            options.workspace.loadFailed(commandError ?? { kind: "unknown" }),
            commandError?.message ?? options.failedListMessage(),
          );
          return;
        }
        password = nextPassword;
      }
    }
  }

  return {
    loadArchive,
    async loadFolder(parentPath) {
      await acceptFolder(parentPath, generation);
    },
    async loadSearch(query) {
      const session = active;
      if (session) {
        await acceptFolder(session.parentPath, generation, null, 1, [], query);
      }
    },
    async loadTreeFolder(parentPath) {
      const session = active;
      const expectedGeneration = generation;
      if (!session) return;
      let cursor: string | undefined;
      let loadedEntries = 0;
      do {
        const page = await options.getArchiveChildren({
          sessionId: session.sessionId,
          parentPath,
          ...(cursor ? { cursor } : {}),
          limit: VISIBLE_PAGE_LIMIT,
        });
        if (expectedGeneration !== generation || active?.sessionId !== page.sessionId) return;
        options.renderPage(options.workspace.acceptTreePage(page.entries));
        loadedEntries += page.entries.length;
        cursor = page.nextCursor;
      } while (cursor && loadedEntries < MAX_TREE_SUMMARY_ENTRIES);
    },
    async loadNextPage() {
      const session = active;
      if (!session?.nextCursor) return;
      await acceptFolder(
        session.parentPath,
        generation,
        session.nextCursor,
        session.pageNumber + 1,
        [...session.previousCursors, session.cursor],
        session.query,
      );
    },
    async loadPreviousPage() {
      const session = active;
      if (!session || session.previousCursors.length === 0) return;
      const previousCursors = [...session.previousCursors];
      const cursor = previousCursors.pop() ?? null;
      await acceptFolder(
        session.parentPath,
        generation,
        cursor,
        Math.max(1, session.pageNumber - 1),
        previousCursors,
        session.query,
      );
    },
    async close() {
      generation += 1;
      await closeActive();
    },
  };
}
