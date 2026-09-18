import type { AcceptedJobEnvelopeDto } from "../../api/types";

export type NativeDragOutcome = Readonly<{
  jobId: string;
  outcome: "dropped" | "cancelled";
}>;

export type NativeDragHandoffController = Readonly<{
  defer(accepted: AcceptedJobEnvelopeDto): void;
  discard(jobId: string): void;
  settle(outcome: NativeDragOutcome): Promise<boolean | null>;
}>;

/**
 * Keeps native-drag jobs out of the task-window handoff path until the OS has
 * finished the drag. A cancelled drag has no task surface to present.
 */
export function createNativeDragHandoffController(
  present: (accepted: AcceptedJobEnvelopeDto) => Promise<boolean>,
): NativeDragHandoffController {
  const pending = new Map<string, AcceptedJobEnvelopeDto>();

  return Object.freeze({
    defer(accepted) {
      pending.set(accepted.job.jobId, accepted);
    },
    discard(jobId) {
      pending.delete(jobId);
    },
    async settle(outcome) {
      const accepted = pending.get(outcome.jobId);
      if (!accepted) return null;
      pending.delete(outcome.jobId);
      if (outcome.outcome === "cancelled") return true;
      return present(accepted);
    },
  });
}
