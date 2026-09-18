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
  it("does not present a task until the drop settles", async () => {
    const present = vi.fn(async () => true);
    const controller = createNativeDragHandoffController(present);

    controller.defer(accepted());
    expect(present).not.toHaveBeenCalled();

    await controller.settle({ jobId: "job-1", outcome: "dropped" });
    expect(present).toHaveBeenCalledWith(accepted());
  });

  it("does not present a task for a cancelled drag", async () => {
    const present = vi.fn(async () => true);
    const controller = createNativeDragHandoffController(present);

    controller.defer(accepted());
    await expect(controller.settle({ jobId: "job-1", outcome: "cancelled" })).resolves.toBe(true);
    expect(present).not.toHaveBeenCalled();
  });

  it("settles each native drag at most once", async () => {
    const present = vi.fn(async () => true);
    const controller = createNativeDragHandoffController(present);

    controller.defer(accepted());
    await controller.settle({ jobId: "job-1", outcome: "dropped" });
    await expect(controller.settle({ jobId: "job-1", outcome: "dropped" })).resolves.toBeNull();
    expect(present).toHaveBeenCalledTimes(1);
  });
});
