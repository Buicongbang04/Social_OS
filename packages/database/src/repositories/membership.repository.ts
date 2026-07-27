import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import type {
  CursorPage,
  CursorPageQuery,
  MembershipId,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { MAX_PAGE_LIMIT, newId } from "@repo/core";
import type {
  AddOrganizationMemberInput,
  AddWorkspaceMemberInput,
  OrganizationMembership,
  OrganizationMembershipRepository,
  PermissionKey,
  WorkspaceMembership,
  WorkspaceMembershipRepository,
  WorkspaceRole,
} from "@repo/domain";
import { assertKnownPermissions } from "@repo/domain";
import type { DatabaseClient } from "../client";
import { organizationMemberships, workspaceMemberships } from "../schema";

type WorkspaceMembershipRow = typeof workspaceMemberships.$inferSelect;
type OrganizationMembershipRow = typeof organizationMemberships.$inferSelect;

function toWorkspaceEntity(row: WorkspaceMembershipRow): WorkspaceMembership {
  return {
    id: row.id as MembershipId,
    workspaceId: row.workspaceId as WorkspaceId,
    userId: row.userId as UserId,
    role: row.role,
    permissionGrants: row.permissionGrants as PermissionKey[],
    permissionDenies: row.permissionDenies as PermissionKey[],
    status: row.status,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    metadata: row.metadata as Record<string, unknown>,
  };
}

function toOrganizationEntity(
  row: OrganizationMembershipRow,
): OrganizationMembership {
  return {
    id: row.id as MembershipId,
    organizationId: row.organizationId as OrganizationId,
    userId: row.userId as UserId,
    role: row.role,
    permissionGrants: row.permissionGrants as PermissionKey[],
    permissionDenies: row.permissionDenies as PermissionKey[],
    status: row.status,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    metadata: row.metadata as Record<string, unknown>,
  };
}

export class DrizzleWorkspaceMembershipRepository implements WorkspaceMembershipRepository {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Deliberately scoped to a single workspace. There is no method here that
   * returns every membership of a user at once, because permission resolution
   * must never see more than one workspace's membership
   * (docs/platform/08_PERMISSION_MODEL.md: quyền không cộng dồn giữa Workspace).
   */
  async findForUserInWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | null> {
    const rows = await this.db
      .select()
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
          isNull(workspaceMemberships.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toWorkspaceEntity(rows[0]) : null;
  }

  async listByWorkspace(
    workspaceId: WorkspaceId,
    query: CursorPageQuery,
  ): Promise<CursorPage<WorkspaceMembership>> {
    const limit = Math.min(query.limit, MAX_PAGE_LIMIT);

    const rows = await this.db
      .select()
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          isNull(workspaceMemberships.deletedAt),
          query.cursor ? lt(workspaceMemberships.id, query.cursor) : undefined,
        ),
      )
      .orderBy(desc(workspaceMemberships.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toWorkspaceEntity);

    return {
      items,
      hasMore,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async add(
    input: AddWorkspaceMemberInput,
    actorId: UserId,
  ): Promise<WorkspaceMembership> {
    // Reject unknown permission strings before they reach the database.
    const grants = assertKnownPermissions(input.permissionGrants ?? []);
    const denies = assertKnownPermissions(input.permissionDenies ?? []);

    const rows = await this.db
      .insert(workspaceMemberships)
      .values({
        id: newId("membership"),
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
        permissionGrants: grants,
        permissionDenies: denies,
        status: "ACTIVE",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Insert returned no row");
    return toWorkspaceEntity(row);
  }

  async updateRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    actorId: UserId,
  ): Promise<WorkspaceMembership | null> {
    const rows = await this.db
      .update(workspaceMemberships)
      .set({ role, updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
          isNull(workspaceMemberships.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toWorkspaceEntity(rows[0]) : null;
  }

  async remove(workspaceId: WorkspaceId, userId: UserId): Promise<boolean> {
    const rows = await this.db
      .update(workspaceMemberships)
      .set({ deletedAt: new Date(), status: "SUSPENDED" })
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.userId, userId),
          isNull(workspaceMemberships.deletedAt),
        ),
      )
      .returning({ id: workspaceMemberships.id });

    return rows.length > 0;
  }

  /** Supports the "last OWNER cannot be removed or demoted" rule. */
  async countByRole(
    workspaceId: WorkspaceId,
    role: WorkspaceRole,
  ): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          eq(workspaceMemberships.role, role),
          eq(workspaceMemberships.status, "ACTIVE"),
          isNull(workspaceMemberships.deletedAt),
        ),
      );

    return rows[0]?.value ?? 0;
  }
}

export class DrizzleOrganizationMembershipRepository implements OrganizationMembershipRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findForUserInOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | null> {
    const rows = await this.db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
          isNull(organizationMemberships.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toOrganizationEntity(rows[0]) : null;
  }

  async add(
    input: AddOrganizationMemberInput,
    actorId: UserId,
  ): Promise<OrganizationMembership> {
    const rows = await this.db
      .insert(organizationMemberships)
      .values({
        id: newId("membership"),
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        status: "ACTIVE",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Insert returned no row");
    return toOrganizationEntity(row);
  }
}
