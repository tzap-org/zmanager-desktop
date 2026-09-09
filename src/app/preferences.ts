import {
  createFormatSupportsPassword,
  normalizeTzapRecoveryPercentage,
  normalizeTzapVolumeLossTolerance,
  TZAP_RECOVERY_PERCENTAGE_DEFAULT,
  type CreateArchiveFormat,
} from "./createFlow";
import {
  type ArchiveSortKey,
} from "./archiveTable";
import {
  PREFERENCE_KEYS,
  resolvePreferenceStorage,
  type PreferenceStorage,
} from "./preferenceStorage";
import {
  SYSTEM_LOCALE_PREFERENCE,
  isLocalePreference,
  type LocalePreference,
} from "./i18n/locale";
import type { ExtractOverwritePolicy, ExtractPathMode, TzapRestorePolicy } from "./extractFlow";
import { DEFAULT_VOLUME_SIZE_PRESETS, normalizeVolumeSizePresets } from "./volumeSizePresets";
import { resolveTzapEnvironment, type TzapEnvironment } from "./tzapEnvironment";

export type DefaultOutputLocation = "sourceFolder" | "customFolder";
export type DefaultExtractionBehavior = "askEveryTime" | "extractHere" | "extractToFolder";
export type PreviewCleanupPolicy = "beforeNextPreview" | "whenAppCloses";
export type TzapSigningDefault = "accountDefault" | "none" | "identity";
export type FormatCreateDefaults = {
  cleanSource: boolean;
  respectGitignore?: boolean;
  followSymlinks?: boolean;
  compressionLevel: number | null;
  volumeSize: number | null;
  tzapRecoveryPercentage: number | null;
  tzapVolumeLossTolerance?: number;
  tzapSigningDefault?: TzapSigningDefault;
  tzapDefaultSigningIdentityId?: string | null;
  tzapBootstrapSidecar?: boolean;
  zipCompression?: "store" | "deflate";
  sevenZSolid?: boolean;
  sevenZThreads?: number | null;
  sevenZChunkSize?: number | null;
  sevenZEncryptFileNames?: boolean;
  preserveMetadata: boolean;
  replaceExisting: boolean;
  promptForPassword: boolean;
};
export type CreateFormatDefaultsMap = Record<CreateArchiveFormat, FormatCreateDefaults>;

export type AppPreferences = {
  locale: LocalePreference;
  defaultArchiveFormat: CreateArchiveFormat;
  defaultCleanSourceEnabled: boolean;
  createFormatDefaults: CreateFormatDefaultsMap;
  volumeSizePresets: number[];
  defaultOutputLocation: DefaultOutputLocation;
  customOutputFolderPath: string;
  customExtractFolderPath: string;
  defaultExtractionBehavior: DefaultExtractionBehavior;
  defaultExtractPathMode: ExtractPathMode;
  defaultExtractOverwrite: ExtractOverwritePolicy;
  defaultExtractStripComponents: number;
  defaultExtractDeduplicateRoot: boolean;
  defaultTzapRestorePolicy: TzapRestorePolicy;
  defaultTzapAllowDegraded: boolean;
  defaultTzapAllowAbsoluteSymlinks: boolean;
  defaultExtractIgnoreSymlinks: boolean;
  previewCleanupPolicy: PreviewCleanupPolicy;
  showParentFolderItem: boolean;
  showRealFileIcons: boolean;
  showGridLines: boolean;
  fullRowSelect: boolean;
  singleClickOpen: boolean;
  alternativeSelectionMode: boolean;
  showToolbarLabels: boolean;
  flatViewDefault: boolean;
  tableSortKey: ArchiveSortKey;
  tableSortAscending: boolean;
  tzapEnvironment: TzapEnvironment;
  lanShareAlias: string;
  lanShareEnableReceiving: boolean;
  lanShareReceiveFolderPath: string;
  lanShareAutoExtract: boolean;
};

