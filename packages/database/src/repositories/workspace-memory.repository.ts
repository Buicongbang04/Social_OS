import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  Metadata,
  UserId,
  WorkspaceId,
  WorkspaceMemoryId,
} from "@repo/core";
import { newId } from "@repo/core";
import type {
  CreateWorkspaceMemoryInput,
  WorkspaceMemory,
  WorkspaceMemoryRepository,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { workspaceMemory } from "../schema";

type Row = typeof workspaceMemory.$inferSelect;

/**
 * How many facts one read returns.
 *
 * Every one of these goes into a prompt, so the bound lives here rather than
 * in the caller: a caller that forgets it spends the whole context window on
 * what the workspace remembers and leaves none for the question, and the
 * failure looks like the model ignoring what it was asked.
 */
const DEFAULT_LIMIT = 30;

function toEntity(row: Row): WorkspaceMemory {
  return {
    id: row.id as WorkspaceMemoryId,
    workspaceId: row.workspaceId as WorkspaceId,
    key: row.key,
    value: row.value,
    source: row.source,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

export class DrizzleWorkspaceMemoryRepository
  implements WorkspaceMemoryRepository
{
  constructor(private readonly db: DatabaseClient) {}

  async list(
    workspaceId: WorkspaceId,
    limit = DEFAULT_LIMIT,
  ): Promise<WorkspaceMemory[]> {
    const rows = await this.db
      .select()
      .from(workspaceMemory)
      .where(
        and(
          eq(workspaceMemory.workspaceId, workspaceId),
          isNull(workspaceMemory.deletedAt),
        ),
      )
      .orderBy(desc(workspaceMemory.updatedAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows.map(toEntity);
  }

  async findById(
    workspaceId: WorkspaceId,
    id: WorkspaceMemoryId,
  ): Promise<WorkspaceMemory | null> {
    const rows = await this.db
      .select()
      .from(workspaceMemory)
      .where(
        and(
          eq(workspaceMemory.id, id),
          eq(workspaceMemory.workspaceId, workspaceId),
          isNull(workspaceMemory.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  /**
   * Remember a fact, replacing whatever was under that key.
   *
   * An upsert rather than an insert plus a lookup, so two writers landing
   * together cannot both see "nothing there yet" and both insert — which the
   * unique index would refuse, turning a routine save into an error the user
   * has to interpret.
   *
   * `deletedAt` is cleared on conflict: remembering something again after
   * forgetting it is the same act as remembering it the first time, and a
   * soft-deleted row silently blocking the key would be a save that reports
   * success and changes nothing visible.
   */
  async remember(
    input: CreateWorkspaceMemoryInput,
    actorId: UserId | null,
  ): Promise<WorkspaceMemory> {
    const rows = await this.db
      .insert(workspaceMemory)
      .values({
        id: newId("workspaceMemory"),
        workspaceId: input.workspaceId,
        key: input.key.trim().slice(0, 120),
        value: input.value.trim(),
        source: input.source ?? "MANUAL",
        metadata: input.metadata ?? {},
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoUpdate({
        target: [workspaceMemory.workspaceId, workspaceMemory.key],
        set: {
          value: input.value.trim(),
          source: input.source ?? "MANUAL",
          deletedAt: null,
          deletedBy: null,
          updatedAt: new Date(),
          updatedBy: actorId,
          version: sql`${workspaceMemory.version} + 1`,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Upsert returned no workspace memory row.");
    return toEntity(row);
  }

  async forget(
    workspaceId: WorkspaceId,
    id: WorkspaceMemoryId,
    actorId: UserId | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(workspaceMemory)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${workspaceMemory.version} + 1`,
      })
      .where(
        and(
          eq(workspaceMemory.id, id),
          eq(workspaceMemory.workspaceId, workspaceId),
          isNull(workspaceMemory.deletedAt),
        ),
      )
      .returning({ id: workspaceMemory.id });

    return rows.length > 0;
  }
}
