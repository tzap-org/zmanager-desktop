import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_APP_PREFERENCES } from "../../../app/preferences";
import { toggleCreateColumnVisibility } from "../../../app/createTableColumns";
import {
  createCreateWorkspace,
  type CreateWorkspaceSnapshot,
} from "../../../app/workspaces/createWorkspace";
import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { createZManagerAppStore } from "../appStore";
import {
  createInitialZManagerReactSnapshot,
  createZManagerReactSnapshot,
  noopZManagerReactActions,
  type ZManagerReactSnapshot,
} from "../appRuntime";
import { CreateWorkspace } from "./CreateWorkspace";

type CreatePlan = NonNullable<CreateWorkspaceSnapshot["plan"]["current"]>;

describe("React create workspace", () => {
  it("does not auto-select a local recipient for TZAP creation", () => {
    const initial = createSnapshot("tzap");
    const snapshot = createZManagerReactSnapshot({
      ...initial,
      account: {
        ...initial.account,
        recipientKeys: [
          {
            keyId: "recipient-local",
            algorithm: "x25519",
            publicKeyFingerprint: "sha256:recipient-local",
            createdAtUnixSeconds: 1,
            label: "This device",
            lifecycle: "active",
          },
        ],
      },
    });
    const handleCreateIntent = vi.fn();
    const store = createZManagerAppStore(snapshot, {
      ...noopZManagerReactActions,
      handleCreateIntent,
    });

    render(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement(CreateWorkspace),
      ),
    );

    expect(handleCreateIntent).not.toHaveBeenCalledWith({
      type: "setOptions",
      patch: { tzapRecipientKeyIds: "recipient-local" },
    });
  });

  it("centers the empty state without rendering a scrollable source table", () => {
    const initial = createInitialZManagerReactSnapshot();
    const html = renderCreateWorkspace({
      ...initial,
      shell: {
        ...initial.shell,
        activeMode: "compress",
      },
    });

    expect(html).toContain('id="compress-empty-state"');
    expect(html).toMatch(
      /data-create-table-shell[^>]*class="[^"]*overflow-hidden[^"]*"/,
    );
    expect(html).toContain("grid place-items-center");
    expect(html).not.toContain('id="compress-source-table"');
  });

  it("renders create sources, plan rows, and options", () => {
    const html = renderCreateWorkspace(createSnapshot());

    expect(html).toContain('data-shell-chrome="path"');
    expect(html).toContain("Destination");
    expect(html).not.toContain('id="nav-back"');
    expect(html).not.toContain('id="nav-up"');
    expect(html).toContain('id="create-destination"');
    expect(html).not.toContain('id="add-source"');
    expect(html).not.toContain('id="start-create"');
    expect(html).toContain('data-pane-resizer="navigation"');
    expect(html).toContain('aria-keyshortcuts="ArrowLeft ArrowRight Home End"');
    expect(html).toContain('id="compress-source-body"');
    expect(html).toMatch(/<h1 id="workspace-title"[^>]*>bundle\.tzst<\/h1>/);
    expect(html).toContain('id="compress-marquee-hit-surface"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('id="compress-include-all"');
    expect(html).not.toContain(
      '<span class="column-header-label" aria-hidden="true"></span><input id="compress-include-all"',
    );
    expect(html).toContain('data-compress-path="photos-folder"');
    expect(html).toContain('data-compress-source-path="C:/work/photos-folder"');
    expect(html).toContain('id="compress-options-panel"');
    expect(html).toMatch(
      /<details[^>]*id="compress-options-panel"[^>]*open=""/,
    );
    expect(html).toContain('id="create-format"');
    expect(html).toContain('id="create-clean-source"');
    expect(html).not.toContain('title="Delete the source files');
    expect(html).toContain('id="create-compression-level"');
    expect(html).not.toContain('<option value="5">5</option>');
  });

  it("renders an error-valued plan status as a bounded workspace alert", () => {
    const snapshot = createSnapshot();
    const html = renderCreateWorkspace({
      ...snapshot,
      create: {
        ...snapshot.create,
        plan: {
          ...snapshot.create.plan,
          state: "error",
          status: { messageKey: "create.error.refreshPlan" },
        },
      },
    });

    expect(html).toContain('data-workspace-content="true"');
    expect(html).toContain('id="create-plan-summary"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Refresh the plan before creating.");
    expect(html).not.toContain("<dialog");
  });

  it("labels the compress workspace from the destination archive name", () => {
    const html = renderCreateWorkspace(
      createSnapshot("tarZst", undefined, "C:/abc/abc.zip"),
    );

    expect(html).toMatch(/<h1 id="workspace-title"[^>]*>abc\.zip<\/h1>/);
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector('button[data-crumb-path=""]')?.textContent).toBe(
      "abc.zip",
    );
    expect(html).not.toContain(">Files to compress</h1>");
  });

  it("renders password-capable formats without serializing password values", () => {
    const html = renderCreateWorkspace(createSnapshot("sevenZ"));

    expect(html).toContain('id="create-format"');
    expect(html).toContain("7z");
    expect(html).toContain('id="create-advanced-options"');
    expect(html).not.toMatch(
      /<details[^>]*id="create-advanced-options"[^>]*open=/,
    );
    expect(html).toContain('id="create-password"');
    expect(html).toContain('id="create-password-confirm"');
    expect(html).toContain('id="create-show-password"');
    expect(html.indexOf('id="create-clean-source"')).toBeLessThan(
      html.indexOf('id="create-advanced-options"'),
    );
    expect(html.indexOf('id="create-respect-gitignore"')).toBeLessThan(
      html.indexOf('id="create-password"'),
    );
    expect(html).not.toContain("correct horse");
  });

  it("keeps TZAP certificates last inside the collapsed advanced options", () => {
    const html = renderCreateWorkspace(createSnapshot("tzap"));

    expect(html.indexOf('id="create-password"')).toBeLessThan(
      html.indexOf('id="create-volume"'),
    );
    expect(html.indexOf('id="create-volume"')).toBeLessThan(
      html.indexOf('id="create-tzap-recovery"'),
    );
    expect(html.indexOf('id="create-tzap-recovery"')).toBeLessThan(
      html.indexOf('id="create-tzap-certificates-title"'),
    );
  });

  it("renders create row selection and focus from the runtime snapshot", () => {
    const html = renderCreateWorkspace(
      createSnapshot("tarZst", {
        selectedPaths: ["quarterly-report.pdf"],
        focusedPath: "quarterly-report.pdf",
        anchorPath: "quarterly-report.pdf",
      }),
    );

    expect(html).toMatch(
      /data-compress-path="quarterly-report\.pdf"[^>]*data-focused="true"[^>]*aria-selected="true"/,
    );
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(
      'aria-keyshortcuts="Space Enter Delete ContextMenu Shift+F10"',
    );
  });

  it("keeps the accepted tree visible with a subtle status while filters refresh", () => {
    const html = renderCreateWorkspace(
      createSnapshot("tzap", undefined, undefined, true),
    );

    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("Updating filters...");
    expect(html).toContain('data-compress-path="photos-folder"');
  });

  it("uses cached system icons for compress rows when real file icons are enabled", () => {
    const html = renderCreateWorkspace(
      createSnapshot("tarZst", undefined, undefined, false, {
        showRealFileIcons: true,
        systemIcons: {
          directory: "data:image/png;base64,folder-icon",
          "file:.zip": "data:image/png;base64,zip-icon",
          "file:.pdf": "data:image/png;base64,pdf-icon",
        },
      }),
    );

    expect(html).toContain('src="data:image/png;base64,folder-icon"');
    expect(html).toContain('src="data:image/png;base64,zip-icon"');
    expect(html).toContain('src="data:image/png;base64,pdf-icon"');
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(3);
  });

  it("keeps compress rows on SVG icons when real file icons are disabled", () => {
    const html = renderCreateWorkspace(
      createSnapshot("tarZst", undefined, undefined, false, {
        showRealFileIcons: false,
        systemIcons: {
          directory: "data:image/png;base64,folder-icon",
          "file:.zip": "data:image/png;base64,zip-icon",
          "file:.pdf": "data:image/png;base64,pdf-icon",
        },
      }),
    );

    expect(html).not.toContain("data:image/png;base64");
    expect(html).toContain('class="lucide lucide-folder size-4"');
    expect(html).toContain('class="lucide lucide-file size-4"');
  });

  it("renders the core-owned mode metadata when the optional column is visible", () => {
    const snapshot = createSnapshot();
    const html = renderCreateWorkspace({
      ...snapshot,
      create: {
        ...snapshot.create,
        view: {
          ...snapshot.create.view,
          columnSettings: toggleCreateColumnVisibility(
            snapshot.create.view.columnSettings,
            "mode",
          ),
        },
      },
    });

    expect(html).toContain('data-compress-column-id="mode"');
    expect(html).toContain(">drwxr-xr-x</td>");
  });
});

