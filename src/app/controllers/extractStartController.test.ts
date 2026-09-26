import { describe, expect, it, vi } from "vitest";

import type {
  ArchiveEntryDto,
  ArchiveListingDto,
  CommandErrorDto,
  StartExtractRequest,
  StartJobResponseDto,
} from "../../api/types";
import type { ExtractMode, ExtractStartInput } from "../extractFlow";
import { createMainWindowSubmissionGuard } from "../mainWindowSubmissionGuard";
import { createArchiveWorkspace, type ArchiveWorkspace } from "../workspaces/archiveWorkspace";
import {
  createExtractStartController,
  type ExtractStartControllerOptions,
} from "./extractStartController";

const startedAt = "2026-06-11T00:00:00Z";

const entries: ArchiveEntryDto[] = [
  { path: "docs", kind: "directory" },
  { path: "docs/readme.txt", kind: "file", size: 12 },
  { path: "src/main.rs", kind: "file", size: 20 },
];

function archiveListing(): ArchiveListingDto {
  return {
    archivePath: "C:/archives/demo.zip",
    entryCount: entries.length,
    totalSize: 32,
    entries,
  };
}

function startJobResponse(overrides: Partial<StartJobResponseDto> = {}): StartJobResponseDto {
  return {
    jobId: "extract-job",
    kind: "zipExtract",
    status: "queued",
    createdAt: startedAt,
    ...overrides,
  };
}

function commandError(overrides: Partial<CommandErrorDto> = {}): CommandErrorDto {
  return {
    code: "failed",
    message: "Could not extract",
    hint: null,
    severity: "error",
    retryable: false,
    ...overrides,
  };
}

function selectPaths(workspace: ArchiveWorkspace, paths: readonly string[]): void {
  workspace.updateSelection({
    selectedPaths: new Set(paths),
    focusedPath: paths[0] ?? "",
    anchorPath: paths[0] ?? "",
  });
}

function createHarness(overrides: Partial<ExtractStartControllerOptions> = {}) {
  const workspace = createArchiveWorkspace();
  workspace.loadSucceeded(archiveListing());
  const calls = {
    chooseDestinationFirst: 0,
    selectEntryFirst: 0,
    recordDestination: [] as string[],
    closeDialog: 0,
    resetSubmittedState: 0,
    jobs: [] as unknown[],
    retries: [] as string[],
    errors: [] as string[],
  };
  let input: ExtractStartInput = {
    destinationBasePath: "C:/out",
    useSubfolder: true,
    subfolder: "demo",
    pathMode: "full",
    overwrite: "ask" as StartExtractRequest["overwrite"],
    stripComponents: "1",
    deduplicateRoot: false,
    tzapRestorePolicy: "portable",
    tzapAllowDegraded: false,
    tzapAllowAbsoluteSymlinks: false,
    ignoreSymlinks: false,
    password: undefined as string | undefined,
  };
  const startExtract = vi.fn(async () => startJobResponse());

  const controller = createExtractStartController({
    workspace,
    submissionGuard: createMainWindowSubmissionGuard(),
    hasCurrentArchive() {
      return Boolean(workspace.getSnapshot().currentArchivePath);
    },
    joinNativePath(parentPath, childName) {
      return `${parentPath}/${childName}`;
    },
    startExtract,
    toCommandError(error) {
      return error && typeof error === "object" && "code" in error
        ? error as CommandErrorDto
        : null;
    },
    requestPasswordInDialog(retry) {
      calls.retries.push(retry.promptKey);
    },
    chooseDestinationFirst() {
      calls.chooseDestinationFirst += 1;
    },
    selectEntryFirst() {
      calls.selectEntryFirst += 1;
    },
    recordDestination(destination) {
      calls.recordDestination.push(destination);
    },
    closeExtractDialog() {
      calls.closeDialog += 1;
    },
    async handoffAcceptedJob(response, resetSubmittedState) {
      calls.jobs.push(response);
      resetSubmittedState();
    },
    resetSubmittedState() {
      calls.resetSubmittedState += 1;
    },
    unableStartMessage(mode) {
      return mode === "selection" ? "Unable to extract selection." : "Unable to extract archive.";
    },
    setBrowseError(message) {
      calls.errors.push(message);
    },
    ...overrides,
  });

  return {
    calls,
    controller,
    setInput(next: Partial<ExtractStartInput>) {
      input = { ...input, ...next };
    },
    startWithInput(mode: ExtractMode) {
      return controller.startExtract(mode, input);
    },
    startExtract,
    workspace,
  };
}

