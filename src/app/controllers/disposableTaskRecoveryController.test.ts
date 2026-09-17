import { describe, expect, it, vi } from "vitest";

import type { DesktopJobSnapshotDto } from "../../api/types";
import { createDisposableTaskRecoveryController } from "./disposableTaskRecoveryController";

function failedSnapshot(): DesktopJobSnapshotDto {
  return {
    jobId: "failed-job",
    kind: "zipExtract",
    status: "failed",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:01.000Z",
    revision: "2",
    canPause: false,
    canResume: false,
    canCancel: false,
    canDismiss: true,
    progressFacts: {
      processedBytes: 0,
      processedEntries: 0,
      recentPaths: [],
      phaseProcessedBytes: 0,
      warningCount: 0,
      activeElapsedMillis: 1000,
      phaseElapsedMillis: 1000,
    },
    boundedNotices: [],
    latestFailure: {
      eventType: "failed",
      code: "password_required",
      message: "Password required",
    },
    terminalSummary: null,
    availableActions: [],
    outputArtifacts: [],
    retryDescriptor: {
      retryKind: "extractArchive",
      actionId: "retry-with-password",
      archivePath: "C:/source.zip",
      destinationPath: "C:/out",
      overwrite: "rename",
      destinationCollisionStrategy: "rename",
      entryPaths: ["docs/readme.txt"],
      stripComponents: 1,
    },
  };
}

describe("disposable task recovery controller", () => {
  it("starts one password retry and hands the accepted Job back to the coordinator", async () => {
    const nextJob = {
      jobId: "retry-job",
      kind: "zipExtract" as const,
      status: "queued" as const,
      createdAt: "2026-07-29T00:00:02.000Z",
    };
    const startExtract = vi.fn(async () => nextJob);
    const handoffAcceptedJob = vi.fn(async () => {});
    const controller = createDisposableTaskRecoveryController({
      promptForPassword: () => "secret",
      startExtract,
      startTest: vi.fn(),
      handoffAcceptedJob,
      toCommandError: () => null,
      reportFailure: vi.fn(),
    });

    await expect(controller.retryWithPassword(failedSnapshot())).resolves.toBe("started");
    expect(startExtract).toHaveBeenCalledWith({
      archivePath: "C:/source.zip",
      destinationPath: "C:/out",
      overwrite: "rename",
      destinationCollisionStrategy: "rename",
      entryPaths: ["docs/readme.txt"],
      stripComponents: 1,
      tzapRestorePolicy: "portable",
      tzapAllowDegraded: false,
      tzapAllowAbsoluteSymlinks: false,
      ignoreSymlinks: false,
      password: "secret",
    }, "passwordRetry");
    expect(handoffAcceptedJob).toHaveBeenCalledWith(nextJob);
  });

  it("does not start work when the user cancels the password prompt", async () => {
    const startExtract = vi.fn();
    const controller = createDisposableTaskRecoveryController({
      promptForPassword: () => null,
      startExtract,
      startTest: vi.fn(),
      handoffAcceptedJob: vi.fn(),
      toCommandError: () => null,
      reportFailure: vi.fn(),
    });

    await expect(controller.retryWithPassword(failedSnapshot())).resolves.toBe("cancelled");
    expect(startExtract).not.toHaveBeenCalled();
  });

  it("keeps an accepted replacement accepted when presentation fails", async () => {
    const reportFailure = vi.fn();
    const controller = createDisposableTaskRecoveryController({
      promptForPassword: () => "secret",
      startExtract: vi.fn(async () => ({
        jobId: "accepted-job",
        kind: "zipExtract" as const,
        status: "queued" as const,
        createdAt: "2026-07-29T00:00:02.000Z",
      })),
      startTest: vi.fn(),
      handoffAcceptedJob: vi.fn(async () => {
        throw new Error("main window event unavailable");
      }),
      toCommandError: () => null,
      reportFailure,
    });

    await expect(controller.retryWithPassword(failedSnapshot()))
      .resolves.toBe("acceptedWithoutPresentation");
    expect(reportFailure).toHaveBeenCalledWith(
      "The replacement Job started, but its task window could not be opened.",
    );
  });
});
