import type { ExtractMode, ExtractOverwritePolicy, ExtractPathMode, ExtractStartInput, TzapRestorePolicy } from "../extractFlow";
import type { VerifyTzapCertificateResponse } from "../../api/types";

export type TzapVerificationState = "idle" | "checking" | "signatureValid" | "trusted" | "verifiedOffline" | "verifiedWithCaveat" | "error";
export type TzapVerificationSnapshot = Readonly<{
  validateTrust: boolean;
  trustedCaCertificatePaths: readonly string[];
  trustedSystemRoots: boolean;
  includeOfficialTzapRoot: boolean;
  checkCurrentStatus: boolean;
  state: TzapVerificationState;
  result: VerifyTzapCertificateResponse | null;
  error: string;
}>;

function verificationStateForResult(result: VerifyTzapCertificateResponse): TzapVerificationState {
  if (["invalid", "revoked", "suspended", "unverifiable"].includes(result.outcome) || result.verificationState === "invalid") {
    return "error";
  }
  if (["signed_before_renewal", "verified_with_caveat", "status_unavailable"].includes(result.outcome)
    || ["signed_before_renewal", "verified_with_caveat", "status_unavailable"].includes(result.verificationState ?? "")) {
    return "verifiedWithCaveat";
  }
  if (["cryptographically_intact_offline"].includes(result.outcome) || result.verificationState === "cryptographically_intact_offline") {
    return "verifiedOffline";
  }
  if (["trusted", "fresh_valid"].includes(result.outcome) || ["trusted", "fresh_valid"].includes(result.verificationState ?? "")) {
    return "trusted";
  }
  if (result.outcome === "signatureValid" || result.verificationState === "signature_valid") {
    return "signatureValid";
  }
  if (result.signatureCheck === "ok") {
    return result.trustCheck && result.trustCheck !== "untrusted" ? "trusted" : "signatureValid";
  }
  return "error";
}

export type ExtractWorkspaceOptionPatch = Partial<Pick<
  ExtractWorkspaceSnapshot,
  "destinationPath" | "pathMode" | "overwrite" | "stripComponents" | "deduplicateRoot" | "tzapRestorePolicy" | "tzapAllowDegraded" | "tzapAllowAbsoluteSymlinks" | "ignoreSymlinks" | "tzapRecipientKeyId" | "passwordPromptOpen"
>>;

export type ExtractWorkspaceDefaults = Readonly<{
  destinationPath: string;
  pathMode: ExtractPathMode;
  overwrite: ExtractOverwritePolicy;
  stripComponents: number;
  deduplicateRoot: boolean;
  tzapRestorePolicy?: TzapRestorePolicy;
  tzapAllowDegraded?: boolean;
  tzapAllowAbsoluteSymlinks?: boolean;
  ignoreSymlinks?: boolean;
}>;

export type ExtractWorkspaceSnapshot = Readonly<{
  destinationPath: string;
  pathMode: ExtractPathMode;
  overwrite: ExtractOverwritePolicy;
  stripComponents: number;
  deduplicateRoot: boolean;
  tzapRestorePolicy: TzapRestorePolicy;
  tzapAllowDegraded: boolean;
  tzapAllowAbsoluteSymlinks: boolean;
  ignoreSymlinks: boolean;
  tzapRecipientKeyId: string;
  usesGlobalDefaults: boolean;
  passwordPromptOpen: boolean;
  tzapVerification: TzapVerificationSnapshot;
}>;

export type ExtractWorkspace = Readonly<{
  getSnapshot(): ExtractWorkspaceSnapshot;
  applyDefaults(defaults: ExtractWorkspaceDefaults): ExtractWorkspaceSnapshot;
  setOptions(patch: ExtractWorkspaceOptionPatch): ExtractWorkspaceSnapshot;
  resetToDefaults(): ExtractWorkspaceSnapshot;
  setTzapVerificationOptions(patch: Partial<Pick<TzapVerificationSnapshot, "validateTrust" | "trustedCaCertificatePaths" | "trustedSystemRoots" | "includeOfficialTzapRoot" | "checkCurrentStatus">>): ExtractWorkspaceSnapshot;
  beginTzapVerification(): ExtractWorkspaceSnapshot;
  acceptTzapVerification(result: VerifyTzapCertificateResponse): ExtractWorkspaceSnapshot;
  rejectTzapVerification(error: string): ExtractWorkspaceSnapshot;
  buildStartInput(password?: string): ExtractStartInput;
}>;

