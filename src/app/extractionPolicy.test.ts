import { describe, expect, it } from "vitest";

import { extractDefaultsForArchive, nativeDragStripComponents } from "./extractionPolicy";
import { DEFAULT_APP_PREFERENCES } from "./preferences";

describe("extraction policy", () => {
  it("applies one set of saved options with the requested destination", () => {
    const preferences = {
      ...DEFAULT_APP_PREFERENCES,
      customExtractFolderPath: "/out",
      defaultExtractOverwrite: "refuse" as const,
      defaultExtractPathMode: "none" as const,
      defaultExtractStripComponents: 2,
      defaultExtractIgnoreSymlinks: true,
    };
    const paths = {
      nativeParentPath: () => "/archives",
      joinNativePath: (parent: string, child: string) => `${parent}/${child}`,
    };
    const defaults = extractDefaultsForArchive("/archives/demo.tar.zst", preferences, paths);
    expect(defaults).toMatchObject({
      destinationPath: "/out/demo",
      overwrite: "refuse",
      pathMode: "none",
      stripComponents: 2,
      ignoreSymlinks: true,
    });
    expect(extractDefaultsForArchive("/archives/demo.tar.zst", preferences, paths, "extractHere")).toEqual({
      ...defaults,
      destinationPath: "/archives",
    });
  });

  it("strips parent components for a single-file drag", () => {
    expect(nativeDragStripComponents({
      entryPaths: ["docs/releases/readme.txt"],
      currentFolder: "",
      flatView: true,
      searchQuery: "",
    })).toBe(2);
  });
});
