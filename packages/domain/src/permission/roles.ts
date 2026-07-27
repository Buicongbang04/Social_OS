import type { PermissionKey } from "./catalog";

/**
 * Role → permission matrices.
 *
 * Workspace roles and Organization roles are two INDEPENDENT sets
 * (docs/platform/05_ORGANIZATION.md): a user can be Organization Admin yet
 * only Viewer inside a given Workspace, and vice versa.
 *
 * The docs use "Admin" and "Administrator" interchangeably; ADMIN is the
 * canonical token here (it is what the permission matrix table uses).
 */

export const WORKSPACE_ROLES = [
  "OWNER",
  "ADMIN",
  "DEVELOPER",
  "OPERATOR",
  "VIEWER",
  "GUEST",
] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const ORGANIZATION_ROLES = [
  "OWNER",
  "ADMIN",
  "BILLING_ADMIN",
  "SECURITY_ADMIN",
  "MEMBER",
  "GUEST",
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

const WORKSPACE_VIEWER: readonly PermissionKey[] = [
  "workspace.workspace.read",
  "workspace.member.read",
  "workspace.workflow.read",
  "workspace.agent.read",
  "workspace.execution.read",
  "workspace.knowledge-base.read",
  "workspace.file.read",
];

const WORKSPACE_OPERATOR: readonly PermissionKey[] = [
  ...WORKSPACE_VIEWER,
  "workspace.workflow.execute",
  "workspace.file.create",
];

const WORKSPACE_DEVELOPER: readonly PermissionKey[] = [
  ...WORKSPACE_OPERATOR,
  "workspace.workflow.create",
  "workspace.workflow.update",
  "workspace.agent.create",
  "workspace.agent.update",
  "workspace.knowledge-base.manage",
  "workspace.file.delete",
];

const WORKSPACE_ADMIN: readonly PermissionKey[] = [
  ...WORKSPACE_DEVELOPER,
  "workspace.workspace.update",
  "workspace.workspace.configure",
  "workspace.workspace.delete",
  "workspace.member.create",
  "workspace.member.update",
  "workspace.member.delete",
  "workspace.workflow.delete",
  "workspace.agent.delete",
  "workspace.secret.read",
  "workspace.secret.manage",
];

/**
 * OWNER currently equals ADMIN at workspace scope. The distinction is
 * structural, not permission-based: the last OWNER of a workspace cannot be
 * removed or demoted (enforced in the membership rules, not the matrix).
 */
const WORKSPACE_OWNER: readonly PermissionKey[] = [...WORKSPACE_ADMIN];

/** GUEST is deliberately read-only and narrower than VIEWER. */
const WORKSPACE_GUEST: readonly PermissionKey[] = [
  "workspace.workspace.read",
  "workspace.workflow.read",
];

export const WORKSPACE_ROLE_PERMISSIONS: Readonly<
  Record<WorkspaceRole, readonly PermissionKey[]>
> = Object.freeze({
  OWNER: Object.freeze([...new Set(WORKSPACE_OWNER)]),
  ADMIN: Object.freeze([...new Set(WORKSPACE_ADMIN)]),
  DEVELOPER: Object.freeze([...new Set(WORKSPACE_DEVELOPER)]),
  OPERATOR: Object.freeze([...new Set(WORKSPACE_OPERATOR)]),
  VIEWER: Object.freeze([...new Set(WORKSPACE_VIEWER)]),
  GUEST: Object.freeze([...new Set(WORKSPACE_GUEST)]),
});

const ORGANIZATION_GUEST: readonly PermissionKey[] = [
  "organization.organization.read",
];

const ORGANIZATION_MEMBER: readonly PermissionKey[] = [
  ...ORGANIZATION_GUEST,
  "organization.workspace.read",
  "organization.member.read",
];

const ORGANIZATION_BILLING_ADMIN: readonly PermissionKey[] = [
  ...ORGANIZATION_MEMBER,
  "organization.billing.read",
  "organization.billing.manage",
];

const ORGANIZATION_SECURITY_ADMIN: readonly PermissionKey[] = [
  ...ORGANIZATION_MEMBER,
  "organization.role.read",
  "organization.member.update",
  "organization.organization.configure",
];

const ORGANIZATION_ADMIN: readonly PermissionKey[] = [
  ...ORGANIZATION_MEMBER,
  "organization.organization.update",
  "organization.organization.configure",
  "organization.workspace.create",
  "organization.user.invite",
  "organization.member.update",
  "organization.member.delete",
  "organization.role.read",
  "organization.billing.read",
];

/** Only OWNER may manage billing at organization scope (per the docs matrix). */
const ORGANIZATION_OWNER: readonly PermissionKey[] = [
  ...ORGANIZATION_ADMIN,
  "organization.billing.manage",
];

export const ORGANIZATION_ROLE_PERMISSIONS: Readonly<
  Record<OrganizationRole, readonly PermissionKey[]>
> = Object.freeze({
  OWNER: Object.freeze([...new Set(ORGANIZATION_OWNER)]),
  ADMIN: Object.freeze([...new Set(ORGANIZATION_ADMIN)]),
  BILLING_ADMIN: Object.freeze([...new Set(ORGANIZATION_BILLING_ADMIN)]),
  SECURITY_ADMIN: Object.freeze([...new Set(ORGANIZATION_SECURITY_ADMIN)]),
  MEMBER: Object.freeze([...new Set(ORGANIZATION_MEMBER)]),
  GUEST: Object.freeze([...new Set(ORGANIZATION_GUEST)]),
});

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}
