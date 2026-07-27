import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type {
  CursorPage,
  CursorPageQuery,
  ExecutionId,
  GoalId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { MAX_PAGE_LIMIT } from "@repo/core";
import type {
  Execution,
  ExecutionPlan,
  ExecutionRepository,
  ExecutionStatus,
} from "@repo/runtime";
import type { DatabaseClient } from "../client";
import { executions, workspaceMemberships } from "../schema";

type ExecutionRow = typeof executions.$inferSelect;

function toEntity(row: ExecutionRow): Execution {
  return {
    id: row.id as ExecutionId,
    goalId: row.goalId as GoalId,
    workspaceId: row.workspaceId as WorkspaceId,
    ownerId: row.ownerId as UserId,
    status: row.status,
    priority: row.priority,
    /**
     * A cast, not a parse — and the difference matters. The plan is stored as
     * jsonb, so the Date fields inside its Task snapshots come back as ISO
     * strings while this type says Date. Nothing reads them today (every
     * consumer uses the freshly built plan, or the tasks table, which is
     * properly typed), so this is a hazard rather than a live bug. Anything
     * that starts reading plan.tasks[].startedAt must parse it first.
     */
    plan: (row.plan as ExecutionPlan | null) ?? null,
    outputs: (row.outputs as Record<string, unknown> | null) ?? null,
    failureReason: row.failureReason,
    correlationId: row.correlationId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
  };
}

/** Statuses on which the scheduler still has work to do. */
const ACTIVE_STATUSES: readonly ExecutionStatus[] = [
  "CREATED",
  "VALIDATING",
  "PLANNING",
  "READY",
  "SCHEDULED",
  "RUNNING",
  "WAITING",
  "RETRYING",
  "CANCELLING",
];

export class DrizzleExecutionRepository implements ExecutionRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(execution: Execution): Promise<Execution> {
    const rows = await this.db
      .insert(executions)
      .values({
        id: execution.id,
        goalId: execution.goalId,
        workspaceId: execution.workspaceId,
        ownerId: execution.ownerId,
        status: execution.status,
        priority: execution.priority,
        plan: execution.plan,
        outputs: execution.outputs,
        failureReason: execution.failureReason,
        correlationId: execution.correlationId,
        startedAt: execution.startedAt,
        finishedAt: execution.finishedAt,
        metadata: execution.metadata,
        createdBy: execution.ownerId,
      })
      .returning();

    return toEntity(rows[0]!);
  }

  /** Unscoped — for the scheduler, which acts as the runtime, not as a user. */
  async findById(id: ExecutionId): Promise<Execution | null> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.id, id))
      .limit(1);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  /**
   * Joined against the caller's membership, so an Execution in another
   * workspace is simply absent rather than forbidden.
   */
  async findByIdForUser(
    id: ExecutionId,
    userId: UserId,
  ): Promise<Execution | null> {
    const rows = await this.db
      .select({ execution: executions })
      .from(executions)
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, executions.workspaceId),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, "ACTIVE"),
        ),
      )
      .where(eq(executions.id, id))
      .limit(1);

    return rows[0] ? toEntity(rows[0].execution) : null;
  }

  async listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Execution>> {
    const limit = Math.min(query.limit, MAX_PAGE_LIMIT);

    const rows = await this.db
      .select({ execution: executions })
      .from(executions)
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, executions.workspaceId),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, "ACTIVE"),
        ),
      )
      .where(
        and(
          eq(executions.workspaceId, workspaceId),
          query.cursor ? lt(executions.id, query.cursor) : undefined,
        ),
      )
      // ULIDs sort chronologically, so id ordering is newest-first.
      .orderBy(desc(executions.id))
      .limit(limit + 1);

    const items = rows.slice(0, limit).map((row) => toEntity(row.execution));
    const hasMore = rows.length > limit;

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Compare-and-swap on version AND status.
   *
   * Guarding on status too is what stops two runtime nodes driving the same
   * Execution forward: the loser's expected status no longer matches, so it
   * gets null rather than silently double-advancing the run.
   */
  async transitionStatus(input: {
    id: ExecutionId;
    expectedVersion: number;
    expectedStatus: ExecutionStatus;
    status: ExecutionStatus;
    failureReason?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    outputs?: Record<string, unknown> | null;
  }): Promise<Execution | null> {
    const rows = await this.db
      .update(executions)
      .set({
        status: input.status,
        ...(input.failureReason !== undefined
          ? { failureReason: input.failureReason }
          : {}),
        ...(input.startedAt !== undefined
          ? { startedAt: input.startedAt }
          : {}),
        ...(input.finishedAt !== undefined
          ? { finishedAt: input.finishedAt }
          : {}),
        ...(input.outputs !== undefined ? { outputs: input.outputs } : {}),
        updatedAt: new Date(),
        version: sql`${executions.version} + 1`,
      })
      .where(
        and(
          eq(executions.id, input.id),
          eq(executions.version, input.expectedVersion),
          eq(executions.status, input.expectedStatus),
        ),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async attachPlan(
    id: ExecutionId,
    plan: ExecutionPlan,
    expectedVersion: number,
  ): Promise<Execution | null> {
    const rows = await this.db
      .update(executions)
      .set({
        plan,
        updatedAt: new Date(),
        version: sql`${executions.version} + 1`,
      })
      .where(
        and(eq(executions.id, id), eq(executions.version, expectedVersion)),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async listPendingPreparation(limit: number): Promise<readonly Execution[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(eq(executions.status, "CREATED"))
      // Oldest first: whoever submitted first gets planned first.
      .orderBy(executions.id)
      .limit(Math.min(limit, MAX_PAGE_LIMIT));

    return rows.map(toEntity);
  }

  async listActive(limit: number): Promise<readonly Execution[]> {
    const rows = await this.db
      .select()
      .from(executions)
      .where(inArray(executions.status, [...ACTIVE_STATUSES]))
      // Oldest first: an Execution that has been waiting longest goes next.
      .orderBy(executions.id)
      .limit(Math.min(limit, MAX_PAGE_LIMIT));

    return rows.map(toEntity);
  }
}
