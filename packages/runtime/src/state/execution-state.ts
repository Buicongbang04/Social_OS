/**
 * Execution state machine, per docs/kernel/04_STATE_MACHINE.md.
 *
 * NOTE ON A DOC CONFLICT: docs/kernel/02_EXECUTION_MODEL.md lists 11 states and
 * allows `Running → Cancelled` directly. Doc 04 — the dedicated state-machine
 * spec — lists 14, routing cancellation through `Cancelling` so an in-flight
 * task gets a chance to stop gracefully. Doc 04 wins here, because a direct
 * jump would strand a running worker with no signal to unwind.
 */
export const EXECUTION_STATUSES = [
  "CREATED",
  "VALIDATING",
  "PLANNING",
  "READY",
  "SCHEDULED",
  "RUNNING",
  "WAITING",
  "PAUSED",
  "CANCELLING",
  "CANCELLED",
  "FAILED",
  "RETRYING",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/**
 * The docs give no explicit list of *forbidden* transitions, only the allowed
 * ones. Encoding the allowed set and denying everything else is the safer
 * reading: an unlisted transition is a bug, not a permission.
 */
const EXECUTION_TRANSITIONS: Readonly<
  Record<ExecutionStatus, readonly ExecutionStatus[]>
> = Object.freeze({
  CREATED: ["VALIDATING", "CANCELLING"],
  VALIDATING: ["PLANNING", "FAILED", "CANCELLING"],
  PLANNING: ["READY", "FAILED", "CANCELLING"],
  READY: ["SCHEDULED", "CANCELLING"],
  SCHEDULED: ["RUNNING", "CANCELLING"],
  RUNNING: ["WAITING", "PAUSED", "CANCELLING", "COMPLETED", "FAILED"],
  WAITING: ["RUNNING", "CANCELLING", "FAILED"],
  PAUSED: ["RUNNING", "CANCELLING"],
  CANCELLING: ["CANCELLED"],
  CANCELLED: ["ARCHIVED"],
  FAILED: ["RETRYING", "ARCHIVED"],
  // Cancellable too: an Execution waiting out a retry backoff is still
  // holding a slot, and a user must be able to stop it before it fires again.
  RETRYING: ["RUNNING", "FAILED", "CANCELLING"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
});

/** States from which an Execution can no longer make progress on its own. */
const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
]);

/** States in which the Execution is occupying runtime resources. */
const ACTIVE_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "SCHEDULED",
  "RUNNING",
  "WAITING",
  "RETRYING",
]);

export function canTransitionExecution(
  from: ExecutionStatus,
  to: ExecutionStatus,
): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to);
}

export function allowedExecutionTransitions(
  from: ExecutionStatus,
): readonly ExecutionStatus[] {
  return EXECUTION_TRANSITIONS[from];
}

export function isExecutionTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isExecutionActive(status: ExecutionStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/**
 * Cancellation is a request, not an immediate stop: the Execution enters
 * CANCELLING and only reaches CANCELLED once in-flight work has unwound
 * (docs/kernel/02_EXECUTION_MODEL.md — "Running → CancelRequested →
 * GracefulStop → Cancelled").
 */
export function canRequestCancellation(status: ExecutionStatus): boolean {
  return canTransitionExecution(status, "CANCELLING");
}
