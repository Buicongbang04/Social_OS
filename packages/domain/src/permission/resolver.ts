import type { PermissionKey } from "./catalog";
import type { OrganizationRole, WorkspaceRole } from "./roles";
import {
  ORGANIZATION_ROLE_PERMISSIONS,
  WORKSPACE_ROLE_PERMISSIONS,
} from "./roles";

/**
 * Effective permission resolution.
 *
 * Rules (docs/platform/07_AUTHORIZATION.md, docs/platform/08_PERMISSION_MODEL.md):
 *  - Deny by default: anything not granted is denied.
 *  - effective = rolePermissions ∪ grants \ denies
 *  - Deny always wins over a grant, consistent with deny-by-default.
 *
 * These functions are pure and take permissions for ONE membership only. The
 * no-cross-workspace-accumulation rule is structural: callers must pass the
 * membership belonging to the workspace being accessed, and there is no
 * overload here that accepts several memberships at once.
 */

export type MembershipPermissionInput = {
  grants?: readonly PermissionKey[];
  denies?: readonly PermissionKey[];
};

function applyGrantsAndDenies(
  base: readonly PermissionKey[],
  { grants = [], denies = [] }: MembershipPermissionInput,
): ReadonlySet<PermissionKey> {
  const effective = new Set<PermissionKey>(base);
  for (const grant of grants) effective.add(grant);
  for (const deny of denies) effective.delete(deny);
  return effective;
}

/** Effective permissions of one membership in one specific workspace. */
export function resolveWorkspacePermissions(
  role: WorkspaceRole,
  overrides: MembershipPermissionInput = {},
): ReadonlySet<PermissionKey> {
  return applyGrantsAndDenies(WORKSPACE_ROLE_PERMISSIONS[role], overrides);
}

/** Effective permissions of one membership in one specific organization. */
export function resolveOrganizationPermissions(
  role: OrganizationRole,
  overrides: MembershipPermissionInput = {},
): ReadonlySet<PermissionKey> {
  return applyGrantsAndDenies(ORGANIZATION_ROLE_PERMISSIONS[role], overrides);
}

/** Deny-by-default check against an already-resolved permission set. */
export function hasPermission(
  effective: ReadonlySet<PermissionKey>,
  required: PermissionKey,
): boolean {
  return effective.has(required);
}
