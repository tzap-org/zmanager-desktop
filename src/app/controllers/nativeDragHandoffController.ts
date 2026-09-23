import type { AcceptedJobEnvelopeDto } from "../../api/types";

export type NativeDragHandoffController = Readonly<{
  start<TResult>(
    accepted: AcceptedJobEnvelopeDto,
    beginNativeDrag: () => Promise<TResult>,
  ): Promise<Readonly<{ presented: boolean; response: TResult }>>;
}>;

export type ListenForNativeDragDestination = (
  jobId: string,
  listener: () => void,
) => Promise<() => void>;

/**
 * Transfers the accepted native-drag Job to its disposable task window only
 * after the native destination has requested the payload. Windows' drag loop
 * must remain visible before that point, while the task window owns extraction
 * progress once the destination starts materializing files.
 */
export function createNativeDragHandoffController(
  present: (accepted: AcceptedJobEnvelopeDto) => Promise<boolean>,
  listenForDestination: ListenForNativeDragDestination,
): NativeDragHandoffController {
  return Object.freeze({
    async start(accepted, beginNativeDrag) {
      let presentation: Promise<boolean> | null = null;
      const onDestination = (): void => {
        presentation ??= present(accepted).catch(() => false);
      };
      const unlisten = await listenForDestination(accepted.job.jobId, onDestination);
      try {
        const response = await beginNativeDrag();
        const presented = presentation ? await presentation : false;
        return { presented, response };
      } finally {
        await unlisten();
      }
    },
  });
}
