import { useEffect, useMemo, useReducer, useState } from "react";

import {
  asCommandError,
  cancelJob,
  pauseJob,
  resumeJob,
  runStartExtract,
  runTestArchive,
} from "../api/commands";
import type { JobEventDto, JobKind, JobStatus, StartJobResponseDto } from "../api/types";
import { createDisposableTaskRecoveryController } from "../app/controllers/disposableTaskRecoveryController";
import {
  createDisposableTask,
  isLiveDisposableTask,
  reduceDisposableTask,
} from "../app/workspaces/disposableTask";
import type { DisposableTaskState } from "../app/workspaces/disposableTask";
import { unknownErrorMessage } from "../app/dialogs";
import {
  announceDisposableTaskReady,
  closeDisposableTaskWindow,
  listenDisposableTaskCloseRequested,
  minimizeDisposableTaskWindow,
  requestDisposableTaskJobHandoff,
  requestDisposableTaskOutputAction,
} from "../desktop/disposableTaskWindow";
import { createTauriJobFeed } from "../desktop/jobFeed";
import { persistDiagnosticEvent } from "../desktop/diagnostics";
import { DisposableTaskView } from "../ui/react/tasks/DisposableTaskApp";
import { createBrowserPasswordPromptAdapter } from "./passwordPromptAdapter";
import { isLocalDevHost } from "./runtimeDevTools";

const AUTO_CLOSE_SUCCESS_MS = 850;

type DisposableTaskBootstrap = StartJobResponseDto & {
  initialFailure: JobEventDto | null;
};

export function DisposableTaskRuntimeApp() {
  const bootstrap = disposableTaskBootstrap(globalThis.location?.search ?? "");
  if (!bootstrap) {
    return <main className="grid min-h-screen place-items-center p-6"><p role="alert">This task could not be opened.</p></main>;
  }
  return <DisposableTaskRuntime bootstrap={bootstrap} />;
}

