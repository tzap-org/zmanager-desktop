import { describe, expect, it } from "vitest";

import {
  applyCreatePlanPathInclusion,
  buildCreatePlanRows,
  buildStartCreateRequest,
  commonSourceParentDirectory,
  createArchiveUnavailableReason,
  createFormatSupportsPassword,
  createPlanRowInclusionState,
  createStateAfterDestinationEdit,
  filterCreatePlanByIncludedPaths,
  getCreateArchiveExtension,
  getCreateFormatExtension,
  isCreatePlanRevisionCurrent,
  isCreateSplitConfigurationValid,
  normalizeCreateVolumeSize,
  normalizeTzapVolumeCount,
  normalizeTzapRecoveryPercentage,
  normalizeTzapVolumeLossTolerance,
  sourcePathForCreatePlanRow,
  suggestedCreateArchiveName,
  withCreateArchiveExtension,
} from "./createFlow";
import { createFormatCapabilities, supportedCreateFormats } from "./createFormatCapabilities";
import type { CreatePlanEntryDto, CreatePlanResponse } from "../api/types";

const pathHelpers = {
  nativeParentPath(path: string): string {
    const trimmed = path.trim().replace(/[\\/]+$/, "");
    const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return slash > 0 ? trimmed.slice(0, slash) : "";
  },
};

