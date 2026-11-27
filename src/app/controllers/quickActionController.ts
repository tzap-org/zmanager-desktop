import type {
  BrowseState,
  CommandErrorDto,
  ListArchiveRequest,
  QuickActionRequestDto,
  StartCreateRequest,
  StartExtractRequest,
  StartJobResponseDto,
} from "../../api/types";
import { isSupportedArchivePath } from "../archiveFileTypes";
import { resolveDestinationCollisionStrategy } from "../collisionPolicy";
import { NOOP_DIAGNOSTIC_RECORDER, type DiagnosticRecorder } from "../diagnostics";
import { createFormatSupportsPassword, type CreateArchiveFormat } from "../createFlow";
import { buildStartExtractRequest, resolveExtractStartInput } from "../extractFlow";
import { extractDefaultsForArchive } from "../extractionPolicy";
import { extractStartInputFromOptions } from "../workspaces/extractWorkspace";
import type { MessageKey, MessageParams } from "../i18n/translator";
import {
  createDefaultsForFormat,
  type AppPreferences,
} from "../preferences";
import {
  quickCreateDestination,
  runQuickActionRequest,
  uniqueQuickActionPaths,
  type QuickActionExtractMode,
  type QuickActionPathHelpers,
} from "../quickActions";
import {
  buildQuickCreateStartRequest,
  type CreateWorkspaceOptionPatch,
  type CreateWorkspaceSnapshot,
} from "../workspaces/createWorkspace";

export type QuickActionControllerOptions = Readonly<{
  preferences(): AppPreferences;
  pathHelpers: QuickActionPathHelpers;
  setOperationalMessage(key: MessageKey, params?: MessageParams): void;
  setOperationalStatus(message: string): void;
  message(key: MessageKey, params?: MessageParams): string;
  openArchive(paths: string[]): Promise<void>;
  runStartCreate(request: StartCreateRequest): Promise<StartJobResponseDto>;
  runStartExtract(request: StartExtractRequest): Promise<StartJobResponseDto>;
  toCommandError(error: unknown): CommandErrorDto | null;
  isPasswordCommandError(error: CommandErrorDto | null): boolean;
  promptForNewArchivePassword(): string | null;
  promptForCommandRetry(commandCode: string): string | null;
  recordCreateDestination(destination: string): void;
  recordExtractDestination(destination: string): void;
  handoffAcceptedJob(response: StartJobResponseDto): Promise<void>;
  showCreateWorkspace(): void;
  readCreateSnapshot(): CreateWorkspaceSnapshot;
  addCreateSources(sources: readonly string[]): CreateWorkspaceSnapshot;
  applyCreateDefaultsForFormat(format: CreateArchiveFormat): void;
  setCreateOptions(patch: CreateWorkspaceOptionPatch): CreateWorkspaceSnapshot;
  setCreateDestinationPath(path: string): CreateWorkspaceSnapshot;
  publishCreateSnapshot(snapshot?: CreateWorkspaceSnapshot): CreateWorkspaceSnapshot;
  cancelQueuedPlanRun(): void;
  runPlan(): Promise<void>;
  setCurrentArchivePath(archivePath: string): void;
  loadArchive(request: ListArchiveRequest): Promise<void>;
  readBrowseState(): BrowseState;
  setBrowseError(message: string): void;
  openExtractDialog(mode: "archive"): void;
  diagnostics?: DiagnosticRecorder;
}>;

export type QuickActionController = Readonly<{
  handleQuickActionRequest(request: QuickActionRequestDto): Promise<void>;
  startQuickCreate(paths: string[], format: CreateArchiveFormat, cleanSource: boolean): Promise<void>;
  openQuickCreateReview(paths: string[], format: CreateArchiveFormat, cleanSource: boolean): Promise<void>;
  openQuickExtractReview(paths: string[]): Promise<void>;
  startQuickExtract(paths: string[], action: QuickActionExtractMode): Promise<void>;
}>;