const FALLBACK_DEFAULTS: ExtractWorkspaceDefaults = Object.freeze({
  destinationPath: "",
  pathMode: "full",
  overwrite: "ask",
  stripComponents: 0,
  deduplicateRoot: false,
  tzapRestorePolicy: "portable",
  tzapAllowDegraded: false,
  tzapAllowAbsoluteSymlinks: false,
  ignoreSymlinks: false,
  tzapRecipientKeyId: "",
});

export function createExtractWorkspace(initialDefaults: ExtractWorkspaceDefaults = FALLBACK_DEFAULTS): ExtractWorkspace {
  let defaults = normalizeDefaults(initialDefaults);
  let state = snapshotFromDefaults(defaults);

  return {
    getSnapshot() {
      return cloneSnapshot(state);
    },

    applyDefaults(nextDefaults) {
      defaults = normalizeDefaults(nextDefaults);
      if (state.usesGlobalDefaults) {
        state = snapshotFromDefaults(defaults);
      } else {
        state = {
          ...state,
          destinationPath: defaults.destinationPath,
        };
      }
      return cloneSnapshot(state);
    },

    setOptions(patch) {
      const changesDurableOption = Object.keys(patch).some((key) => key !== "passwordPromptOpen");
      state = {
        ...state,
        ...normalizedPatch(patch, state),
        usesGlobalDefaults: changesDurableOption ? false : state.usesGlobalDefaults,
      };
      return cloneSnapshot(state);
    },

    resetToDefaults() {
      state = snapshotFromDefaults(defaults);
      return cloneSnapshot(state);
    },

    setTzapVerificationOptions(patch) {
      state = {
        ...state,
        tzapVerification: freezeVerification({
          ...state.tzapVerification,
          ...patch,
          trustedCaCertificatePaths: patch.trustedCaCertificatePaths
            ? uniquePaths(patch.trustedCaCertificatePaths)
            : state.tzapVerification.trustedCaCertificatePaths,
          state: "idle",
          result: null,
          error: "",
        }),
      };
      return cloneSnapshot(state);
    },

    beginTzapVerification() {
      state = { ...state, tzapVerification: freezeVerification({ ...state.tzapVerification, state: "checking", result: null, error: "" }) };
      return cloneSnapshot(state);
    },

    acceptTzapVerification(result) {
      state = { ...state, tzapVerification: freezeVerification({ ...state.tzapVerification, state: verificationStateForResult(result), result: { ...result }, error: "" }) };
      return cloneSnapshot(state);
    },

    rejectTzapVerification(error) {
      state = { ...state, tzapVerification: freezeVerification({ ...state.tzapVerification, state: "error", result: null, error }) };
      return cloneSnapshot(state);
    },

    buildStartInput(password = "") {
      return {
        destinationBasePath: state.destinationPath,
        useSubfolder: false,
        subfolder: "",
        pathMode: state.pathMode,
        overwrite: state.overwrite,
        stripComponents: String(state.stripComponents),
        deduplicateRoot: state.deduplicateRoot,
        tzapRestorePolicy: state.tzapRestorePolicy,
        tzapAllowDegraded: state.tzapAllowDegraded,
        tzapAllowAbsoluteSymlinks: state.tzapAllowAbsoluteSymlinks,
        ignoreSymlinks: state.ignoreSymlinks,
        ...(state.tzapRecipientKeyId.trim() ? { tzapRecipientKeyId: state.tzapRecipientKeyId.trim() } : {}),
        ...(password.trim() ? { password: password.trim() } : {}),
      };
    },
  };
}

export function extractModeForSelection(selectedCount: number): ExtractMode {
  return selectedCount > 0 ? "selection" : "archive";
}

function snapshotFromDefaults(defaults: ExtractWorkspaceDefaults): ExtractWorkspaceSnapshot {
  return {
    destinationPath: defaults.destinationPath,
    pathMode: defaults.pathMode,
    overwrite: defaults.overwrite,
    stripComponents: defaults.stripComponents,
    deduplicateRoot: defaults.deduplicateRoot,
    tzapRestorePolicy: defaults.tzapRestorePolicy ?? "portable",
    tzapAllowDegraded: defaults.tzapAllowDegraded ?? false,
    tzapAllowAbsoluteSymlinks: defaults.tzapAllowAbsoluteSymlinks ?? false,
    ignoreSymlinks: defaults.ignoreSymlinks ?? false,
    tzapRecipientKeyId: "",
    usesGlobalDefaults: true,
    passwordPromptOpen: false,
    tzapVerification: freezeVerification({
      validateTrust: false,
      trustedCaCertificatePaths: [],
      trustedSystemRoots: false,
      includeOfficialTzapRoot: true,
      checkCurrentStatus: false,
      state: "idle",
      result: null,
      error: "",
    }),
  };
}

