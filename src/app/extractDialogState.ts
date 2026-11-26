import type { ExtractOverwritePolicy, ExtractPathMode, ExtractStartInput, TzapRestorePolicy } from "./extractFlow";

export type ExtractDialogFormSnapshot = Readonly<{
  destination: string;
  useSubfolder: boolean;
  subfolder: string;
  pathMode: ExtractPathMode;
  overwrite: ExtractOverwritePolicy;
  stripComponents: string;
  deduplicateRoot: boolean;
  tzapRestorePolicy: TzapRestorePolicy;
  tzapAllowDegraded: boolean;
  tzapAllowAbsoluteSymlinks: boolean;
  ignoreSymlinks: boolean;
  passwordPromptOpen: boolean;
}>;

export type ExtractDialogFormPatch = Partial<ExtractDialogFormSnapshot>;

export const DEFAULT_EXTRACT_DIALOG_FORM: ExtractDialogFormSnapshot = Object.freeze({
  destination: "",
  useSubfolder: false,
  subfolder: "",
  pathMode: "full",
  overwrite: "ask",
  stripComponents: "0",
  deduplicateRoot: false,
  tzapRestorePolicy: "portable",
  tzapAllowDegraded: false,
  tzapAllowAbsoluteSymlinks: false,
  ignoreSymlinks: false,
  passwordPromptOpen: false,
});

export function createExtractDialogFormSnapshot(
  patch: ExtractDialogFormPatch = {},
): ExtractDialogFormSnapshot {
  return {
    destination: patch.destination ?? DEFAULT_EXTRACT_DIALOG_FORM.destination,
    useSubfolder: patch.useSubfolder ?? DEFAULT_EXTRACT_DIALOG_FORM.useSubfolder,
    subfolder: patch.subfolder ?? DEFAULT_EXTRACT_DIALOG_FORM.subfolder,
    pathMode: normalizeExtractPathMode(patch.pathMode),
    overwrite: normalizeExtractOverwrite(patch.overwrite),
    stripComponents: normalizeStripComponentsText(patch.stripComponents),
    deduplicateRoot: patch.deduplicateRoot ?? DEFAULT_EXTRACT_DIALOG_FORM.deduplicateRoot,
    tzapRestorePolicy: normalizeTzapRestorePolicy(patch.tzapRestorePolicy),
    tzapAllowDegraded: patch.tzapAllowDegraded ?? DEFAULT_EXTRACT_DIALOG_FORM.tzapAllowDegraded,
    tzapAllowAbsoluteSymlinks: patch.tzapAllowAbsoluteSymlinks ?? DEFAULT_EXTRACT_DIALOG_FORM.tzapAllowAbsoluteSymlinks,
    ignoreSymlinks: patch.ignoreSymlinks ?? DEFAULT_EXTRACT_DIALOG_FORM.ignoreSymlinks,
    passwordPromptOpen: patch.passwordPromptOpen ?? DEFAULT_EXTRACT_DIALOG_FORM.passwordPromptOpen,
  };
}

export function patchExtractDialogFormSnapshot(
  snapshot: ExtractDialogFormSnapshot,
  patch: ExtractDialogFormPatch,
): ExtractDialogFormSnapshot {
  return createExtractDialogFormSnapshot({
    ...snapshot,
    ...patch,
  });
}

export function extractStartInputFromDialogForm(
  form: ExtractDialogFormSnapshot,
  password = "",
): ExtractStartInput {
  return {
    destinationBasePath: form.destination,
    useSubfolder: form.useSubfolder,
    subfolder: form.subfolder,
    pathMode: form.pathMode,
    overwrite: form.overwrite,
    stripComponents: form.stripComponents,
    deduplicateRoot: form.deduplicateRoot,
    tzapRestorePolicy: form.tzapRestorePolicy,
    tzapAllowDegraded: form.tzapAllowDegraded,
    tzapAllowAbsoluteSymlinks: form.tzapAllowAbsoluteSymlinks,
    ignoreSymlinks: form.ignoreSymlinks,
    ...(password ? { password } : {}),
  };
}

function normalizeExtractPathMode(value: ExtractPathMode | undefined): ExtractPathMode {
  return value === "current" || value === "none" ? value : "full";
}

function normalizeExtractOverwrite(value: ExtractOverwritePolicy | undefined): ExtractOverwritePolicy {
  if (value === undefined) {
    return DEFAULT_EXTRACT_DIALOG_FORM.overwrite;
  }
  if (value === "replace" || value === "rename" || value === "ask") {
    return value;
  }

  return "refuse";
}

function normalizeTzapRestorePolicy(value: TzapRestorePolicy | undefined): TzapRestorePolicy {
  return value === "content" || value === "sameOs" || value === "system" ? value : "portable";
}

function normalizeStripComponentsText(value: string | undefined): string {
  return value ?? DEFAULT_EXTRACT_DIALOG_FORM.stripComponents;
}
