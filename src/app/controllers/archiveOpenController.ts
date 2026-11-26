import type { NativeDialogOpenOptions, NativeOpenDialogResult } from "../dialogs";
import type { PathHistorySnapshot, PathHistoryStore } from "../pathHistory";

export type ArchiveOpenDialogOptions = NativeDialogOpenOptions;

export type ArchiveOpenControllerPathHistoryStore = Pick<
  PathHistoryStore,
  | "getSnapshot"
  | "recordExtractDestinationHistory"
  | "recordCreateDestinationHistory"
  | "recordRecentArchiveHistory"
>;

export type ArchiveOpenControllerOptions = Readonly<{
  pathHistoryStore: ArchiveOpenControllerPathHistoryStore;
  publishPathHistorySnapshot(snapshot: PathHistorySnapshot): void;
  openArchiveDialogOptions(): ArchiveOpenDialogOptions;
  openArchiveDialog(options: ArchiveOpenDialogOptions): Promise<NativeOpenDialogResult>;
  canReadClipboard(): boolean;
  readClipboardText(): Promise<string | null>;
  unsupportedClipboardMessage(): string;
  clipboardEmptyMessage(): void;
  nativeDialogFailedMessage(): string;
  unknownErrorMessage(error: unknown, fallback: string): string;
  setOperationalStatus(message: string): void;
  clearPreviewState(): void;
  setCurrentArchivePath(archivePath: string): void;
  loadArchive(request: { archivePath: string }): Promise<void>;
}>;

export type ArchiveOpenController = Readonly<{
  recordExtractDestinationHistory(destination: string): void;
  recordCreateDestinationHistory(destination: string): void;
  recordRecentArchiveHistory(archivePath: string): void;
  onOpenArchive(): Promise<void>;
  openArchiveFromPath(archivePath: string): Promise<void>;
  openArchiveFromClipboard(): Promise<void>;
}>;

function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return value;
}

export function createArchiveOpenController(
  options: ArchiveOpenControllerOptions,
): ArchiveOpenController {
  function recordExtractDestinationHistory(destination: string): void {
    const snapshot = options.pathHistoryStore.recordExtractDestinationHistory(destination);
    if (!snapshot) {
      return;
    }
    options.publishPathHistorySnapshot(snapshot);
  }

  function recordCreateDestinationHistory(destination: string): void {
    const snapshot = options.pathHistoryStore.recordCreateDestinationHistory(destination);
    if (!snapshot) {
      return;
    }
    options.publishPathHistorySnapshot(snapshot);
  }

  function recordRecentArchiveHistory(archivePath: string): void {
    options.pathHistoryStore.recordRecentArchiveHistory(archivePath);
  }

  async function openArchiveFromPath(archivePath: string): Promise<void> {
    if (!archivePath) {
      return;
    }

    await openSelectedArchivePath(archivePath);
  }

  async function openSelectedArchivePath(selected: string): Promise<void> {
    options.clearPreviewState();
    options.setCurrentArchivePath(selected);
    recordRecentArchiveHistory(selected);
    await options.loadArchive({ archivePath: selected });
  }

  async function onOpenArchive(): Promise<void> {
    const selected = await options.openArchiveDialog(options.openArchiveDialogOptions());
    if (!selected || typeof selected !== "string") {
      return;
    }

    await openSelectedArchivePath(selected);
  }

  async function openArchiveFromClipboard(): Promise<void> {
    if (!options.canReadClipboard()) {
      options.setOperationalStatus(options.unsupportedClipboardMessage());
      return;
    }

    try {
      const pastedPath = stripSurroundingQuotes(await options.readClipboardText() ?? "");
      if (!pastedPath) {
        options.clipboardEmptyMessage();
        return;
      }
      await openArchiveFromPath(pastedPath);
    } catch (error) {
      options.setOperationalStatus(
        options.unknownErrorMessage(error, options.nativeDialogFailedMessage()),
      );
    }
  }

  return {
    recordExtractDestinationHistory,
    recordCreateDestinationHistory,
    recordRecentArchiveHistory,
    onOpenArchive,
    openArchiveFromPath,
    openArchiveFromClipboard,
  };
}
