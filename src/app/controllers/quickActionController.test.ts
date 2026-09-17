import { describe, expect, it, vi } from "vitest";

import type {
  BrowseState,
  CommandErrorDto,
  CreatePlanResponse,
  StartCreateRequest,
  StartExtractRequest,
  StartJobResponseDto,
} from "../../api/types";
import type { CreateArchiveFormat } from "../createFlow";
import type { MessageKey, MessageParams } from "../i18n/translator";
import {
  createDefaultsForFormat,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
} from "../preferences";
import type { QuickExtractEntry } from "../quickActions";
import { createCreateWorkspace, type CreateWorkspace } from "../workspaces/createWorkspace";
import { createQuickActionController, type QuickActionControllerOptions } from "./quickActionController";

const startedAt = "2026-06-11T00:00:00Z";

function startJobResponse(overrides: Partial<StartJobResponseDto> = {}): StartJobResponseDto {
  return {
    jobId: "job-1",
    kind: "zipCreate",
    status: "queued",
    createdAt: startedAt,
    ...overrides,
  };
}

function commandError(overrides: Partial<CommandErrorDto> = {}): CommandErrorDto {
  return {
    code: "failed",
    message: "Command failed",
    hint: null,
    severity: "error",
    retryable: false,
    ...overrides,
  };
}

function planForSources(workspace: CreateWorkspace): CreatePlanResponse {
  return {
    includedCount: workspace.getSnapshot().sources.length,
    excludedCount: 0,
    totalBytes: 10,
    excludedBytes: 0,
    entries: [],
    planEntries: workspace.getSnapshot().sources.map((source) => ({
      path: source.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? source,
      kind: "file",
      size: 10,
      sourcePath: source,
    })),
    excludedEntries: [],
    warnings: [],
  };
}

function createHarness(overrides: Partial<QuickActionControllerOptions> = {}) {
  const workspace = createCreateWorkspace();
  let preferences: AppPreferences = DEFAULT_APP_PREFERENCES;
  let browseState: BrowseState = "loaded";
  const calls = {
    messages: [] as Array<{ key: MessageKey; params?: MessageParams }>,
    statuses: [] as string[],
    openedArchives: [] as string[][],
    createDestinations: [] as string[],
    extractDestinations: [] as string[],
    jobs: [] as unknown[],
    shownCreateWorkspace: 0,
    cancelledPlans: 0,
    currentArchives: [] as string[],
    loadedArchives: [] as string[],
    browseErrors: [] as string[],
    archiveEntries: [] as QuickExtractEntry[],
    extractDialogs: [] as string[],
    promptedNewPasswords: 0,
    promptedRetryCodes: [] as string[],
    publishedSnapshots: 0,
  };
  const runStartCreate = vi.fn(async () => startJobResponse({ kind: "zipCreate" }));
  const runStartExtract = vi.fn(async () => startJobResponse({ kind: "zipExtract" }));

  const controller = createQuickActionController({
    preferences: () => preferences,
    pathHelpers: {
      nativeParentPath(path) {
        const normalized = path.replace(/\\/g, "/");
        const index = normalized.lastIndexOf("/");
        return index > 0 ? normalized.slice(0, index) : "";
      },
      joinNativePath(parentPath, childName) {
        return `${parentPath.replace(/[\\/]+$/, "")}/${childName}`;
      },
    },
    setOperationalMessage(key, params) {
      calls.messages.push({ key, params });
    },
    setOperationalStatus(message) {
      calls.statuses.push(message);
    },
    message(key, params) {
      return params && "archivePath" in params
        ? `${key}:${String(params.archivePath)}`
        : key;
    },
    async openArchive(paths) {
      calls.openedArchives.push(paths);
    },
    runStartCreate,
    runStartExtract,
    toCommandError(error) {
      return error && typeof error === "object" && "code" in error
        ? error as CommandErrorDto
        : null;
    },
    isPasswordCommandError(error) {
      return error?.code === "password_required" || error?.code === "invalid_password";
    },
    promptForNewArchivePassword() {
      calls.promptedNewPasswords += 1;
      return "new-secret";
    },
    promptForCommandRetry(commandCode) {
      calls.promptedRetryCodes.push(commandCode);
      return "retry-secret";
    },
    recordCreateDestination(destination) {
      calls.createDestinations.push(destination);
    },
    recordExtractDestination(destination) {
      calls.extractDestinations.push(destination);
    },
    async handoffAcceptedJob(response) {
      calls.jobs.push(response);
    },
    showCreateWorkspace() {
      calls.shownCreateWorkspace += 1;
    },
    readCreateSnapshot() {
      return workspace.getSnapshot();
    },
    addCreateSources(sources) {
      return workspace.addSources(sources).snapshot;
    },
    applyCreateDefaultsForFormat(format) {
      const defaults = createDefaultsForFormat(preferences, format);
      workspace.applyFormatDefaults(format, defaults);
    },
    setCreateOptions(patch) {
      return workspace.setOptions(patch).snapshot;
    },
    setCreateDestinationPath(path) {
      return workspace.setDestinationPath(path).snapshot;
    },
    publishCreateSnapshot(snapshot = workspace.getSnapshot()) {
      calls.publishedSnapshots += 1;
      return snapshot;
    },
    cancelQueuedPlanRun() {
      calls.cancelledPlans += 1;
    },
    async runPlan() {
      const planStart = workspace.beginPlan();
      if (planStart.ready) {
        workspace.acceptPlanResult(planStart.revision, planForSources(workspace));
      }
    },
    setCurrentArchivePath(archivePath) {
      calls.currentArchives.push(archivePath);
    },
    async loadArchive(request) {
      calls.loadedArchives.push(request.archivePath);
    },
    readBrowseState() {
      return browseState;
    },
    readArchiveEntries() {
      return calls.archiveEntries;
    },
    setBrowseError(message) {
      calls.browseErrors.push(message);
    },
    openExtractDialog(mode) {
      calls.extractDialogs.push(mode);
    },
    ...overrides,
  });

  return {
    calls,
    controller,
    runStartCreate,
    runStartExtract,
    setBrowseState(next: BrowseState) {
      browseState = next;
    },
    setPreferences(next: AppPreferences) {
      preferences = next;
    },
    setArchiveEntries(next: QuickExtractEntry[]) {
      calls.archiveEntries = next;
    },
    workspace,
  };
}

