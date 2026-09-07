import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { preferencesWithPatch } from "../../../app/preferences";
import { ZManagerAppRuntimeProvider } from "../AppProviders";
import { createZManagerAppStore } from "../appStore";
import {
  createInitialZManagerReactSnapshot,
  createZManagerReactSnapshot,
  noopZManagerReactActions,
  type ZManagerReactSnapshot,
} from "../appRuntime";
import { PreferencesDialog, ArchiveDefaultsPage } from "./PreferencesDialog";

describe("React preferences dialog", () => {
  it("renders preference pages and draft controls", () => {
    const html = renderPreferences(preferencesSnapshot());

    expect(html).toContain('role="dialog"');
    expect(html).toContain('id="preferences-title"');
    expect(html).toContain('data-dialog-surface="true"');
    expect(html).toContain('data-dialog-content="true"');
    expect(html).toContain('data-pref-page-target="folders"');
    expect(html).toContain('data-pref-page="folders"');
    expect(html).toContain('id="pref-output-location"');
    expect(html).toContain('id="pref-default-format"');
    expect(html).toContain('id="pref-language"');
    expect(html).toContain('id="pref-tzap-restore-policy"');
    expect(html).toContain('id="pref-tzap-allow-degraded"');
    expect(html).toContain('id="preferences-save"');
  });

  it("keeps every shared create flag with the selected archive-format defaults", () => {
    const html = renderPreferences(
      preferencesSnapshot({ defaultArchiveFormat: "tzap" }),
    );
    const archivePage = html.slice(
      html.indexOf('data-pref-page="archive"'),
      html.indexOf('data-pref-page="extraction"'),
    );

    expect(archivePage).toContain('id="pref-create-clean-source"');
    expect(archivePage).toContain('id="pref-create-respect-gitignore"');
    expect(archivePage).toContain('id="pref-create-follow-symlinks"');
    expect(archivePage).toContain('id="pref-create-preserve-metadata"');
    expect(archivePage).toContain('id="pref-create-replace-existing"');
    expect(archivePage).toContain('id="pref-create-prompt-password"');
    expect(archivePage).toContain('id="pref-create-tzap-signing-default"');
  });

  it("uses the stable identity ID for TZAP signing defaults", () => {
    const initial = createInitialZManagerReactSnapshot();
    const snapshot = createZManagerReactSnapshot({
      ...initial,
      account: {
        ...initial.account,
        certificates: [
          {
            identityId: "identity-1",
            certificateId: "certificate-1",
            certificateSha256: "sha256:certificate-1",
            label: "Primary signing identity",
            identityType: "offline",
            state: "active",
            assuranceLevel: "local_self_signed",
            notAfterUnixSeconds: 2_000_000_000,
            renewalRecommended: false,
          },
        ],
      },
      preferencesDraft: preferencesWithPatch(initial.preferences, {
        defaultArchiveFormat: "tzap",
      }),
    });
    const handleDialogIntent = vi.fn();
    const store = createZManagerAppStore(snapshot, {
      ...noopZManagerReactActions,
      handleDialogIntent,
    });

    render(
      createElement(
        ZManagerAppRuntimeProvider,
        { store },
        createElement(ArchiveDefaultsPage, {
          draft: snapshot.preferencesDraft!,
          active: true,
          selectedCreateFormat: "tzap",
          setSelectedCreateFormat: vi.fn(),
        }),
      ),
    );

    fireEvent.click(document.querySelector("#pref-create-tzap-signing-default")!);
    const option = screen.getByRole("option", { name: "Primary signing identity" });
    fireEvent.click(option);
    expect(handleDialogIntent).toHaveBeenCalledWith({
      type: "preferencesCreateDefaultsPatch",
      format: "tzap",
      patch: {
        tzapSigningDefault: "identity",
        tzapDefaultSigningIdentityId: "identity-1",
      },
    });
  });

  it("disables save and validates when custom output is selected without a path", () => {
    const html = renderPreferences(
      preferencesSnapshot({
        defaultOutputLocation: "customFolder",
        customOutputFolderPath: "",
      }),
    );

    expect(html).toContain('id="preferences-save" type="button" disabled=""');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Choose a custom output folder before saving.");
    const statusStart = html.indexOf('id="preferences-status"');
    const statusEnd = html.indexOf("</p>", statusStart);
    expect(statusStart).toBeGreaterThan(-1);
    expect(html.slice(statusStart, statusEnd)).not.toContain(
      "Choose a custom output folder before saving.",
    );
  });

  it("renders long custom output paths in middle-truncated display form", () => {
    const longPath =
      "C:/Users/frankzhu/Documents/Projects/ZManager/Exports/Quarterly/Archive Output";
    const html = renderPreferences(
      preferencesSnapshot({
        defaultOutputLocation: "customFolder",
        customOutputFolderPath: longPath,
      }),
    );

    expect(html).toContain(
      'title="C:/Users/frankzhu/Documents/Projects/ZManager/Exports/Quarterly/Archive Output"',
    );
    expect(html).toContain("C:/Users/frankzhu/Doc...rchive Output");
  });
});

function renderPreferences(snapshot: ZManagerReactSnapshot): string {
  const store = createZManagerAppStore(snapshot, noopZManagerReactActions);
  return renderToStaticMarkup(
    createElement(
      ZManagerAppRuntimeProvider,
      { store },
      createElement(PreferencesDialog),
    ),
  );
}

function preferencesSnapshot(
  patch: Partial<ZManagerReactSnapshot["preferences"]> = {},
): ZManagerReactSnapshot {
  const initial = createInitialZManagerReactSnapshot();
  const draft = preferencesWithPatch(initial.preferences, patch);
  return createZManagerReactSnapshot({
    ...initial,
    preferencesDraft: draft,
  });
}
