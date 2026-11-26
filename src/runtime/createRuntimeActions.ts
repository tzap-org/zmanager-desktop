import type { CreateSourceColumnId } from "../app/createTableColumns";
import type { ZManagerCreateIntent } from "../ui/react/appRuntime";

export type CreateRuntimeActions = Readonly<{
  handleIntent(intent: ZManagerCreateIntent): void;
}>;

export type CreateRuntimeActionEffects = Readonly<{
  showWorkspace(): void;
  showAddSourcesMenu(x: number, y: number): void;
  clearSources(): void;
  removeSources(sourcePaths: readonly string[]): void;
  showSourceContextMenu(sourcePath: string, x: number, y: number): void;
  setDestinationPath(destinationPath: string): void;
  browseDestination(): void | Promise<void>;
  changeFormat(format: Extract<ZManagerCreateIntent, { type: "changeFormat" }>["format"]): void;
  setOptions(patch: Extract<ZManagerCreateIntent, { type: "setOptions" }>["patch"]): void;
  chooseTzapCertificate(target: Extract<ZManagerCreateIntent, { type: "chooseTzapCertificate" }>["target"]): void | Promise<void>;
  validateTzapSigningIdentity(identityPath: string, password: string): void | Promise<void>;
  navigateToFolder(folderPath: string): void;
  setSearchQuery(query: string): void;
  clearSearch(): void;
  toggleTreeFolder(folderPath: string): void;
  setPathIncluded(path: string, included: boolean): void;
  setCurrentFolderIncluded(included: boolean): void;
  setVisibleRowsIncluded(included: boolean): void;
  selectRow(intent: Extract<ZManagerCreateIntent, { type: "selectRow" }>): void;
  applySelection(input: Extract<ZManagerCreateIntent, { type: "applySelection" }>): void;
  toggleRowSelection(path: string): void;
  focusRow(path: string): void;
  removeSelectedSources(fallbackSourcePath?: string): void;
  showCompressRowContextMenu(path: string, sourcePath: string | undefined, x: number, y: number): void;
  showColumnContextMenu(columnId: CreateSourceColumnId | undefined, x: number, y: number): void;
  setColumnWidth(columnId: CreateSourceColumnId, width: number): void;
  reorderColumn(sourceColumnId: CreateSourceColumnId, targetColumnId: CreateSourceColumnId): void;
  runCreate(password: string, passwordConfirm: string, signingIdentityPassword: string): void | Promise<void>;
  compressAndShareOnLan(password: string, passwordConfirm: string, signingIdentityPassword: string): void | Promise<void>;
}>;

export function createCreateRuntimeActions(
  effects: CreateRuntimeActionEffects,
): CreateRuntimeActions {
  return {
    handleIntent(intent) {
      switch (intent.type) {
        case "showWorkspace":
          effects.showWorkspace();
          break;
        case "showAddSourcesMenu":
          effects.showAddSourcesMenu(intent.x, intent.y);
          break;
        case "clearSources":
          effects.clearSources();
          break;
        case "removeSources":
          effects.removeSources(intent.sourcePaths);
          break;
        case "showSourceContextMenu":
          effects.showSourceContextMenu(intent.sourcePath, intent.x, intent.y);
          break;
        case "setDestinationPath":
          effects.setDestinationPath(intent.destinationPath);
          break;
        case "browseDestination":
          void effects.browseDestination();
          break;
        case "changeFormat":
          effects.changeFormat(intent.format);
          break;
        case "setOptions":
          effects.setOptions(intent.patch);
          break;
        case "chooseTzapCertificate":
          void effects.chooseTzapCertificate(intent.target);
          break;
        case "validateTzapSigningIdentity":
          void effects.validateTzapSigningIdentity(intent.identityPath, intent.password);
          break;
        case "navigateToFolder":
          effects.navigateToFolder(intent.folderPath);
          break;
        case "setSearchQuery":
          effects.setSearchQuery(intent.query);
          break;
        case "clearSearch":
          effects.clearSearch();
          break;
        case "toggleTreeFolder":
          effects.toggleTreeFolder(intent.folderPath);
          break;
        case "setPathIncluded":
          effects.setPathIncluded(intent.path, intent.included);
          break;
        case "setCurrentFolderIncluded":
          effects.setCurrentFolderIncluded(intent.included);
          break;
        case "setVisibleRowsIncluded":
          effects.setVisibleRowsIncluded(intent.included);
          break;
        case "selectRow":
          effects.selectRow(intent);
          break;
        case "applySelection":
          effects.applySelection(intent);
          break;
        case "toggleRowSelection":
          effects.toggleRowSelection(intent.path);
          break;
        case "focusRow":
          effects.focusRow(intent.path);
          break;
        case "removeSelectedSources":
          effects.removeSelectedSources(intent.fallbackSourcePath);
          break;
        case "showCompressRowContextMenu":
          effects.showCompressRowContextMenu(intent.path, intent.sourcePath, intent.x, intent.y);
          break;
        case "showColumnContextMenu":
          effects.showColumnContextMenu(intent.columnId, intent.x, intent.y);
          break;
        case "setColumnWidth":
          effects.setColumnWidth(intent.columnId, intent.width);
          break;
        case "reorderColumn":
          effects.reorderColumn(intent.sourceColumnId, intent.targetColumnId);
          break;
        case "runCreate":
          void effects.runCreate(intent.password, intent.passwordConfirm, intent.signingIdentityPassword);
          break;
        case "compressAndShareOnLan":
          void effects.compressAndShareOnLan(intent.password, intent.passwordConfirm, intent.signingIdentityPassword);
          break;
      }
    },
  };
}
