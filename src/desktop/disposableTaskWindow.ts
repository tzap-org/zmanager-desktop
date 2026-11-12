import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitTo, listen, type Event } from "@tauri-apps/api/event";

import type { JobAvailableActionDto, StartJobResponseDto } from "../api/types";

export const DISPOSABLE_TASK_JOB_HANDOFF_EVENT = "zmanager-disposable-task-job-handoff";
export const DISPOSABLE_TASK_OUTPUT_ACTION_EVENT = "zmanager-disposable-task-output-action";

export type DisposableTaskOutputActionRequest = Readonly<{
  action: JobAvailableActionDto["kind"];
  jobId: string;
  actionId: string;
  artifactId: string;
  path: string;
}>;
export async function announceDisposableTaskReady(): Promise<void> {
  await getCurrentWebviewWindow().emit("zmanager-task-ready");
}

export async function listenDisposableTaskCloseRequested(
  listener: () => void,
): Promise<() => void> {
  return getCurrentWebviewWindow().onCloseRequested((event) => {
    event.preventDefault();
    listener();
  });
}

export async function closeDisposableTaskWindow(): Promise<void> {
  await getCurrentWebviewWindow().destroy();
}

export async function minimizeDisposableTaskWindow(): Promise<void> {
  await getCurrentWebviewWindow().minimize();
}

export async function requestDisposableTaskJobHandoff(
  job: StartJobResponseDto,
): Promise<void> {
  await emitTo("main", DISPOSABLE_TASK_JOB_HANDOFF_EVENT, job);
}

export function listenDisposableTaskJobHandoffs(
  listener: (job: StartJobResponseDto) => void,
): Promise<() => void> {
  return listen<StartJobResponseDto>(
    DISPOSABLE_TASK_JOB_HANDOFF_EVENT,
    (event: Event<StartJobResponseDto>) => listener(event.payload),
  );
}

export async function requestDisposableTaskOutputAction(
  request: DisposableTaskOutputActionRequest,
): Promise<void> {
  await emitTo("main", DISPOSABLE_TASK_OUTPUT_ACTION_EVENT, request);
}

export function listenDisposableTaskOutputActions(
  listener: (request: DisposableTaskOutputActionRequest) => void,
): Promise<() => void> {
  return listen<DisposableTaskOutputActionRequest>(
    DISPOSABLE_TASK_OUTPUT_ACTION_EVENT,
    (event: Event<DisposableTaskOutputActionRequest>) => listener(event.payload),
  );
}
