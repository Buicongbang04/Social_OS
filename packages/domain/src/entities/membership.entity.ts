import type {
  MembershipId,
  Metadata,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type { PermissionKey } from "../permission/catalog";
import type { OrganizationRole, WorkspaceRole } from "../permission/roles";
import type { MembershipStatus } from "../shared/status";

/**
 * Membership joins User ↔ Workspace (N:M), per docs/platform/04_USER_MANAGEMENT.md.
 *
 * `permissionGrants`/`permissionDenies` are per-membership overrides on top of
 * the role matrix. Both are validated against the permission catalog on write,
 * so unknown strings can never reach the database.
 */
export type WorkspaceMembership = {
  id: MembershipId;
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
  permissionGrants: readonly PermissionKey[];
  permissionDenies: readonly PermissionKey[];
  status: MembershipStatus;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
  metadata: Metadata;
};

/** Organization membership uses an independent role set from workspace membership. */
export type OrganizationMembership = {
  id: MembershipId;
  organizationId: OrganizationId;
  userId: UserId;
  role: OrganizationRole;
  permissionGrants: readonly PermissionKey[];
  permissionDenies: readonly PermissionKey[];
  status: MembershipStatus;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
  version: number;
  metadata: Metadata;
};

export type AddWorkspaceMemberInput = {
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
  permissionGrants?: readonly PermissionKey[];
  permissionDenies?: readonly PermissionKey[];
};

export type AddOrganizationMemberInput = {
  organizationId: OrganizationId;
  userId: UserId;
  role: OrganizationRole;
};