export type AppPreferencePatch = Partial<AppPreferences>;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  locale: SYSTEM_LOCALE_PREFERENCE,
  defaultArchiveFormat: "tarZst",
  defaultCleanSourceEnabled: false,
  createFormatDefaults: {
    zip: {
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
      compressionLevel: null,
      volumeSize: null,
      tzapRecoveryPercentage: null,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: false,
      zipCompression: "deflate",
    },
    tarZst: {
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
      compressionLevel: null,
      volumeSize: null,
      tzapRecoveryPercentage: null,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: false,
    },
    tzap: {
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
      compressionLevel: null,
      volumeSize: null,
      tzapRecoveryPercentage: TZAP_RECOVERY_PERCENTAGE_DEFAULT,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: false,
      tzapVolumeLossTolerance: 0,
      tzapSigningDefault: "accountDefault",
      tzapDefaultSigningIdentityId: null,
      tzapBootstrapSidecar: false,
    },
    sevenZ: {
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
      compressionLevel: null,
      volumeSize: null,
      tzapRecoveryPercentage: null,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: false,
      sevenZSolid: true,
      sevenZThreads: null,
      sevenZChunkSize: 16 * 1024 * 1024,
      sevenZEncryptFileNames: true,
    },
    tarGz: {
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
      compressionLevel: null,
      volumeSize: null,
      tzapRecoveryPercentage: null,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: false,
    },
    appleArchive: {
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: false,
      compressionLevel: null,
      volumeSize: null,
      tzapRecoveryPercentage: null,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: false,
    },
  },
  volumeSizePresets: [...DEFAULT_VOLUME_SIZE_PRESETS],
  defaultOutputLocation: "sourceFolder",
  customOutputFolderPath: "",
  customExtractFolderPath: "",
  defaultExtractionBehavior: "askEveryTime",
  defaultExtractPathMode: "full",
  defaultExtractOverwrite: "ask",
  defaultExtractStripComponents: 0,
  defaultExtractDeduplicateRoot: false,
  defaultTzapRestorePolicy: "portable",
  defaultTzapAllowDegraded: false,
  defaultTzapAllowAbsoluteSymlinks: false,
  defaultExtractIgnoreSymlinks: false,
  previewCleanupPolicy: "beforeNextPreview",
  showParentFolderItem: true,
  showRealFileIcons: true,
  showGridLines: true,
  fullRowSelect: true,
  singleClickOpen: false,
  alternativeSelectionMode: false,
  showToolbarLabels: true,
  flatViewDefault: false,
  tableSortKey: "name",
  tableSortAscending: true,
  tzapEnvironment: resolveTzapEnvironment(null),
  lanShareAlias: "",
  lanShareEnableReceiving: true,
  lanShareReceiveFolderPath: "",
  lanShareAutoExtract: true,
};

const ARCHIVE_FORMATS = ["zip", "tarZst", "tzap", "sevenZ", "tarGz", "appleArchive"] as const;
const OUTPUT_LOCATIONS = ["sourceFolder", "customFolder"] as const;
const EXTRACTION_BEHAVIORS = ["askEveryTime", "extractHere", "extractToFolder"] as const;
const EXTRACT_PATH_MODES = ["full", "current", "none"] as const;
const EXTRACT_OVERWRITE_POLICIES = ["refuse", "ask", "rename", "replace"] as const;
const TZAP_RESTORE_POLICIES = ["content", "portable", "sameOs", "system"] as const;
const TZAP_SIGNING_DEFAULTS = ["accountDefault", "none", "identity"] as const;
const PREVIEW_CLEANUP_POLICIES = ["beforeNextPreview", "whenAppCloses"] as const;
const TABLE_SORT_KEYS = [
  "name",
  "size",
  "compressedSize",
  "modified",
  "created",
  "accessed",
  "attributes",
  "encrypted",
  "method",
  "crc",
  "comment",
  "kind",
  "ratio",
  "solid",
  "linkTarget",
  "metadataDiagnostics",
  "uid",
  "gid",
  "owner",
  "group",
] as const;

