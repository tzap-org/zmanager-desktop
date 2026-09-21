import { describe, expect, it, vi } from "vitest";

import type { AcceptedJobEnvelopeDto } from "../../api/types";
import { createNativeDragHandoffController } from "./nativeDragHandoffController";

function accepted(jobId = "job-1"): AcceptedJobEnvelopeDto {
  return {
    acceptanceRevision: "0",
    job: { jobId, kind: "zipExtract", status: "queued", createdAt: "2026-01-01T00:00:00Z" },
    origin: "nativeDrag",
  };
}

describe("native drag handoff controller", () => {
  it("presents the task before entering the native drag loop", async () => {
    const calls: string[] = [];
    const present = vi.fn(async () => {
      calls.push("present");
      return true;
    });
    const beginNativeDrag = vi.fn(async () => {
      calls.push("drag");
      return { outcome: "dropped" as const };
    });
    const controller = createNativeDragHandoffController(present);

    await expect(controller.start(accepted(), beginNativeDrag)).resolves.toEqual({
      presented: true,
      response: { outcome: "dropped" },
    });
    expect(calls).toEqual(["present", "drag"]);
    expect(present).toHaveBeenCalledWith(accepted());
  });

  it("still starts the native drag when task-window presentation degrades", async () => {
    const present = vi.fn(async () => false);
    const beginNativeDrag = vi.fn(async () => ({ outcome: "cancelled" as const }));
    const controller = createNativeDragHandoffController(present);

    await expect(controller.start(accepted(), beginNativeDrag)).resolves.toEqual({
      presented: false,
      response: { outcome: "cancelled" },
    });
    expect(beginNativeDrag).toHaveBeenCalledOnce();
  });
});
