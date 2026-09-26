import { describe, expect, it } from "vitest";

import type { DesktopJobSnapshotDto } from "../api/types";
import {
  deriveRetainedJobProgress,
  isLiveJobStatus,
  isPasswordErrorCode,
  isTerminalJobStatus,
} from "./jobs";

function snapshot(
  overrides: Partial<DesktopJobSnapshotDto> = {},
): DesktopJobSnapshotDto {
  return {
    jobId: "job-1",
    kind: "zipCreate",
    status: "running",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:04.000Z",
    revision: "4",
    canPause: true,
    canResume: false,
    canCancel: true,
    canDismiss: false,
    progressFacts: {
      processedBytes: 50,
      totalBytes: 100,
      processedEntries: 2,
      totalEntries: 4,
      currentPath: "older.txt",
      recentPaths: ["newer.txt"],
      phaseProcessedBytes: 0,
      warningCount: 1,
      activeElapsedMillis: 4000,
      phaseElapsedMillis: 4000,
    },
    boundedNotices: [],
    terminalSummary: null,
    availableActions: [],
    outputArtifacts: [],
    retryDescriptor: null,
    ...overrides,
  };
}

describe("retained Job presentation", () => {
  it("derives progress directly from the authoritative retained snapshot", () => {
    expect(deriveRetainedJobProgress(snapshot())).toMatchObject({
      id: "job-1",
      processedBytes: 50,
      processedFiles: 2,
      progressPercent: 50,
      currentFile: "newer.txt",
      warningCount: 1,
      speedBytesPerSecond: 12.5,
    });
  });

  it("falls back to file progress when the byte total is unavailable", () => {
    expect(deriveRetainedJobProgress(snapshot({
      progressFacts: {
        ...snapshot().progressFacts,
        totalBytes: null,
      },
    }))).toMatchObject({
      processedFiles: 2,
      totalFiles: 4,
      progressPercent: 50,
    });
  });

  it("prefers byte progress when both byte and file totals are available", () => {
    expect(deriveRetainedJobProgress(snapshot({
      progressFacts: {
        ...snapshot().progressFacts,
        totalBytes: 200,
      },
    })).progressPercent).toBe(25);
  });

  it("keeps progress indeterminate when neither total is available", () => {
    expect(deriveRetainedJobProgress(snapshot({
      progressFacts: {
        ...snapshot().progressFacts,
        totalBytes: null,
        totalEntries: null,
      },
    })).progressPercent).toBeNull();
  });

  it("recognizes process and password states without creating frontend Job state", () => {
    expect(isLiveJobStatus("queued")).toBe(true);
    expect(isLiveJobStatus("running")).toBe(true);
    expect(isTerminalJobStatus("completed")).toBe(true);
    expect(isPasswordErrorCode("password_required")).toBe(true);
    expect(isPasswordErrorCode("invalid_password")).toBe(true);
    expect(isPasswordErrorCode("bad_archive")).toBe(false);
  });
});
