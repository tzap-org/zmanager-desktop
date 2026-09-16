import { describe, expect, it } from "vitest";

import type { ShellIntegrationSetup } from "../../api/types";
import { buildSetupDialogSnapshot } from "./dialogSnapshots";
import { createDisplayContext } from "./displayContext";

const display = createDisplayContext("en");

function setup(
  steps: ShellIntegrationSetup["steps"],
): ShellIntegrationSetup {
  return { complete: steps.every((step) => step.state === "satisfied"), steps };
}

const settingsUrl = "x-apple.systempreferences:com.apple.ExtensionsPreferences";

describe("buildSetupDialogSnapshot", () => {
  it("lists outstanding steps before the ones already satisfied", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([
        { id: "quickLook", state: "satisfied", settingsUrl },
        { id: "finderContextMenu", state: "needsApproval", settingsUrl },
        { id: "spotlight", state: "satisfied", settingsUrl },
      ]),
    });

    expect(snapshot.steps.map((step) => step.id)).toEqual([
      "finderContextMenu",
      "quickLook",
      "spotlight",
    ]);
  });

  it("gives an outstanding step the instructions for reaching its switch", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([{ id: "finderContextMenu", state: "needsApproval", settingsUrl }]),
    });

    const step = snapshot.steps[0];
    expect(step.instructions).not.toBe("");
    // The Finder extension is the one people cannot find on their own: macOS
    // files it under "File Provider", so the copy has to say so outright.
    expect(step.instructions).toContain("File Provider");
    expect(step.settingsUrl).toBe(settingsUrl);
  });

  it("tells the user to reinstall when an extension never registered", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([{ id: "spotlight", state: "notRegistered", settingsUrl }]),
    });

    // A missing registration is not something a settings switch can repair, so
    // it must not send the user to a pane where they will find nothing.
    expect(snapshot.steps[0].instructions).toContain("Reinstall");
  });

  it("leaves satisfied steps without instructions and reports completion", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([
        { id: "finderContextMenu", state: "satisfied", settingsUrl },
        { id: "quickLook", state: "satisfied", settingsUrl },
        { id: "spotlight", state: "satisfied", settingsUrl },
      ]),
    });

    expect(snapshot.complete).toBe(true);
    expect(snapshot.steps.every((step) => step.instructions === "")).toBe(true);
  });
});
