import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ARCHIVE_NOT_READY_MESSAGE } from "../../../app/classicCommands";
import { createArchiveWorkspace } from "../../../app/workspaces/archiveWorkspace";
import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { createZManagerAppStore } from "../appStore";
import {
  createInitialZManagerReactSnapshot,
  createZManagerReactSnapshot,
  noopZManagerReactActions,
  type ZManagerReactSnapshot,
} from "../appRuntime";
import { ArchiveWorkspace } from "./ArchiveWorkspace";

describe("React archive workspace", () => {
  it("renders extraction destination, options, search, tree, table, and archive details", () => {
    const snapshot = archiveSnapshot();
    const html = renderArchiveWorkspace(snapshot);

    expect(html).toContain('data-shell-chrome="path"');
    expect(html).toContain("Extract to");
    expect(html).toContain('id="extract-destination"');
    expect(html).toContain("C:/output/demo");
    expect(html).toContain('id="browse-extract-destination"');
    expect(html).not.toContain('id="nav-back"');
    expect(html).not.toContain('id="nav-up"');
    expect(html).toContain("demo.zip");
    expect(html).toContain('id="search-entries"');
    expect(html).toContain('id="tree-content"');
    expect(html).toContain('data-tree-path="docs"');
    expect(html).toContain('data-pane-resizer="navigation"');
    expect(html).toContain('aria-keyshortcuts="ArrowLeft ArrowRight Home End"');
    expect(html).toContain('id="entry-table"');
    expect(html).toContain('data-entry-path="docs/readme.txt"');
    expect(html).toContain('data-column-id="name"');
    expect(html).toContain('id="details-content"');
    expect(html).toContain('data-workspace-content="true"');
    expect(html).toContain('id="extract-path-mode"');
    expect(html).toContain('id="extract-overwrite"');
    expect(html).toContain('id="extract-password"');
    expect(html).toContain("Using global defaults");
    expect(html).toContain("C:/archives/demo.zip");
  });

  it("renders the no-archive empty action without legacy DOM ownership", () => {
    const html = renderArchiveWorkspace(createInitialZManagerReactSnapshot());

    expect(html).toContain('id="archive-empty-state"');
    expect(html).toContain('data-empty-action="open-archive"');
    expect(html).toContain('data-details-action="open-archive"');
    expect(html).toContain("Open Archive");
  });

  it("disables no-archive open actions while another job blocks archive commands", () => {
    const initial = createInitialZManagerReactSnapshot();
    const html = renderArchiveWorkspace(
      createZManagerReactSnapshot({
        ...initial,
        commands: {
          ...initial.commands,
          states: {
            ...initial.commands.states,
            open: { enabled: false, reason: ARCHIVE_NOT_READY_MESSAGE },
          },
        },
      }),
    );

    expect(html).toMatch(/data-empty-action="open-archive"[^>]*disabled=""/);
    expect(html).toMatch(/data-details-action="open-archive"[^>]*disabled=""/);
    expect(html).toContain(ARCHIVE_NOT_READY_MESSAGE);
  });

  it("announces archive listing failures as pane-owned alerts", () => {
    const workspace = createArchiveWorkspace();
    const snapshot = workspace.loadFailed({
      code: "archive_open_failed",
      message: "The archive could not be opened.",
      severity: "error",
      retryable: false,
    });
    const html = renderArchiveWorkspace(
      createZManagerReactSnapshot({
        ...createInitialZManagerReactSnapshot(),
        archive: snapshot,
      }),
    );

    expect(html).toMatch(/id="browse-message"[^>]*role="alert"/);
    expect(html).toContain("The archive could not be opened.");
  });

  it("shows an explicit warning when a requested current-status check is unavailable", () => {
    const initial = archiveSnapshot();
    const html = renderArchiveWorkspace(
      createZManagerReactSnapshot({
        ...initial,
        archive: { ...initial.archive, currentArchivePath: "C:/archives/demo.tzap" },
        extract: {
          ...initial.extract,
          tzapVerification: {
            ...initial.extract.tzapVerification,
            checkCurrentStatus: true,
            state: "verifiedWithCaveat",
            result: {
              outcome: "cryptographically_intact_offline",
              subject: "CN=Signer",
              issuer: "CN=Root",
              serialNumberHex: "01",
              certificateSha256: "sha256:signer",
              signedAtUnixSeconds: 1,
              verifiedChainSubjects: ["CN=Signer", "CN=Root"],
              diagnostics: [],
              verificationState: "cryptographically_intact_offline",
              signatureCheck: "ok",
              trustCheck: "production_root",
              certificateTime: "valid_at_signing",
              statusCheck: "status_unavailable",
            },
          },
        },
      }),
    );

    expect(html).toContain("Current status could not be confirmed");
  });
});

function renderArchiveWorkspace(snapshot: ZManagerReactSnapshot): string {
  const store = createZManagerAppStore(snapshot, noopZManagerReactActions);
  return renderToStaticMarkup(
    createElement(
      ZManagerAppRuntimeProvider,
      { store },
      createElement(ArchiveWorkspace),
    ),
  );
}

function archiveSnapshot(): ZManagerReactSnapshot {
  const initial = createInitialZManagerReactSnapshot();
  const archiveWorkspace = createArchiveWorkspace({
    flatView: false,
    showParentFolderItem: true,
  });
  archiveWorkspace.loadSucceeded({
    archivePath: "C:/archives/demo.zip",
    entries: [
      {
        path: "docs/readme.txt",
        kind: "file",
        size: 1234,
        compressedSize: 456,
        modified: "1781085660",
      },
      {
        path: "docs",
        kind: "directory",
        size: 0,
        compressedSize: 0,
        modified: "1781085600",
      },
    ],
    entryCount: 2,
    totalSize: 1234,
  });
  const archive = archiveWorkspace.navigateToFolder("docs");

  return createZManagerReactSnapshot({
    shell: {
      ...initial.shell,
      activeMode: "extract",
    },
    archive,
    create: initial.create,
    extract: {
      ...initial.extract,
      destinationPath: "C:/output/demo",
    },
    preferences: initial.preferences,
    preferencesDraft: initial.preferencesDraft,
    pathHistory: initial.pathHistory,
    display: initial.display,
    commands: initial.commands,
  });
}
