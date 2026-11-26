import type { AcceptedJobEnvelopeDto, StartJobResponseDto } from "../../api/types";

export type JobHandoffControllerOptions = Readonly<{
  recordAccepted(job: StartJobResponseDto): void;
  presentTaskWindow(job: StartJobResponseDto): Promise<void>;
  acknowledgeAcceptedJob?(accepted: AcceptedJobEnvelopeDto): Promise<void>;
  reportPresentationFailure(job: StartJobResponseDto, error: unknown): void;
}>;

export type JobHandoffOptions = Readonly<{
  resetSubmittedState?: () => void;
}>;

export type JobHandoffController = Readonly<{
  handoffAcceptedJob(
    accepted: StartJobResponseDto | AcceptedJobEnvelopeDto,
    options?: JobHandoffOptions,
  ): Promise<boolean>;
}>;

/**
 * One-way ownership transfer after the backend has accepted a Job.
 * Presentation failure is reported, but never turns into another start request.
 */
export function createJobHandoffController(
  options: JobHandoffControllerOptions,
): JobHandoffController {
  const presentations = new Map<string, Promise<void>>();
  const deliveredJobs = new Set<string>();
  const resetJobs = new Set<string>();
  const acknowledgedRevisions = new Set<string>();

  const acknowledge = async (acceptedEnvelope: AcceptedJobEnvelopeDto): Promise<void> => {
    const key = `${acceptedEnvelope.job.jobId}:${acceptedEnvelope.acceptanceRevision}`;
    if (acknowledgedRevisions.has(key)) return;
    acknowledgedRevisions.add(key);
    try {
      await options.acknowledgeAcceptedJob?.(acceptedEnvelope);
    } catch (error) {
      acknowledgedRevisions.delete(key);
      throw error;
    }
  };

  return Object.freeze({
    async handoffAcceptedJob(accepted, handoffOptions = {}) {
      const envelope = isAcceptedJobEnvelope(accepted)
        ? accepted
        : { acceptanceRevision: "0", job: accepted, origin: "mainWindow" as const };
      const job = envelope.job;
      function resetSubmission() {
        if (!handoffOptions.resetSubmittedState || resetJobs.has(job.jobId)) return;
        resetJobs.add(job.jobId);
        handoffOptions.resetSubmittedState();
      }
      try {
        if (!deliveredJobs.has(job.jobId)) {
          let presentation = presentations.get(job.jobId);
          if (!presentation) {
            presentation = (async () => {
              try {
                options.recordAccepted(job);
                resetSubmission();
                await options.presentTaskWindow(job);
                deliveredJobs.add(job.jobId);
              } catch (error) {
                options.reportPresentationFailure(job, error);
                throw error;
              }
            })();
            presentations.set(job.jobId, presentation);
            void presentation.finally(() => presentations.delete(job.jobId)).catch(() => {});
          } else {
            resetSubmission();
          }
          await presentation;
        } else {
          resetSubmission();
        }
        if (envelope.acceptanceRevision !== "0") {
          await acknowledge(envelope);
        }
        return true;
      } catch {
        // Presentation failures are reported as degraded accepted Jobs. The
        // rejected promise is intentionally absorbed so a feed callback never
        // becomes an unhandled rejection or resubmits the operation.
        return false;
      }
    },
  });
}

function isAcceptedJobEnvelope(value: StartJobResponseDto | AcceptedJobEnvelopeDto): value is AcceptedJobEnvelopeDto {
  return "job" in value;
}