describe("extract start controller", () => {
  it("starts archive extraction, hands off the Job, and resets submitted state", async () => {
    const harness = createHarness();

    await harness.startWithInput("archive");

    expect(harness.startExtract).toHaveBeenCalledWith({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/out/demo",
      overwrite: "ask",
      stripComponents: 1,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: true,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    });
    expect(harness.calls.recordDestination).toEqual(["C:/out/demo"]);
    expect(harness.calls.closeDialog).toBe(1);
    expect(harness.calls.jobs).toHaveLength(1);
    expect(harness.calls.jobs[0]).toEqual(startJobResponse());
    expect(harness.calls.resetSubmittedState).toBe(1);
  });

  it("starts selection extraction with selected entry paths", async () => {
    const harness = createHarness();
    selectPaths(harness.workspace, ["docs/readme.txt"]);

    await harness.startWithInput("selection");

    expect(harness.startExtract).toHaveBeenCalledWith({
      archivePath: "C:/archives/demo.zip",
      destinationPath: "C:/out/demo",
      overwrite: "ask",
      stripComponents: 1,
      entryPaths: ["docs/readme.txt"],
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: true,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
    });
    expect(harness.calls.jobs[0]).toEqual(startJobResponse());
  });

  it("prompts for a destination before building requests", async () => {
    const harness = createHarness();
    harness.setInput({ destinationBasePath: "" });

    await harness.startWithInput("archive");

    expect(harness.calls.chooseDestinationFirst).toBe(1);
    expect(harness.startExtract).not.toHaveBeenCalled();
  });

  it("prompts for selection before building selection requests", async () => {
    const harness = createHarness();

    await harness.startWithInput("selection");

    expect(harness.calls.selectEntryFirst).toBe(1);
    expect(harness.startExtract).not.toHaveBeenCalled();
  });

  it("routes password errors to the dialog retry prompt", async () => {
    const harness = createHarness();
    harness.startExtract.mockRejectedValueOnce(commandError({
      code: "password_required",
      message: "Password required",
    }));

    await harness.startWithInput("archive");

    expect(harness.calls.retries).toEqual(["browse.passwordRequired"]);
    expect(harness.calls.errors).toEqual([]);
  });

  it("reports command and unknown failures with mode-specific fallbacks", async () => {
    const commandHarness = createHarness();
    commandHarness.startExtract.mockRejectedValueOnce(commandError({ message: "Disk full" }));

    await commandHarness.startWithInput("archive");

    expect(commandHarness.calls.errors).toEqual(["Disk full"]);

    const unknownHarness = createHarness();
    selectPaths(unknownHarness.workspace, ["docs/readme.txt"]);
    unknownHarness.startExtract.mockRejectedValueOnce(new Error("boom"));

    await unknownHarness.startWithInput("selection");

    expect(unknownHarness.calls.errors).toEqual(["Unable to extract selection."]);
  });

  it("guards only the request awaiting Rust acceptance", async () => {
    let acceptFirst: (job: StartJobResponseDto) => void = () => {
      throw new Error("first extraction was not started");
    };
    const firstAcceptance = new Promise<StartJobResponseDto>((resolve) => {
      acceptFirst = resolve;
    });
    const startExtract = vi.fn()
      .mockImplementationOnce(() => firstAcceptance)
      .mockResolvedValueOnce(startJobResponse({ jobId: "extract-job-2" }));
    const harness = createHarness({ startExtract });

    const first = harness.startWithInput("archive");
    const duplicate = harness.startWithInput("archive");
    expect(startExtract).toHaveBeenCalledTimes(1);

    acceptFirst(startJobResponse({ jobId: "extract-job-1" }));
    await Promise.all([first, duplicate]);
    await harness.startWithInput("archive");

    expect(startExtract).toHaveBeenCalledTimes(2);
  });
});
