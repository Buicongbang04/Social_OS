/**
 * Task state machine, per docs/kernel/04_STATE_MACHINE.md.
 *
 * SUCCESS and COMPLETED are deliberately distinct, as the doc specifies:
 * SUCCESS means the worker returned a result, COMPLETED means that result has
 * been persisted. Collapsing them would lose the window where a worker
 * finished but the runtime crashed before writing — exactly the case recovery
 * has to reason about.
 */
export const TASK_STATUSES = [
  "PENDING",
  "READY",
  "RUNNING",
  "WAITING",
  "SUCCESS",
  "FAILED",
  "RETRY",
  "COMPLETED",
  "CANCELLED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> =
  Object.freeze({
    // PENDING → READY only once every dependency is COMPLETED (see isTaskDispatchable).
    PENDING: ["READY", "CANCELLED"],
    READY: ["RUNNING", "CANCELLED"],
    RUNNING: ["WAITING", "SUCCESS", "FAILED", "CANCELLED"],
    WAITING: ["RUNNING", "FAILED", "CANCELLED"],
    SUCCESS: ["COMPLETED"],
    FAILED: ["RETRY"],
    RETRY: ["RUNNING", "FAILED"],
    COMPLETED: [],
    CANCELLED: [],
  });

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "COMPLETED",
  "CANCELLED",
]);

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function allowedTaskTransitions(
  from: TaskStatus,
): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * A Task may only enter the Ready Queue when ALL of its dependencies have
 * reached COMPLETED — not merely SUCCESS (docs/kernel/10_RUNTIME_SCHEDULER.md).
 * Depending on SUCCESS would let a downstream task read an output that was
 * never durably written.
 */
export function areDependenciesSatisfied(
  dependencyStatuses: readonly TaskStatus[],
): boolean {
  return dependencyStatuses.every((status) => status === "COMPLETED");
}