function isOneOf<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function storedBool(value: string | null, fallback: boolean): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function storedNumber(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function storedPositiveNumber(value: unknown, fallback: number | null): number | null {
  const stored = storedNumber(value, fallback);
  return stored !== null && stored > 0 ? stored : null;
}

function storedTzapRecoveryPercentage(value: unknown, fallback: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return normalizeTzapRecoveryPercentage(value) ?? fallback;
}

function storedTzapVolumeLossTolerance(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return normalizeTzapVolumeLossTolerance(value) ?? fallback;
}

function storedTzapVolumeLossToleranceForSplit(
  volumeSize: unknown,
  value: unknown,
  fallback: number,
): number {
  return storedPositiveNumber(volumeSize, null) === null
    ? 0
    : storedTzapVolumeLossTolerance(value, fallback);
}

function storedObjectBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function storedOptionalString(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || null;
}

function storedTzapSigningDefault(value: unknown, fallback: TzapSigningDefault): TzapSigningDefault {
  const candidate = typeof value === "string" ? value : null;
  return isOneOf(TZAP_SIGNING_DEFAULTS, candidate)
    ? candidate
    : fallback;
}

function defaultCreateFormatDefaults(cleanSource: boolean): CreateFormatDefaultsMap {
  return Object.fromEntries(
    ARCHIVE_FORMATS.map((format) => [
      format,
      {
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults[format],
        cleanSource,
      },
    ]),
  ) as CreateFormatDefaultsMap;
}

function loadCreateFormatDefaults(value: string | null, cleanSourceFallback: boolean): CreateFormatDefaultsMap {
  const defaults = defaultCreateFormatDefaults(cleanSourceFallback);
  if (!value) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      ARCHIVE_FORMATS.map((format) => {
        const raw = parsed[format] as Partial<Record<keyof FormatCreateDefaults, unknown>> | undefined;
        const fallback = defaults[format];
        return [
          format,
          {
            cleanSource: storedObjectBool(raw?.cleanSource, fallback.cleanSource),
            respectGitignore: storedObjectBool(raw?.respectGitignore, fallback.respectGitignore ?? false),
            followSymlinks: storedObjectBool(raw?.followSymlinks, fallback.followSymlinks ?? false),
            compressionLevel: storedNumber(raw?.compressionLevel, fallback.compressionLevel),
            volumeSize: storedPositiveNumber(raw?.volumeSize, fallback.volumeSize),
            tzapRecoveryPercentage: format === "tzap"
              ? storedTzapRecoveryPercentage(raw?.tzapRecoveryPercentage, fallback.tzapRecoveryPercentage)
              : null,
            preserveMetadata: storedObjectBool(raw?.preserveMetadata, fallback.preserveMetadata),
            replaceExisting: storedObjectBool(raw?.replaceExisting, fallback.replaceExisting),
            promptForPassword:
              createFormatSupportsPassword(format) &&
              storedObjectBool(raw?.promptForPassword, fallback.promptForPassword),
            ...(format === "zip" ? { zipCompression: raw?.zipCompression === "store" ? "store" as const : "deflate" as const } : {}),
            ...(format === "tzap" ? {
              tzapVolumeLossTolerance: storedTzapVolumeLossToleranceForSplit(raw?.volumeSize, raw?.tzapVolumeLossTolerance, fallback.tzapVolumeLossTolerance ?? 0),
              tzapSigningDefault: (() => {
                const mode = storedTzapSigningDefault(raw?.tzapSigningDefault, fallback.tzapSigningDefault ?? "accountDefault");
                const identityId = storedOptionalString(raw?.tzapDefaultSigningIdentityId, fallback.tzapDefaultSigningIdentityId ?? null);
                return mode === "identity" && !identityId ? "accountDefault" : mode;
              })(),
              tzapDefaultSigningIdentityId: storedOptionalString(raw?.tzapDefaultSigningIdentityId, fallback.tzapDefaultSigningIdentityId ?? null),
              tzapBootstrapSidecar: storedObjectBool(raw?.tzapBootstrapSidecar, fallback.tzapBootstrapSidecar ?? false),
            } : {}),
            ...(format === "sevenZ" ? {
              sevenZSolid: storedObjectBool(raw?.sevenZSolid, fallback.sevenZSolid ?? true),
              sevenZThreads: storedPositiveNumber(raw?.sevenZThreads, fallback.sevenZThreads ?? null),
              sevenZChunkSize: storedPositiveNumber(raw?.sevenZChunkSize, fallback.sevenZChunkSize ?? null),
              sevenZEncryptFileNames: storedObjectBool(raw?.sevenZEncryptFileNames, fallback.sevenZEncryptFileNames ?? true),
            } : {}),
          },
        ];
      }),
    ) as CreateFormatDefaultsMap;
  } catch {
    return defaults;
  }
}

