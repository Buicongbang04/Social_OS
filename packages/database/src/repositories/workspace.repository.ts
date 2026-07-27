import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type {
  CursorPage,
  CursorPageQuery,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { MAX_PAGE_LIMIT, newId } from "@repo/core";
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceRepository,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { workspaceMemberships, workspaces } from "../schema";

type WorkspaceRow = typeof workspaces.$inferSelect;

function toEntity(row: WorkspaceRow): Workspace {
  return {
    id: row.id as WorkspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    organizationId: row.organizationId as OrganizationId,
    status: row.status,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

/**
 * Every read is joined against the caller's membership. A workspace the user
 * is not an active member of simply does not exist as far as this repository
 * is concerned — the service layer turns that into 404, never 403, so the
 * existence of another tenant's data is never leaked.
 */
export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findByIdForUser(
    id: WorkspaceId,
    userId: UserId,
  ): Promise<Workspace | null> {
    const rows = await this.db
      .select({ workspace: workspaces })
      .from(workspaces)
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, workspaces.id),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, "ACTIVE"),
          isNull(workspaceMemberships.deletedAt),
        ),
      )
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1);

    return rows[0] ? toEntity(rows[0].workspace) : null;
  }

  async findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<Workspace | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.organizationId, organizationId),
          eq(workspaces.slug, slug),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async listForUser(
    userId: UserId,
    query: CursorPageQuery,
  ): Promise<CursorPage<Workspace>> {
    const limit = Math.min(query.limit, MAX_PAGE_LIMIT);

    const rows = await this.db
      .select({ workspace: workspaces })
      .from(workspaces)
      .innerJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, workspaces.id),
          eq(workspaceMemberships.userId, userId),
          eq(workspaceMemberships.status, "ACTIVE"),
          isNull(workspaceMemberships.deletedAt),
        ),
      )
      .where(
        and(
          isNull(workspaces.deletedAt),
          // Cursor is the previous page's last id; ULIDs sort chronologically.
          query.cursor ? lt(workspaces.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(workspaces.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => toEntity(row.workspace));

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async create(
    input: CreateWorkspaceInput,
    actorId: UserId,
  ): Promise<Workspace> {
    const rows = await this.db
      .insert(workspaces)
      .values({
        id: newId("workspace"),
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        organizationId: input.organizationId,
        status: "ACTIVE",
        metadata: input.metadata ?? {},
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Insert returned no row");
    return toEntity(row);
  }

  /**
   * Compare-and-swap on `version` (docs/data/04_TRANSACTION_MODEL.md).
   * Returns null when the expected version no longer matches, so the caller
   * can raise 409 VERSION_CONFLICT rather than silently clobbering a
   * concurrent write.
   */
  async update(
    id: WorkspaceId,
    expectedVersion: number,
    input: UpdateWorkspaceInput,
    actorId: UserId,
  ): Promise<Workspace | null> {
    const rows = await this.db
      .update(workspaces)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${workspaces.version} + 1`,
      })
      .where(
        and(
          eq(workspaces.id, id),
          eq(workspaces.version, expectedVersion),
          isNull(workspaces.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async softDelete(
    id: WorkspaceId,
    expectedVersion: number,
    actorId: UserId,
  ): Promise<boolean> {
    const rows = await this.db
      .update(workspaces)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        status: "DELETED",
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${workspaces.version} + 1`,
      })
      .where(
        and(
          eq(workspaces.id, id),
          eq(workspaces.version, expectedVersion),
          isNull(workspaces.deletedAt),
        ),
      )
      .returning({ id: workspaces.id });

    return rows.length > 0;
  }
}
