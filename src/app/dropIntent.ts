import { isSupportedArchivePath } from "./archiveFileTypes";

export type DropIntentSurface = "browse" | "create" | "global" | "unknown";
export type DroppedPathKind = "file" | "directory" | "unknown";
export type WorkspaceDropMode = "compress" | "extract";
export type DropIntentWorkspaceState = {
  createDialogOpen: boolean;
  mode?: WorkspaceDropMode;
};

export type DroppedPath =
  | string
  | {
      path: string;
      kind?: DroppedPathKind;
    };

export type DropRejectReason =
  | "emptyDrop"
  | "browseRequiresArchive"
  | "openRequiresSingleArchive";

export type DropIntentDecision =
  | {
      kind: "openArchive";
      surface: DropIntentSurface;
      archivePath: string;
      extraArchivePaths?: readonly string[];
    }
  | {
      kind: "addCreateSources";
      surface: DropIntentSurface;
      sourcePaths: string[];
    }
  | {
      kind: "askAction";
      surface: DropIntentSurface;
      archivePaths: string[];
      sourcePaths: string[];
    }
  | {
      kind: "rejectUnsupportedDrop";
      surface: DropIntentSurface;
      reason: DropRejectReason;
      paths: string[];
      archivePaths: string[];
      sourcePaths: string[];
    };

export function dropSurfaceForWorkspace(state: DropIntentWorkspaceState): DropIntentSurface {
  if (state.createDialogOpen || state.mode === "compress") {
    return "create";
  }

  if (state.mode === "extract") {
    return "browse";
  }

  return "global";
}

type ClassifiedDropPath = {
  path: string;
  archive: boolean;
};

export function classifyDropIntent(
  droppedPaths: readonly DroppedPath[],
  surface: DropIntentSurface = "unknown",
): DropIntentDecision {
  const classifiedPaths = droppedPaths
    .map(classifyDroppedPath)
    .filter((item): item is ClassifiedDropPath => item !== null);
  const paths = classifiedPaths.map((item) => item.path);
  const archivePaths = classifiedPaths.filter((item) => item.archive).map((item) => item.path);
  const sourcePaths = classifiedPaths.filter((item) => !item.archive).map((item) => item.path);

  if (paths.length === 0) {
    return rejectDrop(surface, "emptyDrop", paths, archivePaths, sourcePaths);
  }

  if (surface === "create") {
    return {
      kind: "addCreateSources",
      surface,
      sourcePaths: paths,
    };
  }

  if (archivePaths.length > 0 && sourcePaths.length > 0) {
    return {
      kind: "askAction",
      surface,
      archivePaths,
      sourcePaths,
    };
  }

  if (archivePaths.length === 1) {
    return {
      kind: "openArchive",
      surface,
      archivePath: archivePaths[0],
    };
  }

  if (archivePaths.length > 1) {
    const [archivePath, ...extraArchivePaths] = archivePaths;
    return {
      kind: "openArchive",
      surface,
      archivePath,
      extraArchivePaths,
    };
  }

  if (surface === "browse") {
    return rejectDrop(surface, "browseRequiresArchive", paths, archivePaths, sourcePaths);
  }

  return {
    kind: "addCreateSources",
    surface,
    sourcePaths,
  };
}

function classifyDroppedPath(droppedPath: DroppedPath): ClassifiedDropPath | null {
  const path = typeof droppedPath === "string" ? droppedPath : droppedPath.path;
  if (!path) {
    return null;
  }

  const kind = typeof droppedPath === "string" ? "unknown" : (droppedPath.kind ?? "unknown");
  return {
    path,
    archive: kind !== "directory" && isSupportedArchivePath(path),
  };
}

function rejectDrop(
  surface: DropIntentSurface,
  reason: DropRejectReason,
  paths: string[],
  archivePaths: string[],
  sourcePaths: string[],
): DropIntentDecision {
  return {
    kind: "rejectUnsupportedDrop",
    surface,
    reason,
    paths,
    archivePaths,
    sourcePaths,
  };
}
