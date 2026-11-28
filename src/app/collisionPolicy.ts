import type { StartCreateRequest } from "../api/types";
import type { ExtractOverwritePolicy } from "./extractFlow";

export type CollisionPolicyContext = Readonly<{
  isDisposableTask?: boolean;
  isQuickAction?: boolean;
  replaceExisting?: boolean;
  overwrite?: ExtractOverwritePolicy;
  destinationCollisionStrategy?: StartCreateRequest["destinationCollisionStrategy"];
}>;

/**
 * Centralized resolution of destination collision strategy for extract and create operations.
 *
 * Rules:
 * 1. If an explicit `destinationCollisionStrategy` is provided, honor it.
 * 2. If replacement is explicitly selected (`replaceExisting: true` or `overwrite: "replace"`),
 *    do not apply auto-renaming so exact destination paths are overwritten.
 * 3. If running inside a disposable task window or triggered via a Quick Action, and replacement
 *    was NOT selected, default to `"rename"` so background/disposable jobs do not fail on collisions.
 * 4. Otherwise, fallback based on overwrite policy or omit.
 */
export function resolveDestinationCollisionStrategy(
  context: CollisionPolicyContext,
): StartCreateRequest["destinationCollisionStrategy"] {
  if (context.destinationCollisionStrategy) {
    return context.destinationCollisionStrategy;
  }

  if (context.replaceExisting === true || context.overwrite === "replace") {
    return undefined;
  }

  if (context.replaceExisting === false && (context.isDisposableTask || context.isQuickAction)) {
    return "rename";
  }

  return undefined;
}
