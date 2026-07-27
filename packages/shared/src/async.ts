/** Pause execution for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryOptions = {
  attempts: number;
  delayMs: number;
  backoffFactor?: number;
};

/**
 * Retry an async operation with linear/exponential backoff.
 * Used by Worker/Gateway call sites per docs/kernel/14_ERROR_HANDLING.md's
 * retry-or-not-per-error-class policy — this helper only implements the
 * backoff loop, callers decide which errors are retryable.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { attempts, delayMs, backoffFactor = 1 } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs * Math.pow(backoffFactor, attempt - 1));
      }
    }
  }

  throw lastError;
}
