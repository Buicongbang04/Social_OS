import type {
  CursorPage,
  CursorPageQuery,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type {
  AddOrganizationMemberInput,
  AddWorkspaceMemberInput,
  OrganizationMembership,
  WorkspaceMembership,
} from "../entities/membership.entity";
import type { WorkspaceRole } from "../permission/roles";

export interface WorkspaceMembershipRepository {
  /**
   * The membership for ONE user in ONE workspace. This single-workspace shape
   * is what structurally prevents permissions accumulating across workspaces:
   * there is no API here to fetch "all memberships and merge them".
   */
  findForUserInWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<WorkspaceMembership | null>;

  listByWorkspace(
    workspaceId: WorkspaceId,
    query: CursorPageQuery,
  ): Promise<CursorPage<WorkspaceMembership>>;

  add(
    input: AddWorkspaceMemberInput,
    actorId: UserId,
  ): Promise<WorkspaceMembership>;

  updateRole(
    workspaceId: WorkspaceId,
    userId: UserId,
    role: WorkspaceRole,
    actorId: UserId,
  ): Promise<WorkspaceMembership | null>;

  remove(workspaceId: WorkspaceId, userId: UserId): Promise<boolean>;

  /** Used to enforce "the last OWNER cannot be removed or demoted". */
  countByRole(workspaceId: WorkspaceId, role: WorkspaceRole): Promise<number>;
}

export interface OrganizationMembershipRepository {
  findForUserInOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMembership | null>;

  add(
    input: AddOrganizationMemberInput,
    actorId: UserId,
  ): Promise<OrganizationMembership>;
}