function cleanPath(value: string | null): string {
  return value?.trim() ?? "";
}

function storedString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function loadVolumeSizePresets(value: string | null): number[] {
  if (!value) {
    return [...DEFAULT_VOLUME_SIZE_PRESETS];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_VOLUME_SIZE_PRESETS];
    }
    const normalized = normalizeVolumeSizePresets(parsed);
    return normalized.length ? normalized : [...DEFAULT_VOLUME_SIZE_PRESETS];
  } catch {
    return [...DEFAULT_VOLUME_SIZE_PRESETS];
  }
}

export function loadAppPreferences(storage = resolvePreferenceStorage()): AppPreferences {
  if (!storage) {
    return { ...DEFAULT_APP_PREFERENCES };
  }

  const defaultArchiveFormat = storage.getItem(PREFERENCE_KEYS.defaultArchiveFormat);
  const locale = storage.getItem(PREFERENCE_KEYS.locale);
  const defaultOutputLocation = storage.getItem(PREFERENCE_KEYS.defaultOutputLocation);
  const defaultExtractionBehavior = storage.getItem(PREFERENCE_KEYS.defaultExtractionBehavior);
  const defaultExtractPathMode = storage.getItem(PREFERENCE_KEYS.defaultExtractPathMode);
  const defaultExtractOverwrite = storage.getItem(PREFERENCE_KEYS.defaultExtractOverwrite);
  const defaultExtractStripComponents = storage.getItem(PREFERENCE_KEYS.defaultExtractStripComponents);
  const defaultTzapRestorePolicy = storage.getItem(PREFERENCE_KEYS.defaultTzapRestorePolicy);
  const previewCleanupPolicy = storage.getItem(PREFERENCE_KEYS.previewCleanupPolicy);
  const tableSortKey = storage.getItem(PREFERENCE_KEYS.tableSortKey);
  const defaultCleanSourceEnabled = storedBool(
    storage.getItem(PREFERENCE_KEYS.defaultCleanSourceEnabled),
    DEFAULT_APP_PREFERENCES.defaultCleanSourceEnabled,
  );

  return {
    locale: isLocalePreference(locale) ? locale : DEFAULT_APP_PREFERENCES.locale,
    defaultArchiveFormat: isOneOf(ARCHIVE_FORMATS, defaultArchiveFormat)
      ? defaultArchiveFormat
      : DEFAULT_APP_PREFERENCES.defaultArchiveFormat,
    defaultCleanSourceEnabled,
    createFormatDefaults: loadCreateFormatDefaults(
      storage.getItem(PREFERENCE_KEYS.createFormatDefaults),
      defaultCleanSourceEnabled,
    ),
    defaultOutputLocation: isOneOf(OUTPUT_LOCATIONS, defaultOutputLocation)
      ? defaultOutputLocation
      : DEFAULT_APP_PREFERENCES.defaultOutputLocation,
    customOutputFolderPath: cleanPath(storage.getItem(PREFERENCE_KEYS.customOutputFolderPath)),
    customExtractFolderPath: cleanPath(storage.getItem(PREFERENCE_KEYS.customExtractFolderPath)),
    defaultExtractionBehavior: isOneOf(EXTRACTION_BEHAVIORS, defaultExtractionBehavior)
      ? defaultExtractionBehavior
      : DEFAULT_APP_PREFERENCES.defaultExtractionBehavior,
    defaultExtractPathMode: isOneOf(EXTRACT_PATH_MODES, defaultExtractPathMode)
      ? defaultExtractPathMode
      : DEFAULT_APP_PREFERENCES.defaultExtractPathMode,
    defaultExtractOverwrite: isOneOf(EXTRACT_OVERWRITE_POLICIES, defaultExtractOverwrite)
      ? defaultExtractOverwrite
      : DEFAULT_APP_PREFERENCES.defaultExtractOverwrite,
    defaultExtractStripComponents: defaultExtractStripComponents === null
      ? DEFAULT_APP_PREFERENCES.defaultExtractStripComponents
      : storedNumber(
          Number(defaultExtractStripComponents),
          DEFAULT_APP_PREFERENCES.defaultExtractStripComponents,
        ) ?? 0,
    defaultExtractDeduplicateRoot: storedBool(
      storage.getItem(PREFERENCE_KEYS.defaultExtractDeduplicateRoot),
      DEFAULT_APP_PREFERENCES.defaultExtractDeduplicateRoot,
    ),
    defaultTzapRestorePolicy: isOneOf(TZAP_RESTORE_POLICIES, defaultTzapRestorePolicy)
      ? defaultTzapRestorePolicy
      : DEFAULT_APP_PREFERENCES.defaultTzapRestorePolicy,
    defaultTzapAllowDegraded: storedBool(
      storage.getItem(PREFERENCE_KEYS.defaultTzapAllowDegraded),
      DEFAULT_APP_PREFERENCES.defaultTzapAllowDegraded,
    ),
    defaultTzapAllowAbsoluteSymlinks: storedBool(
      storage.getItem(PREFERENCE_KEYS.defaultTzapAllowAbsoluteSymlinks),
      DEFAULT_APP_PREFERENCES.defaultTzapAllowAbsoluteSymlinks,
    ),
    defaultExtractIgnoreSymlinks: storedBool(
      storage.getItem(PREFERENCE_KEYS.defaultExtractIgnoreSymlinks),
      DEFAULT_APP_PREFERENCES.defaultExtractIgnoreSymlinks,
    ),
    volumeSizePresets: loadVolumeSizePresets(storage.getItem(PREFERENCE_KEYS.volumeSizePresets)),
    previewCleanupPolicy: isOneOf(PREVIEW_CLEANUP_POLICIES, previewCleanupPolicy)
      ? previewCleanupPolicy
      : DEFAULT_APP_PREFERENCES.previewCleanupPolicy,
    showParentFolderItem: storedBool(
      storage.getItem(PREFERENCE_KEYS.showParentFolderItem),
      DEFAULT_APP_PREFERENCES.showParentFolderItem,
    ),
    showRealFileIcons: storedBool(
      storage.getItem(PREFERENCE_KEYS.showRealFileIcons),
      DEFAULT_APP_PREFERENCES.showRealFileIcons,
    ),
    showGridLines: storedBool(
      storage.getItem(PREFERENCE_KEYS.showGridLines),
      DEFAULT_APP_PREFERENCES.showGridLines,
    ),
    fullRowSelect: storedBool(
      storage.getItem(PREFERENCE_KEYS.fullRowSelect),
      DEFAULT_APP_PREFERENCES.fullRowSelect,
    ),
    singleClickOpen: storedBool(
      storage.getItem(PREFERENCE_KEYS.singleClickOpen),
      DEFAULT_APP_PREFERENCES.singleClickOpen,
    ),
    alternativeSelectionMode: storedBool(
      storage.getItem(PREFERENCE_KEYS.alternativeSelectionMode),
      DEFAULT_APP_PREFERENCES.alternativeSelectionMode,
    ),
    showToolbarLabels: storedBool(
      storage.getItem(PREFERENCE_KEYS.showToolbarLabels),
      DEFAULT_APP_PREFERENCES.showToolbarLabels,
    ),
    flatViewDefault: storedBool(
      storage.getItem(PREFERENCE_KEYS.flatViewDefault),
      DEFAULT_APP_PREFERENCES.flatViewDefault,
    ),
    tableSortKey: isOneOf(TABLE_SORT_KEYS, tableSortKey)
      ? tableSortKey
      : DEFAULT_APP_PREFERENCES.tableSortKey,
    tableSortAscending: storedBool(
      storage.getItem(PREFERENCE_KEYS.tableSortAscending),
      DEFAULT_APP_PREFERENCES.tableSortAscending,
    ),
    tzapEnvironment: resolveTzapEnvironment(storage.getItem(PREFERENCE_KEYS.tzapEnvironment)),
    lanShareAlias: storage.getItem(PREFERENCE_KEYS.lanShareAlias) ?? DEFAULT_APP_PREFERENCES.lanShareAlias,
    lanShareEnableReceiving: storedBool(
      storage.getItem(PREFERENCE_KEYS.lanShareEnableReceiving),
      DEFAULT_APP_PREFERENCES.lanShareEnableReceiving,
    ),
    lanShareReceiveFolderPath: cleanPath(storage.getItem(PREFERENCE_KEYS.lanShareReceiveFolderPath)),
    lanShareAutoExtract: storedBool(
      storage.getItem(PREFERENCE_KEYS.lanShareAutoExtract),
      DEFAULT_APP_PREFERENCES.lanShareAutoExtract,
    ),
  };
}

