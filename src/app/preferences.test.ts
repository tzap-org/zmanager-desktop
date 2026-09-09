import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_PREFERENCES,
  defaultCreateDirectory,
  loadAppPreferences,
  preferencesWithPatch,
  createDefaultsForFormat,
  resolveTzapSigningIdentityId,
  saveAppPreferences,
  type AppPreferences,
} from "./preferences";
import { PREFERENCE_KEYS, type PreferenceStorage } from "./preferenceStorage";
import { resolveTzapEnvironment } from "./tzapEnvironment";

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("preferences helpers", () => {
  it("keeps a fixed build environment authoritative over stored values", () => {
    expect(resolveTzapEnvironment("staging", "prod")).toBe("prod");
    expect(resolveTzapEnvironment("prod", "staging")).toBe("staging");
    expect(resolveTzapEnvironment("unexpected", null)).toBe("prod");
  });

  it("returns macOS-aligned safe defaults when storage is unavailable", () => {
    expect(loadAppPreferences(null)).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("uses safe archive creation defaults for every supported format", () => {
    expect(DEFAULT_APP_PREFERENCES.defaultCleanSourceEnabled).toBe(false);

    for (const defaults of Object.values(DEFAULT_APP_PREFERENCES.createFormatDefaults)) {
      expect(defaults.cleanSource).toBe(false);
      expect(defaults.respectGitignore).toBe(true);
      expect(defaults.preserveMetadata).toBe(true);
    }
  });

  it("loads valid stored preferences", () => {
    const storage = memoryStorage({
      "zmanager.locale": "en",
      "zmanager.defaultArchiveFormat": "zip",
      "zmanager.defaultCleanSourceEnabled": "false",
      "zmanager.createFormatDefaults": JSON.stringify({
        zip: {
          cleanSource: false,
          respectGitignore: false,
          followSymlinks: false,
          compressionLevel: 9,
          volumeSize: 1048576,
          tzapRecoveryPercentage: null,
          preserveMetadata: false,
          replaceExisting: true,
          promptForPassword: true,
          zipCompression: "deflate",
        },
      }),
      "zmanager.defaultOutputLocation": "customFolder",
      "zmanager.customOutputFolderPath": " C:/Archives ",
      "zmanager.defaultExtractionBehavior": "extractToFolder",
      "zmanager.defaultExtractPathMode": "current",
      "zmanager.defaultExtractOverwrite": "rename",
      "zmanager.defaultExtractStripComponents": "2",
      "zmanager.defaultExtractDeduplicateRoot": "true",
      "zmanager.defaultTzapRestorePolicy": "sameOs",
      "zmanager.defaultTzapAllowDegraded": "true",
      "zmanager.defaultTzapAllowAbsoluteSymlinks": "true",
      "zmanager.previewCleanupPolicy": "whenAppCloses",
      "zmanager.showParentFolderItem": "false",
      "zmanager.showRealFileIcons": "false",
      "zmanager.showGridLines": "false",
      "zmanager.fullRowSelect": "false",
      "zmanager.singleClickOpen": "true",
      "zmanager.alternativeSelectionMode": "true",
      "zmanager.toolbarVisible": "false",
      "zmanager.largeToolbarButtons": "true",
      "zmanager.showToolbarLabels": "false",
      "zmanager.flatViewDefault": "true",
      "zmanager.tableSortKey": "size",
      "zmanager.tableSortAscending": "false",
    });

    expect(loadAppPreferences(storage)).toEqual({
      locale: "en",
      defaultArchiveFormat: "zip",
      defaultCleanSourceEnabled: false,
      createFormatDefaults: {
        zip: {
          cleanSource: false,
          respectGitignore: false,
          followSymlinks: false,
          compressionLevel: 9,
          volumeSize: 1048576,
          tzapRecoveryPercentage: null,
          preserveMetadata: false,
          replaceExisting: true,
          promptForPassword: true,
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
          tzapRecoveryPercentage: 5,
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
          sevenZChunkSize: null,
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
      volumeSizePresets: DEFAULT_APP_PREFERENCES.volumeSizePresets,
      defaultOutputLocation: "customFolder",
      customOutputFolderPath: "C:/Archives",
      customExtractFolderPath: "",
      defaultExtractionBehavior: "extractToFolder",
      defaultExtractPathMode: "current",
      defaultExtractOverwrite: "rename",
      defaultExtractStripComponents: 2,
      defaultExtractDeduplicateRoot: true,
      defaultTzapRestorePolicy: "sameOs",
      defaultTzapAllowDegraded: true,
      defaultTzapAllowAbsoluteSymlinks: true,
      defaultExtractIgnoreSymlinks: false,
      previewCleanupPolicy: "whenAppCloses",
      showParentFolderItem: false,
      showRealFileIcons: false,
      showGridLines: false,
      fullRowSelect: false,
      singleClickOpen: true,
      alternativeSelectionMode: true,
      showToolbarLabels: false,
      flatViewDefault: true,
      tableSortKey: "size",
      tableSortAscending: false,
      tzapEnvironment: "prod",
      lanShareAlias: DEFAULT_APP_PREFERENCES.lanShareAlias,
      lanShareEnableReceiving: DEFAULT_APP_PREFERENCES.lanShareEnableReceiving,
      lanShareReceiveFolderPath: DEFAULT_APP_PREFERENCES.lanShareReceiveFolderPath,
      lanShareAutoExtract: DEFAULT_APP_PREFERENCES.lanShareAutoExtract,
    });
  });

  it("falls back when stored values are invalid", () => {
    const storage = memoryStorage({
      "zmanager.locale": "ja-JP",
      "zmanager.defaultArchiveFormat": "rar",
      "zmanager.defaultCleanSourceEnabled": "yes",
      "zmanager.defaultOutputLocation": "downloads",
      "zmanager.defaultExtractionBehavior": "alwaysOverwrite",
      "zmanager.previewCleanupPolicy": "never",
    });

    expect(loadAppPreferences(storage)).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it("loads the supported Simplified Chinese locale preference", () => {
    const storage = memoryStorage({
      "zmanager.locale": "zh-CN",
    });

    expect(loadAppPreferences(storage).locale).toBe("zh-CN");
  });

  it("saves non-sensitive preference fields and removes blank custom output", () => {
    const storage = memoryStorage({
      "zmanager.customOutputFolderPath": "C:/Old",
    });

    saveAppPreferences(
      {
        ...DEFAULT_APP_PREFERENCES,
        defaultArchiveFormat: "sevenZ",
        defaultCleanSourceEnabled: false,
        createFormatDefaults: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
          sevenZ: {
            cleanSource: false,
            compressionLevel: 22,
            volumeSize: 4096,
            tzapRecoveryPercentage: null,
            preserveMetadata: true,
            replaceExisting: true,
            promptForPassword: true,
          },
        },
        defaultOutputLocation: "sourceFolder",
        customOutputFolderPath: "   ",
        defaultExtractionBehavior: "extractHere",
        previewCleanupPolicy: "whenAppCloses",
        showParentFolderItem: false,
        showRealFileIcons: true,
        showGridLines: false,
        fullRowSelect: true,
        singleClickOpen: false,
        alternativeSelectionMode: false,
        showToolbarLabels: false,
        flatViewDefault: true,
        tableSortKey: "size",
        tableSortAscending: false,
        tzapEnvironment: "prod",
        locale: "en",
      },
      storage,
    );

    expect(Object.fromEntries(storage.values)).toEqual({
      "zmanager.locale": "en",
      "zmanager.defaultArchiveFormat": "sevenZ",
      "zmanager.defaultCleanSourceEnabled": "false",
      "zmanager.createFormatDefaults": JSON.stringify({
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
        sevenZ: {
          cleanSource: false,
          compressionLevel: 22,
          volumeSize: 4096,
          tzapRecoveryPercentage: null,
          preserveMetadata: true,
          replaceExisting: true,
          promptForPassword: true,
        },
      }),
      "zmanager.volumeSizePresets": JSON.stringify(DEFAULT_APP_PREFERENCES.volumeSizePresets),
      "zmanager.defaultOutputLocation": "sourceFolder",
      "zmanager.defaultExtractionBehavior": "extractHere",
      "zmanager.defaultExtractPathMode": "full",
      "zmanager.defaultExtractOverwrite": "ask",
      "zmanager.defaultExtractStripComponents": "0",
      "zmanager.defaultExtractDeduplicateRoot": "false",
      "zmanager.defaultTzapRestorePolicy": "portable",
      "zmanager.defaultTzapAllowDegraded": "false",
      "zmanager.defaultTzapAllowAbsoluteSymlinks": "false",
      "zmanager.defaultExtractIgnoreSymlinks": "false",
      "zmanager.previewCleanupPolicy": "whenAppCloses",
      "zmanager.showParentFolderItem": "false",
      "zmanager.showRealFileIcons": "true",
      "zmanager.showGridLines": "false",
      "zmanager.fullRowSelect": "true",
      "zmanager.singleClickOpen": "false",
      "zmanager.alternativeSelectionMode": "false",
      "zmanager.showToolbarLabels": "false",
      "zmanager.flatViewDefault": "true",
      "zmanager.tableSortKey": "size",
      "zmanager.tableSortAscending": "false",
      "zmanager.tzapEnvironment": "prod",
      "zmanager.lanShareAlias": "",
      "zmanager.lanShareEnableReceiving": "true",
      "zmanager.lanShareAutoExtract": "true",
    });
  });

  it("normalizes patches and resolves default create directories", () => {
    const preferences = preferencesWithPatch(DEFAULT_APP_PREFERENCES, {
      defaultOutputLocation: "customFolder",
      customOutputFolderPath: " /tmp/archives ",
      createFormatDefaults: {
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
        zip: {
          cleanSource: false,
          compressionLevel: 9,
          volumeSize: 1024,
          tzapRecoveryPercentage: null,
          preserveMetadata: true,
          replaceExisting: false,
          promptForPassword: true,
        },
      },
    });

    expect(preferences.customOutputFolderPath).toBe("/tmp/archives");
    expect(createDefaultsForFormat(preferences, "zip")).toEqual({
      cleanSource: false,
      respectGitignore: false,
      followSymlinks: false,
      compressionLevel: 9,
      volumeSize: 1024,
      tzapRecoveryPercentage: null,
      preserveMetadata: true,
      replaceExisting: false,
      promptForPassword: true,
      zipCompression: "deflate",
    });
    expect(defaultCreateDirectory(preferences)).toBe("/tmp/archives");
    expect(defaultCreateDirectory(DEFAULT_APP_PREFERENCES)).toBeNull();
  });

  it("normalizes patches from dialog saves", () => {
    const dialogPreferences: AppPreferences = {
      ...DEFAULT_APP_PREFERENCES,
      customOutputFolderPath: " /tmp/dialog-output ",
    };

    const preferences = preferencesWithPatch(DEFAULT_APP_PREFERENCES, dialogPreferences);

    expect(preferences.customOutputFolderPath).toBe("/tmp/dialog-output");
  });

  it("treats zero volume defaults as no split", () => {
    const preferences = preferencesWithPatch(DEFAULT_APP_PREFERENCES, {
      createFormatDefaults: {
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
        tzap: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults.tzap,
          volumeSize: 0,
          tzapRecoveryPercentage: 250,
          tzapVolumeLossTolerance: 99,
        },
      },
    });

    expect(createDefaultsForFormat(preferences, "tzap").volumeSize).toBeNull();
    expect(createDefaultsForFormat(preferences, "tzap").tzapRecoveryPercentage).toBe(100);
    expect(createDefaultsForFormat(preferences, "tzap").tzapVolumeLossTolerance).toBe(0);
  });

  it("resolves the TZAP signing default only to an active identity", () => {
    const defaults = {
      ...DEFAULT_APP_PREFERENCES.createFormatDefaults.tzap,
      tzapSigningDefault: "identity" as const,
      tzapDefaultSigningIdentityId: "identity-2",
    };

    expect(resolveTzapSigningIdentityId(defaults, "identity-1", ["identity-2"])).toBe("identity-2");
    expect(resolveTzapSigningIdentityId({ ...defaults, tzapSigningDefault: "accountDefault" }, "identity-1", ["identity-1"])).toBe("identity-1");
    expect(resolveTzapSigningIdentityId({ ...defaults, tzapSigningDefault: "none" }, "identity-1", ["identity-1", "identity-2"])).toBe("");
    expect(resolveTzapSigningIdentityId(defaults, "identity-1", ["identity-1"])).toBe("");
  });

  it("loads the explicit TZAP no-signing default", () => {
    const storage = memoryStorage({
      [PREFERENCE_KEYS.createFormatDefaults]: JSON.stringify({
        tzap: {
          tzapSigningDefault: "none",
        },
      }),
    });

    expect(createDefaultsForFormat(loadAppPreferences(storage), "tzap")).toMatchObject({
      tzapSigningDefault: "none",
      tzapDefaultSigningIdentityId: null,
    });
  });

  it("does not persist legacy TZAP signing paths", () => {
    const storage = memoryStorage({
      [PREFERENCE_KEYS.createFormatDefaults]: JSON.stringify({
        tzap: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults.tzap,
          tzapSigningMode: "advanced",
          tzapSigningIdentityPath: "/private/identity.p12",
          tzapSigningCertificatePath: "/private/certificate.pem",
          tzapSigningPrivateKeyPath: "/private/key.pem",
          tzapSigningChainPaths: "/private/chain.pem",
        },
      }),
    });

    const loaded = loadAppPreferences(storage);
    expect(loaded.createFormatDefaults.tzap).not.toHaveProperty("tzapSigningIdentityPath");
    expect(loaded.createFormatDefaults.tzap).not.toHaveProperty("tzapSigningPrivateKeyPath");

    saveAppPreferences(loaded, storage);
    const persisted = JSON.parse(storage.values.get(PREFERENCE_KEYS.createFormatDefaults) ?? "{}");
    expect(persisted.tzap).not.toHaveProperty("tzapSigningIdentityPath");
    expect(persisted.tzap).not.toHaveProperty("tzapSigningCertificatePath");
  });

  it("declares locale storage through the tracked preference key map", () => {
    expect(PREFERENCE_KEYS.locale).toBe("zmanager.locale");
  });

  it("round-trips LAN Sharing preferences and trims the receive folder path", () => {
    const storage = memoryStorage();

    saveAppPreferences(
      {
        ...DEFAULT_APP_PREFERENCES,
        lanShareAlias: "Frank's Desktop",
        lanShareEnableReceiving: false,
        lanShareReceiveFolderPath: "  /tmp/lan-received  ",
        lanShareAutoExtract: false,
      },
      storage,
    );

    expect(storage.values.get(PREFERENCE_KEYS.lanShareAlias)).toBe("Frank's Desktop");
    expect(storage.values.get(PREFERENCE_KEYS.lanShareEnableReceiving)).toBe("false");
    expect(storage.values.get(PREFERENCE_KEYS.lanShareReceiveFolderPath)).toBe("/tmp/lan-received");
    expect(storage.values.get(PREFERENCE_KEYS.lanShareAutoExtract)).toBe("false");

    const loaded = loadAppPreferences(storage);
    expect(loaded.lanShareAlias).toBe("Frank's Desktop");
    expect(loaded.lanShareEnableReceiving).toBe(false);
    expect(loaded.lanShareReceiveFolderPath).toBe("/tmp/lan-received");
    expect(loaded.lanShareAutoExtract).toBe(false);
  });

  it("removes the LAN Sharing receive folder key when blank, like the other custom folder paths", () => {
    const storage = memoryStorage({ [PREFERENCE_KEYS.lanShareReceiveFolderPath]: "/tmp/old-receive-folder" });

    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, lanShareReceiveFolderPath: "   " }, storage);

    expect(storage.values.has(PREFERENCE_KEYS.lanShareReceiveFolderPath)).toBe(false);
    expect(loadAppPreferences(storage).lanShareReceiveFolderPath).toBe("");
  });

  it("trims the LAN Sharing receive folder path when patched", () => {
    const preferences = preferencesWithPatch(DEFAULT_APP_PREFERENCES, {
      lanShareReceiveFolderPath: "  /tmp/patched-lan-folder  ",
    });

    expect(preferences.lanShareReceiveFolderPath).toBe("/tmp/patched-lan-folder");
  });
});