describe("create flow helpers", () => {
  it("normalizes archive extensions to the selected format", () => {
    expect(withCreateArchiveExtension("C:/tmp/backup", "zip")).toBe("C:/tmp/backup.zip");
    expect(withCreateArchiveExtension("C:/tmp/backup.7z", "zip")).toBe("C:/tmp/backup.zip");
    expect(withCreateArchiveExtension("C:/tmp/backup.zip", "sevenZ")).toBe("C:/tmp/backup.7z");
    expect(withCreateArchiveExtension("C:/tmp/backup.tar.zst", "tarZst")).toBe("C:/tmp/backup.tar.zst");
    expect(withCreateArchiveExtension("C:/tmp/backup.zip", "tarZst")).toBe("C:/tmp/backup.tzst");
  });

  it("detects known create extensions case-insensitively", () => {
    expect(getCreateArchiveExtension("C:/tmp/report.TAR.ZST")).toBe("tar.zst");
    expect(getCreateArchiveExtension("C:/tmp/report.ZIP")).toBe("zip");
    expect(getCreateArchiveExtension("C:/tmp/report.txt")).toBeNull();
  });

  it("suggests a safe archive name from the first source", () => {
    expect(suggestedCreateArchiveName(["C:/work/my:folder"], "zip")).toBe("my_folder.zip");
    expect(suggestedCreateArchiveName([], "sevenZ")).toBe("archive.7z");
  });

  it("finds the common parent directory for selected source paths", () => {
    expect(commonSourceParentDirectory(["C:/work/docs"], pathHelpers)).toBe("C:/work");
    expect(
      commonSourceParentDirectory(
        ["C:/work/docs/readme.md", "C:/work/docs/images/logo.png"],
        pathHelpers,
      ),
    ).toBe("C:/work/docs");
    expect(
      commonSourceParentDirectory(
        ["C:\\work\\docs\\readme.md", "C:\\work\\assets\\logo.png"],
        pathHelpers,
      ),
    ).toBe("C:\\work");
  });

  it("restores a ready create state after destination edits when a plan still exists", () => {
    expect(createStateAfterDestinationEdit("error", true)).toBe("ready");
    expect(createStateAfterDestinationEdit("error", false)).toBe("error");
    expect(createStateAfterDestinationEdit("loading", true)).toBe("loading");
  });

  it("accepts only the latest create-plan revision result", () => {
    expect(isCreatePlanRevisionCurrent(3, 3)).toBe(true);
    expect(isCreatePlanRevisionCurrent(2, 3)).toBe(false);
    expect(isCreatePlanRevisionCurrent(4, 3)).toBe(false);
  });

  it("explains why create archive is unavailable", () => {
    expect(createArchiveUnavailableReason({
      sourceCount: 0,
      destinationPath: "C:/tmp/output.zip",
      planState: "ready",
      hasPlan: true,
      submissionInFlight: false,
    })).toBe("needsSources");

    expect(createArchiveUnavailableReason({
      sourceCount: 1,
      includedEntryCount: 0,
      destinationPath: "C:/tmp/output.zip",
      planState: "ready",
      hasPlan: true,
      submissionInFlight: false,
    })).toBe("needsIncludedEntries");

    expect(createArchiveUnavailableReason({
      sourceCount: 1,
      destinationPath: "",
      planState: "ready",
      hasPlan: true,
      submissionInFlight: false,
    })).toBe("needsDestination");

    expect(createArchiveUnavailableReason({
      sourceCount: 1,
      destinationPath: "C:/tmp/output.zip",
      planState: "loading",
      hasPlan: false,
      submissionInFlight: false,
    })).toBe("planning");

    expect(createArchiveUnavailableReason({
      sourceCount: 1,
      destinationPath: "C:/tmp/output.zip",
      planState: "error",
      hasPlan: false,
      submissionInFlight: false,
    })).toBe("needsPlan");
  });

  it("allows create archive only after destination and plan are valid", () => {
    expect(createArchiveUnavailableReason({
      sourceCount: 2,
      destinationPath: "C:/tmp/output.zip",
      planState: "ready",
      hasPlan: true,
      submissionInFlight: false,
    })).toBeNull();

    expect(createArchiveUnavailableReason({
      sourceCount: 2,
      destinationPath: "C:/tmp/output.zip",
      planState: "ready",
      hasPlan: true,
      submissionInFlight: true,
    })).toBe("starting");
  });

  it("builds create requests without blank optional fields", () => {
    const request = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "zip",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      zipCompression: "deflate",
      password: "",
      compressionLevel: undefined,
      volumeSize: undefined,
    });

    expect(request).toEqual({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output.zip",
      format: "zip",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      zipCompression: "deflate",
    });
  });

  it("passes selective archive path filters into create requests", () => {
    const request = buildStartCreateRequest({
      sources: ["C:/work/project"],
      destinationPath: "C:/tmp/output",
      format: "zip",
      cleanSource: false,
      excludeArchivePaths: ["project/debug.log", "project/node_modules"],
      includeArchivePaths: ["project/node_modules/kept/index.js"],
      respectGitignore: true,
      followSymlinks: false,
      replaceExisting: true,
      preserveMetadata: false,
    });

    expect(request).toMatchObject({
      excludeArchivePaths: ["project/debug.log", "project/node_modules"],
      includeArchivePaths: ["project/node_modules/kept/index.js"],
      respectGitignore: true,
      followSymlinks: false,
    });
  });

  it("scopes passwords to formats that support archive passwords", () => {
    expect(createFormatSupportsPassword("zip")).toBe(true);
    expect(createFormatSupportsPassword("tzap")).toBe(true);
    expect(createFormatSupportsPassword("sevenZ")).toBe(true);
    expect(createFormatSupportsPassword("tarZst")).toBe(false);

    expect(
      buildStartCreateRequest({
        sources: ["C:/work/source"],
        destinationPath: "C:/tmp/output",
        format: "tarZst",
        cleanSource: false,
        replaceExisting: true,
        preserveMetadata: false,
        password: "secret",
      }),
    ).not.toHaveProperty("password");
  });

  it("adds clamped recovery percentage only for TZAP requests", () => {
    expect(normalizeTzapRecoveryPercentage(105)).toBe(100);
    expect(normalizeTzapRecoveryPercentage(-1)).toBe(0);

    const tzapRequest = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      tzapRecoveryPercentage: 12,
    });
    const zipRequest = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "zip",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      tzapRecoveryPercentage: 12,
    });

    expect(tzapRequest.tzapRecoveryPercentage).toBe(12);
    expect(zipRequest).not.toHaveProperty("tzapRecoveryPercentage");
  });

  it("keeps TZAP split size and volume-loss count independent", () => {
    expect(normalizeTzapVolumeLossTolerance(-1)).toBe(0);
    expect(normalizeTzapVolumeLossTolerance(17)).toBe(16);

    const split = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      volumeSize: 10 * 1024 * 1024,
      tzapVolumeLossTolerance: 17,
    });
    const single = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      tzapVolumeLossTolerance: 4,
    });

    expect(split.volumeSize).toBe(10 * 1024 * 1024);
    expect(split.tzapVolumeLossTolerance).toBe(16);
    expect(single.tzapVolumeLossTolerance).toBe(0);
  });

  it("builds exact TZAP volume counts as an alternate split mode", () => {
    expect(normalizeTzapVolumeCount(1)).toBeUndefined();
    expect(normalizeTzapVolumeCount(2)).toBe(2);
    expect(normalizeTzapVolumeCount(2.5)).toBeUndefined();

    const request = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      splitMode: "volumeCount",
      volumeSize: 10 * 1024 * 1024,
      volumeCount: 4,
      tzapVolumeLossTolerance: 2,
    });

    expect(request).not.toHaveProperty("volumeSize");
    expect(request.volumeCount).toBe(4);
    expect(request.tzapVolumeLossTolerance).toBe(2);
  });

  it("requires an exact volume count before enabling count mode", () => {
    expect(isCreateSplitConfigurationValid({
      format: "tzap",
      splitMode: "volumeCount",
      volumeSize: null,
      volumeCount: null,
    })).toBe(false);
    expect(createArchiveUnavailableReason({
      sourceCount: 1,
      destinationPath: "C:/tmp/output.tzap",
      planState: "ready",
      hasPlan: true,
      submissionInFlight: false,
      format: "tzap",
      splitMode: "volumeCount",
      volumeSize: null,
      volumeCount: null,
    })).toBe("invalidSplitConfiguration");
    expect(isCreateSplitConfigurationValid({
      format: "tzap",
      splitMode: "volumeCount",
      volumeSize: null,
      volumeCount: 3,
    })).toBe(true);
  });

  it("blocks recipient encryption when split or volume-loss settings are present", () => {
    expect(isCreateSplitConfigurationValid({
      format: "tzap",
      splitMode: "volumeCount",
      volumeSize: null,
      volumeCount: 3,
      tzapVolumeLossTolerance: 0,
      recipientEncryptionSelected: true,
    })).toBe(false);
    expect(isCreateSplitConfigurationValid({
      format: "tzap",
      splitMode: "none",
      volumeSize: null,
      volumeCount: null,
      tzapVolumeLossTolerance: 1,
      recipientEncryptionSelected: true,
    })).toBe(false);
    expect(isCreateSplitConfigurationValid({
      format: "tzap",
      splitMode: "none",
      volumeSize: null,
      volumeCount: null,
      tzapVolumeLossTolerance: 0,
      recipientEncryptionSelected: true,
    })).toBe(true);
    expect(isCreateSplitConfigurationValid({
      format: "tzap",
      splitMode: "none",
      volumeSize: null,
      volumeCount: null,
      tzapVolumeLossTolerance: 1,
      recipientEncryptionSelected: false,
    })).toBe(false);
  });

  it("passes tzapBootstrapSidecar toggle only for TZAP requests", () => {
    const withSidecar = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      tzapBootstrapSidecar: true,
    });
    const withoutSidecar = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      tzapBootstrapSidecar: false,
    });
    const zipRequest = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "zip",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      tzapBootstrapSidecar: true,
    });

    expect(withSidecar.tzapBootstrapSidecar).toBe(true);
    expect(withoutSidecar.tzapBootstrapSidecar).toBe(false);
    expect(zipRequest).not.toHaveProperty("tzapBootstrapSidecar");
  });

  it("treats zero volume size as no split request", () => {
    expect(normalizeCreateVolumeSize(0)).toBeUndefined();
    expect(normalizeCreateVolumeSize(-1)).toBeUndefined();
    expect(normalizeCreateVolumeSize(1024.8)).toBe(1024);

    const request = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      volumeSize: 0,
      tzapRecoveryPercentage: 0,
    });

    expect(request).not.toHaveProperty("volumeSize");
    expect(request.tzapRecoveryPercentage).toBe(0);
  });

  it("includes destination collision strategy when requested", () => {
    const request = buildStartCreateRequest({
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      format: "tzap",
      cleanSource: false,
      replaceExisting: false,
      destinationCollisionStrategy: "rename",
      preserveMetadata: false,
    });

    expect(request.destinationCollisionStrategy).toBe("rename");
  });

  it("drops every create option that is unsupported by the selected format", () => {
    const common = {
      sources: ["C:/work/source"],
      destinationPath: "C:/tmp/output",
      cleanSource: false,
      replaceExisting: true,
      preserveMetadata: false,
      password: "secret",
      volumeSize: 1024,
      compressionLevel: 9,
      zipCompression: "store" as const,
      tzapRecoveryPercentage: 12,
      tzapVolumeLossTolerance: 4,
      sevenZSolid: false,
      sevenZThreads: 2,
      sevenZChunkSize: 1024,
      sevenZEncryptFileNames: false,
      tzapBootstrapSidecar: true,
    };

    for (const format of ["zip", "tarZst", "tzap", "sevenZ", "tarGz", "appleArchive"] as const) {
      const request = buildStartCreateRequest({ ...common, format });
      const capabilities = createFormatCapabilities(format);
      assertOptionPresence(request, "password", capabilities.password);
      assertOptionPresence(request, "volumeSize", capabilities.splitVolumes);
      assertOptionPresence(request, "zipCompression", capabilities.zipCompression);
      assertOptionPresence(request, "tzapRecoveryPercentage", capabilities.tzapRecovery);
      assertOptionPresence(request, "tzapVolumeLossTolerance", capabilities.tzapVolumeLossTolerance);
      assertOptionPresence(request, "sevenZSolid", capabilities.sevenZAdvanced);
      assertOptionPresence(request, "sevenZThreads", capabilities.sevenZAdvanced);
      assertOptionPresence(request, "sevenZChunkSize", capabilities.sevenZAdvanced);
      assertOptionPresence(request, "sevenZEncryptFileNames", capabilities.sevenZAdvanced);
      assertOptionPresence(request, "tzapBootstrapSidecar", format === "tzap");
      expect(request.compressionLevel).toBe(9);
      if (format === "tzap") expect(request.tzapVolumeLossTolerance).toBe(4);
      if (format !== "tzap" && !capabilities.tzapVolumeLossTolerance) expect(request).not.toHaveProperty("tzapVolumeLossTolerance");
    }
  });

  it("keeps Apple Archive out of the picker when the native capability is absent", () => {
    expect(supportedCreateFormats(false)).not.toContain("appleArchive");
    expect(supportedCreateFormats(true)).toContain("appleArchive");
  });
});

