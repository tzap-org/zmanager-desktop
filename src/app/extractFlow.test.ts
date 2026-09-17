import { describe, expect, it } from "vitest";

import {
  buildStartExtractRequest,
  resolveExtractStartInput,
} from "./extractFlow";
import { extractHerePathOptions } from "./extractionPolicy";

describe("extract flow helpers", () => {
  it("prepares Extract Here to preserve the archive root in the current folder", () => {
    const input = {
      destinationBasePath: "C:/tmp",
      useSubfolder: false,
      subfolder: "",
      pathMode: "none" as const,
      overwrite: "rename" as const,
      stripComponents: "0",
      deduplicateRoot: false,
    };

    expect(extractHerePathOptions(input, { mode: "archive" })).toMatchObject({
      pathMode: "full",
      stripComponents: 0,
      deduplicateRoot: false,
    });
    expect(extractHerePathOptions(input, {
      mode: "selection",
      selectedFilePath: "docs/releases/readme.txt",
    })).toMatchObject({
      pathMode: "full",
      stripComponents: 2,
      deduplicateRoot: false,
    });
  });

  it("builds full archive extract requests without selected entry paths", () => {
    expect(
      buildStartExtractRequest({
        archivePath: "C:/tmp/archive.zip",
        destinationPath: "C:/tmp/out",
        overwrite: "replace",
        stripComponents: 0,
        password: "",
      }),
    ).toEqual({
      archivePath: "C:/tmp/archive.zip",
      destinationPath: "C:/tmp/out",
      overwrite: "replace",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
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
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      password: "secret",
    });

    entryPaths.push("source/late.txt");

    expect(request).toEqual({
      archivePath: "C:/tmp/archive.zip",
      destinationPath: "C:/tmp/out",
      overwrite: "rename",
      entryPaths: ["source/hello.txt"],
      stripComponents: 1,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
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
      destinationBasePath: " C:/tmp/out ",
      useSubfolder: true,
      subfolder: "review",
      pathMode: "current",
      overwrite: "ask",
      stripComponents: "1",
      deduplicateRoot: false,
      tzapRestorePolicy: "system",
      tzapAllowDegraded: true,
      tzapAllowAbsoluteSymlinks: true,
      ignoreSymlinks: true,
      password: " secret ",
      tzapRecipientKeyId: " recipient_local ",
    }, {
      currentFolder: "docs/releases",
      allEntryPaths: ["root/docs/releases/readme.txt"],
      entryReferences: ["root/docs/releases/readme.txt"],
      joinNativePath: (parent, child) => `${parent}/${child}`,
    });

    expect(resolved).toEqual({
      destination: "C:/tmp/out/review",
      destinationValid: true,
      overwrite: "ask",
      stripComponents: 2,
      entryReferences: ["root/docs/releases/readme.txt"],
      tzapRestorePolicy: "system",
      tzapAllowDegraded: true,
      tzapAllowAbsoluteSymlinks: true,
      ignoreSymlinks: true,
      tzapRecipientKeyId: "recipient_local",
    });
  });

  it("rejects empty base destinations before subfolder joining", () => {
    const resolved = resolveExtractStartInput({
      destinationBasePath: " ",
      useSubfolder: true,
      subfolder: "ignored",
      pathMode: "full",
      overwrite: "refuse",
      stripComponents: "0",
      deduplicateRoot: false,
    }, {
      currentFolder: "",
      allEntryPaths: ["root/readme.txt"],
      entryReferences: ["root/readme.txt"],
      joinNativePath: (parent, child) => `${parent}/${child}`,
    });

    expect(resolved.destination).toBeNull();
    expect(resolved.destinationValid).toBe(false);
  });

  it("resolves no-paths and duplicated-root stripping from archive references", () => {
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
      allEntryPaths: [
        "bundle/docs/readme.txt",
        "bundle/src/main.rs",
      ],
      entryReferences: [],
      joinNativePath: (parent, child) => `${parent}/${child}`,
    });

    expect(resolved.stripComponents).toBe(4);
  });
});