export function saveAppPreferences(preferences: AppPreferences, storage = resolvePreferenceStorage()): void {
  if (!storage) {
    return;
  }

  storage.setItem(PREFERENCE_KEYS.defaultArchiveFormat, preferences.defaultArchiveFormat);
  storage.setItem(PREFERENCE_KEYS.locale, preferences.locale);
  storage.setItem(PREFERENCE_KEYS.defaultCleanSourceEnabled, String(preferences.defaultCleanSourceEnabled));
  storage.setItem(PREFERENCE_KEYS.createFormatDefaults, JSON.stringify(preferences.createFormatDefaults));
  storage.setItem(PREFERENCE_KEYS.volumeSizePresets, JSON.stringify(preferences.volumeSizePresets));
  storage.setItem(PREFERENCE_KEYS.defaultOutputLocation, preferences.defaultOutputLocation);
  storage.setItem(PREFERENCE_KEYS.defaultExtractionBehavior, preferences.defaultExtractionBehavior);
  storage.setItem(PREFERENCE_KEYS.defaultExtractPathMode, preferences.defaultExtractPathMode);
  storage.setItem(PREFERENCE_KEYS.defaultExtractOverwrite, preferences.defaultExtractOverwrite);
  storage.setItem(PREFERENCE_KEYS.defaultExtractStripComponents, String(preferences.defaultExtractStripComponents));
  storage.setItem(PREFERENCE_KEYS.defaultExtractDeduplicateRoot, String(preferences.defaultExtractDeduplicateRoot));
  storage.setItem(PREFERENCE_KEYS.defaultTzapRestorePolicy, preferences.defaultTzapRestorePolicy);
  storage.setItem(PREFERENCE_KEYS.defaultTzapAllowDegraded, String(preferences.defaultTzapAllowDegraded));
  storage.setItem(PREFERENCE_KEYS.defaultTzapAllowAbsoluteSymlinks, String(preferences.defaultTzapAllowAbsoluteSymlinks));
  storage.setItem(PREFERENCE_KEYS.defaultExtractIgnoreSymlinks, String(preferences.defaultExtractIgnoreSymlinks));
  storage.setItem(PREFERENCE_KEYS.previewCleanupPolicy, preferences.previewCleanupPolicy);
  storage.setItem(PREFERENCE_KEYS.showParentFolderItem, String(preferences.showParentFolderItem));
  storage.setItem(PREFERENCE_KEYS.showRealFileIcons, String(preferences.showRealFileIcons));
  storage.setItem(PREFERENCE_KEYS.showGridLines, String(preferences.showGridLines));
  storage.setItem(PREFERENCE_KEYS.fullRowSelect, String(preferences.fullRowSelect));
  storage.setItem(PREFERENCE_KEYS.singleClickOpen, String(preferences.singleClickOpen));
  storage.setItem(PREFERENCE_KEYS.alternativeSelectionMode, String(preferences.alternativeSelectionMode));
  storage.setItem(PREFERENCE_KEYS.showToolbarLabels, String(preferences.showToolbarLabels));
  storage.setItem(PREFERENCE_KEYS.flatViewDefault, String(preferences.flatViewDefault));
  storage.setItem(PREFERENCE_KEYS.tableSortKey, preferences.tableSortKey);
  storage.setItem(PREFERENCE_KEYS.tableSortAscending, String(preferences.tableSortAscending));
  storage.setItem(PREFERENCE_KEYS.tzapEnvironment, preferences.tzapEnvironment);
  storage.setItem(PREFERENCE_KEYS.lanShareAlias, preferences.lanShareAlias);
  storage.setItem(PREFERENCE_KEYS.lanShareEnableReceiving, String(preferences.lanShareEnableReceiving));
  storage.setItem(PREFERENCE_KEYS.lanShareAutoExtract, String(preferences.lanShareAutoExtract));

  const customOutputFolderPath = preferences.customOutputFolderPath.trim();
  if (customOutputFolderPath) {
    storage.setItem(PREFERENCE_KEYS.customOutputFolderPath, customOutputFolderPath);
  } else {
    storage.removeItem(PREFERENCE_KEYS.customOutputFolderPath);
  }
  const customExtractFolderPath = preferences.customExtractFolderPath.trim();
  if (customExtractFolderPath) {
    storage.setItem(PREFERENCE_KEYS.customExtractFolderPath, customExtractFolderPath);
  } else {
    storage.removeItem(PREFERENCE_KEYS.customExtractFolderPath);
  }
  const lanShareReceiveFolderPath = preferences.lanShareReceiveFolderPath.trim();
  if (lanShareReceiveFolderPath) {
    storage.setItem(PREFERENCE_KEYS.lanShareReceiveFolderPath, lanShareReceiveFolderPath);
  } else {
    storage.removeItem(PREFERENCE_KEYS.lanShareReceiveFolderPath);
  }
}

