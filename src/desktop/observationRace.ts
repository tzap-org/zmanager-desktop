export type ObservationAttempt<T> = (signal: AbortSignal) => Promise<T | null>;

/**
 * Resolve with the first successful observation while cancelling slower
 * observers. A null result is a failed attempt, not a successful observation.
 */
export function raceFirstObservation<T>(attempts: readonly ObservationAttempt<T>[]): Promise<T> {
  if (attempts.length === 0) {
    return Promise.reject(new Error("At least one observation attempt is required."));
  }

  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const failures: unknown[] = [];
    let pending = attempts.length;
    let settled = false;

    const fail = (error: unknown): void => {
      failures.push(error);
      pending -= 1;
      if (pending === 0 && !settled) {
        settled = true;
        controller.abort();
        reject(new AggregateError(failures, "No browser observer reported a navigation."));
      }
    };

    for (const attempt of attempts) {
      Promise.resolve()
        .then(() => attempt(controller.signal))
        .then((result) => {
          if (result === null) {
            fail(new Error("Browser observer did not report a navigation."));
            return;
          }
          if (settled) return;
          settled = true;
          controller.abort();
          resolve(result);
        }, fail);
    }
  });
}
