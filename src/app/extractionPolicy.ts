import { baseNameWithoutKnownArchiveExtension } from "./archiveFileTypes";
import { normalizeArchivePath } from "./archiveTree";
import { defaultCreateDirectory, type AppPreferences } from "./preferences";
import type { ExtractWorkspaceDefaults } from "./workspaces/extractWorkspace";

export type ArchiveExtractionAction = "extractHere" | "extractToFolder";

export function extractDefaultsForArchive(
  archivePath: string,
  preferences: AppPreferences,
  paths: Readonly<{
    nativeParentPath(path: string): string;
    joinNativePath(parentPath: string, childName: string): string;
  }>,
  action: ArchiveExtractionAction = preferences.defaultExtractionBehavior === "extractHere" ? "extractHere" : "extractToFolder",
): ExtractWorkspaceDefaults {
  const parent = paths.nativeParentPath(archivePath);
  const configuredBase = preferences.customExtractFolderPath || defaultCreateDirectory(preferences) || parent;
  const archiveName = baseNameWithoutKnownArchiveExtension(archivePath) || "ZManager";
  const destinationPath = action === "extractHere" ? parent : paths.joinNativePath(configuredBase, archiveName);

  return {
    destinationPath,
    pathMode: preferences.defaultExtractPathMode,
    overwrite: preferences.defaultExtractOverwrite,
    stripComponents: preferences.defaultExtractStripComponents,
    deduplicateRoot: preferences.defaultExtractDeduplicateRoot,
    tzapRestorePolicy: preferences.defaultTzapRestorePolicy,
    tzapAllowDegraded: preferences.defaultTzapAllowDegraded,
    ignoreSymlinks: preferences.defaultExtractIgnoreSymlinks,
  };
}

const NO_STRIPPED_COMPONENTS = 0;

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

function archivePathDepth(entryPath: string): number {
  return normalizeArchivePath(entryPath).split("/").filter(Boolean).length;
}
