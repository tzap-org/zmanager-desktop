import { listen, type Event } from "@tauri-apps/api/event";

import {
  runPrepareNativeFileDrag,
  runStartNativeFileDrag,
  finishNativeFileDrag,
} from "../api/commands";
import type {
  NativeFileDragPreparationResponse,
  NativeFileDragFinishRequest,
  NativeFileDragRequest,
  NativeFileDragResponse,
  NativeFileDragStartRequest,
} from "../api/types";

export async function prepareNativeFileDrag(
  request: NativeFileDragRequest,
): Promise<NativeFileDragPreparationResponse> {
  return runPrepareNativeFileDrag(request);
}

export async function startNativeFileDrag(
  request: NativeFileDragStartRequest,
): Promise<NativeFileDragResponse> {
  return runStartNativeFileDrag(request);
}

export async function finishNativeDrag(
  request: NativeFileDragFinishRequest,
): Promise<void> {
  return finishNativeFileDrag(request);
}

export const NATIVE_FILE_DRAG_OUTCOME_EVENT = "native-file-drag-outcome";

export type NativeFileDragOutcomeEvent = {
  sessionId: string;
  outcome: "dropped" | "cancelled";
};

export function listenNativeFileDragOutcomes(
  listener: (event: Event<NativeFileDragOutcomeEvent>) => void,
): Promise<() => void> {
  return listen<NativeFileDragOutcomeEvent>(NATIVE_FILE_DRAG_OUTCOME_EVENT, listener);
}
