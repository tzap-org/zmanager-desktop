import { describe, expect, it, vi } from "vitest";

import { createPathHistoryStore, type PathHistorySnapshot } from "../pathHistory";
import {
  createArchiveOpenController,
  type ArchiveOpenControllerOptions,
  type ArchiveOpenDialogOptions,
} from "./archiveOpenController";

function createHarness(overrides: Partial<ArchiveOpenControllerOptions> = {}) {
  const pathHistoryStore = createPathHistoryStore(null);
  const calls: string[] = [];
  const publishPathHistorySnapshot = vi.fn((snapshot: PathHistorySnapshot) => {
    calls.push(
      `publish-history:${snapshot.extractDestinationHistory.join("|")}:${snapshot.createDestinationHistory.join("|")}`,
    );
  });
  const dialogOptions: ArchiveOpenDialogOptions = {
    title: "Open archive",
    directory: false,
    multiple: false,
    filters: [{ name: "Archives", extensions: ["zip"] }],
  };
  const openArchiveDialog = vi.fn(async (_options: ArchiveOpenDialogOptions) => null as string | string[] | null);
  const readClipboardText = vi.fn(async () => null as string | null);
  const loadArchive = vi.fn(async ({ archivePath }: { archivePath: string }) => {
    calls.push(`load:${archivePath}`);
  });
  const setOperationalStatus = vi.fn((message: string) => {
    calls.push(`status:${message}`);
  });
  const clipboardEmptyMessage = vi.fn(() => {
    calls.push("message:browse.noArchiveOpen");
  });
  const clearPreviewState = vi.fn(() => {
    calls.push("clear-preview");
  });
  const setCurrentArchivePath = vi.fn((archivePath: string) => {
    calls.push(`current:${archivePath}`);
  });

  const controller = createArchiveOpenController({
    pathHistoryStore,
    publishPathHistorySnapshot,
    openArchiveDialogOptions: () => dialogOptions,
    openArchiveDialog,
    canReadClipboard: () => true,
    readClipboardText,
    unsupportedClipboardMessage: () => "Unsupported operation.",
    clipboardEmptyMessage,
    nativeDialogFailedMessage: () => "Native dialog failed.",
    unknownErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
    setOperationalStatus,
    clearPreviewState,
    setCurrentArchivePath,
    loadArchive,
    ...overrides,
  });

  return {
    calls,
    clipboardEmptyMessage,
    controller,
    dialogOptions,
    loadArchive,
    openArchiveDialog,
    pathHistoryStore,
    publishPathHistorySnapshot,
    readClipboardText,
    setCurrentArchivePath,
    setOperationalStatus,
  };
}

