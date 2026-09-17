import { listen, type Event } from "@tauri-apps/api/event";

import {
  runAcceptNativeFileDrag,
  runStartNativeFileDrag,
} from "../api/commands";
import type {
  NativeFileDragAcceptanceResponse,
  NativeFileDragRequest,
  NativeFileDragResponse,
  StartNativeFileDragRequest,
} from "../api/types";

export async function acceptNativeFileDrag(
  request: NativeFileDragRequest,
): Promise<NativeFileDragAcceptanceResponse> {
  return runAcceptNativeFileDrag(request);
}

export async function startNativeFileDrag(
  request: StartNativeFileDragRequest,
): Promise<NativeFileDragResponse> {
  return runStartNativeFileDrag(request);
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
