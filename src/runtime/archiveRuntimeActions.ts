import type { ArchiveTableColumnId } from "../app/archiveTable";
import type { ZManagerArchiveIntent } from "../ui/react/appRuntime";
import type { ExtractMode } from "../app/extractFlow";
import type { ExtractWorkspaceOptionPatch, TzapVerificationSnapshot } from "../app/workspaces/extractWorkspace";

export type ArchiveRuntimeActions = Readonly<{
  handleIntent(intent: ZManagerArchiveIntent): void;
}>;

export type ArchiveRuntimeActionEffects = Readonly<{
  navigateToFolder(folderPath: string): void;
  navigateBack(): void;
  navigateUp(): void;
  loadNextPage(): void | Promise<void>;
  loadPreviousPage(): void | Promise<void>;
  setSearchQuery(query: string, immediate: boolean): void;
  clearSearch(): void;
  setFlatView(flatView: boolean, persistPreference: boolean): void;
  setColumnWidth(columnId: ArchiveTableColumnId, width: number, persist: boolean): void;
  reorderColumn(sourceColumnId: ArchiveTableColumnId, targetColumnId: ArchiveTableColumnId): void;
  toggleTreeFolder(folderPath: string): void;
  sortByColumn(columnId: ArchiveTableColumnId): void;
  selectAllVisible(): void;
  clearSelection(): void;
  selectRow(path: string, modifiers?: ArchiveRuntimeSelectionModifiers): void;
  setRowSelected(path: string, selected: boolean): void;
  applySelection(input: ArchiveRuntimeSelectionInput): void;
  runEntryDefaultAction(path: string): void;
  startNativeDrag(entryPath: string): void | Promise<void>;
  copyDetailsValue(value: string): void | Promise<void>;
  setExtractDestination(destinationPath: string): void;
  browseExtractDestination(): void | Promise<void>;
  setExtractOptions(patch: ExtractWorkspaceOptionPatch): void;
  resetExtractDefaults(): void;
  setTzapVerificationOptions(patch: Partial<Pick<TzapVerificationSnapshot, "validateTrust" | "trustedSystemRoots" | "includeOfficialTzapRoot">>): void;
  chooseTzapTrustedCAs(): void | Promise<void>;
  removeTzapTrustedCA(path: string): void;
  verifyTzapCertificate(): void | Promise<void>;
  runExtract(mode: ExtractMode, password: string): void | Promise<void>;
  showEmptyContextMenu(x: number, y: number): void;
  showColumnContextMenu(columnId: ArchiveTableColumnId, x: number, y: number): void;
  showFolderContextMenu(path: string, x: number, y: number): void;
  showEntryContextMenu(path: string, x: number, y: number): void;
  runDetailsAction(action: string): void;
}>;

export type ArchiveRuntimeSelectionModifiers = Readonly<{
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}>;

export type ArchiveRuntimeSelectionInput = Readonly<{
  selectedPaths: readonly string[];
  focusedPath: string;
  anchorPath: string;
}>;

export function createArchiveRuntimeActions(
  effects: ArchiveRuntimeActionEffects,
): ArchiveRuntimeActions {
  return {
    handleIntent(intent) {
      switch (intent.type) {
        case "navigateToFolder":
          effects.navigateToFolder(intent.folderPath);
          break;
        case "navigateBack":
          effects.navigateBack();
          break;
        case "navigateUp":
          effects.navigateUp();
          break;
        case "loadNextArchivePage":
          void effects.loadNextPage();
          break;
        case "loadPreviousArchivePage":
          void effects.loadPreviousPage();
          break;
        case "setSearchQuery":
          effects.setSearchQuery(intent.query, Boolean(intent.immediate));
          break;
        case "clearSearch":
          effects.clearSearch();
          break;
        case "setFlatView":
          effects.setFlatView(intent.flatView, Boolean(intent.persistPreference));
          break;
        case "setColumnWidth":
          effects.setColumnWidth(intent.columnId, intent.width, intent.persist);
          break;
        case "reorderColumn":
          effects.reorderColumn(intent.sourceColumnId, intent.targetColumnId);
          break;
        case "toggleTreeFolder":
          effects.toggleTreeFolder(intent.folderPath);
          break;
        case "sortByColumn":
          effects.sortByColumn(intent.columnId);
          break;
        case "selectAllVisible":
          effects.selectAllVisible();
          break;
        case "clearSelection":
          effects.clearSelection();
          break;
        case "selectRow":
          effects.selectRow(intent.path, {
            ctrl: intent.ctrlKey,
            meta: intent.metaKey,
            shift: intent.shiftKey,
          });
          break;
        case "setRowSelected":
          effects.setRowSelected(intent.path, intent.selected);
          break;
        case "applySelection":
          effects.applySelection(intent);
          break;
        case "activateRow":
          if (intent.rowKind === "folder" || intent.rowKind === "parent") {
            effects.navigateToFolder(intent.path);
          } else {
            effects.runEntryDefaultAction(intent.path);
          }
          break;
        case "startNativeDrag":
          void effects.startNativeDrag(intent.entryPath);
          break;
        case "copyDetailsValue":
          void effects.copyDetailsValue(intent.value);
          break;
        case "setExtractDestination":
          effects.setExtractDestination(intent.destinationPath);
          break;
        case "browseExtractDestination":
          void effects.browseExtractDestination();
          break;
        case "setExtractOptions":
          effects.setExtractOptions(intent.patch);
          break;
        case "resetExtractDefaults":
          effects.resetExtractDefaults();
          break;
        case "setTzapVerificationOptions":
          effects.setTzapVerificationOptions(intent.patch);
          break;
        case "chooseTzapTrustedCAs":
          void effects.chooseTzapTrustedCAs();
          break;
        case "removeTzapTrustedCA":
          effects.removeTzapTrustedCA(intent.path);
          break;
        case "verifyTzapCertificate":
          void effects.verifyTzapCertificate();
          break;
        case "runExtract":
          void effects.runExtract(intent.mode, intent.password);
          break;
        case "showEmptyContextMenu":
          effects.showEmptyContextMenu(intent.x, intent.y);
          break;
        case "showColumnContextMenu":
          effects.showColumnContextMenu(intent.columnId, intent.x, intent.y);
          break;
        case "showRowContextMenu":
          if (intent.rowKind === "folder" || intent.rowKind === "parent") {
            effects.showFolderContextMenu(intent.path, intent.x, intent.y);
          } else {
            effects.showEntryContextMenu(intent.path, intent.x, intent.y);
          }
          break;
        case "runDetailsAction":
          effects.runDetailsAction(intent.action);
          break;
      }
    },
  };
}
