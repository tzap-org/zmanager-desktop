import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_PREFERENCES } from "./preferences";
import {
  quickCreateDestination,
  quickExtractDestination,
  quickExtractDestinationCollisionStrategy,
  quickExtractDestinationPlan,
  quickExtractSingleRootFolder,
  runQuickActionRequest,
  quickActionWindowDisposition,
  uniqueQuickActionPaths,
  unsupportedQuickExtractPath,
  type QuickActionPathHelpers,
} from "./quickActions";

const pathHelpers: QuickActionPathHelpers = {
  nativeParentPath(path) {
    const normalized = path.replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    return index > 0 ? normalized.slice(0, index) : "";
  },
  joinNativePath(parent, child) {
    return parent ? `${parent}/${child}` : child;
  },
};

describe("quick action helpers", () => {
  it("uses generated policies for Main Window and Disposable Task Window actions", () => {
    expect(quickActionWindowDisposition("open")).toBe("mainWindow");
    expect(quickActionWindowDisposition("compress")).toBe("mainWindow");
    expect(quickActionWindowDisposition("extract")).toBe("mainWindow");
    expect(quickActionWindowDisposition("compressShareOnLan")).toBe("mainWindow");
    expect(quickActionWindowDisposition("shareOnLan")).toBe("mainWindow");
    expect(quickActionWindowDisposition("compressTzap")).toBe("disposableTask");
    expect(quickActionWindowDisposition("extractHere")).toBe("disposableTask");
  });

  it("deduplicates and trims quick-action paths", () => {
    expect(uniqueQuickActionPaths([" a ", "", "b", "a", " b "])).toEqual(["a", "b"]);
  });

  it("builds quick create destinations from preferences", () => {
    expect(
      quickCreateDestination(
        ["/tmp/photos"],
        "tzap",
        DEFAULT_APP_PREFERENCES,
        pathHelpers,
      ),
    ).toBe("/tmp/photos.tzap");

    expect(
      quickCreateDestination(
        ["/tmp/photos"],
        "zip",
        {
          ...DEFAULT_APP_PREFERENCES,
          defaultOutputLocation: "customFolder",
          customOutputFolderPath: "/archives",
        },
        pathHelpers,
      ),
    ).toBe("/archives/photos.zip");
  });

  it("uses the common source parent for quick create destinations", () => {
    expect(
      quickCreateDestination(
        ["/tmp/photos/raw/image.jpg", "/tmp/photos/edited/image.jpg"],
        "zip",
        DEFAULT_APP_PREFERENCES,
        pathHelpers,
      ),
    ).toBe("/tmp/photos/image.jpg.zip");
  });

  it("builds quick extract destinations from the extraction mode", () => {
    expect(quickExtractDestination("/tmp/archive.tar.zst", "extractHere", pathHelpers)).toBe(
      "/tmp",
    );
    expect(quickExtractDestination("/tmp/archive.tar.zst", "extractToFolder", pathHelpers)).toBe(
      "/tmp/archive",
    );
  });

  it("only renames the destination folder for extract-to-folder quick actions", () => {
    expect(quickExtractDestinationCollisionStrategy("extractHere")).toBeUndefined();
    expect(quickExtractDestinationCollisionStrategy("extractToFolder")).toBe("rename");
  });

  it("detects a single archive root without changing its extraction layout", () => {
    expect(quickExtractSingleRootFolder([
      { path: "photos/", kind: "directory" },
      { path: "photos/raw/image.jpg" },
      { path: "photos/edited/image.jpg" },
    ])).toBe("photos");

    expect(quickExtractSingleRootFolder([{ path: "empty", kind: "directory" }])).toBe("empty");
    expect(quickExtractSingleRootFolder([{ path: "README.md" }])).toBeNull();
    expect(quickExtractSingleRootFolder([
      { path: "photos/image.jpg" },
      { path: "docs/readme.txt" },
    ])).toBeNull();
    expect(quickExtractSingleRootFolder([{ path: "../escape.txt" }])).toBeNull();
  });

  it("plans extract-here folder-wrapped archives directly in the current directory", () => {
    expect(
      quickExtractDestinationPlan("/tmp/photos.zip", "extractHere", pathHelpers, [
        { path: "photos/", kind: "directory" },
        { path: "photos/raw/image.jpg" },
    ]),
    ).toEqual({
      destinationPath: "/tmp",
      stripComponents: 0,
    });

    expect(
      quickExtractDestinationPlan("/tmp/photos.zip", "extractHere", pathHelpers, [
        { path: "README.md" },
      ]),
    ).toEqual({
      destinationPath: "/tmp",
      stripComponents: 0,
    });
  });

  it("plans extract-to-folder quick actions with destination root renaming", () => {
    expect(
      quickExtractDestinationPlan("/tmp/photos.zip", "extractToFolder", pathHelpers),
    ).toEqual({
      destinationPath: "/tmp/photos",
      stripComponents: 0,
      destinationCollisionStrategy: "rename",
    });
  });

  it("finds unsupported archive paths", () => {
    expect(unsupportedQuickExtractPath(["one.zip", "notes.txt", "two.tzap"])).toBe("notes.txt");
    expect(unsupportedQuickExtractPath(["one.zip", "two.tzap"])).toBeNull();
  });

  it("routes generic quick actions through preferences", async () => {
    const handlers = {
      openArchive: vi.fn().mockResolvedValue(undefined),
      openCreateReview: vi.fn().mockResolvedValue(undefined),
      startCreate: vi.fn().mockResolvedValue(undefined),
      openExtractReview: vi.fn().mockResolvedValue(undefined),
      startExtract: vi.fn().mockResolvedValue(undefined),
    };

    await runQuickActionRequest(
      { kind: "compress", paths: ["/tmp/source"] },
      {
        ...DEFAULT_APP_PREFERENCES,
        defaultArchiveFormat: "tzap",
        createFormatDefaults: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
          tzap: {
            ...DEFAULT_APP_PREFERENCES.createFormatDefaults.tzap,
            cleanSource: false,
          },
        },
      },
      handlers,
    );

    expect(handlers.openCreateReview).toHaveBeenCalledWith(["/tmp/source"], "tzap", false);
    expect(handlers.startCreate).not.toHaveBeenCalled();

    await runQuickActionRequest(
      { kind: "extract", paths: ["/tmp/archive.zip"] },
      { ...DEFAULT_APP_PREFERENCES, defaultExtractionBehavior: "extractToFolder" },
      handlers,
    );

    expect(handlers.startExtract).toHaveBeenCalledWith(["/tmp/archive.zip"], "extractToFolder");
  });

  it("routes associated archive opens to browsing by default", async () => {
    const handlers = {
      openArchive: vi.fn().mockResolvedValue(undefined),
      openCreateReview: vi.fn().mockResolvedValue(undefined),
      startCreate: vi.fn().mockResolvedValue(undefined),
      openExtractReview: vi.fn().mockResolvedValue(undefined),
      startExtract: vi.fn().mockResolvedValue(undefined),
    };

    await runQuickActionRequest(
      { kind: "open", paths: ["/tmp/archive.tzap"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );

    expect(handlers.openArchive).toHaveBeenCalledWith(["/tmp/archive.tzap"]);
    expect(handlers.openExtractReview).not.toHaveBeenCalled();
    expect(handlers.startExtract).not.toHaveBeenCalled();
  });

  it("routes fixed-format create quick actions", async () => {
    const handlers = {
      openArchive: vi.fn().mockResolvedValue(undefined),
      openCreateReview: vi.fn().mockResolvedValue(undefined),
      startCreate: vi.fn().mockResolvedValue(undefined),
      openExtractReview: vi.fn().mockResolvedValue(undefined),
      startExtract: vi.fn().mockResolvedValue(undefined),
    };

    await runQuickActionRequest(
      { kind: "compressTzap", paths: ["/tmp/source"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );
    await runQuickActionRequest(
      { kind: "compressZip", paths: ["/tmp/source"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );
    await runQuickActionRequest(
      { kind: "compressSevenZ", paths: ["/tmp/source"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );
    await runQuickActionRequest(
      { kind: "compressTarZst", paths: ["/tmp/source"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );
    await runQuickActionRequest(
      { kind: "compressTarGz", paths: ["/tmp/source"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );

    expect(handlers.startCreate).toHaveBeenNthCalledWith(1, ["/tmp/source"], "tzap", false);
    expect(handlers.startCreate).toHaveBeenNthCalledWith(2, ["/tmp/source"], "zip", false);
    expect(handlers.startCreate).toHaveBeenNthCalledWith(3, ["/tmp/source"], "sevenZ", false);
    expect(handlers.startCreate).toHaveBeenNthCalledWith(4, ["/tmp/source"], "tarZst", false);
    expect(handlers.startCreate).toHaveBeenNthCalledWith(5, ["/tmp/source"], "tarGz", false);
  });

  it("uses the per-format clean-source preference for Add to .tzst", async () => {
    const handlers = {
      openArchive: vi.fn().mockResolvedValue(undefined),
      openCreateReview: vi.fn().mockResolvedValue(undefined),
      startCreate: vi.fn().mockResolvedValue(undefined),
      openExtractReview: vi.fn().mockResolvedValue(undefined),
      startExtract: vi.fn().mockResolvedValue(undefined),
    };

    await runQuickActionRequest(
      { kind: "compressTarZst", paths: ["/tmp/source"] },
      {
        ...DEFAULT_APP_PREFERENCES,
        createFormatDefaults: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
          tarZst: {
            ...DEFAULT_APP_PREFERENCES.createFormatDefaults.tarZst,
            cleanSource: true,
          },
        },
      },
      handlers,
    );

    expect(handlers.startCreate).toHaveBeenCalledWith(["/tmp/source"], "tarZst", true);
  });

  it("routes associated archive opens to browsing regardless of extraction defaults", async () => {
    const handlers = {
      openArchive: vi.fn().mockResolvedValue(undefined),
      openCreateReview: vi.fn().mockResolvedValue(undefined),
      startCreate: vi.fn().mockResolvedValue(undefined),
      openExtractReview: vi.fn().mockResolvedValue(undefined),
      startExtract: vi.fn().mockResolvedValue(undefined),
    };

    await runQuickActionRequest(
      { kind: "open", paths: ["/tmp/archive.zip"] },
      {
        ...DEFAULT_APP_PREFERENCES,
        defaultExtractionBehavior: "extractHere",
      },
      handlers,
    );

    expect(handlers.openArchive).toHaveBeenCalledWith(["/tmp/archive.zip"]);
    expect(handlers.startExtract).not.toHaveBeenCalled();
  });

  it("routes ask-every-time extraction to user review", async () => {
    const handlers = {
      openArchive: vi.fn().mockResolvedValue(undefined),
      openCreateReview: vi.fn().mockResolvedValue(undefined),
      startCreate: vi.fn().mockResolvedValue(undefined),
      openExtractReview: vi.fn().mockResolvedValue(undefined),
      startExtract: vi.fn().mockResolvedValue(undefined),
    };

    await runQuickActionRequest(
      { kind: "extract", paths: ["/tmp/archive.zip"] },
      DEFAULT_APP_PREFERENCES,
      handlers,
    );

    expect(handlers.openExtractReview).toHaveBeenCalledWith(["/tmp/archive.zip"]);
    expect(handlers.startExtract).not.toHaveBeenCalled();
  });
});