export function preferencesWithPatch(
  preferences: AppPreferences,
  patch: AppPreferencePatch,
): AppPreferences {
  return {
    ...preferences,
    ...patch,
    tzapEnvironment: resolveTzapEnvironment(patch.tzapEnvironment),
    createFormatDefaults: normalizeCreateFormatDefaults(
      patch.createFormatDefaults ?? preferences.createFormatDefaults,
    ),
    volumeSizePresets: (() => {
      const normalized = normalizeVolumeSizePresets(patch.volumeSizePresets ?? preferences.volumeSizePresets);
      return normalized.length ? normalized : [...DEFAULT_VOLUME_SIZE_PRESETS];
    })(),
    customOutputFolderPath:
      patch.customOutputFolderPath !== undefined
        ? patch.customOutputFolderPath.trim()
        : preferences.customOutputFolderPath,
    customExtractFolderPath:
      patch.customExtractFolderPath !== undefined
        ? patch.customExtractFolderPath.trim()
        : preferences.customExtractFolderPath,
    lanShareReceiveFolderPath:
      patch.lanShareReceiveFolderPath !== undefined
        ? patch.lanShareReceiveFolderPath.trim()
        : preferences.lanShareReceiveFolderPath,
    defaultTzapRestorePolicy: isOneOf(
      TZAP_RESTORE_POLICIES,
      patch.defaultTzapRestorePolicy ?? preferences.defaultTzapRestorePolicy,
    )
      ? (patch.defaultTzapRestorePolicy ?? preferences.defaultTzapRestorePolicy)
      : DEFAULT_APP_PREFERENCES.defaultTzapRestorePolicy,
    defaultTzapAllowDegraded: Boolean(
      patch.defaultTzapAllowDegraded ?? preferences.defaultTzapAllowDegraded,
    ),
    defaultTzapAllowAbsoluteSymlinks: Boolean(
      patch.defaultTzapAllowAbsoluteSymlinks ?? preferences.defaultTzapAllowAbsoluteSymlinks,
    ),
    defaultExtractIgnoreSymlinks: Boolean(
      patch.defaultExtractIgnoreSymlinks ?? preferences.defaultExtractIgnoreSymlinks,
    ),
  };
}