function assertOptionPresence(
  request: object,
  option: string,
  expected: boolean,
): void {
  expect(Object.prototype.hasOwnProperty.call(request, option), `${option} capability mismatch`).toBe(expected);
}

describe("create plan rows", () => {
  const sources = [
    "C:/work/project",
    "C:/work/assets",
    "C:/work/zeta.txt",
  ];
  const planEntries: CreatePlanEntryDto[] = [
    { path: "project", kind: "directory", sourcePath: "C:/work/project" },
    { path: "project/src/index.ts", kind: "file", size: 10, sourcePath: "C:/work/project/src/index.ts" },
    { path: "project/README.md", kind: "file", size: 2, sourcePath: "C:/work/project/README.md" },
    { path: "assets/logo.png", kind: "file", size: 3, sourcePath: "C:/work/assets/logo.png" },
    { path: "zeta.txt", kind: "file", size: 1, sourcePath: "C:/work/zeta.txt" },
  ];
  const plan: CreatePlanResponse = {
    includedCount: planEntries.length,
    excludedCount: 0,
    totalBytes: 16,
    excludedBytes: 0,
    entries: planEntries.map((entry) => entry.path),
    planEntries,
    excludedEntries: [],
    warnings: [],
  };

  it("builds root create-plan rows and maps each row back to the owning source", () => {
    const rows = buildCreatePlanRows({ entries: planEntries });

    expect(rows.map((row) => [row.rowType, row.path, row.name])).toEqual([
      ["folder", "assets", "assets"],
      ["folder", "project", "project"],
      ["entry", "zeta.txt", "zeta.txt"],
    ]);
    expect(rows.map((row) => sourcePathForCreatePlanRow(row, planEntries, sources))).toEqual([
      "C:/work/assets",
      "C:/work/project",
      "C:/work/zeta.txt",
    ]);
  });

  it("builds nested rows with a parent row and sorted folders before entries", () => {
    const rows = buildCreatePlanRows({ entries: planEntries, currentFolder: "project" });

    expect(rows.map((row) => [row.rowType, row.path, row.name])).toEqual([
      ["parent", "", ".."],
      ["folder", "project/src", "src"],
      ["entry", "project/README.md", "README.md"],
    ]);
  });

  it("derives included, excluded, and partial folder states from excluded paths", () => {
    const rows = buildCreatePlanRows({ entries: planEntries });
    const projectRow = rows.find((row) => row.path === "project")!;
    const assetsRow = rows.find((row) => row.path === "assets")!;
    const excludedPaths = new Set(["project/src/index.ts", "assets/logo.png"]);

    expect(createPlanRowInclusionState(projectRow, planEntries, excludedPaths)).toBe("partial");
    expect(createPlanRowInclusionState(assetsRow, planEntries, excludedPaths)).toBe("excluded");
    expect(createPlanRowInclusionState(rows.find((row) => row.path === "zeta.txt")!, planEntries, excludedPaths)).toBe("included");
  });

  it("updates excluded paths for folder exclusions and descendant re-inclusion", () => {
    const excludedProject = applyCreatePlanPathInclusion({
      entries: planEntries,
      excludedPaths: [],
      path: "project",
      included: false,
    });

    expect(Array.from(excludedProject).sort()).toEqual([
      "project",
      "project/README.md",
      "project/src/index.ts",
    ]);

    const includedChild = applyCreatePlanPathInclusion({
      entries: planEntries,
      excludedPaths: new Set(["project", "project/src", "project/src/index.ts"]),
      path: "project/src/index.ts",
      included: true,
    });

    expect(Array.from(includedChild)).toEqual([]);
  });

  it("filters create plans and keeps byte counts aligned with user exclusions", () => {
    const filtered = filterCreatePlanByIncludedPaths(plan, new Set(["assets/logo.png"]));

    expect(filtered.includedCount).toBe(4);
    expect(filtered.excludedCount).toBe(1);
    expect(filtered.totalBytes).toBe(13);
    expect(filtered.excludedBytes).toBe(3);
    expect(filtered.entries).not.toContain("assets/logo.png");
    expect(filtered.excludedEntries).toEqual(["assets/logo.png"]);
  });
});

