import type { StartCreateRequest } from "../api/types";

export type CollisionPolicyContext = Readonly<{
  isDisposableTask?: boolean;
  isQuickAction?: boolean;
  replaceExisting?: boolean;
  destinationCollisionStrategy?: StartCreateRequest["destinationCollisionStrategy"];
}>;

/**
 * Resolves destination collision strategy for archive creation.
 *
 * Rules:
 * 1. If an explicit `destinationCollisionStrategy` is provided, honor it.
 * 2. If replacement is explicitly selected (`replaceExisting: true`), do not apply
 *    auto-renaming so the exact destination path is used.
 * 3. If running inside a disposable task window or triggered via a Quick Action, and replacement
 *    was NOT selected, default to `"rename"` so background/disposable jobs do not fail on collisions.
 * 4. Otherwise, omit the strategy.
 */
export function resolveDestinationCollisionStrategy(
  context: CollisionPolicyContext,
): StartCreateRequest["destinationCollisionStrategy"] {
  if (context.destinationCollisionStrategy) {
    return context.destinationCollisionStrategy;
  }

  if (context.replaceExisting === true) {
    return undefined;
  }

  if (context.replaceExisting === false && (context.isDisposableTask || context.isQuickAction)) {
    return "rename";
  }

  return undefined;
}
