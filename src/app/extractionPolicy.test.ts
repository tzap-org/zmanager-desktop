import { describe, expect, it } from "vitest";

import {
  archiveExtractionPolicy,
  extractHerePathOptions,
  hasSingleArchiveRootFolder,
  nativeDragStripComponents,
  quickExtractPathPolicy,
  singleArchiveRootFolder,
} from "./extractionPolicy";

describe("extraction policy", () => {
  it("keeps parent-folder and collision decisions together", () => {
    expect(archiveExtractionPolicy("extractHere")).toEqual({
      destination: "archiveParent",
      wrapperRoot: "preserve",
    });
    expect(archiveExtractionPolicy("extractToFolder")).toEqual({
      destination: "archiveNamedFolder",
      wrapperRoot: "preserve",
      destinationCollisionStrategy: "rename",
    });
    expect(quickExtractPathPolicy("extractHere", true)).toEqual({
      stripComponents: 0,
    });
    expect(quickExtractPathPolicy("extractToFolder", true)).toEqual({
      stripComponents: 0,
      destinationCollisionStrategy: "rename",
    });
  });

  it("preserves the archive root for Extract Here while shaping direct-file extraction", () => {
    expect(extractHerePathOptions({ stripComponents: 0 }, {
      mode: "archive",
    })).toEqual({
      pathMode: "full",
      stripComponents: 0,
      deduplicateRoot: false,
    });

    expect(extractHerePathOptions({ stripComponents: 0 }, {
      mode: "selection",
      selectedFilePath: "docs/releases/readme.txt",
    })).toEqual({
      pathMode: "full",
      stripComponents: 2,
      deduplicateRoot: false,
    });
    expect(nativeDragStripComponents({
      entryPaths: ["docs/releases/readme.txt"],
      currentFolder: "",
      flatView: true,
      searchQuery: "",
    })).toBe(2);
  });

  it("uses one root-wrapper detector for quick and normal extraction", () => {
    const entries = [
      { path: "bundle", kind: "directory" },
      { path: "bundle/readme.txt", kind: "file" },
    ];

    expect(singleArchiveRootFolder(entries)).toBe("bundle");
    expect(hasSingleArchiveRootFolder(entries.map((entry) => entry.path))).toBe(true);
    expect(hasSingleArchiveRootFolder(["README.md"])).toBe(false);
  });
});
