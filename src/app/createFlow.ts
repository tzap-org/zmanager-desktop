import type { CreatePlanEntryDto, CreatePlanResponse, CreateState, StartCreateRequest } from "../api/types";
import {
  getParentArchivePath,
  isArchivePathInFolder,
  normalizeArchivePath,
} from "./archiveTree";
import { getPathBasename } from "./formatting";
import {
  buildHierarchicalRows,
  type HierarchicalTableRow,
} from "./hierarchicalTable";

export type CreateArchiveFormat = StartCreateRequest["format"];

const CREATE_FORMAT_EXTENSIONS = {
  zip: "zip",
  tarZst: "tzst",
  tzap: "tzap",
  sevenZ: "7z",
  tarGz: "tgz",
  appleArchive: "aar",
} satisfies Record<CreateArchiveFormat, string>;

const CREATE_FORMAT_ALLOWED_EXTENSIONS = {
  zip: ["zip"],
  tarZst: ["tzst", "tar.zst"],
  tzap: ["tzap"],
  sevenZ: ["7z"],
  tarGz: ["tgz", "tar.gz"],
  appleArchive: ["aar", "aea"],
} satisfies Record<CreateArchiveFormat, string[]>;

const RECOGNIZED_CREATE_EXTENSIONS = ["tar.gz", "tar.zst", "zip", "tgz", "tzst", "tzap", "7z", "aar", "aea"];
const CREATE_PASSWORD_FORMATS = new Set<CreateArchiveFormat>(["zip", "tzap", "sevenZ", "appleArchive"]);

export const TZAP_RECOVERY_PERCENTAGE_DEFAULT = 5;
export const TZAP_RECOVERY_PERCENTAGE_MIN = 0;
export const TZAP_RECOVERY_PERCENTAGE_MAX = 100;
export const TZAP_VOLUME_LOSS_TOLERANCE_MIN = 0;
export const TZAP_VOLUME_LOSS_TOLERANCE_MAX = 16;
export const TZAP_SPLIT_DEFAULT_VOLUME_LOSS_TOLERANCE = 1;
export const TZAP_VOLUME_COUNT_MIN = 2;
export const TZAP_VOLUME_COUNT_MAX = 0xffff_ffff;

export type TzapSplitMode = "none" | "volumeSize" | "volumeCount";

export type CreateArchiveUnavailableReason =
  | "needsSources"
  | "needsIncludedEntries"
  | "needsDestination"
  | "planning"
  | "needsPlan"
  | "starting";

export type CreateArchiveAvailabilityInput = {
  sourceCount: number;
  includedEntryCount?: number;
  destinationPath: string;
  planState: CreateState;
  hasPlan: boolean;
  submissionInFlight: boolean;
};

export type CreatePathHelpers = {
  nativeParentPath: (path: string) => string;
};

export type CreatePlanRow = HierarchicalTableRow<CreatePlanEntryDto>;

export type CreatePlanInclusionState = "included" | "excluded" | "partial";

export type BuildCreatePlanRowsOptions = {
  entries: readonly CreatePlanEntryDto[];
  currentFolder?: string | null;
  searchQuery?: string | null;
};

export type ApplyCreatePlanPathInclusionInput = {
  entries: readonly CreatePlanEntryDto[];
  excludedPaths: ReadonlySet<string> | readonly string[];
  path: string;
  included: boolean;
};

type ParsedDirectoryPath = {
  root: string;
  segments: string[];
  separator: "/" | "\\";
};

export function getArchiveName(path: string, fallback: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? fallback;
}

export function getCreateFormatExtension(format: CreateArchiveFormat, hasPassword = false): string {
  if (format === "appleArchive" && hasPassword) return "aea";
  return CREATE_FORMAT_EXTENSIONS[format];
}

export function getCreateArchiveExtension(path: string): string | null {
  const normalized = path.toLowerCase();
  return RECOGNIZED_CREATE_EXTENSIONS.find((extension) => normalized.endsWith(`.${extension}`)) ?? null;
}

