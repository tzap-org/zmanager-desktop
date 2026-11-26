import { describe, expect, it } from "vitest";

import { classifyDropIntent, dropSurfaceForWorkspace } from "./dropIntent";

describe("drop intent classifier", () => {
  it("uses the global drop surface for the main workspace", () => {
    expect(dropSurfaceForWorkspace({ createDialogOpen: false })).toBe("global");
    expect(classifyDropIntent(["C:/work/readme.txt"], dropSurfaceForWorkspace({ createDialogOpen: false }))).toEqual({
      kind: "addCreateSources",
      surface: "global",
      sourcePaths: ["C:/work/readme.txt"],
    });
  });

  it("uses the create drop surface while the create dialog is open", () => {
    expect(dropSurfaceForWorkspace({ createDialogOpen: true })).toBe("create");
  });

  it("uses create drops for Compress mode and browse drops for Extract mode", () => {
    expect(dropSurfaceForWorkspace({ createDialogOpen: false, mode: "compress" })).toBe("create");
    expect(dropSurfaceForWorkspace({ createDialogOpen: false, mode: "extract" })).toBe("browse");
    expect(dropSurfaceForWorkspace({ createDialogOpen: true, mode: "extract" })).toBe("create");
  });

  it("opens one supported archive on the browse surface", () => {
    expect(classifyDropIntent(["C:/tmp/archive.zip"], "browse")).toEqual({
      kind: "openArchive",
      surface: "browse",
      archivePath: "C:/tmp/archive.zip",
    });
  });

  it("opens supported compound and split archives from global drops", () => {
    expect(classifyDropIntent(["C:/tmp/archive.tar.zst"], "global")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/archive.tar.zst",
    });
    expect(classifyDropIntent(["C:/tmp/archive.7z.001"], "unknown")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/archive.7z.001",
    });
    expect(classifyDropIntent(["C:/tmp/archive.vol002.tzap"], "global")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/archive.vol002.tzap",
    });
  });

  it("opens DMG and PKG archives from drops", () => {
    expect(classifyDropIntent(["C:/tmp/installer.dmg"], "global")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/installer.dmg",
    });
    expect(classifyDropIntent(["C:/tmp/installer.pkg"], "browse")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/installer.pkg",
    });
  });

  it("opens WARC and AR library archives from drops", () => {
    expect(classifyDropIntent(["C:/tmp/capture.warc"], "global")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/capture.warc",
    });
    expect(classifyDropIntent(["C:/tmp/library.lib"], "browse")).toMatchObject({
      kind: "openArchive",
      archivePath: "C:/tmp/library.lib",
    });
  });

  it("rejects ordinary source drops on the browse surface", () => {
    expect(classifyDropIntent([{ path: "C:/work/photos", kind: "directory" }], "browse")).toEqual({
      kind: "rejectUnsupportedDrop",
      surface: "browse",
      reason: "browseRequiresArchive",
      paths: ["C:/work/photos"],
      archivePaths: [],
      sourcePaths: ["C:/work/photos"],
    });
    expect(classifyDropIntent(["C:/work/notes.txt"], "browse")).toMatchObject({
      kind: "rejectUnsupportedDrop",
      reason: "browseRequiresArchive",
    });
  });

  it("adds ordinary files and folders as create sources", () => {
    expect(
      classifyDropIntent(
        [
          { path: "C:/work/photos", kind: "directory" },
          { path: "C:/work/readme.txt", kind: "file" },
        ],
        "create",
      ),
    ).toEqual({
      kind: "addCreateSources",
      surface: "create",
      sourcePaths: ["C:/work/photos", "C:/work/readme.txt"],
    });
  });

  it("treats archives as sources when they are dropped directly on create", () => {
    expect(classifyDropIntent(["C:/work/nested.zip"], "create")).toEqual({
      kind: "addCreateSources",
      surface: "create",
      sourcePaths: ["C:/work/nested.zip"],
    });
  });

  it("treats mixed drops as sources when they are dropped directly on create", () => {
    expect(classifyDropIntent(["C:/work/nested.zip", "C:/work/readme.txt"], "create")).toEqual({
      kind: "addCreateSources",
      surface: "create",
      sourcePaths: ["C:/work/nested.zip", "C:/work/readme.txt"],
    });
  });

  it("adds ordinary global drops as create sources", () => {
    expect(classifyDropIntent(["C:/work/readme.txt", "C:/work/src"], "unknown")).toEqual({
      kind: "addCreateSources",
      surface: "unknown",
      sourcePaths: ["C:/work/readme.txt", "C:/work/src"],
    });
  });

  it("asks for an action when archive and source drops are mixed", () => {
    expect(
      classifyDropIntent(
        [
          "C:/tmp/archive.zip",
          { path: "C:/work/photos", kind: "directory" },
          "C:/work/readme.txt",
        ],
        "global",
      ),
    ).toEqual({
      kind: "askAction",
      surface: "global",
      archivePaths: ["C:/tmp/archive.zip"],
      sourcePaths: ["C:/work/photos", "C:/work/readme.txt"],
    });
  });

  it("rejects empty and multi-archive open drops without guessing", () => {
    expect(classifyDropIntent(["", ""], "unknown")).toEqual({
      kind: "rejectUnsupportedDrop",
      surface: "unknown",
      reason: "emptyDrop",
      paths: [],
      archivePaths: [],
      sourcePaths: [],
    });
    expect(classifyDropIntent(["C:/tmp/a.zip", "C:/tmp/b.7z"], "browse")).toMatchObject({
      kind: "openArchive",
      surface: "browse",
      archivePath: "C:/tmp/a.zip",
      extraArchivePaths: ["C:/tmp/b.7z"],
    });
  });
});