describe("archive open controller", () => {
  it("publishes extract destination history only when the store records a value", () => {
    const harness = createHarness();

    harness.controller.recordExtractDestinationHistory("C:/out ");
    harness.controller.recordExtractDestinationHistory("");

    expect(harness.publishPathHistorySnapshot).toHaveBeenCalledTimes(1);
    expect(harness.publishPathHistorySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        extractDestinationHistory: ["C:/out "],
      }),
    );
  });

  it("publishes create destination history only when the store records a value", () => {
    const harness = createHarness();

    harness.controller.recordCreateDestinationHistory("C:/created/app.zip ");
    harness.controller.recordCreateDestinationHistory("");

    expect(harness.publishPathHistorySnapshot).toHaveBeenCalledTimes(1);
    expect(harness.publishPathHistorySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        createDestinationHistory: ["C:/created/app.zip "],
      }),
    );
  });

  it("records recent archive history without publishing destination history", () => {
    const harness = createHarness();

    harness.controller.recordRecentArchiveHistory(" C:/archives/app.zip ");

    expect(harness.pathHistoryStore.getSnapshot().recentArchiveHistory).toEqual([" C:/archives/app.zip "]);
    expect(harness.publishPathHistorySnapshot).not.toHaveBeenCalled();
  });

  it("opens the dialog with injected options and noops on cancel or non-string selection", async () => {
    const harness = createHarness();
    harness.openArchiveDialog.mockResolvedValueOnce(null);
    await harness.controller.onOpenArchive();
    harness.openArchiveDialog.mockResolvedValueOnce(["C:/archives/app.zip"]);
    await harness.controller.onOpenArchive();

    expect(harness.openArchiveDialog).toHaveBeenCalledWith(harness.dialogOptions);
    expect(harness.loadArchive).not.toHaveBeenCalled();
    expect(harness.pathHistoryStore.getSnapshot().recentArchiveHistory).toEqual([]);
  });

  it("preserves selected dialog paths while clearing preview state, recording history, and loading in order", async () => {
    const harness = createHarness();
    harness.openArchiveDialog.mockResolvedValueOnce(" C:/archives/app.zip ");

    await harness.controller.onOpenArchive();

    expect(harness.calls).toEqual([
      "clear-preview",
      "current: C:/archives/app.zip ",
      "load: C:/archives/app.zip ",
    ]);
    expect(harness.pathHistoryStore.getSnapshot().recentArchiveHistory).toEqual([" C:/archives/app.zip "]);
    expect(harness.loadArchive).toHaveBeenCalledWith({ archivePath: " C:/archives/app.zip " });
  });

  it("preserves explicit paths and noops on empty paths", async () => {
    const harness = createHarness();

    await harness.controller.openArchiveFromPath("");
    await harness.controller.openArchiveFromPath("/tmp/from-input.7z ");

    expect(harness.loadArchive).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual([
      "clear-preview",
      "current:/tmp/from-input.7z ",
      "load:/tmp/from-input.7z ",
    ]);
    expect(harness.pathHistoryStore.getSnapshot().recentArchiveHistory).toEqual(["/tmp/from-input.7z "]);
  });

  it("reports unsupported status when clipboard reads are unavailable", async () => {
    const harness = createHarness({
      canReadClipboard: () => false,
    });

    await harness.controller.openArchiveFromClipboard();

    expect(harness.setOperationalStatus).toHaveBeenCalledWith("Unsupported operation.");
    expect(harness.readClipboardText).not.toHaveBeenCalled();
    expect(harness.loadArchive).not.toHaveBeenCalled();
  });

  it("reports no archive open when clipboard text contains only paired empty quotes", async () => {
    const harness = createHarness();
    harness.readClipboardText.mockResolvedValueOnce("''");

    await harness.controller.openArchiveFromClipboard();

    expect(harness.clipboardEmptyMessage).toHaveBeenCalledTimes(1);
    expect(harness.loadArchive).not.toHaveBeenCalled();
  });

  it("strips surrounding clipboard quotes and delegates to path opening", async () => {
    const harness = createHarness();
    harness.readClipboardText.mockResolvedValueOnce('  "C:/archives/from-clipboard.zip"  ');

    await harness.controller.openArchiveFromClipboard();

    expect(harness.calls).toEqual([
      "clear-preview",
      "current:C:/archives/from-clipboard.zip",
      "load:C:/archives/from-clipboard.zip",
    ]);
    expect(harness.pathHistoryStore.getSnapshot().recentArchiveHistory).toEqual([
      "C:/archives/from-clipboard.zip",
    ]);
  });

  it("preserves meaningful whitespace in an unquoted clipboard path", async () => {
    const harness = createHarness();
    harness.readClipboardText.mockResolvedValueOnce("/tmp/archive.zip ");

    await harness.controller.openArchiveFromClipboard();

    expect(harness.calls).toEqual([
      "clear-preview",
      "current:/tmp/archive.zip ",
      "load:/tmp/archive.zip ",
    ]);
  });

  it("maps clipboard read errors through unknown error text with the native dialog fallback", async () => {
    const harness = createHarness({
      unknownErrorMessage: (error, fallback) => error instanceof Error ? `${fallback}: ${error.message}` : fallback,
    });
    harness.readClipboardText.mockRejectedValueOnce(new Error("clipboard failed"));

    await harness.controller.openArchiveFromClipboard();

    expect(harness.setOperationalStatus).toHaveBeenCalledWith("Native dialog failed.: clipboard failed");
    expect(harness.loadArchive).not.toHaveBeenCalled();
  });
});
