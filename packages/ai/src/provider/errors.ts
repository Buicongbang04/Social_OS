import { RuntimeError } from "@repo/runtime";
import type { StreamFailure } from "./types";
import { APICallError } from "ai";
import type { ProviderName } from "./types";
import type { ProviderStatus } from "./registry";

/**
 * What went wrong, in terms the Gateway can act on.
 *
 * `retryable` answers "will the same call to the same provider plausibly work
 * in a moment"; `demoteTo` answers "what should the registry now believe about
 * this provider". They are different questions: a 429 is retryable *and*
 * demotes to RATE_LIMITED, while a 400 is neither.
 */
export type ProviderFailure = {
  retryable: boolean;
  demoteTo: ProviderStatus | null;
  statusCode: number | undefined;
  message: string;
};

/**
 * Classify a thrown provider error.
 *
 * We defer to the AI SDK's own `isRetryable` (set from HTTP semantics: 408,
 * 409, 429 and 5xx) rather than re-deriving it, and only add the status
 * mapping the SDK does not express. An abort is treated as retryable because
 * the only aborts we issue are our own timeouts.
 */
export function classifyFailure(error: unknown): ProviderFailure {
  if (APICallError.isInstance(error)) {
    return {
      retryable: error.isRetryable,
      demoteTo: demotionFor(error.statusCode),
      statusCode: error.statusCode,
      message: error.message,
    };
  }

  if (isAbort(error)) {
    return {
      retryable: true,
      demoteTo: "UNAVAILABLE",
      statusCode: undefined,
      message: "The provider did not answer before the configured timeout.",
    };
  }

  // Unclassified: could be a transport fault or a bug in our own mapping.
  // Neither is worth retrying blind — a retry that repeats a side effect is
  // more expensive than a failed request (docs/kernel/14_ERROR_HANDLING.md).
  return {
    retryable: false,
    demoteTo: null,
    statusCode: undefined,
    message: error instanceof Error ? error.message : String(error),
  };
}

function demotionFor(statusCode: number | undefined): ProviderStatus | null {
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode !== undefined && statusCode >= 500) return "UNAVAILABLE";
  return null;
}

function isAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

/**
 * Should the Gateway try the *next* provider?
 *
 * Only when the failure is transient. A malformed request, an unknown model or
 * a rejected API key fails identically everywhere, so falling back would just
 * multiply one user-visible error into four — and, where the fallback provider
 * does accept it, silently bill a different vendor for a request we already
 * know is wrong.
 */
export function isWorthFallingBackFrom(failure: ProviderFailure): boolean {
  return failure.retryable;
}

/** Wrap a provider failure as the Runtime's classified error type. */
export function toRuntimeError(
  failure: ProviderFailure,
  context: {
    provider: ProviderName;
    model: string;
    attempted: readonly ProviderName[];
  },
  cause?: unknown,
): RuntimeError {
  return new RuntimeError(
    "PROVIDER",
    `${context.provider} (${context.model}) failed: ${failure.message}`,
    {
      // PROVIDER defaults to retryable; say so explicitly, because by the time
      // the Gateway throws it has already exhausted its own retries and the
      // whole fallback chain. Re-running the task is the caller's decision.
      retryable: failure.retryable,
      context: {
        provider: context.provider,
        model: context.model,
        attemptedProviders: [...context.attempted],
        statusCode: failure.statusCode,
      },
      cause,
    },
  );
}

/**
 * A stream that failed after the caller had already been given part of it.
 *
 * A RuntimeError subclass rather than a plain Error so the Runtime's retry
 * classification still applies, but retryable is forced to false: retrying
 * means replaying the answer from the start on top of text the reader already
 * has, and nothing downstream can splice those together.
 *
 * `partial` exists because two things are true at once — the answer is
 * unusable, and the vendor billed for the tokens behind it. Throwing without
 * it would make a workspace's bill quietly understate what it spent.
 */
export class ProviderStreamError extends RuntimeError {
  readonly partial: StreamFailure;

  constructor(
    message: string,
    partial: StreamFailure,
    context: {
      provider: ProviderName;
      model: string;
      attempted: readonly ProviderName[];
    },
    cause?: unknown,
  ) {
    super("PROVIDER", message, {
      retryable: false,
      context: {
        provider: context.provider,
        model: context.model,
        attemptedProviders: [...context.attempted],
        charactersDelivered: partial.textSoFar.length,
      },
      cause,
    });
    this.name = "ProviderStreamError";
    this.partial = partial;
  }
}
