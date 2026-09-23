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
  it("presents the task when the native destination requests the payload", async () => {
    const calls: string[] = [];
    const present = vi.fn(async () => {
      calls.push("present");
      return true;
    });
    let destinationAccepted: (() => void) | null = null;
    const listenForDestination = vi.fn(async (_jobId: string, listener: () => void) => {
      destinationAccepted = listener;
      return async () => {
        calls.push("unlisten");
      };
    });
    const beginNativeDrag = vi.fn(async () => {
      calls.push("drag");
      destinationAccepted?.();
      return { outcome: "dropped" as const };
    });
    const controller = createNativeDragHandoffController(present, listenForDestination);

    await expect(controller.start(accepted(), beginNativeDrag)).resolves.toEqual({
      presented: true,
      response: { outcome: "dropped" },
    });
    expect(calls).toEqual(["drag", "present", "unlisten"]);
    expect(listenForDestination).toHaveBeenCalledWith("job-1", expect.any(Function));
    expect(present).toHaveBeenCalledWith(accepted());
  });

  it("does not present a task window when no destination is accepted", async () => {
    const present = vi.fn(async () => false);
    const listenForDestination = vi.fn(async () => async () => {});
    const beginNativeDrag = vi.fn(async () => ({ outcome: "cancelled" as const }));
    const controller = createNativeDragHandoffController(present, listenForDestination);

    await expect(controller.start(accepted(), beginNativeDrag)).resolves.toEqual({
      presented: false,
      response: { outcome: "cancelled" },
    });
    expect(beginNativeDrag).toHaveBeenCalledOnce();
    expect(present).not.toHaveBeenCalled();
  });
});
