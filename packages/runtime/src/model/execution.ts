import type {
  BaseEntity,
  ExecutionId,
  GoalId,
  Metadata,
  TaskId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type { ExecutionStatus } from "../state/execution-state";
import type { GoalPriority } from "./goal";
import type { Task } from "./task";

/**
 * The plan produced by the Planning Engine: a DAG of Tasks.
 *
 * `dependencyGraph` is stored explicitly alongside each Task's `dependencies`
 * so the graph can be validated (cycles, unknown ids) without walking tasks,
 * and so a replan can diff the shape directly.
 */
export type ExecutionPlan = {
  id: string;
  executionId: ExecutionId;
  tasks: readonly Task[];
  /** taskId → ids it depends on. */
  dependencyGraph: Readonly<Record<string, readonly TaskId[]>>;
  estimatedDurationMs: number;
  estimatedCostUsd: number;
  metadata: Metadata;
};

/**
 * What started this run.
 *
 * A first-class field rather than something inferred, because it decides
 * whether the platform may post to a real audience with nobody watching. That
 * was inferred once, from `ownerId` being null — and it was wrong: a scheduled
 * Execution inherits the Goal's owner, so the check never fired and a cron run
 * published to a real Page.
 */
export const EXECUTION_TRIGGERS = ["MANUAL", "SCHEDULE"] as const;
export type ExecutionTrigger = (typeof EXECUTION_TRIGGERS)[number];

/**
 * One run of a Goal. A Goal may produce many Executions over time (a daily
 * cron creates a fresh one per fire); an Execution never restarts as a new
 * Execution — retry happens in place (docs/kernel/04_STATE_MACHINE.md).
 */
export type Execution = BaseEntity<ExecutionId> & {
  goalId: GoalId;
  workspaceId: WorkspaceId;
  ownerId: UserId;
  /** Who or what started this run. Never guessed; see EXECUTION_TRIGGERS. */
  trigger: ExecutionTrigger;
  status: ExecutionStatus;
  priority: GoalPriority;
  /** Null until the Planning Engine has run. */
  plan: ExecutionPlan | null;
  outputs: Metadata | null;
  /** Why the Execution failed or was cancelled; null while healthy. */
  failureReason: string | null;
  correlationId: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  metadata: Metadata;
};

export type CreateExecutionInput = {
  goalId: GoalId;
  workspaceId: WorkspaceId;
  ownerId: UserId;
  trigger?: ExecutionTrigger;
  priority?: GoalPriority;
  correlationId: string;
  metadata?: Metadata;
};

/** An Execution is done when every task reached a terminal state. */
export function isPlanComplete(tasks: readonly Task[]): boolean {
  return tasks.every(
    (task) => task.status === "COMPLETED" || task.status === "CANCELLED",
  );
}

/** Any task that exhausted its retries fails the whole Execution. */
export function hasUnrecoverableFailure(tasks: readonly Task[]): boolean {
  return tasks.some(
    (task) =>
      task.status === "FAILED" && task.attempt >= task.retryPolicy.maxAttempts,
  );
}
