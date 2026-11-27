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

const finderSettingsTarget = "finderSync";

describe("buildSetupDialogSnapshot", () => {
  it("lists outstanding steps before the ones already satisfied", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([
        { id: "quickLook", state: "satisfied", settingsTarget: null },
        { id: "finderContextMenu", state: "needsApproval", settingsTarget: finderSettingsTarget },
        { id: "spotlight", state: "satisfied", settingsTarget: null },
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
      setup: setup([{ id: "finderContextMenu", state: "needsApproval", settingsTarget: finderSettingsTarget }]),
    });

    const step = snapshot.steps[0];
    expect(step.instructions).toContain("ZManager Finder extension");
    expect(step.settingsTarget).toBe(finderSettingsTarget);
  });

  it("asks the user to recheck when macOS approval could not be read", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([{ id: "finderContextMenu", state: "unknown", settingsTarget: null }]),
    });

    expect(snapshot.steps[0].instructions).toContain("Re-check");
    expect(snapshot.steps[0].settingsTarget).toBeNull();
  });

  it("tells the user to reinstall when an extension never registered", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([{ id: "spotlight", state: "notRegistered", settingsTarget: "extensions" }]),
    });

    // A missing registration is not something a settings switch can repair, so
    // it must not send the user to a pane where they will find nothing.
    expect(snapshot.steps[0].instructions).toContain("Reinstall");
  });

  it("leaves satisfied steps without instructions and reports completion", () => {
    const snapshot = buildSetupDialogSnapshot({
      display,
      setup: setup([
        { id: "finderContextMenu", state: "satisfied", settingsTarget: null },
        { id: "quickLook", state: "satisfied", settingsTarget: null },
        { id: "spotlight", state: "satisfied", settingsTarget: null },
      ]),
    });

    expect(snapshot.complete).toBe(true);
    expect(snapshot.steps.every((step) => step.instructions === "")).toBe(true);
  });
});
