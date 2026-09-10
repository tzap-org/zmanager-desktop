export async function retryAsync<T>(
  operation: (attempt: number) => Promise<T>,
  attempts: number,
  delayMs: number,
): Promise<T> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Retry attempts must be a positive integer.");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Retry delay must be a non-negative number.");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Operation failed after retries.");
}
