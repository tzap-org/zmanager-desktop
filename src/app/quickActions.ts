import type { QuickActionRequestDto, StartExtractRequest } from "../api/types";
import { SHELL_ACTION_POLICIES } from "../api/generated/shellActions.generated";
import { resolveDestinationCollisionStrategy } from "./collisionPolicy";
import { isSupportedArchivePath, baseNameWithoutKnownArchiveExtension } from "./archiveFileTypes";
import {
  commonSourceParentDirectory,
  suggestedCreateArchiveName,
  withCreateArchiveExtension,
  type CreatePathHelpers,
  type CreateArchiveFormat,
} from "./createFlow";
import {
  createDefaultsForFormat,
  defaultCreateDirectory,
  type AppPreferences,
} from "./preferences";
import {
  archiveExtractionPolicy,
  quickExtractPathPolicy,
  singleArchiveRootFolder,
  type ArchiveExtractionAction,
} from "./extractionPolicy";

export type QuickActionExtractMode = ArchiveExtractionAction;
export type QuickActionWindowDisposition = "mainWindow" | "disposableTask";

export type QuickActionPathHelpers = CreatePathHelpers & {
  joinNativePath: (parentPath: string, childName: string) => string;
};

export type QuickExtractEntry = {
  path: string;
  kind?: string;
};

export type QuickExtractDestinationPlan = {
  destinationPath: string;
  stripComponents: number;
  destinationCollisionStrategy?: StartExtractRequest["destinationCollisionStrategy"];
};

export type QuickActionHandlers = {
  openArchive: (paths: string[]) => Promise<void>;
  openCreateReview: (paths: string[], format: CreateArchiveFormat, cleanSource: boolean) => Promise<void>;
  startCreate: (paths: string[], format: CreateArchiveFormat, cleanSource: boolean) => Promise<void>;
  openExtractReview: (paths: string[]) => Promise<void>;
  startExtract: (paths: string[], action: QuickActionExtractMode) => Promise<void>;
};

export function uniqueQuickActionPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.filter(Boolean)));
}

export function quickActionWindowDisposition(
  kind: QuickActionRequestDto["kind"],
): QuickActionWindowDisposition {
  const policy = SHELL_ACTION_POLICIES.find((candidate) => candidate.id === kind);
  if (!policy) {
    throw new Error(`Missing shell action policy for ${kind}`);
  }
  return policy.windowDisposition;
}

export function quickCreateDestination(
  paths: string[],
  format: CreateArchiveFormat,
  preferences: AppPreferences,
  pathHelpers: QuickActionPathHelpers,
): string {
  const firstPath = paths[0] ?? "";
  const outputDirectory =
    defaultCreateDirectory(preferences) ??
    commonSourceParentDirectory(paths, pathHelpers) ??
    pathHelpers.nativeParentPath(firstPath);
  const name = suggestedCreateArchiveName(paths, format);
  return withCreateArchiveExtension(
    outputDirectory ? pathHelpers.joinNativePath(outputDirectory, name) : name,
    format,
  );
}

export function quickExtractDestination(
  archivePath: string,
  action: QuickActionExtractMode,
  pathHelpers: QuickActionPathHelpers,
): string {
  const parent = pathHelpers.nativeParentPath(archivePath);
  const policy = archiveExtractionPolicy(action);
  if (policy.destination === "archiveParent") {
    return parent;
  }

  const folderName = baseNameWithoutKnownArchiveExtension(archivePath);
  return parent ? pathHelpers.joinNativePath(parent, folderName) : folderName;
}

export function quickExtractDestinationCollisionStrategy(
  action: QuickActionExtractMode,
): StartExtractRequest["destinationCollisionStrategy"] | undefined {
  return archiveExtractionPolicy(action).destinationCollisionStrategy;
}

export function quickExtractSingleRootFolder(entries: readonly QuickExtractEntry[]): string | null {
  return singleArchiveRootFolder(entries);
}

export function quickExtractDestinationPlan(
  archivePath: string,
  action: QuickActionExtractMode,
  pathHelpers: QuickActionPathHelpers,
  entries?: readonly QuickExtractEntry[],
): QuickExtractDestinationPlan {
  const destinationPath = quickExtractDestination(archivePath, action, pathHelpers);
  const rootFolder = entries ? quickExtractSingleRootFolder(entries) : null;
  const pathPolicy = quickExtractPathPolicy(
    action,
    Boolean(rootFolder),
  );
  return {
    destinationPath,
    ...pathPolicy,
  };
}

export function unsupportedQuickExtractPath(paths: string[]): string | null {
  return uniqueQuickActionPaths(paths).find((path) => !isSupportedArchivePath(path)) ?? null;
}

export async function runQuickActionRequest(
  request: QuickActionRequestDto,
  preferences: AppPreferences,
  handlers: QuickActionHandlers,
): Promise<void> {
  switch (request.kind) {
    case "open":
      await handlers.openArchive(request.paths);
      break;
    case "compress":
      {
        const createDefaults = createDefaultsForFormat(preferences, preferences.defaultArchiveFormat);
        await handlers.openCreateReview(
          request.paths,
          preferences.defaultArchiveFormat,
          createDefaults.cleanSource,
        );
      }
      break;
    case "extract":
      if (preferences.defaultExtractionBehavior === "askEveryTime") {
        await handlers.openExtractReview(request.paths);
      } else {
        await handlers.startExtract(request.paths, preferences.defaultExtractionBehavior);
      }
      break;
    case "compressZip":
      await handlers.startCreate(
        request.paths,
        "zip",
        createDefaultsForFormat(preferences, "zip").cleanSource,
      );
      break;
    case "compressTzap":
      await handlers.startCreate(
        request.paths,
        "tzap",
        createDefaultsForFormat(preferences, "tzap").cleanSource,
      );
      break;
    case "compressSevenZ":
      await handlers.startCreate(
        request.paths,
        "sevenZ",
        createDefaultsForFormat(preferences, "sevenZ").cleanSource,
      );
      break;
    case "compressTarZst":
      await handlers.startCreate(
        request.paths,
        "tarZst",
        createDefaultsForFormat(preferences, "tarZst").cleanSource,
      );
      break;
    case "compressTarGz":
      await handlers.startCreate(
        request.paths,
        "tarGz",
        createDefaultsForFormat(preferences, "tarGz").cleanSource,
      );
      break;
    case "compressAppleArchive":
      await handlers.startCreate(
        request.paths,
        "appleArchive",
        createDefaultsForFormat(preferences, "appleArchive").cleanSource,
      );
      break;
    case "compressCleanSource":
      await handlers.startCreate(request.paths, "tarZst", true);
      break;
    case "extractHere":
      await handlers.startExtract(request.paths, "extractHere");
      break;
    case "extractToFolder":
      await handlers.startExtract(request.paths, "extractToFolder");
      break;
  }
}