export function withCreateArchiveExtension(path: string, format: CreateArchiveFormat, hasPassword = false): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return trimmed;
  }

  const allowedExtensions = CREATE_FORMAT_ALLOWED_EXTENSIONS[format];
  const existingExtension = getCreateArchiveExtension(trimmed);

  // If the existing extension is already recognized for this format
  if (existingExtension && allowedExtensions.includes(existingExtension)) {
    // For appleArchive, check if extension matches password state
    if (format === "appleArchive") {
      const isCurrentlyAea = existingExtension === "aea";
      const wantsAea = hasPassword;
      if (isCurrentlyAea === wantsAea) return trimmed;
      // Swap: strip existing extension, append the correct one
      const basePath = trimmed.slice(0, -(existingExtension.length + 1));
      return `${basePath}.${getCreateFormatExtension(format, hasPassword)}`;
    }
    return trimmed;
  }

  // Has an unrecognized extension → replace it
  if (existingExtension) {
    const basePath = trimmed.slice(0, -(existingExtension.length + 1));
    return `${basePath}.${getCreateFormatExtension(format, hasPassword)}`;
  }

  // No recognized extension → append
  return `${trimmed}.${getCreateFormatExtension(format, hasPassword)}`;
}

export function suggestedCreateArchiveName(
  sources: string[],
  format: CreateArchiveFormat,
  fallback = "archive",
  hasPassword = false,
): string {
  const firstSource = sources[0];
  const sourceName = firstSource ? getArchiveName(firstSource, fallback) : fallback;
  const safeName = sourceName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || fallback;
  return `${safeName}.${getCreateFormatExtension(format, hasPassword)}`;
}

export function createFormatSupportsPassword(format: CreateArchiveFormat): boolean {
  return CREATE_PASSWORD_FORMATS.has(format);
}

export function normalizeTzapRecoveryPercentage(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(
    TZAP_RECOVERY_PERCENTAGE_MAX,
    Math.max(TZAP_RECOVERY_PERCENTAGE_MIN, Math.floor(value)),
  );
}

export function normalizeTzapVolumeLossTolerance(value?: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.min(
    TZAP_VOLUME_LOSS_TOLERANCE_MAX,
    Math.max(TZAP_VOLUME_LOSS_TOLERANCE_MIN, Math.floor(value)),
  );
}

export function normalizeCreateVolumeSize(value?: number): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function normalizeTzapVolumeCount(value?: number): number | undefined {
  if (value === undefined || !Number.isSafeInteger(value) || value < TZAP_VOLUME_COUNT_MIN || value > TZAP_VOLUME_COUNT_MAX) {
    return undefined;
  }
  return value;
}

function parseDirectoryPath(directory: string): ParsedDirectoryPath | null {
  const trimmed = directory.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return null;
  }

  const separator = trimmed.includes("\\") ? "\\" : "/";
  const normalized = trimmed.replace(/\\/g, "/");
  const uncMatch = normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (uncMatch) {
    const segments = (uncMatch[3] ?? "").split("/").filter(Boolean);
    return {
      root: `//${uncMatch[1]}/${uncMatch[2]}`,
      segments,
      separator,
    };
  }

  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/(.*))?$/);
  if (driveMatch) {
    const segments = (driveMatch[2] ?? "").split("/").filter(Boolean);
    return {
      root: driveMatch[1],
      segments,
      separator,
    };
  }

  if (normalized.startsWith("/")) {
    return {
      root: "/",
      segments: normalized.slice(1).split("/").filter(Boolean),
      separator: "/",
    };
  }

  return {
    root: "",
    segments: normalized.split("/").filter(Boolean),
    separator,
  };
}

function isCaseInsensitiveRoot(root: string): boolean {
  return /^[A-Za-z]:$/.test(root) || root.startsWith("//");
}