describe("quick action controller", () => {
  it("starts quick create with unique sources, password defaults, and focused close-window job", async () => {
    const harness = createHarness();
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      defaultArchiveFormat: "zip",
      createFormatDefaults: {
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
        zip: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults.zip,
          promptForPassword: true,
          compressionLevel: 5,
        },
      },
    });

    await harness.controller.startQuickCreate(
      ["C:/work/report.txt", " C:/work/report.txt ", "C:/work/images"],
      "zip",
      false,
    );

    expect(harness.runStartCreate).toHaveBeenCalledWith({
      sources: ["C:/work/report.txt", "C:/work/images"],
      destinationPath: "C:/work/report.txt.zip",
      format: "zip",
      cleanSource: false,
      replaceExisting: false,
      destinationCollisionStrategy: "rename",
      preserveMetadata: true,
      password: "new-secret",
      compressionLevel: 5,
      respectGitignore: true,
      followSymlinks: false,
      zipCompression: "deflate",
    } satisfies StartCreateRequest);
    expect(harness.calls.createDestinations).toEqual(["C:/work/report.txt.zip"]);
    expect(harness.calls.jobs).toHaveLength(1);
    expect(harness.calls.jobs[0]).toEqual(startJobResponse({ kind: "zipCreate" }));
    expect(harness.calls.messages.at(-1)).toEqual({ key: "quickCreate.started", params: undefined });
  });

  it.each([
    { format: "zip", kind: "compressZip" },
    { format: "tarZst", kind: "compressTarZst" },
    { format: "tarGz", kind: "compressTarGz" },
    { format: "tzap", kind: "compressTzap" },
    { format: "sevenZ", kind: "compressSevenZ" },
    { format: "appleArchive", kind: "compressAppleArchive" },
  ] as const)("applies all persisted $format flags to its fixed-format quick action", async ({ format, kind }) => {
    const harness = createHarness();
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      createFormatDefaults: {
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
        [format]: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults[format],
          cleanSource: false,
          respectGitignore: true,
          followSymlinks: true,
          replaceExisting: true,
          preserveMetadata: false,
        },
      },
    });

    await harness.controller.handleQuickActionRequest({
      kind,
      paths: ["C:/work/source"],
    });

    expect(harness.runStartCreate).toHaveBeenCalledWith(expect.objectContaining({
      format,
      cleanSource: false,
      respectGitignore: true,
      followSymlinks: true,
      replaceExisting: true,
      preserveMetadata: false,
    } satisfies Partial<StartCreateRequest>));
  });

  it("cancels quick create when a password prompt is dismissed", async () => {
    const harness = createHarness({
      promptForNewArchivePassword: () => null,
    });
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      createFormatDefaults: {
        ...DEFAULT_APP_PREFERENCES.createFormatDefaults,
        zip: {
          ...DEFAULT_APP_PREFERENCES.createFormatDefaults.zip,
          promptForPassword: true,
        },
      },
    });

    await harness.controller.startQuickCreate(["C:/work/report.txt"], "zip", false);

    expect(harness.runStartCreate).not.toHaveBeenCalled();
    expect(harness.calls.messages.at(-1)).toEqual({ key: "quickCreate.cancelled", params: undefined });
  });

  it("sets up create review, cancels queued planning, runs a plan, and reports review readiness", async () => {
    const harness = createHarness();

    await harness.controller.openQuickCreateReview(
      ["C:/work/report.txt", "C:/work/report.txt"],
      "tarZst",
      true,
    );

    expect(harness.calls.shownCreateWorkspace).toBe(1);
    expect(harness.workspace.getSnapshot().sources).toEqual(["C:/work/report.txt"]);
    expect(harness.workspace.getSnapshot().options).toMatchObject({
      format: "tarZst" satisfies CreateArchiveFormat,
      cleanSource: true,
      destinationPath: "C:/work/report.txt.tzst",
    });
    expect(harness.calls.cancelledPlans).toBe(1);
    expect(harness.calls.publishedSnapshots).toBeGreaterThanOrEqual(4);
    expect(harness.calls.messages.map((call) => call.key)).toContain("quickCreate.planning");
    expect(harness.calls.messages.at(-1)).toEqual({ key: "quickCreate.review", params: undefined });
  });

  it("adds later shell sources to the active create draft without replacing its options", async () => {
    const harness = createHarness();
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      defaultArchiveFormat: "zip",
    });

    await harness.controller.handleQuickActionRequest({
      kind: "compress",
      paths: ["C:/work/folder1"],
    });
    harness.workspace.setOptions({
      destinationPath: "C:/work/combined.zip",
      compressionLevel: 1,
    });

    await harness.controller.handleQuickActionRequest({
      kind: "compress",
      paths: ["C:/work/folder2"],
    });

    expect(harness.workspace.getSnapshot().sources).toEqual([
      "C:/work/folder1",
      "C:/work/folder2",
    ]);
    expect(harness.workspace.getSnapshot().options).toMatchObject({
      destinationPath: "C:/work/combined.zip",
      compressionLevel: 1,
    });
  });

  it("opens extract review for one supported archive after loading it", async () => {
    const harness = createHarness();

    await harness.controller.openQuickExtractReview(["C:/archives/demo.zip"]);

    expect(harness.calls.currentArchives).toEqual(["C:/archives/demo.zip"]);
    expect(harness.calls.loadedArchives).toEqual(["C:/archives/demo.zip"]);
    expect(harness.calls.messages.at(-1)).toEqual({ key: "quickExtract.chooseOptions", params: undefined });
    expect(harness.calls.extractDialogs).toEqual(["archive"]);
  });

  it("guards extract review when the request has multiple archives or unsupported paths", async () => {
    const manyHarness = createHarness();
    await manyHarness.controller.openQuickExtractReview(["C:/a.zip", "C:/b.zip"]);
    expect(manyHarness.calls.messages).toEqual([{ key: "quickExtract.oneArchiveAtATime", params: undefined }]);
    expect(manyHarness.calls.loadedArchives).toEqual([]);

    const unsupportedHarness = createHarness();
    await unsupportedHarness.controller.openQuickExtractReview(["C:/archives/demo.txt"]);
    expect(unsupportedHarness.calls.messages).toEqual([{
      key: "archive.unsupported",
      params: { archivePath: "C:/archives/demo.txt" },
    }]);
    expect(unsupportedHarness.calls.loadedArchives).toEqual([]);
  });

  it("starts quick extract with password retry and focused close-window job metadata", async () => {
    const harness = createHarness();
    harness.runStartExtract
      .mockRejectedValueOnce(commandError({ code: "password_required", message: "Password required" }))
      .mockResolvedValueOnce(startJobResponse({ kind: "zipExtract" }));

    await harness.controller.startQuickExtract(["C:/archives/demo.zip"], "extractToFolder");

    expect(harness.runStartExtract).toHaveBeenNthCalledWith(1, {
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/archives/demo",
      overwrite: "rename",
      destinationCollisionStrategy: "rename",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    } satisfies StartExtractRequest);
    expect(harness.runStartExtract).toHaveBeenNthCalledWith(2, {
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/archives/demo",
      overwrite: "rename",
      destinationCollisionStrategy: "rename",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      password: "retry-secret",
    } satisfies StartExtractRequest);
    expect(harness.calls.promptedRetryCodes).toEqual(["password_required"]);
    expect(harness.calls.extractDestinations).toEqual(["C:/archives/demo"]);
    expect(harness.calls.jobs[0]).toEqual(startJobResponse({ kind: "zipExtract" }));
  });

  it("starts quick extract for extractHere without destination collision renaming on parent directory", async () => {
    const harness = createHarness();
    harness.runStartExtract.mockResolvedValueOnce(startJobResponse({ kind: "zipExtract" }));

    await harness.controller.startQuickExtract(["C:/archives/demo.zip"], "extractHere");

    expect(harness.runStartExtract).toHaveBeenCalledWith({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/archives",
      overwrite: "rename",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    } satisfies StartExtractRequest);
    expect(harness.calls.extractDestinations).toEqual(["C:/archives"]);
  });

  it("preserves the archive wrapper for direct quick extract here", async () => {
    const harness = createHarness();
    harness.setArchiveEntries([
      { path: "demo", kind: "directory" },
      { path: "demo/readme.txt", kind: "file" },
    ]);

    await harness.controller.startQuickExtract(["C:/archives/demo.zip"], "extractHere");

    expect(harness.calls.loadedArchives).toEqual(["C:/archives/demo.zip"]);
    expect(harness.runStartExtract).toHaveBeenCalledWith({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/archives",
      overwrite: "rename",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    } satisfies StartExtractRequest);
  });

  it("uses replace for quick extract only when defaultExtractOverwrite is set to replace", async () => {
    const harness = createHarness();
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      defaultExtractOverwrite: "replace",
    });
    harness.runStartExtract.mockResolvedValueOnce(startJobResponse({ kind: "zipExtract" }));

    await harness.controller.startQuickExtract(["C:/archives/demo.zip"], "extractToFolder");

    expect(harness.runStartExtract).toHaveBeenCalledWith({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/archives/demo",
      overwrite: "replace",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    } satisfies StartExtractRequest);
  });

  it("falls back to rename for quick extract when defaultExtractOverwrite is refuse or ask", async () => {
    const harness = createHarness();
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      defaultExtractOverwrite: "refuse",
    });
    harness.runStartExtract.mockResolvedValueOnce(startJobResponse({ kind: "zipExtract" }));

    await harness.controller.startQuickExtract(["C:/archives/demo.zip"], "extractToFolder");

    expect(harness.runStartExtract).toHaveBeenCalledWith({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/archives/demo",
      overwrite: "rename",
      destinationCollisionStrategy: "rename",
      stripComponents: 0,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    } satisfies StartExtractRequest);
  });

  it("continues past unsupported quick extract paths and reports command hints", async () => {
    const harness = createHarness();
    harness.runStartExtract.mockRejectedValueOnce(commandError({
      message: "Could not extract",
      hint: "Try another destination.",
    }));

    await harness.controller.startQuickExtract(
      ["C:/archives/readme.txt", "C:/archives/demo.zip"],
      "extractHere",
    );

    expect(harness.calls.messages).toEqual([{
      key: "archive.unsupported",
      params: { archivePath: "C:/archives/readme.txt" },
    }]);
    expect(harness.calls.statuses).toEqual(["Could not extract"]);
    expect(harness.calls.browseErrors).toEqual(["Could not extract\nTry another destination."]);
  });

  it("dispatches quick-action requests through the controller methods", async () => {
    const harness = createHarness();
    harness.setPreferences({
      ...DEFAULT_APP_PREFERENCES,
      defaultExtractionBehavior: "askEveryTime",
    });

    await harness.controller.handleQuickActionRequest({
      kind: "extract",
      paths: ["C:/archives/demo.zip"],
    });

    expect(harness.calls.loadedArchives).toEqual(["C:/archives/demo.zip"]);
    expect(harness.runStartExtract).not.toHaveBeenCalled();
    expect(harness.calls.extractDialogs).toEqual(["archive"]);
  });
});
