import { createElement } from "react";
import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { createZManagerAppStore, type ZManagerAppStore } from "../appStore";
import { ExtractPasswordProvider, useExtractPasswordState } from "../archive/ExtractPasswordContext";
import {
  createInitialZManagerReactSnapshot,
  noopZManagerReactActions,
  type ZManagerDialogSnapshot,
} from "../appRuntime";
import { DialogRoot } from "./DialogRoot";

function renderDialog(
  dialog: ZManagerDialogSnapshot,
  currentArchivePath = "",
): string {
  const initial = createInitialZManagerReactSnapshot();
  const store = createZManagerAppStore({
    ...initial,
    archive: {
      ...initial.archive,
      currentArchivePath,
    },
    dialog,
  });

  return renderToStaticMarkup(
    createElement(
      ZManagerAppRuntimeProvider,
      { store },
      createElement(DialogRoot),
    ),
  );
}

function SeedExtractPassword({
  password,
  store,
  dialog,
}: Readonly<{
  password: string;
  store: ZManagerAppStore;
  dialog: ZManagerDialogSnapshot;
}>) {
  const state = useExtractPasswordState();
  useEffect(() => {
    state.setPassword(password);
    store.publish({ ...store.getSnapshot(), dialog });
  }, [dialog, password, state.setPassword, store]);
  return null;
}

describe("DialogRoot", () => {
  it("renders extract form controls without snapshot password values", () => {
    const html = renderDialog({
      kind: "extract",
      mode: "archive",
      title: "Extract",
      message: "Choose a destination.",
      startLabel: "Extract",
      destination: "C:/out",
      destinationHistory: ["C:/out"],
      useSubfolder: false,
      subfolder: "",
      pathMode: "full",
      overwrite: "refuse",
      stripComponents: "0",
      deduplicateRoot: false,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      passwordPromptOpen: false,
    });

    expect(html).toContain('role="dialog"');
    expect(html).toContain("data-dialog-surface");
    expect(html).toContain("data-dialog-content");
    expect(html).toContain('id="extract-destination"');
    expect(html).toContain('id="extract-start"');
    expect(html).not.toContain("passwordValue");
    expect(html).not.toContain("correct horse");
  });

  it("carries the extraction pane password into the toolbar-opened dialog", async () => {
    const initial = createInitialZManagerReactSnapshot();
    const dialog: ZManagerDialogSnapshot = {
      kind: "extract",
      mode: "archive",
      title: "Extract",
      message: "Choose a destination.",
      startLabel: "Extract",
      destination: "C:/out",
      destinationHistory: ["C:/out"],
      useSubfolder: false,
      subfolder: "",
      pathMode: "full",
      overwrite: "refuse",
      stripComponents: "0",
      deduplicateRoot: false,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      passwordPromptOpen: false,
    };
    const store = createZManagerAppStore({
      ...initial,
    }, {
      ...noopZManagerReactActions,
      handleDialogIntent: vi.fn(),
    });

    render(
      createElement(
        ExtractPasswordProvider,
        null,
        createElement(
          ZManagerAppRuntimeProvider,
          { store },
          createElement(SeedExtractPassword, { password: "archive-secret", store, dialog }),
          createElement(DialogRoot),
        ),
      ),
    );

    await waitFor(() => {
      expect(document.getElementById("browse-password")).toHaveValue("archive-secret");
    });

    fireEvent.click(document.getElementById("extract-start")!);

    expect(store.getActions().handleDialogIntent).toHaveBeenCalledWith(expect.objectContaining({
      type: "submitExtract",
      mode: "archive",
      password: "archive-secret",
    }));
    await waitFor(() => {
      expect(document.getElementById("browse-password")).toHaveValue("");
    });
  });

  it("renders TZAP metadata policy controls for TZAP archives", () => {
    const html = renderDialog(
      {
        kind: "extract",
        mode: "archive",
        title: "Extract",
        message: "Choose a destination.",
        startLabel: "Extract",
        destination: "/tmp/out",
        destinationHistory: [],
        useSubfolder: false,
        subfolder: "",
        pathMode: "full",
        overwrite: "refuse",
        stripComponents: "0",
        deduplicateRoot: false,
        tzapRestorePolicy: "system",
        tzapAllowDegraded: true,
        tzapAllowAbsoluteSymlinks: false,
        ignoreSymlinks: false,
        passwordPromptOpen: false,
      },
      "/tmp/backup.tzap",
    );

    expect(html).toContain('id="browse-tzap-restore-policy"');
    expect(html).toContain("numeric user/group ownership");
    expect(html).toContain("Allow degraded metadata restore");
  });

  it("renders info rows and actions from a serializable model", () => {
    const html = renderDialog({
      kind: "info",
      title: "Entry Info",
      description: "Archive or entry details.",
      sectionTitle: "Entry Info",
      rows: [{ label: "Path", value: "docs/readme.txt", mode: "middle" }],
      actions: [{ label: "Copy Path", copyValue: "docs/readme.txt" }],
      returnFocusPath: "docs/readme.txt",
    });

    expect(html).toContain("Entry Info");
    expect(html).toContain("docs/readme.txt");
    expect(html).toContain(">Copy Path</button>");
    expect(html).not.toContain("data-info-action");
    expect(html).not.toContain("data-copy-value");
  });

  it("renders about diagnostics groups", () => {
    const html = renderDialog({
      kind: "about",
      title: "About ZManager",
      groups: [
        {
          title: "Runtime",
          rows: [["Shell", "browser preview"]],
        },
      ],
    });

    expect(html).toContain("About ZManager");
    expect(html).toContain('data-diagnostics-group="true"');
    expect(html).toContain("browser preview");
    expect(html).toContain('id="copy-diagnostics"');
  });

  it("keeps the shared shell header and footer outside its primary content owner", () => {
    const html = renderDialog({
      kind: "info",
      title: "Entry Info",
      description: "Details",
      sectionTitle: "Metadata",
      rows: [],
      actions: [],
      returnFocusPath: "",
    });

    const contentStart = html.indexOf("data-dialog-content");
    const headerEnd = html.indexOf("info-dialog-body");
    const footerStart = html.indexOf("info-action-group");
    expect(contentStart).toBeGreaterThan(-1);
    expect(headerEnd).toBeGreaterThan(contentStart);
    expect(footerStart).toBeGreaterThan(headerEnd);
    expect(html).toContain('aria-labelledby="info-title"');
    expect(html).toContain('aria-describedby="info-description"');
  });
});
