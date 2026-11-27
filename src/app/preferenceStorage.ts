export type PreferenceStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type PreferenceStorageKey =
  | "locale"
  | "defaultArchiveFormat"
  | "defaultCleanSourceEnabled"
  | "createFormatDefaults"
  | "volumeSizePresets"
  | "defaultOutputLocation"
  | "customOutputFolderPath"
  | "customExtractFolderPath"
  | "defaultExtractionBehavior"
  | "defaultExtractPathMode"
  | "defaultExtractOverwrite"
  | "defaultExtractStripComponents"
  | "defaultExtractDeduplicateRoot"
  | "defaultTzapRestorePolicy"
  | "defaultTzapAllowDegraded"
  | "defaultExtractIgnoreSymlinks"
  | "previewCleanupPolicy"
  | "showParentFolderItem"
  | "showRealFileIcons"
  | "showGridLines"
  | "fullRowSelect"
  | "singleClickOpen"
  | "alternativeSelectionMode"
  | "showToolbarLabels"
  | "flatViewDefault"
  | "tableSortKey"
  | "tableSortAscending"
  | "tzapEnvironment"
  | "lanShareAlias"
  | "lanShareEnableReceiving"
  | "lanShareReceiveFolderPath"
  | "lanShareAutoExtract";

export const PREFERENCE_KEYS = {
  locale: "zmanager.locale",
  defaultArchiveFormat: "zmanager.defaultArchiveFormat",
  defaultCleanSourceEnabled: "zmanager.defaultCleanSourceEnabled",
  createFormatDefaults: "zmanager.createFormatDefaults",
  volumeSizePresets: "zmanager.volumeSizePresets",
  defaultOutputLocation: "zmanager.defaultOutputLocation",
  customOutputFolderPath: "zmanager.customOutputFolderPath",
  customExtractFolderPath: "zmanager.customExtractFolderPath",
  defaultExtractionBehavior: "zmanager.defaultExtractionBehavior",
  defaultExtractPathMode: "zmanager.defaultExtractPathMode",
  defaultExtractOverwrite: "zmanager.defaultExtractOverwrite",
  defaultExtractStripComponents: "zmanager.defaultExtractStripComponents",
  defaultExtractDeduplicateRoot: "zmanager.defaultExtractDeduplicateRoot",
  defaultTzapRestorePolicy: "zmanager.defaultTzapRestorePolicy",
  defaultTzapAllowDegraded: "zmanager.defaultTzapAllowDegraded",
  defaultExtractIgnoreSymlinks: "zmanager.defaultExtractIgnoreSymlinks",
  previewCleanupPolicy: "zmanager.previewCleanupPolicy",
  showParentFolderItem: "zmanager.showParentFolderItem",
  showRealFileIcons: "zmanager.showRealFileIcons",
  showGridLines: "zmanager.showGridLines",
  fullRowSelect: "zmanager.fullRowSelect",
  singleClickOpen: "zmanager.singleClickOpen",
  alternativeSelectionMode: "zmanager.alternativeSelectionMode",
  showToolbarLabels: "zmanager.showToolbarLabels",
  flatViewDefault: "zmanager.flatViewDefault",
  tableSortKey: "zmanager.tableSortKey",
  tableSortAscending: "zmanager.tableSortAscending",
  tzapEnvironment: "zmanager.tzapEnvironment",
  lanShareAlias: "zmanager.lanShareAlias",
  lanShareEnableReceiving: "zmanager.lanShareEnableReceiving",
  lanShareReceiveFolderPath: "zmanager.lanShareReceiveFolderPath",
  lanShareAutoExtract: "zmanager.lanShareAutoExtract",
};

export function resolvePreferenceStorage(): PreferenceStorage | null {
  try {
    const storage = globalThis.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}
