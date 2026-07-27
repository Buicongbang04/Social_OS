import type {
  CursorPage,
  CursorPageQuery,
  ExecutionId,
  GoalId,
  TaskId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type { Execution, ExecutionPlan } from "../model/execution";
import type { CreateGoalInput, Goal } from "../model/goal";
import type { Task } from "../model/task";
import type { ExecutionStatus } from "../state/execution-state";
import type { TaskStatus } from "../state/task-state";

/**
 * Persistence ports for the runtime.
 *
 * Every read that a user can reach takes the caller's `userId` so the query is
 * scoped to their workspace membership — the same rule the platform
 * repositories follow, and the reason a foreign Execution resolves to "not
 * found" rather than "forbidden".
 *
 * Writes that a scheduler performs (claiming, completing) take no userId:
 * they run as the runtime itself, not on behalf of a user.
 */
export interface GoalRepository {
  create(input: CreateGoalInput): Promise<Goal>;
  /**
   * Unscoped read for the runtime itself, which acts on its own behalf rather
   * than a user's — the same rule the scheduler's writes follow. Never reachable
   * from an HTTP handler: those use findByIdForUser so a foreign Goal resolves
   * to "not found" rather than "forbidden".
   */
  findById(id: GoalId): Promise<Goal | null>;
  findByIdForUser(id: GoalId, userId: UserId): Promise<Goal | null>;
  listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Goal>>;
  updateStatus(
    id: GoalId,
    status: Goal["status"],
    expectedVersion: number,
  ): Promise<Goal | null>;

  /** Recurring Goals whose next occurrence has arrived. */
  listDueSchedules(now: Date, limit: number): Promise<readonly Goal[]>;

  /**
   * Claim one occurrence, moving the Goal's next run forward.
   *
   * Compare-and-swap on `nextRunAt`: the caller passes the value it saw, and
   * the write only lands if nothing else has moved it. That, not the scheduler
   * lock, is what makes a firing exactly-once — the lock only reduces
   * contention, and two nodes racing past it would otherwise both create an
   * Execution for the same occurrence.
   *
   * Returns null when another node got there first.
   */
  claimSchedule(input: {
    id: GoalId;
    expectedNextRunAt: Date;
    nextRunAt: Date | null;
    firedAt: Date;
  }): Promise<Goal | null>;

  /** Set the first occurrence when a recurring Goal is created. */
  setNextRunAt(id: GoalId, nextRunAt: Date | null): Promise<void>;
}

export interface ExecutionRepository {
  create(execution: Execution): Promise<Execution>;
  findById(id: ExecutionId): Promise<Execution | null>;
  findByIdForUser(id: ExecutionId, userId: UserId): Promise<Execution | null>;
  listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Execution>>;

  /**
   * Compare-and-swap on both `version` and `expectedStatus`.
   *
   * Guarding on the current status as well as the version is what stops two
   * runtime nodes from both driving the same Execution forward: the second
   * one's expected status no longer matches, so it gets null.
   */
  transitionStatus(input: {
    id: ExecutionId;
    expectedVersion: number;
    expectedStatus: ExecutionStatus;
    status: ExecutionStatus;
    failureReason?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    outputs?: Record<string, unknown> | null;
  }): Promise<Execution | null>;

  attachPlan(
    id: ExecutionId,
    plan: ExecutionPlan,
    expectedVersion: number,
  ): Promise<Execution | null>;

  /** Executions the scheduler still has work to do on. */
  listActive(limit: number): Promise<readonly Execution[]>;

  /**
   * Executions submitted but not yet planned.
   *
   * The API only writes a CREATED row; planning happens here because it will
   * involve an LLM call from Phase 2 onward, and an HTTP request must not
   * block on that. Keeping it asynchronous now avoids reworking the boundary
   * later.
   */
  listPendingPreparation(limit: number): Promise<readonly Execution[]>;
}

export interface TaskRepository {
  createMany(tasks: readonly Task[]): Promise<readonly Task[]>;
  findById(id: TaskId): Promise<Task | null>;
  listByExecution(executionId: ExecutionId): Promise<readonly Task[]>;

  /** Same compare-and-swap discipline as executions. */
  transitionStatus(input: {
    id: TaskId;
    expectedStatus: TaskStatus;
    status: TaskStatus;
    outputs?: Record<string, unknown> | null;
    lastError?: string | null;
    attempt?: number;
    workerId?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  }): Promise<Task | null>;
}