function normalizeDefaults(defaults: ExtractWorkspaceDefaults): ExtractWorkspaceDefaults {
  return {
    destinationPath: defaults.destinationPath.trim(),
    pathMode: normalizePathMode(defaults.pathMode),
    overwrite: normalizeOverwrite(defaults.overwrite),
    stripComponents: normalizeStripComponents(defaults.stripComponents),
    deduplicateRoot: Boolean(defaults.deduplicateRoot),
    tzapRestorePolicy: normalizeTzapRestorePolicy(defaults.tzapRestorePolicy),
    tzapAllowDegraded: Boolean(defaults.tzapAllowDegraded),
    tzapAllowAbsoluteSymlinks: Boolean(defaults.tzapAllowAbsoluteSymlinks),
    ignoreSymlinks: Boolean(defaults.ignoreSymlinks),
  };
}

function normalizedPatch(
  patch: ExtractWorkspaceOptionPatch,
  current: ExtractWorkspaceSnapshot,
): ExtractWorkspaceOptionPatch {
  return {
    ...(patch.destinationPath === undefined ? {} : { destinationPath: patch.destinationPath }),
    ...(patch.pathMode === undefined ? {} : { pathMode: normalizePathMode(patch.pathMode) }),
    ...(patch.overwrite === undefined ? {} : { overwrite: normalizeOverwrite(patch.overwrite) }),
    ...(patch.stripComponents === undefined
      ? {}
      : { stripComponents: normalizeStripComponents(patch.stripComponents) }),
    ...(patch.deduplicateRoot === undefined ? {} : { deduplicateRoot: Boolean(patch.deduplicateRoot) }),
    ...(patch.tzapRestorePolicy === undefined ? {} : { tzapRestorePolicy: normalizeTzapRestorePolicy(patch.tzapRestorePolicy) }),
    ...(patch.tzapAllowDegraded === undefined ? {} : { tzapAllowDegraded: Boolean(patch.tzapAllowDegraded) }),
    ...(patch.tzapAllowAbsoluteSymlinks === undefined ? {} : { tzapAllowAbsoluteSymlinks: Boolean(patch.tzapAllowAbsoluteSymlinks) }),
    ...(patch.ignoreSymlinks === undefined ? {} : { ignoreSymlinks: Boolean(patch.ignoreSymlinks) }),
    ...(patch.tzapRecipientKeyId === undefined ? {} : { tzapRecipientKeyId: normalizeRecipientKeyId(patch.tzapRecipientKeyId) }),
    ...(patch.passwordPromptOpen === undefined
      ? {}
      : { passwordPromptOpen: Boolean(patch.passwordPromptOpen) }),
    destinationPath: patch.destinationPath ?? current.destinationPath,
  };
}

function normalizeRecipientKeyId(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePathMode(value: ExtractPathMode): ExtractPathMode {
  return value === "current" || value === "none" ? value : "full";
}

function normalizeOverwrite(value: ExtractOverwritePolicy): ExtractOverwritePolicy {
  return value === "refuse" || value === "replace" || value === "rename" ? value : "ask";
}

function normalizeTzapRestorePolicy(value?: TzapRestorePolicy): TzapRestorePolicy {
  return value === "content" || value === "sameOs" || value === "system" ? value : "portable";
}

function normalizeStripComponents(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function cloneSnapshot(snapshot: ExtractWorkspaceSnapshot): ExtractWorkspaceSnapshot {
  return { ...snapshot, tzapVerification: freezeVerification(snapshot.tzapVerification) };
}

function freezeVerification(value: TzapVerificationSnapshot): TzapVerificationSnapshot {
  return Object.freeze({
    ...value,
    trustedCaCertificatePaths: Object.freeze([...value.trustedCaCertificatePaths]),
    result: value.result ? Object.freeze({ ...value.result }) : null,
  });
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
}