export function createDefaultsForFormat(
  preferences: AppPreferences,
  format: CreateArchiveFormat,
): FormatCreateDefaults {
  return preferences.createFormatDefaults[format] ?? DEFAULT_APP_PREFERENCES.createFormatDefaults[format];
}

export function resolveTzapSigningIdentityId(
  defaults: FormatCreateDefaults,
  accountDefaultIdentityId: string | null,
  activeIdentityIds: readonly string[],
): string {
  const candidate = defaults.tzapSigningDefault === "identity"
    ? defaults.tzapDefaultSigningIdentityId ?? ""
    : defaults.tzapSigningDefault === "none"
      ? ""
      : accountDefaultIdentityId ?? "";
  return candidate && activeIdentityIds.includes(candidate) ? candidate : "";
}

function normalizeCreateFormatDefaults(defaults: CreateFormatDefaultsMap): CreateFormatDefaultsMap {
  return Object.fromEntries(
    ARCHIVE_FORMATS.map((format) => {
      const fallback = DEFAULT_APP_PREFERENCES.createFormatDefaults[format];
      const value = defaults[format] ?? fallback;
      return [
        format,
        {
          cleanSource: Boolean(value.cleanSource),
          respectGitignore: Boolean(value.respectGitignore),
          followSymlinks: Boolean(value.followSymlinks),
          compressionLevel: storedNumber(value.compressionLevel, fallback.compressionLevel),
          volumeSize: storedPositiveNumber(value.volumeSize, fallback.volumeSize),
          tzapRecoveryPercentage: format === "tzap"
            ? storedTzapRecoveryPercentage(value.tzapRecoveryPercentage, fallback.tzapRecoveryPercentage)
            : null,
          preserveMetadata: Boolean(value.preserveMetadata),
          replaceExisting: Boolean(value.replaceExisting),
          promptForPassword: createFormatSupportsPassword(format) && Boolean(value.promptForPassword),
          ...(format === "zip" ? { zipCompression: value.zipCompression === "store" ? "store" as const : "deflate" as const } : {}),
          ...(format === "tzap" ? {
            tzapVolumeLossTolerance: storedTzapVolumeLossToleranceForSplit(value.volumeSize, value.tzapVolumeLossTolerance, fallback.tzapVolumeLossTolerance ?? 0),
            tzapSigningDefault: (() => {
              const mode = storedTzapSigningDefault(value.tzapSigningDefault, fallback.tzapSigningDefault ?? "accountDefault");
              const identityId = storedOptionalString(value.tzapDefaultSigningIdentityId, fallback.tzapDefaultSigningIdentityId ?? null);
              return mode === "identity" && !identityId ? "accountDefault" : mode;
            })(),
            tzapDefaultSigningIdentityId: storedOptionalString(value.tzapDefaultSigningIdentityId, fallback.tzapDefaultSigningIdentityId ?? null),
          } : {}),
          ...(format === "sevenZ" ? {
            sevenZSolid: storedObjectBool(value.sevenZSolid, fallback.sevenZSolid ?? true),
            sevenZThreads: storedPositiveNumber(value.sevenZThreads, fallback.sevenZThreads ?? null),
            sevenZChunkSize: storedPositiveNumber(value.sevenZChunkSize, fallback.sevenZChunkSize ?? null),
            sevenZEncryptFileNames: storedObjectBool(value.sevenZEncryptFileNames, fallback.sevenZEncryptFileNames ?? true),
          } : {}),
        },
      ];
    }),
  ) as CreateFormatDefaultsMap;
}


export function defaultCreateDirectory(preferences: AppPreferences): string | null {
  if (preferences.defaultOutputLocation !== "customFolder") {
    return null;
  }

  return preferences.customOutputFolderPath.trim() || null;
}
