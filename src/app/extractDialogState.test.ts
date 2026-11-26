import { describe, expect, it } from "vitest";

import {
  createExtractDialogFormSnapshot,
  extractStartInputFromDialogForm,
  patchExtractDialogFormSnapshot,
} from "./extractDialogState";

describe("extract dialog state", () => {
  it("preserves unsaved form fields when browse applies a selected destination", () => {
    const form = createExtractDialogFormSnapshot({
      destination: "C:/draft",
      useSubfolder: true,
      subfolder: "release",
      pathMode: "none",
      overwrite: "rename",
      stripComponents: "2",
      deduplicateRoot: true,
      passwordPromptOpen: true,
    });

    const patched = patchExtractDialogFormSnapshot(form, {
      destination: "D:/picked",
    });

    expect(patched).toEqual({
      ...form,
      destination: "D:/picked",
    });
  });

  it("keeps password out of dialog snapshots while building explicit submit input", () => {
    const form = createExtractDialogFormSnapshot({
      destination: "C:/out",
      passwordPromptOpen: true,
    });

    expect(JSON.stringify(form)).not.toContain("secret");
    expect(extractStartInputFromDialogForm(form, " secret ")).toEqual({
      destinationBasePath: "C:/out",
      useSubfolder: false,
      subfolder: "",
      pathMode: "full",
      overwrite: "ask",
      stripComponents: "0",
      deduplicateRoot: false,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      password: " secret ",
    });
  });
});
