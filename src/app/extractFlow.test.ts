import { describe, expect, it } from "vitest";

import {
  buildStartExtractRequest,
  resolveExtractStartInput,
} from "./extractFlow";

describe("extract flow helpers", () => {
  it("builds full archive extract requests without selected entry paths", () => {
    expect(
      buildStartExtractRequest({
        archivePath: "C:/tmp/archive.zip",
        destinationPath: "C:/tmp/out",
        overwrite: "ask",
        stripComponents: 0,
        password: "",
      }),
    ).toEqual({
      archivePath: "C:/tmp/archive.zip",
      destinationPath: "C:/tmp/out",
      overwrite: "ask",
      destinationCollisionStrategy: "renameIfBlocked",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: true,
      ignoreSymlinks: false,
    });
  });

  it("builds selected extract requests with copied entry paths and password", () => {
    const entryPaths = ["source/hello.txt"];
    const request = buildStartExtractRequest({
      archivePath: "C:/tmp/archive.zip",
      destinationPath: "C:/tmp/out",
      overwrite: "rename",
      entryPaths,
      stripComponents: 1,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      ignoreSymlinks: false,
      password: "secret",
    });

    entryPaths.push("source/late.txt");

    expect(request).toEqual({
      archivePath: "C:/tmp/archive.zip",
      destinationPath: "C:/tmp/out",
      overwrite: "rename",
      destinationCollisionStrategy: "renameIfBlocked",
      entryPaths: ["source/hello.txt"],
      stripComponents: 1,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: true,
      ignoreSymlinks: false,
      password: "secret",
    });
  });

  it("includes destination collision strategy when requested", () => {
    const request = buildStartExtractRequest({
      archivePath: "C:/tmp/archive.zip",
      destinationPath: "C:/tmp/out",
      overwrite: "rename",
      destinationCollisionStrategy: "rename",
      stripComponents: 0,
    });

    expect(request.destinationCollisionStrategy).toBe("rename");
  });

  it("includes a trimmed local recipient key selection", () => {
    const request = buildStartExtractRequest({
      archivePath: "C:/tmp/archive.tzap",
      destinationPath: "C:/tmp/out",
      overwrite: "ask",
      stripComponents: 0,
      recipientKeyId: "  recipient_local  ",
    });

    expect(request.recipientKeyId).toBe("recipient_local");
  });

  it("resolves explicit dialog input into request-ready destination and strip depth", () => {
    const resolved = resolveExtractStartInput({
      destinationBasePath: "/tmp/out ",
      useSubfolder: true,
      subfolder: "review",
      pathMode: "current",
      overwrite: "ask",
      stripComponents: "1",
      deduplicateRoot: false,
      tzapRestorePolicy: "system",
      tzapAllowDegraded: true,
      ignoreSymlinks: true,
      password: " secret ",
      tzapRecipientKeyId: " recipient_local ",
    }, {
      currentFolder: "docs/releases",
      entryReferences: ["root/docs/releases/readme.txt"],
      joinNativePath: (parent, child) => `${parent}/${child}`,
    });

    expect(resolved).toEqual({
      destination: "/tmp/out /review",
      destinationValid: true,
      overwrite: "ask",
      stripComponents: 2,
      flattenPaths: false,
      deduplicateRoot: false,
      entryReferences: ["root/docs/releases/readme.txt"],
      tzapRestorePolicy: "system",
      tzapAllowDegraded: true,
      ignoreSymlinks: true,
      tzapRecipientKeyId: "recipient_local",
    });
  });

  it("rejects empty base destinations before subfolder joining", () => {
    const resolved = resolveExtractStartInput({
      destinationBasePath: "",
      useSubfolder: true,
      subfolder: "ignored",
      pathMode: "full",
      overwrite: "ask",
      stripComponents: "0",
      deduplicateRoot: false,
    }, {
      currentFolder: "",
      entryReferences: ["root/readme.txt"],
      joinNativePath: (parent, child) => `${parent}/${child}`,
    });

    expect(resolved.destination).toBeNull();
    expect(resolved.destinationValid).toBe(false);
  });

  it("sends No paths as a flattening request instead of globally stripping components", () => {
    const resolved = resolveExtractStartInput({
      destinationBasePath: "C:/tmp/out",
      useSubfolder: false,
      subfolder: "",
      pathMode: "none",
      overwrite: "rename",
      stripComponents: "0",
      deduplicateRoot: true,
    }, {
      currentFolder: "",
      entryReferences: [],
      joinNativePath: (parent, child) => `${parent}/${child}`,
    });

    expect(resolved).toMatchObject({ stripComponents: 0, flattenPaths: true, deduplicateRoot: false });
  });
});