export function createQuickActionController(
  options: QuickActionControllerOptions,
): QuickActionController {
  const diagnostics = options.diagnostics ?? NOOP_DIAGNOSTIC_RECORDER;

  async function startQuickCreate(
    paths: string[],
    format: CreateArchiveFormat,
    cleanSource: boolean,
  ): Promise<void> {
    const sources = uniqueQuickActionPaths(paths);
    if (!sources.length) {
      options.setOperationalMessage("quickCreate.needsSource");
      return;
    }

    const preferences = options.preferences();
    const destinationPath = quickCreateDestination(
      sources,
      format,
      preferences,
      options.pathHelpers,
    );

    if (!destinationPath) {
      options.setOperationalMessage("quickCreate.needsDestination");
      return;
    }

    options.setOperationalMessage("quickCreate.starting");
    try {
      const defaults = createDefaultsForFormat(preferences, format);
      let password: string | undefined;
      if (defaults.promptForPassword && createFormatSupportsPassword(format)) {
        const promptedPassword = options.promptForNewArchivePassword();
        if (!promptedPassword) {
          options.setOperationalMessage("quickCreate.cancelled");
          return;
        }
        password = promptedPassword;
      }

      const requestResult = buildQuickCreateStartRequest({
        sources,
        destinationPath,
        format,
        cleanSource,
        replaceExisting: defaults.replaceExisting,
        destinationCollisionStrategy: resolveDestinationCollisionStrategy({
          isQuickAction: true,
          replaceExisting: defaults.replaceExisting,
        }),
        preserveMetadata: defaults.preserveMetadata,
        password,
        compressionLevel: defaults.compressionLevel ?? undefined,
        volumeSize: defaults.volumeSize ?? undefined,
        respectGitignore: defaults.respectGitignore,
        followSymlinks: defaults.followSymlinks,
        tzapRecoveryPercentage: defaults.tzapRecoveryPercentage,
        tzapVolumeLossTolerance: defaults.tzapVolumeLossTolerance,
        zipCompression: defaults.zipCompression,
        sevenZSolid: defaults.sevenZSolid,
        sevenZThreads: defaults.sevenZThreads,
        sevenZChunkSize: defaults.sevenZChunkSize,
        sevenZEncryptFileNames: defaults.sevenZEncryptFileNames,
      });
      if (!requestResult.ok) {
        options.setOperationalMessage(
          requestResult.reason === "needsSources"
            ? "quickCreate.needsSource"
            : "quickCreate.needsDestination",
        );
        return;
      }

      const request = requestResult.request;
      const response = await options.runStartCreate(request);
      diagnostics.record({
        scope: "quickAction",
        name: "createJobStarted",
        fields: { format, cleanSource, pathCount: sources.length, jobKind: response.kind },
      });
      options.recordCreateDestination(request.destinationPath);
      await options.handoffAcceptedJob(response);
      options.setOperationalMessage("quickCreate.started");
    } catch (error) {
      const commandError = options.toCommandError(error);
      diagnostics.record({
        scope: "quickAction",
        name: "createStartFailed",
        fields: { format, errorCode: commandError?.code ?? "unknown" },
      });
      options.setOperationalStatus(
        commandError?.message ?? options.message("quickCreate.unableStart"),
      );
    }
  }

  async function openQuickCreateReview(
    paths: string[],
    format: CreateArchiveFormat,
    cleanSource: boolean,
  ): Promise<void> {
    const sources = uniqueQuickActionPaths(paths);
    if (!sources.length) {
      options.setOperationalMessage("quickCreate.needsSource");
      return;
    }

    const previousSnapshot = options.readCreateSnapshot();
    options.showCreateWorkspace();
    const sourceSnapshot = options.publishCreateSnapshot(options.addCreateSources(sources));
    if (!previousSnapshot.hasSources) {
      options.applyCreateDefaultsForFormat(format);
      options.publishCreateSnapshot();
      options.publishCreateSnapshot(options.setCreateOptions({ cleanSource }));
      options.publishCreateSnapshot(options.setCreateDestinationPath(quickCreateDestination(
        [...sourceSnapshot.sources],
        format,
        options.preferences(),
        options.pathHelpers,
      )));
    }
    options.cancelQueuedPlanRun();

    options.setOperationalMessage("quickCreate.planning");
    await options.runPlan();
    const reviewSnapshot = options.publishCreateSnapshot();
    if (reviewSnapshot.plan.state === "ready" && reviewSnapshot.plan.current !== null) {
      options.setOperationalMessage("quickCreate.review");
    } else {
      options.setOperationalMessage("quickCreate.needsReview");
    }
  }

  async function openQuickExtractReview(paths: string[]): Promise<void> {
    const archives = uniqueQuickActionPaths(paths);
    if (archives.length !== 1) {
      options.setOperationalMessage("quickExtract.oneArchiveAtATime");
      return;
    }

    const archivePath = archives[0];
    if (!archivePath || !isSupportedArchivePath(archivePath)) {
      options.setOperationalMessage("archive.unsupported", { archivePath });
      return;
    }

    options.setCurrentArchivePath(archivePath);
    await options.loadArchive({ archivePath });
    const browseState = options.readBrowseState();
    if (browseState !== "loaded" && browseState !== "empty") {
      return;
    }

    options.setOperationalMessage("quickExtract.chooseOptions");
    options.openExtractDialog("archive");
  }

  async function startQuickExtract(
    paths: string[],
    action: QuickActionExtractMode,
  ): Promise<void> {
    const archives = uniqueQuickActionPaths(paths);
    if (!archives.length) {
      options.setOperationalMessage("quickExtract.needsArchive");
      return;
    }

    for (const archivePath of archives) {
      if (!isSupportedArchivePath(archivePath)) {
        options.setOperationalMessage("archive.unsupported", { archivePath });
        continue;
      }

      const defaults = extractDefaultsForArchive(archivePath, options.preferences(), options.pathHelpers, action);
      let password: string | undefined;
      while (true) {
        try {
          const resolved = resolveExtractStartInput(extractStartInputFromOptions(defaults, password), {
            currentFolder: "",
            entryReferences: [],
            joinNativePath: options.pathHelpers.joinNativePath,
          });
          if (!resolved.destination) {
            options.setOperationalMessage("quickExtract.chooseDestination", { archivePath });
            break;
          }
          const request = buildStartExtractRequest({
            ...resolved,
            archivePath,
            destinationPath: resolved.destination,
          });
          const response = await options.runStartExtract(request);
          diagnostics.record({
            scope: "quickAction",
            name: "extractJobStarted",
            fields: { action, jobKind: response.kind },
          });
          options.recordExtractDestination(request.destinationPath);
          await options.handoffAcceptedJob(response);
          break;
        } catch (error) {
          const commandError = options.toCommandError(error);
          if (options.isPasswordCommandError(commandError)) {
            diagnostics.record({
              scope: "quickAction",
              name: "extractPasswordRequired",
              fields: { action, errorCode: commandError?.code ?? "unknown" },
            });
            const nextPassword = options.promptForCommandRetry(commandError?.code ?? "");
            if (!nextPassword) {
              options.setOperationalStatus(commandError?.message ?? options.message("quickExtract.unableExtract", { archivePath }));
              break;
            }
            password = nextPassword;
            continue;
          }

          diagnostics.record({
            scope: "quickAction",
            name: "extractStartFailed",
            fields: { action, errorCode: commandError?.code ?? "unknown" },
          });
          options.setOperationalStatus(
            commandError?.message ?? options.message("quickExtract.unableExtract", { archivePath }),
          );
          if (commandError?.hint) {
            options.setBrowseError(`${commandError.message}\n${commandError.hint}`);
          }
          break;
        }
      }
    }
  }

  async function handleQuickActionRequest(request: QuickActionRequestDto): Promise<void> {
    diagnostics.record({
      scope: "quickAction",
      name: "requestReceived",
      fields: { action: request.kind, pathCount: request.paths.length },
    });
    await runQuickActionRequest(request, options.preferences(), {
      openArchive: options.openArchive,
      openCreateReview: openQuickCreateReview,
      startCreate: startQuickCreate,
      openExtractReview: openQuickExtractReview,
      startExtract: startQuickExtract,
    });
  }

  return {
    handleQuickActionRequest,
    startQuickCreate,
    openQuickCreateReview,
    openQuickExtractReview,
    startQuickExtract,
  };
}