function samePathPart(left: string, right: string, caseInsensitive: boolean): boolean {
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function formatParsedDirectoryPath(parsed: ParsedDirectoryPath, segments: string[]): string | null {
  const separator = parsed.separator;
  if (parsed.root.startsWith("//")) {
    const root = parsed.root.replace(/\//g, separator);
    return segments.length ? `${root}${separator}${segments.join(separator)}` : root;
  }

  if (/^[A-Za-z]:$/.test(parsed.root)) {
    return segments.length
      ? `${parsed.root}${separator}${segments.join(separator)}`
      : `${parsed.root}${separator}`;
  }

  if (parsed.root === "/") {
    return segments.length ? `/${segments.join("/")}` : "/";
  }

  if (segments.length === 0) {
    return null;
  }

  return segments.join(separator);
}

export function commonSourceParentDirectory(
  sources: readonly string[],
  pathHelpers: CreatePathHelpers,
): string | null {
  const parents = sources
    .map((source) => pathHelpers.nativeParentPath(source))
    .map((parent) => parseDirectoryPath(parent))
    .filter((parent): parent is ParsedDirectoryPath => parent !== null);

  if (parents.length === 0) {
    return null;
  }

  const [firstParent, ...remainingParents] = parents;
  const caseInsensitive = isCaseInsensitiveRoot(firstParent.root);
  for (const parent of remainingParents) {
    if (!samePathPart(firstParent.root, parent.root, caseInsensitive)) {
      return null;
    }
  }

  const commonSegments: string[] = [];
  for (let index = 0; index < firstParent.segments.length; index += 1) {
    const segment = firstParent.segments[index];
    if (parents.every((parent) => samePathPart(segment, parent.segments[index] ?? "", caseInsensitive))) {
      commonSegments.push(segment);
      continue;
    }
    break;
  }

  return formatParsedDirectoryPath(firstParent, commonSegments);
}

export function buildCreatePlanRows(options: BuildCreatePlanRowsOptions): CreatePlanRow[] {
  const currentFolder = normalizeArchivePath(options.currentFolder);
  const rows = buildHierarchicalRows({
    entries: options.entries,
    getPath: (entry) => entry.path,
    isFolderEntry: (entry) => entry.kind === "directory",
    currentFolder,
    mode: options.searchQuery?.trim() ? "search" : "folder",
    searchQuery: options.searchQuery,
    showParentRow: Boolean(currentFolder),
  });

  const parentRows = rows.filter((row) => row.rowType === "parent");
  const sortedFolders = rows
    .filter((row): row is Extract<CreatePlanRow, { rowType: "folder" }> => row.rowType === "folder")
    .sort((left, right) => left.name.localeCompare(right.name));
  const sortedEntries = rows
    .filter((row): row is Extract<CreatePlanRow, { rowType: "entry" }> => row.rowType === "entry")
    .sort((left, right) => left.name.localeCompare(right.name));
  return [...parentRows, ...sortedFolders, ...sortedEntries];
}

export function createPlanEntriesForPath(
  entries: readonly CreatePlanEntryDto[],
  path: string,
): CreatePlanEntryDto[] {
  const normalizedPath = normalizeArchivePath(path);
  if (!normalizedPath) {
    return [...entries];
  }
  return entries.filter((entry) => isArchivePathInFolder(entry.path, normalizedPath));
}

export function isCreatePlanPathIncluded(
  excludedPaths: ReadonlySet<string> | readonly string[],
  path: string,
): boolean {
  const normalizedPath = normalizeArchivePath(path);
  if (!normalizedPath) {
    return true;
  }
  if (excludedPaths instanceof Set) {
    return !excludedPaths.has(normalizedPath);
  }
  return !normalizeExcludedCreatePlanPaths(excludedPaths).has(normalizedPath);
}

export function createPlanRowInclusionState(
  row: CreatePlanRow,
  entries: readonly CreatePlanEntryDto[],
  excludedPaths: ReadonlySet<string> | readonly string[],
): CreatePlanInclusionState {
  if (row.rowType === "parent") {
    return "included";
  }

  const normalizedExcluded = excludedPaths instanceof Set
    ? excludedPaths
    : normalizeExcludedCreatePlanPaths(excludedPaths);

  if (row.rowType === "entry") {
    return !normalizedExcluded.has(normalizeArchivePath(row.path)) ? "included" : "excluded";
  }

  const affectedEntries = createPlanEntriesForPath(entries, row.path);
  if (affectedEntries.length === 0) {
    return !normalizedExcluded.has(normalizeArchivePath(row.path)) ? "included" : "excluded";
  }

  let includedCount = 0;
  for (const entry of affectedEntries) {
    if (!normalizedExcluded.has(normalizeArchivePath(entry.path))) {
      includedCount += 1;
    }
  }

  if (includedCount === 0) {
    return "excluded";
  }
  if (includedCount === affectedEntries.length) {
    return "included";
  }
  return "partial";
}

export function applyCreatePlanPathInclusion(
  input: ApplyCreatePlanPathInclusionInput,
): Set<string> {
  const excludedPaths = normalizeExcludedCreatePlanPaths(input.excludedPaths);
  const affectedEntries = createPlanEntriesForPath(input.entries, input.path);
  const paths = affectedEntries.length
    ? affectedEntries.map((entry) => normalizeArchivePath(entry.path))
    : [normalizeArchivePath(input.path)];

  for (const entryPath of paths) {
    if (!entryPath) {
      continue;
    }
    if (input.included) {
      excludedPaths.delete(entryPath);
      let parent = getParentArchivePath(entryPath) ?? "";
      while (parent) {
        excludedPaths.delete(parent);
        parent = getParentArchivePath(parent) ?? "";
      }
    } else {
      excludedPaths.add(entryPath);
    }
  }

  return excludedPaths;
}

export function filterCreatePlanByIncludedPaths(
  plan: CreatePlanResponse,
  excludedPaths: ReadonlySet<string> | readonly string[],
): CreatePlanResponse {
  const includedEntries = plan.planEntries.filter((entry) => isCreatePlanPathIncluded(excludedPaths, entry.path));
  const excludedByUser = plan.planEntries.filter((entry) => !isCreatePlanPathIncluded(excludedPaths, entry.path));
  const excludedBytes = excludedByUser.reduce((total, entry) => total + (entry.size ?? 0), 0);
  return {
    ...plan,
    includedCount: includedEntries.length,
    excludedCount: plan.excludedCount + excludedByUser.length,
    totalBytes: includedEntries.reduce((total, entry) => total + (entry.size ?? 0), 0),
    excludedBytes: plan.excludedBytes + excludedBytes,
    entries: includedEntries.map((entry) => entry.path),
    planEntries: includedEntries,
    excludedEntries: [
      ...plan.excludedEntries,
      ...excludedByUser.map((entry) => entry.path),
    ],
  };
}

export function sourcePathForCreatePlanRow(
  row: CreatePlanRow,
  entries: readonly CreatePlanEntryDto[],
  createSources: readonly string[],
): string {
  if (row.rowType === "parent") {
    return "";
  }

  const sourceFromArchivePath = sourcePathForCreatePlanArchivePath(row.path, entries, createSources);
  if (sourceFromArchivePath) {
    return sourceFromArchivePath;
  }

  if (row.entry?.sourcePath) {
    const sourceFromNativePath = sourcePathForNativePath(row.entry.sourcePath, createSources);
    if (sourceFromNativePath) {
      return sourceFromNativePath;
    }
  }

  const descendantSources = new Set(
    createPlanEntriesForPath(entries, row.path)
      .map((entry) => sourcePathForNativePath(entry.sourcePath, createSources))
      .filter(Boolean),
  );
  if (descendantSources.size === 1) {
    return descendantSources.values().next().value ?? "";
  }

  return createSources.find((sourcePath) => getPathBasename(sourcePath) === row.path) ?? "";
}

export function isCreatePlanRevisionCurrent(resultRevision: number, currentRevision: number): boolean {
  return resultRevision === currentRevision;
}

export function createStateAfterDestinationEdit(
  state: CreateState,
  hasCurrentPlan: boolean,
): CreateState {
  return state === "error" && hasCurrentPlan ? "ready" : state;
}

export function createArchiveUnavailableReason(
  input: CreateArchiveAvailabilityInput,
): CreateArchiveUnavailableReason | null {
  if (input.submissionInFlight) {
    return "starting";
  }
  if (input.sourceCount === 0) {
    return "needsSources";
  }
  if (input.includedEntryCount !== undefined && input.includedEntryCount === 0) {
    return "needsIncludedEntries";
  }
  if (input.destinationPath.trim().length === 0) {
    return "needsDestination";
  }
  if (input.planState === "loading") {
    return "planning";
  }
  if (input.planState !== "ready" || !input.hasPlan) {
    return "needsPlan";
  }
  return null;
}

export type BuildStartCreateRequestInput = {
  sources: string[];
  destinationPath: string;
  format: CreateArchiveFormat;
  cleanSource: boolean;
  excludeNames?: string[];
  excludeArchivePaths?: string[];
  includeArchivePaths?: string[];
  respectGitignore?: boolean;
  followSymlinks?: boolean;
  replaceExisting: boolean;
  destinationCollisionStrategy?: StartCreateRequest["destinationCollisionStrategy"];
  preserveMetadata: boolean;
  password?: string;
  compressionLevel?: number;
  splitMode?: TzapSplitMode;
  volumeSize?: number;
  volumeCount?: number;
  tzapRecoveryPercentage?: number;
  tzapVolumeLossTolerance?: number;
  zipCompression?: "store" | "deflate";
  sevenZSolid?: boolean;
  sevenZThreads?: number;
  sevenZChunkSize?: number;
  sevenZEncryptFileNames?: boolean;
  tzapCertificates?: StartCreateRequest["tzapCertificates"];
  tzapBootstrapSidecar?: boolean;
};

export function buildStartCreateRequest(input: BuildStartCreateRequestInput): StartCreateRequest {
  const requestedSplitMode = input.splitMode ?? (
    input.volumeCount !== undefined
      ? "volumeCount"
      : input.volumeSize !== undefined
        ? "volumeSize"
        : "none"
  );
  const splitMode: TzapSplitMode = input.format === "tzap"
    ? requestedSplitMode
    : input.volumeSize !== undefined
      ? "volumeSize"
      : "none";
  const volumeSize = splitMode === "volumeSize" ? normalizeCreateVolumeSize(input.volumeSize) : undefined;
  const volumeCount = splitMode === "volumeCount" ? normalizeTzapVolumeCount(input.volumeCount) : undefined;

  return {
    sources: [...input.sources],
    destinationPath: withCreateArchiveExtension(input.destinationPath, input.format, Boolean(input.password)),
    format: input.format,
    cleanSource: input.cleanSource,
    ...(input.excludeNames?.length ? { excludeNames: [...input.excludeNames] } : {}),
    ...(input.excludeArchivePaths?.length ? { excludeArchivePaths: [...input.excludeArchivePaths] } : {}),
    ...(input.includeArchivePaths?.length ? { includeArchivePaths: [...input.includeArchivePaths] } : {}),
    ...(input.respectGitignore !== undefined ? { respectGitignore: input.respectGitignore } : {}),
    ...(input.followSymlinks !== undefined ? { followSymlinks: input.followSymlinks } : {}),
    replaceExisting: input.replaceExisting,
    ...(input.destinationCollisionStrategy
      ? { destinationCollisionStrategy: input.destinationCollisionStrategy }
      : {}),
    preserveMetadata: input.preserveMetadata,
    ...(input.password && createFormatSupportsPassword(input.format) ? { password: input.password } : {}),
    ...(input.compressionLevel !== undefined ? { compressionLevel: input.compressionLevel } : {}),
    ...(volumeSize !== undefined && input.format !== "tarZst" && input.format !== "tarGz" && input.format !== "appleArchive" ? { volumeSize } : {}),
    ...(volumeCount !== undefined && input.format === "tzap" ? { volumeCount } : {}),
    ...(input.format === "zip" ? { zipCompression: input.zipCompression ?? "deflate" } : {}),
    ...(input.format === "tzap"
      ? {
          tzapRecoveryPercentage:
            normalizeTzapRecoveryPercentage(input.tzapRecoveryPercentage) ?? TZAP_RECOVERY_PERCENTAGE_DEFAULT,
          tzapVolumeLossTolerance: splitMode === "none"
            ? 0
            : normalizeTzapVolumeLossTolerance(input.tzapVolumeLossTolerance) ?? 0,
          ...(input.tzapCertificates ? { tzapCertificates: input.tzapCertificates } : {}),
          ...(input.tzapBootstrapSidecar !== undefined
            ? { tzapBootstrapSidecar: input.tzapBootstrapSidecar }
            : {}),
        }
      : {}),
    ...(input.format === "sevenZ"
      ? {
          sevenZSolid: input.sevenZSolid ?? true,
          ...(input.sevenZThreads ? { sevenZThreads: Math.floor(input.sevenZThreads) } : {}),
          ...(input.sevenZChunkSize ? { sevenZChunkSize: Math.floor(input.sevenZChunkSize) } : {}),
          sevenZEncryptFileNames: input.sevenZEncryptFileNames ?? true,
        }
      : {}),
  };
}

function normalizeExcludedCreatePlanPaths(
  excludedPaths: ReadonlySet<string> | readonly string[],
): Set<string> {
  return new Set(Array.from(excludedPaths).map((path) => normalizeArchivePath(path)).filter(Boolean));
}

function sourcePathForCreatePlanArchivePath(
  archivePath: string,
  entries: readonly CreatePlanEntryDto[],
  createSources: readonly string[],
): string {
  const normalizedArchivePath = normalizeArchivePath(archivePath);
  if (!normalizedArchivePath) {
    return "";
  }

  const rootEntries = entries
    .filter((entry) => createSources.includes(entry.sourcePath))
    .sort((left, right) => normalizeArchivePath(right.path).length - normalizeArchivePath(left.path).length);
  const rootEntry = rootEntries.find((entry) => isArchivePathInFolder(normalizedArchivePath, entry.path));
  return rootEntry?.sourcePath ?? "";
}

function normalizedNativePathForCompare(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

function sourcePathForNativePath(nativePath: string, createSources: readonly string[]): string {
  const normalizedNativePath = normalizedNativePathForCompare(nativePath);
  if (!normalizedNativePath) {
    return "";
  }

  return createSources.find((sourcePath) => {
    const normalizedSourcePath = normalizedNativePathForCompare(sourcePath);
    return normalizedNativePath === normalizedSourcePath
      || normalizedNativePath.startsWith(`${normalizedSourcePath}/`);
  }) ?? "";
}
