import type { ExecutionId, Metadata, TaskId, WorkerId } from "@repo/core";
import type { TaskStatus } from "../state/task-state";

export const TASK_PRIORITIES = [
  "CRITICAL",
  "HIGH",
  "NORMAL",
  "LOW",
  "BACKGROUND",
] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Retry policy, per docs/kernel/14_ERROR_HANDLING.md
 * (`max_attempts: 3`, `backoff: exponential`, `max_delay: 60s`).
 */
export type RetryPolicy = {
  maxAttempts: number;
  backoff: "FIXED" | "EXPONENTIAL";
  initialDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxAttempts: 3,
  backoff: "EXPONENTIAL",
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
});

/**
 * Default task timeout.
 *
 * NOTE ON A DOC CONFLICT: 04_STATE_MACHINE.md says 60s, 02_EXECUTION_MODEL.md
 * says `task_timeout: 2m`. We take 60s — the tighter bound frees a stuck worker
 * sooner — and let a capability raise it where the work genuinely takes longer.
 */
export const DEFAULT_TASK_TIMEOUT_MS = 60_000;
export const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60_000;

export type Task = {
  id: TaskId;
  executionId: ExecutionId;
  /** Capability id, e.g. "content.generate". Never a concrete worker. */
  capability: string;
  /**
   * Assigned by the Worker Dispatcher at dispatch time, not by the Planner —
   * the plan commits to *what*, the dispatcher decides *who*
   * (docs/kernel/06_PLANNING_ENGINE.md).
   */
  workerId: WorkerId | null;
  inputs: Metadata;
  outputs: Metadata | null;
  /** Ids of tasks that must reach COMPLETED before this one becomes READY. */
  dependencies: readonly TaskId[];
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  priority: TaskPriority;
  status: TaskStatus;
  attempt: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  metadata: Metadata;
};

/**
 * Delay before the next attempt. Exponential backoff spreads retries so a
 * struggling downstream service is not hammered by every task at once, and is
 * clamped to maxDelayMs so a late attempt never sleeps unboundedly.
 */
export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  if (policy.backoff === "FIXED") {
    return Math.min(policy.initialDelayMs, policy.maxDelayMs);
  }

  const exponential =
    policy.initialDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponential, policy.maxDelayMs);
}

/** True when the task has attempts left under its own policy. */
export function canRetry(task: Pick<Task, "attempt" | "retryPolicy">): boolean {
  return task.attempt < task.retryPolicy.maxAttempts;
}
