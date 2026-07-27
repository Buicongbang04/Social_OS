import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type {
  CursorPage,
  CursorPageQuery,
  GoalId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { MAX_PAGE_LIMIT, newId } from "@repo/core";
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
        status: "CREATED",
        metadata: input.metadata ?? {},
        createdBy: input.ownerId,
      })
      .returning();

    return toEntity(rows[0]!);
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
