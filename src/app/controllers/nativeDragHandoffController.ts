import type { AcceptedJobEnvelopeDto } from "../../api/types";

export type NativeDragHandoffController = Readonly<{
  start<TResult>(
    accepted: AcceptedJobEnvelopeDto,
    beginNativeDrag: () => Promise<TResult>,
  ): Promise<Readonly<{ presented: boolean; response: TResult }>>;
}>;

/**
 * Transfers the accepted native-drag Job to its disposable task window before
 * entering the platform drag loop. Windows' DoDragDrop call is modal, so
 * presenting afterwards would leave the user with a frozen-looking main window
 * and no visible Job surface while Explorer materializes the files.
 */
export function createNativeDragHandoffController(
  present: (accepted: AcceptedJobEnvelopeDto) => Promise<boolean>,
): NativeDragHandoffController {
  return Object.freeze({
    async start(accepted, beginNativeDrag) {
      const presented = await present(accepted);
      const response = await beginNativeDrag();
      return { presented, response };
    },
  });
}
