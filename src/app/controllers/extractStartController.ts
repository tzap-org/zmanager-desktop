import type { CommandErrorDto, StartExtractRequest, StartJobResponseDto } from "../../api/types";
import {
  resolveExtractStartInput,
  type ExtractMode,
  type ExtractStartInput,
  type ResolvedExtractStartInput,
} from "../extractFlow";
import type {
  ArchiveWorkspace,
  ArchiveWorkspacePasswordRetry,
  ArchiveWorkspaceRequestResult,
  ArchiveWorkspaceExtractUnavailableReason,
} from "../workspaces/archiveWorkspace";
import type { MainWindowSubmissionGuard } from "../mainWindowSubmissionGuard";

export type ExtractStartControllerWorkspace = Pick<
  ArchiveWorkspace,
  | "buildExtractRequest"
  | "clearPasswordRetry"
  | "getExtractReferencePaths"
  | "getSnapshot"
  | "requestPasswordRetry"
>;

export type ExtractStartControllerOptions = Readonly<{
  workspace: ExtractStartControllerWorkspace;
  submissionGuard: MainWindowSubmissionGuard;
  hasCurrentArchive(): boolean;
  joinNativePath(parentPath: string, childName: string): string;
  startExtract(request: StartExtractRequest): Promise<StartJobResponseDto>;
  toCommandError(error: unknown): CommandErrorDto | null;
  requestPasswordInDialog(retry: ArchiveWorkspacePasswordRetry): void;
  chooseDestinationFirst(): void;
  selectEntryFirst(): void;
  recordDestination(destination: string): void;
  closeExtractDialog(): void;
  handoffAcceptedJob(
    response: StartJobResponseDto,
    resetSubmittedState: () => void,
  ): Promise<void>;
  resetSubmittedState(): void;
  unableStartMessage(mode: ExtractMode): string;
  setBrowseError(message: string): void;
}>;

export type ExtractStartController = Readonly<{
  startExtract(mode: ExtractMode, input: ExtractStartInput): Promise<void>;
}>;

function passwordRetryOperation(mode: ExtractMode): "extractArchive" | "extractSelection" {
  return mode === "archive" ? "extractArchive" : "extractSelection";
}

export function createExtractStartController(
  options: ExtractStartControllerOptions,
): ExtractStartController {
  async function startExtract(mode: ExtractMode, input: ExtractStartInput): Promise<void> {
    if (!options.hasCurrentArchive()) {
      return;
    }

    const snapshot = options.workspace.getSnapshot();
    const resolvedInput = resolveExtractStartInput(input, {
      currentFolder: snapshot.view.currentFolder,
      allEntryPaths: snapshot.entries.map((entry) => entry.path),
      entryReferences: options.workspace.getExtractReferencePaths(mode),
      joinNativePath: options.joinNativePath,
    });
    if (!resolvedInput.destinationValid || !resolvedInput.destination) {
      options.chooseDestinationFirst();
      return;
    }

    if (
      mode === "selection" &&
      resolvedInput.entryReferences.length === 0 &&
      !snapshot.view.selection.allSelected
    ) {
      options.selectEntryFirst();
      return;
    }

    let requestResult: ArchiveWorkspaceRequestResult<StartExtractRequest, ArchiveWorkspaceExtractUnavailableReason> =
      options.workspace.buildExtractRequest({
        mode,
        destinationPath: resolvedInput.destination,
        overwrite: resolvedInput.overwrite,
        stripComponents: resolvedInput.stripComponents,
        tzapRestorePolicy: resolvedInput.tzapRestorePolicy,
        tzapAllowDegraded: resolvedInput.tzapAllowDegraded,
        tzapAllowAbsoluteSymlinks: resolvedInput.tzapAllowAbsoluteSymlinks,
        ignoreSymlinks: resolvedInput.ignoreSymlinks,
        ...(resolvedInput.tzapRecipientKeyId ? { recipientKeyId: resolvedInput.tzapRecipientKeyId } : {}),
        password: resolvedInput.password,
      });
    if (!requestResult.ok) {
      if (mode === "selection") {
        options.selectEntryFirst();
      }
      return;
    }
    const request = requestResult.request;
    if (!options.submissionGuard.tryBegin()) {
      return;
    }

    let response: StartJobResponseDto;
    try {
      response = await options.startExtract(request);
    } catch (error) {
      const commandError = options.toCommandError(error);
      const retry = options.workspace.requestPasswordRetry({
        operation: passwordRetryOperation(mode),
        error: commandError,
      });
      if (retry) {
        options.requestPasswordInDialog(retry);
        return;
      }
      options.setBrowseError(commandError?.message ?? options.unableStartMessage(mode));
      return;
    } finally {
      options.submissionGuard.end();
    }

    await options.handoffAcceptedJob(response, options.resetSubmittedState);
    try {
      options.recordDestination(resolvedInput.destination);
    } finally {
      options.closeExtractDialog();
    }
  }

  return {
    startExtract,
  };
}