describe("withCreateArchiveExtension - appleArchive", () => {
  it("uses .aar when no password", () => {
    expect(withCreateArchiveExtension("test", "appleArchive", false)).toBe("test.aar");
  });

  it("uses .aea when hasPassword is true", () => {
    expect(withCreateArchiveExtension("test", "appleArchive", true)).toBe("test.aea");
  });

  it("keeps .aar when no password and extension already matches", () => {
    expect(withCreateArchiveExtension("test.aar", "appleArchive", false)).toBe("test.aar");
  });

  it("swaps .aar to .aea when password added", () => {
    expect(withCreateArchiveExtension("test.aar", "appleArchive", true)).toBe("test.aea");
  });

  it("swaps .aea to .aar when password removed", () => {
    expect(withCreateArchiveExtension("test.aea", "appleArchive", false)).toBe("test.aar");
  });

  it("keeps .aea when password present and extension already matches", () => {
    expect(withCreateArchiveExtension("test.aea", "appleArchive", true)).toBe("test.aea");
  });

  it("does not produce double extension (.aea.aea)", () => {
    expect(withCreateArchiveExtension("test.aea", "appleArchive", true)).toBe("test.aea");
  });

  it("defaults hasPassword to false", () => {
    expect(withCreateArchiveExtension("test", "appleArchive")).toBe("test.aar");
  });
});

