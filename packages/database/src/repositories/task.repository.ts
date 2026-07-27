import { and, eq, sql } from "drizzle-orm";
import type { ExecutionId, TaskId, WorkspaceId } from "@repo/core";
import type {
  RetryPolicy,
  Task,
  TaskRepository,
  TaskStatus,
} from "@repo/runtime";
import type { DatabaseClient } from "../client";
import { tasks } from "../schema";

type TaskRow = typeof tasks.$inferSelect;

function toEntity(row: TaskRow): Task {
  return {
    id: row.id as TaskId,
    executionId: row.executionId as ExecutionId,
    workspaceId: row.workspaceId as WorkspaceId,
    capability: row.capability,
    workerId: row.workerId as Task["workerId"],
    inputs: row.inputs as Record<string, unknown>,
    outputs: (row.outputs as Record<string, unknown> | null) ?? null,
    dependencies: row.dependencies as TaskId[],
    timeoutMs: row.timeoutMs,
    retryPolicy: row.retryPolicy as RetryPolicy,
    priority: row.priority,
    status: row.status,
    attempt: row.attempt,
    lastError: row.lastError,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    metadata: row.metadata as Record<string, unknown>,
  };
}

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createMany(input: readonly Task[]): Promise<readonly Task[]> {
    if (input.length === 0) return [];

    const rows = await this.db
      .insert(tasks)
      .values(
        input.map((task) => ({
          id: task.id,
          executionId: task.executionId,
          // Denormalised so the scheduler can filter by workspace without a join.
          workspaceId: task.workspaceId,
          capability: task.capability,
          workerId: task.workerId,
          inputs: task.inputs,
          outputs: task.outputs,
          dependencies: task.dependencies,
          status: task.status,
          priority: task.priority,
          timeoutMs: task.timeoutMs,
          retryPolicy: task.retryPolicy,
          attempt: task.attempt,
          lastError: task.lastError,
          startedAt: task.startedAt,
          finishedAt: task.finishedAt,
          metadata: task.metadata,
        })),
      )
      .returning();

    return rows.map(toEntity);
  }

  async findById(id: TaskId): Promise<Task | null> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async listByExecution(executionId: ExecutionId): Promise<readonly Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.executionId, executionId))
      .orderBy(tasks.id);

    return rows.map(toEntity);
  }

  /**
   * Compare-and-swap on the current status.
   *
   * Two dispatchers can reserve the same task from the queue in a partition
   * scenario; only the one whose expected status still matches wins the
   * transition, and the loser gets null instead of running it a second time.
   */
  async transitionStatus(input: {
    id: TaskId;
    expectedStatus: TaskStatus;
    status: TaskStatus;
    outputs?: Record<string, unknown> | null;
    lastError?: string | null;
    attempt?: number;
    workerId?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  }): Promise<Task | null> {
    const rows = await this.db
      .update(tasks)
      .set({
        status: input.status,
        ...(input.outputs !== undefined ? { outputs: input.outputs } : {}),
        ...(input.lastError !== undefined
          ? { lastError: input.lastError }
          : {}),
        ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
        ...(input.workerId !== undefined ? { workerId: input.workerId } : {}),
        ...(input.startedAt !== undefined
          ? { startedAt: input.startedAt }
          : {}),
        ...(input.finishedAt !== undefined
          ? { finishedAt: input.finishedAt }
          : {}),
        updatedAt: new Date(),
        version: sql`${tasks.version} + 1`,
      })
      .where(
        and(eq(tasks.id, input.id), eq(tasks.status, input.expectedStatus)),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }
}
