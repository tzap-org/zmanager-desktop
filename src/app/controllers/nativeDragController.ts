import type {
  NativeFileDragPreparationResponse,
  NativeFileDragRequest,
  NativeFileDragResponse,
} from "../../api/types";

export type NativeDragControllerOptions = Readonly<{
  prepare(request: NativeFileDragRequest): Promise<NativeFileDragPreparationResponse>;
  handoffAcceptedJob(job: NativeFileDragPreparationResponse["job"]): Promise<void>;
  start(sessionId: string): Promise<NativeFileDragResponse>;
}>;

export type NativeDragController = Readonly<{
  start(request: NativeFileDragRequest): Promise<{
    preparation: NativeFileDragPreparationResponse;
    response: NativeFileDragResponse;
  }>;
}>;

/**
 * Native drag has a platform-specific second phase, but Job Handoff must
 * happen before that phase so the drag is represented by a Disposable Task.
 */
export function createNativeDragController(
  options: NativeDragControllerOptions,
): NativeDragController {
  return {
    async start(request) {
      const preparation = await options.prepare(request);
      await options.handoffAcceptedJob(preparation.job);
      const response = await options.start(preparation.sessionId);
      return { preparation, response };
    },
  };
}