describe("getCreateFormatExtension - appleArchive", () => {
  it("returns aar when hasPassword is false", () => {
    expect(getCreateFormatExtension("appleArchive", false)).toBe("aar");
  });

  it("returns aea when hasPassword is true", () => {
    expect(getCreateFormatExtension("appleArchive", true)).toBe("aea");
  });

  it("defaults to aar when hasPassword is omitted", () => {
    expect(getCreateFormatExtension("appleArchive")).toBe("aar");
  });
});

describe("suggestedCreateArchiveName - appleArchive", () => {
  it("suggests .aar extension by default", () => {
    expect(suggestedCreateArchiveName(["/tmp/src"], "appleArchive")).toBe("src.aar");
  });

  it("suggests .aea extension with password", () => {
    expect(suggestedCreateArchiveName(["/tmp/src"], "appleArchive", "archive", true)).toBe("src.aea");
  });
});

describe("createFormatSupportsPassword - appleArchive", () => {
  it("appleArchive supports password", () => {
    expect(createFormatSupportsPassword("appleArchive")).toBe(true);
  });
});

describe("buildStartCreateRequest - appleArchive", () => {
  it("uses .aea extension when password is present", () => {
    const req = buildStartCreateRequest({
      sources: ["/tmp/src"],
      destinationPath: "output.aar",
      format: "appleArchive",
      cleanSource: true,
      replaceExisting: false,
      preserveMetadata: true,
      password: "secret",
    });
    expect(req.destinationPath).toBe("output.aea");
    expect(req.format).toBe("appleArchive");
  });

  it("uses .aar extension when no password", () => {
    const req = buildStartCreateRequest({
      sources: ["/tmp/src"],
      destinationPath: "output",
      format: "appleArchive",
      cleanSource: true,
      replaceExisting: false,
      preserveMetadata: true,
    });
    expect(req.destinationPath).toBe("output.aar");
  });

  it("omits volumeSize for appleArchive format", () => {
    const req = buildStartCreateRequest({
      sources: ["/tmp/src"],
      destinationPath: "output",
      format: "appleArchive",
      cleanSource: true,
      replaceExisting: false,
      preserveMetadata: true,
      volumeSize: 1000000,
    });
    expect(req.volumeSize).toBeUndefined();
  });
});
