import {
  Archive,
  CircleCheck,
  CircleX,
  FileArchive,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { useMemo } from "react";

import {
  deriveRetainedJobProgress,
  isPasswordErrorCode,
} from "../../../app/jobs";
import {
  isLiveDisposableTask,
  type DisposableTaskJobSnapshot,
  type DisposableTaskState,
} from "../../../app/workspaces/disposableTask";
import { formatBytes } from "../../../app/formatting";
import { Button } from "../../components/ui/button";
import { ErrorDetailsPanel } from "../../components/ui/error-details-panel";
import { HelpTooltip } from "../../components/ui/tooltip";

export function DisposableTaskView({
  state,
  nowMs,
  onCancel,
  onClose,
  onContinueInBackground,
  onKeepOpen,
  onMinimize,
  onPause,
  onRetry,
  onResume,
  onRunOutputAction,
  retrying = false,
  retryDisabled = false,
  surfaceError = "",
}: Readonly<{
  state: DisposableTaskState;
  nowMs: number;
  onCancel(): void;
  onClose(): void;
  onContinueInBackground(): void;
  onKeepOpen(): void;
  onMinimize(): void;
  onPause(): void;
  onRetry(): void;
  onResume(): void;
  onRunOutputAction(
    action: DisposableTaskJobSnapshot["availableActions"][number],
    path: string,
  ): void;
  retrying?: boolean;
  retryDisabled?: boolean;
  surfaceError?: string;
}>) {
  const progress = useMemo(
    () => deriveRetainedJobProgress(state.job),
    [nowMs, state.job],
  );
  const create = isCreateKind(state.job.kind);
  const title = state.job.kind === "testArchive"
    ? "Testing with ZManager"
    : create
      ? "Compressing with ZManager"
      : "Extracting with ZManager";
  const subtitle = taskKindLabel(state.job.kind);
  const failedEvent = state.job.latestFailure;
  const failureMessage =
    failedEvent?.message || "The archive job could not be completed.";
  const failureDetail = [failedEvent?.message, failedEvent?.hint]
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  const hasLongFailureDetail = failureDetail.length > 180;
  const artifacts = new Map(
    state.job.outputArtifacts.map((artifact) => [artifact.artifactId, artifact]),
  );
  const outputActions = state.job.availableActions.flatMap((action) => {
    const artifact = artifacts.get(action.artifactId);
    return artifact?.path ? [{ ...action, path: artifact.path }] : [];
  });
  const canRetry = state.phase === "failed"
    && Boolean(state.job.retryDescriptor)
    && isPasswordErrorCode(failedEvent?.code);

  return (
    <main className="flex min-h-screen min-w-0 max-w-full h-screen max-h-screen flex-col overflow-hidden bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <header className="flex items-start justify-between border-b border-black/10 px-5 py-4 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-sm">
            {create ? (
              <Archive className="size-5" />
            ) : (
              <FileArchive className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold">{title}</h1>
            <p className="truncate text-xs opacity-60">{subtitle}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close task"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>

      <section
        data-task-content
        className="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-5"
      >
        {surfaceError ? (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
            {surfaceError}
          </p>
        ) : null}
        <div className="min-w-0 max-w-full rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <TaskState state={state} />
            <span className="text-xs tabular-nums opacity-60">
              {formatClock(progress.elapsedMs)}
            </span>
          </div>
          {progress.currentFile ? (
            <HelpTooltip content={progress.currentFile}>
              <p className="mb-3 min-h-5 max-w-full truncate text-sm font-medium">
                {compactProgressPath(progress.currentFile)}
              </p>
            </HelpTooltip>
          ) : (
            <p className="mb-3 min-h-5 max-w-full truncate text-sm font-medium">
              {taskPhaseLabel(progress.phase) || statusText(state)}
            </p>
          )}
          <progress
            className="h-2 w-full overflow-hidden rounded-full"
            aria-label="Task progress"
            value={progress.progressPercent ?? undefined}
            max="100"
          />
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <Metric
              label="Files"
              value={
                progress.totalFiles === null
                  ? String(progress.processedFiles)
                  : `${progress.processedFiles} / ${progress.totalFiles}`
              }
            />
            <Metric
              label="Processed"
              value={formatBytes(progress.processedBytes)}
            />
            <Metric
              label="Remaining"
              value={formatClock(progress.remainingMs)}
            />
          </div>
        </div>

        {state.phase === "failed" ? (
          <div
            className="grid gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.07] p-3 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            <strong className="block">Task failed</strong>
            <span>{failureMessage}</span>
            {hasLongFailureDetail ? (
              <ErrorDetailsPanel>{failureDetail}</ErrorDetailsPanel>
            ) : failedEvent?.hint ? (
              <span className="text-xs leading-5">{failedEvent.hint}</span>
            ) : null}
          </div>
        ) : null}
        {state.closePromptOpen ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-4">
            <h2 className="text-sm font-semibold">
              This task is still running
            </h2>
            <p className="mt-1 text-xs opacity-70">
              Keep it running in the background, cancel it, or return to
              progress.
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="dialog"
                size="unset"
                onClick={onContinueInBackground}
              >
                Run in background
              </Button>
              <Button
                type="button"
                variant="dialog"
                size="unset"
                onClick={onCancel}
              >
                Cancel task
              </Button>
              <Button
                type="button"
                variant="dialogPrimary"
                size="unset"
                onClick={onKeepOpen}
              >
                Keep open
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <footer className="flex items-center justify-between border-t border-black/10 px-5 py-3 dark:border-white/10">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="dialog"
            size="unset"
            onClick={onMinimize}
          >
            Minimize
          </Button>
          {outputActions.map((action) => (
            <Button
              key={action.actionId}
              type="button"
              variant="dialog"
              size="unset"
              onClick={() => onRunOutputAction(action, action.path)}
            >
              {action.kind === "open" ? "Open output" : "Show output"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          {state.phase === "running" && state.job.canPause ? (
            <Button
              type="button"
              variant="dialog"
              size="unset"
              onClick={onPause}
            >
              <Pause className="mr-1 size-3" />
              Pause
            </Button>
          ) : null}
          {state.phase === "paused" && state.job.canResume ? (
            <Button
              type="button"
              variant="dialog"
              size="unset"
              onClick={onResume}
            >
              <Play className="mr-1 size-3" />
              Resume
            </Button>
          ) : null}
          {isLiveDisposableTask(state) && state.job.canCancel ? (
            <Button
              type="button"
              variant="dialog"
              size="unset"
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          {state.phase === "failed" ? (
            <>
              {canRetry ? (
                <Button
                  type="button"
                  variant="dialogPrimary"
                  size="unset"
                  disabled={retrying || retryDisabled}
                  onClick={onRetry}
                >
                  <RotateCcw className="mr-1 size-3" />
                  {retrying
                    ? "Retrying…"
                    : retryDisabled
                      ? "Replacement Job started"
                      : "Retry with password"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={canRetry ? "dialog" : "dialogPrimary"}
                size="unset"
                onClick={onClose}
              >
                Close
              </Button>
            </>
          ) : null}
        </div>
      </footer>
    </main>
  );
}

function TaskState({ state }: Readonly<{ state: DisposableTaskState }>) {
  if (state.phase === "succeeded")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        <CircleCheck className="size-4" />
        Completed
      </span>
    );
  if (state.phase === "failed")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-300">
        <CircleX className="size-4" />
        Failed
      </span>
    );
  if (state.phase === "cancelled")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <CircleX className="size-4" />
        Cancelled
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-700 dark:text-blue-300">
      <LoaderCircle className="size-4 animate-spin" />
      {statusText(state)}
    </span>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-black/[0.035] px-2 py-2 dark:bg-white/[0.05]">
      <strong className="block truncate text-sm tabular-nums">{value}</strong>
      <span className="opacity-55">{label}</span>
    </div>
  );
}

function statusText(state: DisposableTaskState): string {
  switch (state.phase) {
    case "starting":
      return "Starting…";
    case "running":
      return "Working…";
    case "paused":
      return "Paused";
    case "cancelling":
      return "Cancelling…";
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "closing":
      return "Closing…";
  }
}

function isCreateKind(kind: DisposableTaskJobSnapshot["kind"]): boolean {
  return kind.endsWith("Create");
}

function taskKindLabel(kind: DisposableTaskJobSnapshot["kind"]): string {
  return kind
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (value) => value.toUpperCase());
}

function taskPhaseLabel(
  phase: ReturnType<typeof deriveRetainedJobProgress>["phase"],
): string {
  switch (phase) {
    case "planningPayload":
      return "Planning archive…";
    case "planningMetadata":
      return "Planning archive metadata…";
    case "emittingPayload":
      return "Writing archive payload…";
    case "emittingMetadata":
      return "Writing recovery metadata…";
    case "committingOutput":
      return "Finalizing archive…";
    case null:
    case undefined:
      return "";
  }
}

function formatClock(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "--:--";
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function compactProgressPath(path: string | null, maxCharacters = 64): string {
  if (!path || path.length <= maxCharacters) return path ?? "";

  const parts = path.split(/[\\/]+/).filter(Boolean);
  const tail = parts.slice(-2).join("/");
  if (tail.length <= maxCharacters - 2) return `…/${tail}`;

  const fileName = parts.at(-1) ?? path;
  if (fileName.length <= maxCharacters - 2) return `…/${fileName}`;
  return `…${fileName.slice(-(maxCharacters - 1))}`;
}
