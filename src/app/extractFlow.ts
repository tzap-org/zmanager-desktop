import type { StartExtractRequest } from "../api/types";
import { normalizeArchivePath } from "./archiveTree";

export type ExtractMode = "archive" | "selection";
export type ExtractPathMode = "full" | "current" | "none";
export type ExtractOverwritePolicy = StartExtractRequest["overwrite"];
export type TzapRestorePolicy = StartExtractRequest["tzapRestorePolicy"];

export type ExtractStartInput = Readonly<{
  destinationBasePath: string;
  useSubfolder: boolean;
  subfolder: string;
  pathMode: ExtractPathMode;
  overwrite: ExtractOverwritePolicy;
  stripComponents: string | number;
  deduplicateRoot: boolean;
  tzapRestorePolicy?: TzapRestorePolicy;
  tzapAllowDegraded?: boolean;
  ignoreSymlinks?: boolean;
  tzapRecipientKeyId?: string;
  password?: string;
}>;

export type ResolvedExtractStartInput = Readonly<{
  destination: string | null;
  destinationValid: boolean;
  overwrite: ExtractOverwritePolicy;
  stripComponents: number;
  flattenPaths: boolean;
  deduplicateRoot: boolean;
  password?: string;
  entryReferences: readonly string[];
  tzapRestorePolicy: TzapRestorePolicy;
  tzapAllowDegraded: boolean;
  ignoreSymlinks: boolean;
  tzapRecipientKeyId?: string;
}>;

export type ResolveExtractStartInputContext = Readonly<{
  currentFolder: string;
  entryReferences: readonly string[];
  joinNativePath(parentPath: string, childName: string): string;
}>;

export type BuildStartExtractRequestInput = {
  archivePath: string;
  destinationPath: string;
  overwrite: ExtractOverwritePolicy;
  destinationCollisionStrategy?: StartExtractRequest["destinationCollisionStrategy"];
  stripComponents: number;
  flattenPaths?: boolean;
  deduplicateRoot?: boolean;
  password?: string;
  entryPaths?: string[];
  selectAll?: boolean;
  excludedEntryPaths?: string[];
  tzapRestorePolicy?: TzapRestorePolicy;
  tzapAllowDegraded?: boolean;
  ignoreSymlinks?: boolean;
  recipientKeyId?: string;
};

export function buildStartExtractRequest(input: BuildStartExtractRequestInput): StartExtractRequest {
  const tzapRestorePolicy = input.tzapRestorePolicy ?? "portable";
  const destinationCollisionStrategy = input.destinationCollisionStrategy ??
    (input.overwrite === "rename" ? "renameIfBlocked" : undefined);
  return {
    archivePath: input.archivePath,
    destinationPath: input.destinationPath,
    overwrite: input.overwrite,
    ...(destinationCollisionStrategy
      ? { destinationCollisionStrategy }
      : {}),
    ...(input.entryPaths ? { entryPaths: [...input.entryPaths] } : {}),
    ...(input.selectAll ? { selectAll: true } : {}),
    ...(input.excludedEntryPaths?.length
      ? { excludedEntryPaths: [...input.excludedEntryPaths] }
      : {}),
    stripComponents: input.stripComponents,
    ...(input.flattenPaths ? { flattenPaths: true } : {}),
    ...(input.deduplicateRoot ? { deduplicateRoot: true } : {}),
    tzapRestorePolicy,
    // Only native and system metadata restoration expose the strict mode.
    tzapAllowDegraded: tzapRestorePolicy === "sameOs" || tzapRestorePolicy === "system"
      ? input.tzapAllowDegraded ?? true
      : true,
    ignoreSymlinks: input.ignoreSymlinks ?? false,
    ...(input.recipientKeyId?.trim() ? { recipientKeyId: input.recipientKeyId.trim() } : {}),
    ...(input.password ? { password: input.password } : {}),
  };
}

export function resolveExtractStartInput(
  input: ExtractStartInput,
  context: ResolveExtractStartInputContext,
): ResolvedExtractStartInput {
  const destination = resolveExtractDestination(input, context.joinNativePath);
  const entryReferences = [...context.entryReferences];
  return {
    destination,
    destinationValid: destination !== null,
    overwrite: input.overwrite,
    stripComponents: input.pathMode === "none" ? 0 : Math.max(
      0,
      numberOrZero(input.stripComponents),
      input.pathMode === "current" ? archivePathDepth(context.currentFolder) : 0,
    ),
    flattenPaths: input.pathMode === "none",
    deduplicateRoot: input.pathMode !== "none" && input.deduplicateRoot,
    ...(input.password && !input.tzapRecipientKeyId?.trim()
      ? { password: input.password }
      : {}),
    entryReferences,
    tzapRestorePolicy: input.tzapRestorePolicy ?? "portable",
    tzapAllowDegraded: input.tzapAllowDegraded ?? true,
    ignoreSymlinks: input.ignoreSymlinks ?? false,
    ...(input.tzapRecipientKeyId?.trim() ? { tzapRecipientKeyId: input.tzapRecipientKeyId.trim() } : {}),
  };
}

export function resolveExtractDestination(
  input: Pick<ExtractStartInput, "destinationBasePath" | "useSubfolder" | "subfolder">,
  joinNativePath: ResolveExtractStartInputContext["joinNativePath"],
): string | null {
  const baseDestination = input.destinationBasePath;
  if (!baseDestination) {
    return null;
  }

  if (!input.useSubfolder) {
    return baseDestination;
  }

  const subfolder = input.subfolder;
  return subfolder ? joinNativePath(baseDestination, subfolder) : baseDestination;
}

function numberOrZero(value: string | number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : Math.trunc(parsed);
}

function archivePathDepth(entryPath: string): number {
  return normalizeArchivePath(entryPath).split("/").filter(Boolean).length;
}
