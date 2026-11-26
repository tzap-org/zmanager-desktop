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
  | "acceptPage"
  | "acceptTreePage"
  | "beginLoading"
  | "clearSearch"
  | "getSnapshot"
  | "loadFailed"
  | "requestPasswordRetry"
  | "setBrowseState"
  | "setSearchSupported"
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
  renderCapability(snapshot: ArchiveWorkspaceSnapshot): void;
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

type BrowseIntent = Readonly<{ parentPath: string; query: string | null }>;

function requestWithPassword(archivePath: string, password: string | undefined): ListArchiveRequest {
  return { archivePath, ...(password ? { password } : {}) };
}

export function createArchiveLoadController(options: ArchiveLoadControllerOptions): ArchiveLoadController {
  let active: {
    sessionId: string;
    revision: string;
    archivePath: string;
    searchSupported: boolean;
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
  let pendingBrowse: BrowseIntent | null = null;
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
    expectedBrowse?: BrowseIntent,
  ): Promise<ArchiveChildrenPageDto | null> {
    const session = active;
    if (!session) return null;
    const requestId = ++pageRequestId;
    const sort = options.workspace.getSnapshot().view.sort;
    const stillCurrent = () => requestId === pageRequestId
      && expectedGeneration === generation
      && active?.sessionId === session.sessionId
      && (!expectedBrowse || pendingBrowse === expectedBrowse);
    let page: ArchiveChildrenPageDto;
    try {
      const paging = {
        sessionId: session.sessionId,
        ...(cursor ? { cursor } : {}),
        limit: VISIBLE_PAGE_LIMIT,
        sortKey: sort.key,
        sortAscending: sort.ascending,
      };
      page = query === null
        ? await options.getArchiveChildren({ ...paging, parentPath })
        : await options.searchArchiveIndex({ ...paging, query });
    } catch (error) {
      if (!stillCurrent()) return null;
      throw error;
    }
    if (!stillCurrent() || page.sessionId !== session.sessionId) return null;
    active = {
      ...session,
      parentPath,
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
    let password = request.password;
    const preserveState = loadOptions.preserveState ?? false;
    const view = options.workspace.getSnapshot().view;
    const requestGeneration = ++generation;
    const currentBrowse = {
      parentPath: view.currentFolder,
      query: view.flatView || view.searchQuery ? active?.query ?? null : null,
    };
    pendingBrowse = preserveState ? pendingBrowse ?? currentBrowse : { parentPath: "", query: null };
    options.enterExtractWorkspace();

    try {
      while (requestGeneration === generation) {
        await closeActive();
        if (requestGeneration !== generation) return;
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
          let terminal = started.snapshot;
          active = {
            sessionId: started.sessionId,
            revision: terminal.revision,
            archivePath: terminal.archivePath,
            searchSupported: started.snapshot.format !== "tzap",
            entryCount: terminal.discoveredEntries,
            totalSize: null,
            parentPath: "",
            cursor: null,
            nextCursor: null,
            previousCursors: [],
            pageNumber: 1,
            query: null,
          };
          if (!active.searchSupported && pendingBrowse && pendingBrowse.query !== null) {
            pendingBrowse = { parentPath: pendingBrowse.parentPath, query: null };
            options.renderCapability(options.workspace.clearSearch());
          }
          options.renderCapability(options.workspace.setSearchSupported(active.searchSupported));
          while (terminal.status === "indexing") {
            terminal = await options.waitArchiveIndex({
              sessionId: started.sessionId,
              afterRevision: terminal.revision,
            });
            if (requestGeneration !== generation || active?.sessionId !== terminal.sessionId) return;
            active = {
              ...active,
              revision: terminal.revision,
              entryCount: terminal.discoveredEntries,
              totalSize: terminal.discoveredBytes ?? null,
            };
            const intent: BrowseIntent | null = pendingBrowse;
            if (intent && intent.query === null && terminal.status === "indexing" && terminal.discoveredEntries > 0) {
              await acceptFolder(intent.parentPath, requestGeneration, null, 1, [], null, false, intent);
            }
          }
          if (requestGeneration !== generation || active?.sessionId !== terminal.sessionId) return;
          if (terminal.status === "failed" || terminal.status === "cancelled") {
            throw terminal.latestFailure ?? new Error("Archive indexing failed.");
          }
          active = {
            ...active,
            revision: terminal.revision,
            entryCount: terminal.finalEntryCount ?? terminal.discoveredEntries,
            totalSize: terminal.finalTotalBytes ?? null,
          };
          while (requestGeneration === generation && pendingBrowse) {
            const intent: BrowseIntent | null = pendingBrowse;
            const page = await acceptFolder(intent.parentPath, requestGeneration, null, 1, [], intent.query, true, intent);
            if (requestGeneration !== generation) return;
            if (intent !== pendingBrowse) continue;
            if (intent.query === null && (terminal.finalEntryCount ?? 0) === 0 && page?.childCount === 0) {
              options.renderPage(options.workspace.setBrowseState("empty"));
            }
            return;
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
          if (requestGeneration !== generation) return;
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
    } finally {
      if (requestGeneration === generation) pendingBrowse = null;
    }
  }

  async function browse(intent: BrowseIntent): Promise<void> {
    if (pendingBrowse) {
      pendingBrowse = intent;
      return;
    }
    await acceptFolder(intent.parentPath, generation, null, 1, [], intent.query);
  }

  return {
    loadArchive,
    loadFolder: (parentPath) => browse({ parentPath, query: null }),
    loadSearch(query) {
      if (active && !active.searchSupported) {
        options.renderPage(options.workspace.clearSearch());
        return Promise.resolve();
      }
      return browse({
        parentPath: pendingBrowse?.parentPath ?? active?.parentPath ?? "",
        query,
      });
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
      if (pendingBrowse || !session?.nextCursor) return;
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
      if (pendingBrowse || !session || session.previousCursors.length === 0) return;
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
      pendingBrowse = null;
      await closeActive();
    },
  };
}
