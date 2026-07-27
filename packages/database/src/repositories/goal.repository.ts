import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type {
  CursorPage,
  CursorPageQuery,
  GoalId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { MAX_PAGE_LIMIT, newId } from "@repo/core";
import { canTransitionGoal, GOAL_STATUSES, nextRunAfter } from "@repo/runtime";
import type {
  CreateGoalInput,
  ExpectedOutput,
  Goal,
  GoalConstraints,
  GoalRepository,
  GoalSchedule,
  GoalStatus,
} from "@repo/runtime";
import type { DatabaseClient } from "../client";
import { goals, workspaceMemberships } from "../schema";

type GoalRow = typeof goals.$inferSelect;

function toEntity(row: GoalRow): Goal {
  return {
    id: row.id as GoalId,
    workspaceId: row.workspaceId as WorkspaceId,
    ownerId: row.ownerId as UserId,
    title: row.title,
    objective: row.objective,
    description: row.description,
    type: row.type,
    priority: row.priority,
    constraints: row.constraints as GoalConstraints,
    inputs: row.inputs as Record<string, unknown>,
    outputs: row.outputs as ExpectedOutput[],
    schedule: (row.schedule as GoalSchedule | null) ?? null,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    status: row.status,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
  };
}

export class DrizzleGoalRepository implements GoalRepository {
  constructor(private readonly db: DatabaseClient) {}

  /** Due, recurring, and not archived or deleted. */
  async listDueSchedules(now: Date, limit: number): Promise<readonly Goal[]> {
    const rows = await this.db
      .select()
      .from(goals)
      .where(
        and(
          lte(goals.nextRunAt, now),
          isNotNull(goals.nextRunAt),
          isNull(goals.deletedAt),
          ne(goals.status, "ARCHIVED"),
        ),
      )
      .orderBy(asc(goals.nextRunAt))
      .limit(limit);

    return rows.map(toEntity);
  }

  /**
   * Claim the occurrence that is currently due, moving the schedule forward.
   *
   * The condition is "still due", not "next_run_at equals the value I read".
   * Equality looks like the obvious compare-and-swap and is a trap: Postgres
   * stores this column to microseconds while a JavaScript Date only carries
   * milliseconds, so any value written with sub-millisecond precision — a
   * `now()` default, an operator fixing a schedule by hand — can never be
   * matched again, and the Goal silently stops firing for ever with no error
   * anywhere. Found exactly that way.
   *
   * Still exactly-once: under READ COMMITTED a second UPDATE blocks on the
   * first, then re-evaluates its WHERE against the committed row. By then
   * next_run_at is in the future, so it matches nothing and returns null.
   */
  async claimSchedule(input: {
    id: GoalId;
    /** The moment the sweep considers "now"; the row must still be due at it. */
    dueAt: Date;
    nextRunAt: Date | null;
    firedAt: Date;
  }): Promise<Goal | null> {
    const rows = await this.db
      .update(goals)
      .set({
        nextRunAt: input.nextRunAt,
        lastRunAt: input.firedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(goals.id, input.id),
          isNotNull(goals.nextRunAt),
          lte(goals.nextRunAt, input.dueAt),
        ),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async setNextRunAt(id: GoalId, nextRunAt: Date | null): Promise<void> {
    await this.db
      .update(goals)
      .set({ nextRunAt, updatedAt: new Date() })
      .where(eq(goals.id, id));
  }

  async create(input: CreateGoalInput): Promise<Goal> {
    const rows = await this.db
      .insert(goals)
      .values({
        id: newId("goal"),
        workspaceId: input.workspaceId,
        ownerId: input.ownerId,
        title: input.title,
        objective: input.objective,
        description: input.description ?? null,
        type: input.type ?? "CONTENT",
        priority: input.priority ?? "NORMAL",
        constraints: input.constraints ?? {},
        inputs: input.inputs ?? {},
        outputs: input.outputs ?? [],
        schedule: input.schedule ?? null,
        // Computed on insert so the scheduler's due query is a plain range
        // scan. A recurring Goal with no nextRunAt would simply never fire —
        // the exact silence this whole feature exists to remove.
        nextRunAt: input.schedule
          ? nextRunAfter(input.schedule, new Date())
          : null,
        status: "CREATED",
        metadata: input.metadata ?? {},
        createdBy: input.ownerId,
      })
      .returning();

    return toEntity(rows[0]!);
  }

  /**
   * Unscoped, for the runtime acting on its own behalf. Deliberately separate
   * from findByIdForUser rather than a flag on it: one call site forgetting to
   * pass the flag would silently turn a tenant-scoped read into a global one.
   */
  async findById(id: GoalId): Promise<Goal | null> {
    const rows = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  /**
   * Stop a Goal from ever running again.
   *
   * One statement, because the two halves must not be separable: clearing
   * `nextRunAt` is what stops the firing, and it happens whatever the status
   * is. The status only moves to ARCHIVED when the state machine allows it —
   * a Goal in the middle of a run cannot, and its Execution has to finish —
   * so `case when` rather than a second UPDATE that could fail on its own and
   * leave a Goal that says ARCHIVED but is still scheduled, or the reverse.
   *
   * Scoped by membership through a subquery rather than a join: Postgres does
   * not allow a joined table in an UPDATE's WHERE the way a SELECT does, and
   * an UPDATE without the scope is one that archives another tenant's Goal.
   */
  async archive(id: GoalId, userId: UserId): Promise<Goal | null> {
    const archivable = GOAL_STATUSES.filter((status) =>
      canTransitionGoal(status, "ARCHIVED"),
    );

    const rows = await this.db
      .update(goals)
      .set({
        nextRunAt: null,
        status: sql`case when ${goals.status} in ${archivable} then 'ARCHIVED'::goal_status else ${goals.status} end`,
        updatedBy: userId,
        updatedAt: new Date(),
        version: sql`${goals.version} + 1`,
      })
      .where(
        and(
          eq(goals.id, id),
          isNull(goals.deletedAt),
          inArray(
            goals.workspaceId,
            this.db
              .select({ id: workspaceMemberships.workspaceId })
              .from(workspaceMemberships)
              .where(
                and(
                  eq(workspaceMemberships.userId, userId),
                  eq(workspaceMemberships.status, "ACTIVE"),
                ),
              ),
          ),
        ),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  /** Membership-scoped, so a foreign Goal is absent rather than forbidden. */
  async findByIdForUser(id: GoalId, userId: UserId): Promise<Goal | null> {
    const rows = await this.db
      .select({ goal: goals })
      .from(goals)
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, goals.workspaceId),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, "ACTIVE"),
        ),
      )
      .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
      .limit(1);

    return rows[0] ? toEntity(rows[0].goal) : null;
  }

  async listForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Goal>> {
    const limit = Math.min(query.limit, MAX_PAGE_LIMIT);

    const rows = await this.db
      .select({ goal: goals })
      .from(goals)
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, goals.workspaceId),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, "ACTIVE"),
        ),
      )
      .where(
        and(
          eq(goals.workspaceId, workspaceId),
          isNull(goals.deletedAt),
          query.cursor ? lt(goals.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(goals.id))
      .limit(limit + 1);

    const items = rows.slice(0, limit).map((row) => toEntity(row.goal));
    const hasMore = rows.length > limit;

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async updateStatus(
    id: GoalId,
    status: GoalStatus,
    expectedVersion: number,
  ): Promise<Goal | null> {
    const rows = await this.db
      .update(goals)
      .set({
        status,
        updatedAt: new Date(),
        version: sql`${goals.version} + 1`,
      })
      .where(and(eq(goals.id, id), eq(goals.version, expectedVersion)))
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }
}
