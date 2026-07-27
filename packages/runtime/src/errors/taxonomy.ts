/**
 * Runtime error taxonomy, per docs/kernel/14_ERROR_HANDLING.md.
 *
 * The point of classifying an error is to answer one question mechanically:
 * should the runtime try again? Retrying a permission denial burns quota and
 * never succeeds; not retrying a network blip throws away work that would
 * have completed.
 */
export const RUNTIME_ERROR_CLASSES = [
  "VALIDATION",
  "PLANNING",
  "EXECUTION",
  "WORKER",
  "PROVIDER",
  "NETWORK",
  "PLUGIN",
  "MCP",
  "CONNECTOR",
  "POLICY",
  "RESOURCE",
  "MEMORY",
  "SECURITY",
  "INTERNAL",
] as const;
export type RuntimeErrorClass = (typeof RUNTIME_ERROR_CLASSES)[number];

export const ERROR_SEVERITIES = [
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL",
  "FATAL",
] as const;
export type ErrorSeverity = (typeof ERROR_SEVERITIES)[number];

/**
 * NEVER  — retrying cannot change the outcome (bad input, denied permission).
 * ALWAYS — transient by nature (network, worker crash, resource contention).
 * MAYBE  — depends on the specific failure; the caller inspects `retryable`
 *          on the error itself, and we default to NOT retrying, because a
 *          wrong retry on a side-effecting call can double-post.
 */
export type RetryDisposition = "NEVER" | "ALWAYS" | "MAYBE";

const RETRY_DISPOSITION: Readonly<Record<RuntimeErrorClass, RetryDisposition>> =
  Object.freeze({
    VALIDATION: "NEVER", // Missing Goal, Invalid Input, Invalid Schedule
    PLANNING: "MAYBE", // Intent Resolution Failed, Capability Not Found
    EXECUTION: "MAYBE",
    WORKER: "ALWAYS", // Worker Crash, Worker Timeout, Out of Memory
    PROVIDER: "ALWAYS", // Claude Timeout, GPT Rate Limited — plus provider fallback
    NETWORK: "ALWAYS", // DNS Error, HTTP Timeout, TLS Error
    PLUGIN: "NEVER", // A crashing plugin is isolated, not retried
    MCP: "MAYBE",
    CONNECTOR: "MAYBE", // Facebook/YouTube/Telegram API errors vary
    POLICY: "NEVER", // Permission Denied, Budget Exceeded, Approval Required
    RESOURCE: "ALWAYS", // No Worker Available, Queue Full
    MEMORY: "MAYBE",
    SECURITY: "NEVER",
    INTERNAL: "MAYBE",
  });

const SEVERITY: Readonly<Record<RuntimeErrorClass, ErrorSeverity>> =
  Object.freeze({
    VALIDATION: "WARNING",
    PLANNING: "ERROR",
    EXECUTION: "ERROR",
    WORKER: "ERROR",
    PROVIDER: "ERROR",
    NETWORK: "WARNING",
    PLUGIN: "WARNING",
    MCP: "WARNING",
    CONNECTOR: "ERROR",
    POLICY: "WARNING",
    RESOURCE: "CRITICAL",
    MEMORY: "ERROR",
    SECURITY: "CRITICAL",
    INTERNAL: "CRITICAL",
  });

/**
 * A classified runtime failure.
 *
 * `retryable` lets a MAYBE-class error state its own verdict — e.g. a
 * connector returning 429 is retryable while the same connector rejecting a
 * malformed post is not.
 */
export class RuntimeError extends Error {
  readonly errorClass: RuntimeErrorClass;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    errorClass: RuntimeErrorClass,
    message: string,
    options: {
      retryable?: boolean;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "RuntimeError";
    this.errorClass = errorClass;
    this.severity = SEVERITY[errorClass];
    this.retryable = options.retryable ?? defaultRetryable(errorClass);
    this.context = Object.freeze({ ...options.context });
  }
}

function defaultRetryable(errorClass: RuntimeErrorClass): boolean {
  // MAYBE defaults to false: silently retrying an ambiguous failure is how a
  // single request becomes three published posts.
  return RETRY_DISPOSITION[errorClass] === "ALWAYS";
}

export function retryDispositionOf(
  errorClass: RuntimeErrorClass,
): RetryDisposition {
  return RETRY_DISPOSITION[errorClass];
}

export function severityOf(errorClass: RuntimeErrorClass): ErrorSeverity {
  return SEVERITY[errorClass];
}

/**
 * Should this failure be retried? Unknown (non-RuntimeError) throws are treated
 * as INTERNAL and not retried — we cannot reason about a failure we did not
 * classify, and guessing risks repeating a side effect.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof RuntimeError ? error.retryable : false;
}

export function classify(error: unknown): RuntimeErrorClass {
  return error instanceof RuntimeError ? error.errorClass : "INTERNAL";
}