function renderCreateWorkspace(snapshot: ZManagerReactSnapshot): string {
  const store = createZManagerAppStore(snapshot, noopZManagerReactActions);
  return renderToStaticMarkup(
    createElement(
      ZManagerAppRuntimeProvider,
      { store },
      createElement(CreateWorkspace),
    ),
  );
}

function createSnapshot(
  format: "tarZst" | "sevenZ" | "tzap" = "tarZst",
  createSelection?: Readonly<{
    selectedPaths: readonly string[];
    focusedPath: string;
    anchorPath: string;
  }>,
  destinationPath = format === "sevenZ"
    ? "C:/work/bundle.7z"
    : format === "tzap"
      ? "C:/work/bundle.tzap"
      : "C:/work/bundle.tzst",
  refreshing = false,
  iconOptions: Readonly<{
    showRealFileIcons: boolean;
    systemIcons: Readonly<Record<string, string | null>>;
  }> = {
    showRealFileIcons: false,
    systemIcons: {},
  },
): ZManagerReactSnapshot {
  const initial = createInitialZManagerReactSnapshot();
  const workspace = createCreateWorkspace();
  workspace.addSources([
    "C:/work/photos-folder",
    "C:/work/desktop-archive-source.zip",
    "C:/work/quarterly-report.pdf",
  ]);
  if (format === "sevenZ") {
    workspace.changeFormat(
      "sevenZ",
      DEFAULT_APP_PREFERENCES.createFormatDefaults.sevenZ,
    );
  } else if (format === "tzap") {
    workspace.changeFormat(
      "tzap",
      DEFAULT_APP_PREFERENCES.createFormatDefaults.tzap,
    );
  }
  workspace.setDestinationPath(destinationPath);
  const started = workspace.beginPlan();
  expect(started.ready).toBe(true);
  if (!started.ready) {
    throw new Error("Expected create plan to be ready");
  }
  workspace.acceptPlanResult(started.revision, createPlan());
  if (createSelection) {
    workspace.updateSelection({
      selectedPaths: new Set(createSelection.selectedPaths),
      focusedPath: createSelection.focusedPath,
      anchorPath: createSelection.anchorPath,
    });
  }
  if (refreshing) {
    workspace.queuePlan();
  }

  return createZManagerReactSnapshot({
    shell: {
      ...initial.shell,
      activeMode: "compress",
    },
    archive: initial.archive,
    create: workspace.getSnapshot(),
    systemIcons: iconOptions.systemIcons,
    preferences: {
      ...initial.preferences,
      showRealFileIcons: iconOptions.showRealFileIcons,
    },
    preferencesDraft: initial.preferencesDraft,
    pathHistory: initial.pathHistory,
    display: initial.display,
    commands: initial.commands,
  });
}

function createPlan(): CreatePlan {
  const planEntries: CreatePlan["planEntries"] = [
    {
      path: "photos-folder",
      kind: "directory",
      mode: 0o755,
      sourcePath: "C:/work/photos-folder",
    },
    {
      path: "desktop-archive-source.zip",
      kind: "file",
      size: 0,
      sourcePath: "C:/work/desktop-archive-source.zip",
    },
    {
      path: "quarterly-report.pdf",
      kind: "file",
      size: 0,
      sourcePath: "C:/work/quarterly-report.pdf",
    },
  ];
  return {
    includedCount: planEntries.length,
    excludedCount: 0,
    totalBytes: 0,
    excludedBytes: 0,
    entries: planEntries.map((entry) => entry.path),
    planEntries,
    excludedEntries: [],
    warnings: [],
  };
}
