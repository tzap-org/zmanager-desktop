import type { StartExtractRequest } from "../api/types";
import { normalizeArchivePath } from "./archiveTree";

export type ArchiveExtractionAction = "extractHere" | "extractToFolder";
export type ArchiveExtractionMode = "archive" | "selection";
export type ArchiveExtractionEntry = Readonly<{
  path: string;
  kind?: string;
}>;

export type ArchiveExtractionPolicy = Readonly<{
  destination: "archiveParent" | "archiveNamedFolder";
  wrapperRoot: "stripSingleRoot" | "preserve";
  destinationCollisionStrategy?: StartExtractRequest["destinationCollisionStrategy"];
}>;

export const ARCHIVE_EXTRACTION_POLICIES: Readonly<Record<ArchiveExtractionAction, ArchiveExtractionPolicy>> = {
  extractHere: {
    destination: "archiveParent",
    // Extract Here writes the archive's members into the current directory
    // without inventing a destination folder or removing one from the archive.
    wrapperRoot: "preserve",
  },
  extractToFolder: {
    destination: "archiveNamedFolder",
    wrapperRoot: "preserve",
    destinationCollisionStrategy: "rename",
  },
};

const NO_STRIPPED_COMPONENTS = 0;
const SINGLE_WRAPPER_COMPONENTS = 1;

export function archiveExtractionPolicy(action: ArchiveExtractionAction): ArchiveExtractionPolicy {
  return ARCHIVE_EXTRACTION_POLICIES[action];
}

export function quickExtractPathPolicy(
  action: ArchiveExtractionAction,
  hasSingleRootFolder: boolean,
): Readonly<{
  stripComponents: number;
  destinationCollisionStrategy?: StartExtractRequest["destinationCollisionStrategy"];
}> {
  const policy = archiveExtractionPolicy(action);
  return {
    stripComponents: policy.wrapperRoot === "stripSingleRoot" && hasSingleRootFolder
      ? SINGLE_WRAPPER_COMPONENTS
      : NO_STRIPPED_COMPONENTS,
    ...(policy.destinationCollisionStrategy
      ? { destinationCollisionStrategy: policy.destinationCollisionStrategy }
      : {}),
  };
}

export function singleArchiveRootFolder(entries: readonly ArchiveExtractionEntry[]): string | null {
  let root: string | null = null;
  let hasChildBelowRoot = false;
  let hasRootDirectoryEntry = false;

  for (const entry of entries) {
    const parts = normalizeArchivePath(entry.path).split("/").filter(Boolean);
    if (!parts.length) {
      continue;
    }

    const entryRoot = parts[0];
    if (!isSafeArchiveRootName(entryRoot)) {
      return null;
    }
    if (root === null) {
      root = entryRoot;
    } else if (root !== entryRoot) {
      return null;
    }

    if (parts.length > 1) {
      hasChildBelowRoot = true;
    } else if (entry.kind === "directory") {
      hasRootDirectoryEntry = true;
    }
  }

  return root && (hasChildBelowRoot || hasRootDirectoryEntry) ? root : null;
}

export function hasSingleArchiveRootFolder(entryPaths: readonly string[]): boolean {
  return Boolean(singleArchiveRootFolder(entryPaths.map((path) => ({ path }))));
}

export function extractHerePathOptions(
  input: Readonly<{ stripComponents: string | number }>,
  options: Readonly<{
    mode: ArchiveExtractionMode;
    selectedFilePath?: string;
  }>,
): Readonly<{
  pathMode: "full";
  stripComponents: number;
  deduplicateRoot: boolean;
}> {
  if (options.mode === "selection" && options.selectedFilePath) {
    return {
      pathMode: "full",
      stripComponents: Math.max(
        numberOrZero(input.stripComponents),
        Math.max(NO_STRIPPED_COMPONENTS, archivePathDepth(options.selectedFilePath) - 1),
      ),
      deduplicateRoot: false,
    };
  }

  return {
    pathMode: "full",
    stripComponents: Math.max(NO_STRIPPED_COMPONENTS, numberOrZero(input.stripComponents)),
    deduplicateRoot: false,
  };
}

export function nativeDragStripComponents(input: Readonly<{
  entryPaths: readonly string[];
  currentFolder: string;
  flatView: boolean;
  searchQuery: string;
}>): number {
  if (input.entryPaths.length === 1) {
    return Math.max(NO_STRIPPED_COMPONENTS, archivePathDepth(input.entryPaths[0]) - 1);
  }

  if (input.flatView || input.searchQuery.trim() || !input.currentFolder) {
    return NO_STRIPPED_COMPONENTS;
  }

  return archivePathDepth(input.currentFolder);
}

function numberOrZero(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : NO_STRIPPED_COMPONENTS;
  }

  const normalized = value.trim();
  if (!normalized) {
    return NO_STRIPPED_COMPONENTS;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? NO_STRIPPED_COMPONENTS : Math.trunc(parsed);
}

function archivePathDepth(entryPath: string): number {
  return normalizeArchivePath(entryPath).split("/").filter(Boolean).length;
}

function isSafeArchiveRootName(name: string): boolean {
  return Boolean(
    name &&
      name !== "." &&
      name !== ".." &&
      !name.includes("/") &&
      !name.includes("\\"),
  );
}
