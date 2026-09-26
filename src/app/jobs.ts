import type {
  DesktopJobSnapshotDto,
  JobKind,
  JobPhase,
  JobStatus,
} from "../api/types";
import { COMMAND_INVALID_PASSWORD, COMMAND_PASSWORD_REQUIRED } from "./constants";
import { calculateCompressionRatio } from "./formatting";

export function isPasswordErrorCode(code?: string | null): boolean {
  return code === COMMAND_PASSWORD_REQUIRED || code === COMMAND_INVALID_PASSWORD;
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isLiveJobStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running" || status === "paused";
}

export function isCreateJobKind(kind: JobKind): boolean {
  return (
    kind === "zipCreate"
    || kind === "sevenZCreate"
    || kind === "tarZstdCreate"
    || kind === "tarGzCreate"
    || kind === "tzapCreate"
    || kind === "appleArchiveCreate"
  );
}

export type JobProgressSnapshot = Readonly<{
  id: string;
  kind: JobKind;
  status: JobStatus;
  elapsedMs: number;
  remainingMs: number | null;
  processedFiles: number;
  totalFiles: number | null;
  errorCount: number;
  warningCount: number;
  totalBytes: number | null;
  processedBytes: number;
  compressedBytes: number | null;
  speedBytesPerSecond: number | null;
  compressionRatio: number | null;
  currentFile: string;
  progressPercent: number | null;
  latestStatusMessage: string;
  phase?: JobPhase | null;
}>;

export function deriveRetainedJobProgress(
  snapshot: DesktopJobSnapshotDto,
): JobProgressSnapshot {
  const facts = snapshot.progressFacts;
  const processedBytes = facts.processedBytes;
  const totalBytes = facts.totalBytes ?? null;
  const totalEntries = facts.totalEntries ?? null;
  const elapsedMs = facts.activeElapsedMillis;
  const speedBytesPerSecond = elapsedMs > 0 && processedBytes > 0
    ? processedBytes / (elapsedMs / 1000)
    : null;
  const bytePercent = totalBytes !== null && totalBytes > 0
    ? Math.max(0, Math.min(100, processedBytes / totalBytes * 100))
    : null;
  const filePercent = totalEntries !== null && totalEntries > 0
    ? Math.max(0, Math.min(100, facts.processedEntries / totalEntries * 100))
    : null;
  const phasePercent = snapshot.kind === "tzapCreate" && facts.activePhase
    ? progressPercentForTzapPhase(
        facts.activePhase,
        facts.phaseProcessedBytes,
        facts.phaseTotalBytes ?? null,
        facts.activePhase.startsWith("planning"),
      )
    : null;
  const progressPercent = snapshot.status === "completed"
    ? 100
    : phasePercent ?? bytePercent ?? filePercent;
  const writtenBytes = snapshot.terminalSummary?.writtenBytes ?? null;

  return {
    id: snapshot.jobId,
    kind: snapshot.kind,
    status: snapshot.status,
    elapsedMs,
    remainingMs: progressPercent && progressPercent > 0
      ? elapsedMs * ((100 - progressPercent) / progressPercent)
      : null,
    processedFiles: facts.processedEntries,
    totalFiles: facts.totalEntries ?? null,
    errorCount: snapshot.latestFailure ? 1 : 0,
    warningCount: facts.warningCount,
    totalBytes,
    processedBytes,
    compressedBytes: writtenBytes,
    speedBytesPerSecond,
    compressionRatio: isCreateJobKind(snapshot.kind)
      ? calculateCompressionRatio(totalBytes, writtenBytes)
      : null,
    currentFile: facts.recentPaths.at(-1) ?? facts.currentPath ?? "",
    progressPercent,
    latestStatusMessage: snapshot.latestFailure?.message
      ?? facts.activePhase
      ?? snapshot.status,
    phase: facts.activePhase ?? null,
  };
}

const TZAP_CREATE_PHASE_RANGES: Readonly<
  Record<JobPhase, Readonly<{ start: number; end: number }>>
> = Object.freeze({
  planningPayload: Object.freeze({ start: 0, end: 40 }),
  planningMetadata: Object.freeze({ start: 40, end: 42 }),
  emittingPayload: Object.freeze({ start: 42, end: 94 }),
  emittingMetadata: Object.freeze({ start: 94, end: 99 }),
  committingOutput: Object.freeze({ start: 99, end: 99 }),
});

const TZAP_SINGLE_PASS_PHASE_RANGES: Readonly<
  Record<JobPhase, Readonly<{ start: number; end: number }>>
> = Object.freeze({
  planningPayload: Object.freeze({ start: 0, end: 0 }),
  planningMetadata: Object.freeze({ start: 0, end: 0 }),
  emittingPayload: Object.freeze({ start: 0, end: 94 }),
  emittingMetadata: Object.freeze({ start: 94, end: 99 }),
  committingOutput: Object.freeze({ start: 99, end: 99 }),
});

function progressPercentForTzapPhase(
  phase: JobPhase,
  processedBytes: number,
  totalBytes: number | null,
  hasPlanningPhase: boolean,
): number {
  const range = (
    hasPlanningPhase
      ? TZAP_CREATE_PHASE_RANGES
      : TZAP_SINGLE_PASS_PHASE_RANGES
  )[phase];
  const fraction = totalBytes !== null && totalBytes > 0
    ? Math.max(0, Math.min(1, processedBytes / totalBytes))
    : 0;
  return range.start + ((range.end - range.start) * fraction);
}
