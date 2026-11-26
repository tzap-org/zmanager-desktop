export const EXTRACT_DESTINATION_HISTORY_MAX = 10;
export const CREATE_DESTINATION_HISTORY_MAX = 10;
export const RECENT_ARCHIVE_HISTORY_MAX = 8;

export type PathHistoryEntries = readonly string[];

export type PathHistoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export type PathHistorySnapshot = {
  readonly extractDestinationHistory: readonly string[];
  readonly createDestinationHistory: readonly string[];
  readonly recentArchiveHistory: readonly string[];
};

export type PathHistoryStore = {
  getSnapshot: () => PathHistorySnapshot;
  load: () => PathHistorySnapshot;
  setExtractDestinationHistory: (entries: PathHistoryEntries) => PathHistorySnapshot;
  recordExtractDestinationHistory: (destinationPath: string) => PathHistorySnapshot | null;
  setCreateDestinationHistory: (entries: PathHistoryEntries) => PathHistorySnapshot;
  recordCreateDestinationHistory: (destinationPath: string) => PathHistorySnapshot | null;
  setRecentArchiveHistory: (entries: PathHistoryEntries) => PathHistorySnapshot;
  recordRecentArchiveHistory: (archivePath: string) => PathHistorySnapshot | null;
};

export const PATH_HISTORY_STORAGE_KEYS = {
  extractDestination: "zmanager.extractDestinationHistory",
  createDestination: "zmanager.createDestinationHistory",
  recentArchive: "zmanager.recentArchiveHistory",
} as const;

export function normalizePathHistory(entries: PathHistoryEntries): string[] {
  const normalizedEntries: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    normalizedEntries.push(entry);
  }

  return normalizedEntries;
}

export function setPathHistoryEntries(entries: PathHistoryEntries, maxEntries: number): string[] {
  return normalizePathHistory(entries).slice(0, maxEntries);
}

export function recordPathHistoryEntry(
  currentEntries: PathHistoryEntries,
  recordedPath: string,
  maxEntries: number,
): string[] | null {
  if (!recordedPath) {
    return null;
  }

  return setPathHistoryEntries(
    [recordedPath, ...currentEntries.filter((entry) => entry !== recordedPath)],
    maxEntries,
  );
}

export function normalizeExtractDestinationHistory(entries: PathHistoryEntries): string[] {
  return setExtractDestinationHistoryEntries(entries);
}

export function setExtractDestinationHistoryEntries(entries: PathHistoryEntries): string[] {
  return setPathHistoryEntries(entries, EXTRACT_DESTINATION_HISTORY_MAX);
}

export function recordExtractDestinationHistoryEntry(
  currentEntries: PathHistoryEntries,
  destinationPath: string,
): string[] | null {
  return recordPathHistoryEntry(currentEntries, destinationPath, EXTRACT_DESTINATION_HISTORY_MAX);
}

export function normalizeCreateDestinationHistory(entries: PathHistoryEntries): string[] {
  return setCreateDestinationHistoryEntries(entries);
}

export function setCreateDestinationHistoryEntries(entries: PathHistoryEntries): string[] {
  return setPathHistoryEntries(entries, CREATE_DESTINATION_HISTORY_MAX);
}

export function recordCreateDestinationHistoryEntry(
  currentEntries: PathHistoryEntries,
  destinationPath: string,
): string[] | null {
  return recordPathHistoryEntry(currentEntries, destinationPath, CREATE_DESTINATION_HISTORY_MAX);
}

export function normalizeRecentArchiveHistory(entries: PathHistoryEntries): string[] {
  return setRecentArchiveHistoryEntries(entries);
}

export function setRecentArchiveHistoryEntries(entries: PathHistoryEntries): string[] {
  return setPathHistoryEntries(entries, RECENT_ARCHIVE_HISTORY_MAX);
}

export function recordRecentArchiveHistoryEntry(
  currentEntries: PathHistoryEntries,
  archivePath: string,
): string[] | null {
  return recordPathHistoryEntry(currentEntries, archivePath, RECENT_ARCHIVE_HISTORY_MAX);
}

export function resolvePathHistoryStorage(): PathHistoryStorage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readPathHistoryEntries(storage: PathHistoryStorage | null, key: string): string[] {
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function savePathHistoryEntries(storage: PathHistoryStorage | null, key: string, entries: PathHistoryEntries): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(entries));
  } catch {
    // Storage can be unavailable in restricted environments.
  }
}

function freezeHistory(entries: PathHistoryEntries): readonly string[] {
  return Object.freeze([...entries]);
}

export function createPathHistoryStore(storage: PathHistoryStorage | null = resolvePathHistoryStorage()): PathHistoryStore {
  let extractDestinationHistory = normalizeExtractDestinationHistory([]);
  let createDestinationHistory = normalizeCreateDestinationHistory([]);
  let recentArchiveHistory = normalizeRecentArchiveHistory([]);

  function getSnapshot(): PathHistorySnapshot {
    return Object.freeze({
      extractDestinationHistory: freezeHistory(extractDestinationHistory),
      createDestinationHistory: freezeHistory(createDestinationHistory),
      recentArchiveHistory: freezeHistory(recentArchiveHistory),
    });
  }

  function setExtractDestinationHistory(entries: PathHistoryEntries): PathHistorySnapshot {
    extractDestinationHistory = setExtractDestinationHistoryEntries(entries);
    savePathHistoryEntries(storage, PATH_HISTORY_STORAGE_KEYS.extractDestination, extractDestinationHistory);
    return getSnapshot();
  }

  function setCreateDestinationHistory(entries: PathHistoryEntries): PathHistorySnapshot {
    createDestinationHistory = setCreateDestinationHistoryEntries(entries);
    savePathHistoryEntries(storage, PATH_HISTORY_STORAGE_KEYS.createDestination, createDestinationHistory);
    return getSnapshot();
  }

  function setRecentArchiveHistory(entries: PathHistoryEntries): PathHistorySnapshot {
    recentArchiveHistory = setRecentArchiveHistoryEntries(entries);
    savePathHistoryEntries(storage, PATH_HISTORY_STORAGE_KEYS.recentArchive, recentArchiveHistory);
    return getSnapshot();
  }

  return {
    getSnapshot,

    load() {
      extractDestinationHistory = normalizeExtractDestinationHistory(
        readPathHistoryEntries(storage, PATH_HISTORY_STORAGE_KEYS.extractDestination),
      );
      createDestinationHistory = normalizeCreateDestinationHistory(
        readPathHistoryEntries(storage, PATH_HISTORY_STORAGE_KEYS.createDestination),
      );
      recentArchiveHistory = normalizeRecentArchiveHistory(
        readPathHistoryEntries(storage, PATH_HISTORY_STORAGE_KEYS.recentArchive),
      );
      return getSnapshot();
    },

    setExtractDestinationHistory,

    recordExtractDestinationHistory(destinationPath) {
      const nextHistory = recordExtractDestinationHistoryEntry(extractDestinationHistory, destinationPath);
      return nextHistory ? setExtractDestinationHistory(nextHistory) : null;
    },

    setCreateDestinationHistory,

    recordCreateDestinationHistory(destinationPath) {
      const nextHistory = recordCreateDestinationHistoryEntry(createDestinationHistory, destinationPath);
      return nextHistory ? setCreateDestinationHistory(nextHistory) : null;
    },

    setRecentArchiveHistory,

    recordRecentArchiveHistory(archivePath) {
      const nextHistory = recordRecentArchiveHistoryEntry(recentArchiveHistory, archivePath);
      return nextHistory ? setRecentArchiveHistory(nextHistory) : null;
    },
  };
}
