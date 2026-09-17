import { describe, expect, it, vi } from "vitest";

import type { StartJobResponseDto } from "../../api/types";
import { createJobHandoffController } from "./jobHandoffController";

const job: StartJobResponseDto = {
  jobId: "job-1",
  kind: "zipCreate",
  status: "queued",
  createdAt: "2026-07-29T00:00:00.000Z",
};

describe("job handoff controller", () => {
  it("records, resets, and presents one accepted job exactly once", async () => {
    const recordAccepted = vi.fn();
    const resetSubmittedState = vi.fn();
    const presentTaskWindow = vi.fn(async () => {});
    const reportPresentationFailure = vi.fn();
    const controller = createJobHandoffController({
      recordAccepted,
      presentTaskWindow,
      reportPresentationFailure,
    });

    await controller.handoffAcceptedJob(job, { resetSubmittedState });

    expect(recordAccepted).toHaveBeenCalledOnce();
    expect(recordAccepted).toHaveBeenCalledWith(job);
    expect(resetSubmittedState).toHaveBeenCalledOnce();
    expect(presentTaskWindow).toHaveBeenCalledOnce();
    expect(presentTaskWindow).toHaveBeenCalledWith(job);
    expect(reportPresentationFailure).not.toHaveBeenCalled();
  });

  it("keeps accepted work accepted when task presentation fails", async () => {
    const failure = new Error("window unavailable");
    const resetSubmittedState = vi.fn();
    const reportPresentationFailure = vi.fn();
    const controller = createJobHandoffController({
      recordAccepted: vi.fn(),
      presentTaskWindow: vi.fn(async () => {
        throw failure;
      }),
      reportPresentationFailure,
    });

    await expect(controller.handoffAcceptedJob(job, {
      resetSubmittedState,
    })).resolves.toBe(false);

    expect(resetSubmittedState).toHaveBeenCalledOnce();
    expect(reportPresentationFailure).toHaveBeenCalledWith(job, failure);
  });

  it("claims concurrent accepted deliveries once and acknowledges after presentation", async () => {
    let resolvePresentation!: () => void;
    const presentTaskWindow = vi.fn(() => new Promise<void>((resolve) => { resolvePresentation = resolve; }));
    const acknowledgeAcceptedJob = vi.fn(async () => {});
    const controller = createJobHandoffController({
      recordAccepted: vi.fn(),
      presentTaskWindow,
      acknowledgeAcceptedJob,
      reportPresentationFailure: vi.fn(),
    });
    const accepted = { acceptanceRevision: "7", job, origin: "nativeDrag" as const };

    const first = controller.handoffAcceptedJob(accepted);
    const second = controller.handoffAcceptedJob(accepted);
    expect(presentTaskWindow).toHaveBeenCalledOnce();
    resolvePresentation();
    await Promise.all([first, second]);

    expect(acknowledgeAcceptedJob).toHaveBeenCalledOnce();
    expect(acknowledgeAcceptedJob).toHaveBeenCalledWith(accepted);
  });

  it("treats the synchronous response and accepted-feed envelope as one delivery", async () => {
    const presentTaskWindow = vi.fn(async () => {});
    const acknowledgeAcceptedJob = vi.fn(async () => {});
    const controller = createJobHandoffController({
      recordAccepted: vi.fn(),
      presentTaskWindow,
      acknowledgeAcceptedJob,
      reportPresentationFailure: vi.fn(),
    });
    const accepted = { acceptanceRevision: "8", job, origin: "mainWindow" as const };

    await controller.handoffAcceptedJob(job);
    await controller.handoffAcceptedJob(accepted);

    expect(presentTaskWindow).toHaveBeenCalledOnce();
    expect(acknowledgeAcceptedJob).toHaveBeenCalledOnce();
  });
});
