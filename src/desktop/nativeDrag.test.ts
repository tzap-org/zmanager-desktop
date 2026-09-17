import { describe, expect, it, vi } from "vitest";

import {
  runPrepareNativeFileDrag,
  runStartNativeFileDrag,
} from "../api/commands";
import type {
  NativeFileDragPreparationResponse,
  NativeFileDragRequest,
  NativeFileDragResponse,
} from "../api/types";
import {
  listenNativeFileDragOutcomes,
  NATIVE_FILE_DRAG_OUTCOME_EVENT,
  prepareNativeFileDrag,
  startNativeFileDrag,
} from "./nativeDrag";

const listenMock = vi.hoisted(() => vi.fn());

vi.mock("../api/commands", () => ({
  runPrepareNativeFileDrag: vi.fn(),
  runStartNativeFileDrag: vi.fn(),
  finishNativeFileDrag: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

describe("desktop native drag adapter", () => {
  it("delegates native file drag starts to the API command", async () => {
    const request = { sessionId: "prepared-drag-1" };
    const response: NativeFileDragResponse = {
      outcome: "dropped",
      sessionId: null,
      jobId: "job-1",
      draggedEntries: [],
    };
    vi.mocked(runStartNativeFileDrag).mockResolvedValue(response);

    await expect(startNativeFileDrag(request)).resolves.toBe(response);

    expect(runStartNativeFileDrag).toHaveBeenCalledTimes(1);
    expect(runStartNativeFileDrag).toHaveBeenCalledWith(request);
  });

  it("delegates native file drag preparation to the API command", async () => {
    const request: NativeFileDragRequest = {
      archivePath: "C:\\archives\\sample.zip",
      entryPaths: ["docs/readme.txt"],
      password: "secret",
      stripComponents: 0,
    };
    const response: NativeFileDragPreparationResponse = {
      sessionId: "prepared-drag-1",
      job: {
        jobId: "job-1",
        kind: "zipExtract",
        status: "queued",
        createdAt: "2026-01-01T00:00:00Z",
      },
      draggedEntries: ["docs/readme.txt"],
    };
    vi.mocked(runPrepareNativeFileDrag).mockResolvedValue(response);

    await expect(prepareNativeFileDrag(request)).resolves.toBe(response);

    expect(runPrepareNativeFileDrag).toHaveBeenCalledTimes(1);
    expect(runPrepareNativeFileDrag).toHaveBeenCalledWith(request);
  });

  it("propagates API command errors", async () => {
    const request = { sessionId: "prepared-drag-1" };
    const error = new Error("drag failed");
    vi.mocked(runStartNativeFileDrag).mockRejectedValue(error);

    await expect(startNativeFileDrag(request)).rejects.toBe(error);
  });

  it("listens for asynchronous native drag outcomes", async () => {
    const dispose = vi.fn();
    const listener = vi.fn();
    listenMock.mockResolvedValue(dispose);

    await expect(listenNativeFileDragOutcomes(listener)).resolves.toBe(dispose);
    expect(listenMock).toHaveBeenCalledWith(NATIVE_FILE_DRAG_OUTCOME_EVENT, listener);
  });
});
