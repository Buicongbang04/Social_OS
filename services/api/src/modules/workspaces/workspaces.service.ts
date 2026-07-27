import { Inject, Injectable } from "@nestjs/common";
import type { CursorPage, UserId, WorkspaceId } from "@repo/core";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  assertId,
} from "@repo/core";
import type {
  OrganizationMembershipRepository,
  Workspace,
  WorkspaceMembership,
  WorkspaceMembershipRepository,
  WorkspaceRepository,
  WorkspaceRole,
} from "@repo/domain";
import { canDelete, canTransitionEntityStatus } from "@repo/domain";
import {
  ORGANIZATION_MEMBERSHIP_REPOSITORY,
  WORKSPACE_MEMBERSHIP_REPOSITORY,
  WORKSPACE_REPOSITORY,
} from "../../infra/database/database.module";
import { PermissionService } from "../authorization/permission.service";
import type {
  AddMemberBody,
  CreateWorkspaceBody,
  ListQuery,
  UpdateWorkspaceBody,
} from "./workspaces.dto";

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(WORKSPACE_REPOSITORY)
    private readonly workspaces: WorkspaceRepository,
    @Inject(WORKSPACE_MEMBERSHIP_REPOSITORY)
    private readonly memberships: WorkspaceMembershipRepository,
    @Inject(ORGANIZATION_MEMBERSHIP_REPOSITORY)
    private readonly organizationMemberships: OrganizationMembershipRepository,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * A workspace the caller is not a member of resolves to 404, never 403 —
   * a 403 would confirm that a workspace with that id exists, leaking the
   * existence of another tenant's data.
   */
  async getForUser(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<Workspace> {
    const workspace = await this.workspaces.findByIdForUser(
      workspaceId,
      userId,
    );
    if (!workspace) throw notFound();
    return workspace;
  }

  async listForUser(
    userId: UserId,
    query: ListQuery,
  ): Promise<CursorPage<Workspace>> {
    return this.workspaces.listForUser(userId, query);
  }

  async create(body: CreateWorkspaceBody, actorId: UserId): Promise<Workspace> {
    const organizationId = assertId("organization", body.organizationId);

    // Creating a workspace is an organization-scoped action, so the caller
    // must hold the permission in that organization.
    const allowed = await this.permissions.canInOrganization(
      organizationId,
      actorId,
      "organization.workspace.create",
    );

    if (!allowed) {
      throw new ForbiddenError(
        "Missing required permission: organization.workspace.create",
        "PERMISSION_DENIED",
      );
    }

    const existing = await this.workspaces.findBySlug(
      organizationId,
      body.slug,
    );
    if (existing) {
      throw new ConflictError(
        "A workspace with this slug already exists in the organization.",
        "WORKSPACE_SLUG_TAKEN",
      );
    }

    const workspace = await this.workspaces.create(
      {
        name: body.name,
        slug: body.slug,
        description: body.description ?? null,
        organizationId,
      },
      actorId,
    );

    // The creator becomes OWNER, otherwise nobody could administer it.
    await this.memberships.add(
      { workspaceId: workspace.id, userId: actorId, role: "OWNER" },
      actorId,
    );
    await this.permissions.invalidateWorkspace(workspace.id, actorId);

    return workspace;
  }

  async update(
    workspaceId: WorkspaceId,
    body: UpdateWorkspaceBody,
    actorId: UserId,
  ): Promise<Workspace> {
    const current = await this.getForUser(workspaceId, actorId);

    if (body.status && body.status !== current.status) {
      if (!canTransitionEntityStatus(current.status, body.status)) {
        throw new ConflictError(
          `Cannot change status from ${current.status} to ${body.status}.`,
          "INVALID_STATUS_TRANSITION",
        );
      }
    }

    const updated = await this.workspaces.update(
      workspaceId,
      body.version,
      {
        name: body.name,
        description: body.description,
        status: body.status,
      },
      actorId,
    );

    // Null means the compare-and-swap on `version` failed: someone else wrote
    // first, so the caller's view is stale.
    if (!updated) throw staleVersion();

    return updated;
  }

  /**
   * Archive-then-delete: an ACTIVE workspace may not be deleted directly
   * (docs/platform/03_WORKSPACE_MANAGEMENT.md).
   */
  async remove(
    workspaceId: WorkspaceId,
    version: number,
    actorId: UserId,
  ): Promise<void> {
    const current = await this.getForUser(workspaceId, actorId);

    if (!canDelete(current.status)) {
      throw new ConflictError(
        `A workspace in status ${current.status} cannot be deleted. Archive it first.`,
        "WORKSPACE_NOT_ARCHIVED",
      );
    }

    const deleted = await this.workspaces.softDelete(
      workspaceId,
      version,
      actorId,
    );
    if (!deleted) throw staleVersion();
  }

  async listMembers(
    workspaceId: WorkspaceId,
    actorId: UserId,
    query: ListQuery,
  ) {
    await this.getForUser(workspaceId, actorId);
    return this.memberships.listByWorkspace(workspaceId, query);
  }

  async addMember(
    workspaceId: WorkspaceId,
    body: AddMemberBody,
    actorId: UserId,
  ): Promise<WorkspaceMembership> {
    await this.getForUser(workspaceId, actorId);

    const userId = assertId("user", body.userId);

    const existing = await this.memberships.findForUserInWorkspace(
      workspaceId,
      userId,
    );
    if (existing) {
      throw new ConflictError(
        "User is already a member of this workspace.",
        "ALREADY_A_MEMBER",
      );
    }

    const membership = await this.memberships.add(
      { workspaceId, userId, role: body.role },
      actorId,
    );

    // The new member's cached (empty) permission set must not outlive this.
    await this.permissions.invalidateWorkspace(workspaceId, userId);

    return membership;
  }

  async removeMember(
    workspaceId: WorkspaceId,
    userId: UserId,
    actorId: UserId,
  ): Promise<void> {
    await this.getForUser(workspaceId, actorId);

    const membership = await this.memberships.findForUserInWorkspace(
      workspaceId,
      userId,
    );
    if (!membership) {
      throw new NotFoundError(
        "This user is not a member of the workspace.",
        "MEMBER_NOT_FOUND",
      );
    }

    await this.assertNotLastOwner(workspaceId, membership.role);

    await this.memberships.remove(workspaceId, userId);
    await this.permissions.invalidateWorkspace(workspaceId, userId);
  }

  /** Removing or demoting the last OWNER would leave the workspace unadministrable. */
  private async assertNotLastOwner(
    workspaceId: WorkspaceId,
    role: WorkspaceRole,
  ): Promise<void> {
    if (role !== "OWNER") return;

    const owners = await this.memberships.countByRole(workspaceId, "OWNER");
    if (owners <= 1) {
      throw new ConflictError(
        "The last owner of a workspace cannot be removed.",
        "LAST_OWNER_CANNOT_BE_REMOVED",
      );
    }
  }
}

function notFound(): NotFoundError {
  return new NotFoundError("Workspace not found.", "WORKSPACE_NOT_FOUND");
}

function staleVersion(): ConflictError {
  return new ConflictError(
    "This workspace was modified by someone else. Reload and try again.",
    "VERSION_CONFLICT",
  );
}
