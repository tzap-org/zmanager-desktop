import { describe, expect, it } from "vitest";

import { normalizeDroppedPath, normalizeDroppedPaths } from "./paths";

describe("desktop dropped path normalization", () => {
  it("preserves whitespace in literal native paths", () => {
    expect(normalizeDroppedPath("/tmp/report.zip ")).toBe("/tmp/report.zip ");
  });

  it("normalizes Windows drive file URIs into command-ready paths", () => {
    expect(normalizeDroppedPath("file:///C:/Users/Frank/My%20Archive.zip")).toBe(
      "C:\\Users\\Frank\\My Archive.zip",
    );
  });

  it("normalizes UNC file URIs with decoded path segments", () => {
    expect(normalizeDroppedPath("file://nas01/Archive%20Share/%E6%B5%8B%E8%AF%95.zip")).toBe(
      "\\\\nas01\\Archive Share\\\u6D4B\u8BD5.zip",
    );
  });

  it("keeps Linux-style file URIs intact after decoding", () => {
    expect(normalizeDroppedPath("file:///home/frank/archive%20set/source.tar.zst")).toBe(
      "/home/frank/archive set/source.tar.zst",
    );
  });

  it("filters empty dropped paths after normalization", () => {
    expect(normalizeDroppedPaths(["", "file:///C:/tmp/archive.zip"])).toEqual([
      "C:\\tmp\\archive.zip",
    ]);
  });
});
