import { describe, expect, it, vi } from "vitest";

import type { NativeFileDragRequest } from "../../api/types";
import { createNativeDragController } from "./nativeDragController";

const request: NativeFileDragRequest = {
  archivePath: "C:/archives/demo.zip",
  entryPaths: ["docs/readme.txt"],
  stripComponents: 0,
};

describe("native drag controller", () => {
  it("hands the accepted drag Job to the Disposable Task before starting OS drag", async () => {
    const order: string[] = [];
    const preparation = {
      sessionId: "prepared-drag-1",
      job: {
        jobId: "job-1",
        kind: "zipExtract" as const,
        status: "queued" as const,
        createdAt: "2026-01-01T00:00:00Z",
      },
      draggedEntries: ["docs/readme.txt"],
    };
    const response = {
      outcome: "dropped" as const,
      sessionId: null,
      jobId: "job-1",
      draggedEntries: [],
    };
    const controller = createNativeDragController({
      prepare: vi.fn(async () => {
        order.push("prepare");
        return preparation;
      }),
      handoffAcceptedJob: vi.fn(async () => {
        order.push("handoff");
      }),
      start: vi.fn(async () => {
        order.push("start");
        return response;
      }),
    });

    await expect(controller.start(request)).resolves.toEqual({ preparation, response });
    expect(order).toEqual(["prepare", "handoff", "start"]);
  });
});