function DisposableTaskRuntime({ bootstrap }: Readonly<{ bootstrap: DisposableTaskBootstrap }>) {
  const [state, dispatch] = useReducer(
    reduceDisposableTask,
    bootstrap,
    createInitialDisposableTaskState,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);
  const [replacementAccepted, setReplacementAccepted] = useState(false);
  const [surfaceError, setSurfaceError] = useState("");
  const recovery = useMemo(() => createDisposableTaskRecoveryController({
    promptForPassword: (commandCode) => createBrowserPasswordPromptAdapter()
      .promptForPassword(
        commandCode === "password_required"
          ? "Enter the archive password to retry."
          : "The password was not accepted. Enter another password.",
      ),
    startExtract: runStartExtract,
    startTest: runTestArchive,
    handoffAcceptedJob: requestDisposableTaskJobHandoff,
    toCommandError: asCommandError,
    reportFailure: setSurfaceError,
  }), []);

  useEffect(() => {
    performance.mark("zmanager-task-content-mounted");
    const paint = () => {
      void persistDiagnosticEvent({
        scope: "disposableTaskSurface",
        name: "firstContentPainted",
        fields: { jobKind: bootstrap.kind, initialStatus: bootstrap.status },
      }).catch(() => {});
    };
    if (typeof requestAnimationFrame === "function") {
      const frame = requestAnimationFrame(paint);
      return () => cancelAnimationFrame(frame);
    }
    const timeout = globalThis.setTimeout(paint, 0);
    return () => globalThis.clearTimeout(timeout);
  }, [bootstrap.kind, bootstrap.status]);

  useEffect(() => {
    void persistDiagnosticEvent({
      scope: "disposableTaskSurface",
      name: "mounted",
      fields: { jobKind: bootstrap.kind, initialStatus: bootstrap.status },
    }).catch(() => {});
  }, [bootstrap.kind, bootstrap.status]);

  useEffect(() => {
    let disposed = false;
    let unsubscribeUpdates: (() => Promise<void>) | null = null;
    let unlistenClose: (() => void) | null = null;
    void createTauriJobFeed().subscribeJob(state.job.jobId, (snapshot) => {
        if (!disposed) dispatch({ type: "jobUpdated", snapshot });
      }).then((subscription) => {
        unsubscribeUpdates = subscription.unsubscribe;
      }).catch((error) => {
        if (!disposed) {
          setSurfaceError(asCommandError(error)?.message ?? "Unable to receive task updates.");
        }
      });
    void listenDisposableTaskCloseRequested(() => dispatch({ type: "closeRequested" }))
      .then((unlisten) => {
        unlistenClose = unlisten;
      })
      .catch(() => {
        if (!disposed) setSurfaceError("Unable to register task window controls.");
      });
    void announceDisposableTaskReady().catch(() => {
      if (!disposed) setSurfaceError("Unable to connect this task window to the manager.");
    });
    return () => {
      disposed = true;
      void unsubscribeUpdates?.();
      unlistenClose?.();
    };
  }, [state.job.jobId]);

  useEffect(() => {
    if (!isLiveDisposableTask(state)) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    void persistDiagnosticEvent({
      scope: "disposableTaskSurface",
      name: "phaseChanged",
      fields: { jobKind: state.job.kind, phase: state.phase, jobStatus: state.job.status },
    }).catch(() => {});
  }, [state.job.kind, state.job.status, state.phase]);

  useEffect(() => {
    if (state.phase !== "succeeded" && state.phase !== "cancelled") return;
    const timer = window.setTimeout(() => dispatch({ type: "autoCloseElapsed" }), AUTO_CLOSE_SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [state.phase]);

  useEffect(() => {
    if (state.phase === "closing") {
      void persistDiagnosticEvent({
        scope: "disposableTaskSurface",
        name: "closeRequested",
        fields: { jobKind: state.job.kind, jobStatus: state.job.status },
      }).catch(() => {}).finally(() => closeDisposableTaskWindow());
    }
  }, [state.phase]);

  const cancel = async () => {
    dispatch({ type: "cancelRequested" });
    try {
      await cancelJob({ jobId: state.job.jobId });
    } catch (error) {
      const commandError = asCommandError(error);
      void persistDiagnosticEvent({
        scope: "jobControl",
        name: "cancelFailed",
        fields: {
          jobId: state.job.jobId,
          errorCode: commandError?.code ?? "invokeFailed",
          errorMessage: commandError?.message ?? unknownErrorMessage(error, "cancel_job failed"),
        },
      }).catch(() => {});
      setSurfaceError(commandError?.message ?? unknownErrorMessage(error, "Unable to cancel the task."));
      dispatch({ type: "controlRejected" });
    }
  };

  const retry = async () => {
    if (retrying || replacementAccepted) return;
    setRetrying(true);
    setSurfaceError("");
    const result = await recovery.retryWithPassword(state.job);
    setRetrying(false);
    if (result === "started") {
      dispatch({ type: "continueInBackground" });
    } else if (result === "acceptedWithoutPresentation") {
      setReplacementAccepted(true);
    }
  };

  return <DisposableTaskView
    state={state}
    nowMs={nowMs}
    onCancel={() => { void cancel(); }}
    onClose={() => dispatch({ type: "closeRequested" })}
    onContinueInBackground={() => dispatch({ type: "continueInBackground" })}
    onKeepOpen={() => dispatch({ type: "keepOpen" })}
    onMinimize={() => { void minimizeDisposableTaskWindow(); }}
    onPause={() => { void pauseJob({ jobId: state.job.jobId }).catch(() => dispatch({ type: "controlRejected" })); }}
    onRetry={() => { void retry(); }}
    onResume={() => { void resumeJob({ jobId: state.job.jobId }).catch(() => dispatch({ type: "controlRejected" })); }}
    onRunOutputAction={(action, path) => {
      void requestDisposableTaskOutputAction({ action, path }).catch(() => {
        setSurfaceError("Unable to open the task output.");
      });
    }}
    retrying={retrying}
    retryDisabled={replacementAccepted}
    surfaceError={surfaceError}
  />;
}

function disposableTaskBootstrap(search: string): DisposableTaskBootstrap | null {
  const params = new URLSearchParams(search);
  const jobId = params.get("jobId")?.trim() ?? "";
  const kind = params.get("kind") as JobKind | null;
  const status = params.get("status") as JobStatus | null;
  const createdAt = params.get("createdAt")?.trim() ?? "";
  if (!jobId || !kind || !status || !createdAt) return null;
  const initialFailure =
    import.meta.env.DEV &&
    isLocalDevHost(true, globalThis.location?.hostname ?? "") &&
    params.get("fixture") === "long-task-error"
      ? longTaskErrorFixture(kind)
      : null;
  return { jobId, kind, status, createdAt, initialFailure };
}

function createInitialDisposableTaskState(
  bootstrap: DisposableTaskBootstrap,
): DisposableTaskState {
  const base = createDisposableTask({
    ...bootstrap,
    status: bootstrap.initialFailure ? "queued" : bootstrap.status,
  });
  if (!bootstrap.initialFailure) {
    return base;
  }

  return reduceDisposableTask(base, {
    type: "jobUpdated",
    snapshot: {
      ...base.job,
      revision: "1",
      status: "failed",
      updatedAt: bootstrap.createdAt,
      canPause: false,
      canResume: false,
      canCancel: false,
      canDismiss: true,
      latestFailure: bootstrap.initialFailure,
    },
  });
}

function longTaskErrorFixture(kind: JobKind): JobEventDto {
  return {
    eventType: "failed",
    jobKind: kind,
    code: "fixture_long_task_error",
    severity: "error",
    retryable: false,
    message: "Fixture error: the archive task failed after validation.",
    hint: `Diagnostic detail: ${"path component mismatch; archive metadata remained bounded; ".repeat(80)}`,
  };
}
