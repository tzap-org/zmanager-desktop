import { describe, expect, it, vi } from "vitest";

import {
  runAcceptNativeFileDrag,
  runStartNativeFileDrag,
} from "../api/commands";
import type {
  NativeFileDragAcceptanceResponse,
  NativeFileDragRequest,
  NativeFileDragResponse,
} from "../api/types";
import {
  acceptNativeFileDrag,
  listenNativeFileDragOutcomes,
  NATIVE_FILE_DRAG_OUTCOME_EVENT,
  startNativeFileDrag,
} from "./nativeDrag";

const listenMock = vi.hoisted(() => vi.fn());

vi.mock("../api/commands", () => ({
  runAcceptNativeFileDrag: vi.fn(),
  runStartNativeFileDrag: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

describe("desktop native drag adapter", () => {
  it("delegates native file drag starts to the API command", async () => {
    const request: NativeFileDragRequest = {
      archivePath: "C:\\archives\\sample.zip",
      entryPaths: ["docs/readme.txt"],
      stripComponents: 0,
    };
    const response: NativeFileDragResponse = {
      outcome: "dropped",
      sessionId: null,
      jobId: "job-1",
      draggedEntries: ["docs/readme.txt"],
    };
    vi.mocked(runStartNativeFileDrag).mockResolvedValue(response);

    const startRequest = { operationId: "native-drag-1", request };
    await expect(startNativeFileDrag(startRequest)).resolves.toBe(response);

    expect(runStartNativeFileDrag).toHaveBeenCalledTimes(1);
    expect(runStartNativeFileDrag).toHaveBeenCalledWith(startRequest);
  });

  it("delegates native drag acceptance before preparation", async () => {
    const request: NativeFileDragRequest = {
      archivePath: "C:\\archives\\sample.zip",
      entryPaths: ["docs/readme.txt"],
      stripComponents: 0,
    };
    const response: NativeFileDragAcceptanceResponse = {
      acceptedJob: {
        acceptanceRevision: "1",
        job: { jobId: "job-1", kind: "zipExtract", status: "queued", createdAt: "2026-01-01T00:00:00Z" },
        origin: "nativeDrag",
      },
      operationId: "native-drag-1",
    };
    vi.mocked(runAcceptNativeFileDrag).mockResolvedValue(response);

    await expect(acceptNativeFileDrag(request)).resolves.toBe(response);
    expect(runAcceptNativeFileDrag).toHaveBeenCalledWith(request);
  });

  it("propagates API command errors", async () => {
    const request: NativeFileDragRequest = {
      archivePath: "C:\\archives\\sample.zip",
      entryPaths: ["docs/readme.txt"],
      stripComponents: 0,
    };
    const error = new Error("drag failed");
    vi.mocked(runStartNativeFileDrag).mockRejectedValue(error);

    await expect(startNativeFileDrag({ operationId: "native-drag-1", request })).rejects.toBe(error);
  });

  it("listens for asynchronous native drag outcomes", async () => {
    const dispose = vi.fn();
    const listener = vi.fn();
    listenMock.mockResolvedValue(dispose);

    await expect(listenNativeFileDragOutcomes(listener)).resolves.toBe(dispose);
    expect(listenMock).toHaveBeenCalledWith(NATIVE_FILE_DRAG_OUTCOME_EVENT, listener);
  });
});
