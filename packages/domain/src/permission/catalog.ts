/**
 * Permission catalog — the single source of truth for what may be authorized.
 *
 * Format `<scope>.<resource>.<action>`, per docs/platform/08_PERMISSION_MODEL.md.
 * This file is declarative *data*, not business logic: nothing here decides
 * who gets what, it only enumerates what is expressible. The database is the
 * runtime source of truth and is seeded from this catalog, with a drift test
 * asserting the two agree — that is how "never hardcode permissions in source
 * code" is honoured while still getting compile-time safety.
 */

/** Authorization scopes, widest to narrowest (docs/platform/07_AUTHORIZATION.md). */
export const PERMISSION_SCOPES = [
  "platform",
  "organization",
  "workspace",
  "project",
  "resource",
] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/**
 * The 11 documented actions (docs/platform/08_PERMISSION_MODEL.md), plus
 * `invite`.
 *
 * Doc inconsistency resolved here: the action list in the docs omits `invite`,
 * yet the same document quotes `organization.user.invite` as a canonical
 * permission string. The verbatim example wins — it is the one that shows up
 * in API contracts — so `invite` is added as a twelfth action.
 */
export const PERMISSION_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "execute",
  "share",
  "export",
  "import",
  "manage",
  "approve",
  "configure",
  "invite",
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Documented resource types. `organization` is included so organization-scoped
 * permissions on the organization record itself are expressible
 * (e.g. `organization.organization.update`).
 */
export const PERMISSION_RESOURCES = [
  "organization",
  "workspace",
  "project",
  "workflow",
  "agent",
  "knowledge-base",
  "secret",
  "plugin",
  "connector",
  "execution",
  "file",
  "media",
  "billing",
  "license",
  "user",
  "member",
  "role",
] as const;
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export type PermissionKey =
  `${PermissionScope}.${PermissionResource}.${PermissionAction}`;

export type PermissionDefinition = {
  key: PermissionKey;
  scope: PermissionScope;
  resource: PermissionResource;
  action: PermissionAction;
  description: string;
};

function define(key: PermissionKey, description: string): PermissionDefinition {
  const [scope, resource, action] = key.split(".") as [
    PermissionScope,
    PermissionResource,
    PermissionAction,
  ];
  return { key, scope, resource, action, description };
}

/**
 * Curated set for Phase 0 — deliberately not the full scope×resource×action
 * cross-product. Permissions are added as the features that need them land.
 */
export const PERMISSIONS: readonly PermissionDefinition[] = Object.freeze([
  // Workspace itself
  define("workspace.workspace.read", "Xem thông tin Workspace"),
  define("workspace.workspace.update", "Cập nhật thông tin Workspace"),
  define("workspace.workspace.delete", "Xóa (archive) Workspace"),
  define("workspace.workspace.configure", "Thay đổi cấu hình Workspace"),

  // Membership management inside a workspace
  define("workspace.member.read", "Xem danh sách thành viên"),
  define("workspace.member.create", "Thêm thành viên vào Workspace"),
  define("workspace.member.update", "Đổi Role của thành viên"),
  define("workspace.member.delete", "Gỡ thành viên khỏi Workspace"),

  // Workflow / Agent / Execution — Runtime lands in Phase 1, permissions exist now
  define("workspace.workflow.create", "Tạo Workflow"),
  define("workspace.workflow.read", "Xem Workflow"),
  define("workspace.workflow.update", "Sửa Workflow"),
  define("workspace.workflow.delete", "Xóa Workflow"),
  define("workspace.workflow.execute", "Chạy Workflow"),
  define("workspace.agent.create", "Tạo Agent"),
  define("workspace.agent.read", "Xem Agent"),
  define("workspace.agent.update", "Sửa Agent"),
  define("workspace.agent.delete", "Xóa Agent"),
  define("workspace.execution.read", "Xem lịch sử Execution"),

  // Knowledge / files / secrets
  define("workspace.knowledge-base.read", "Xem Knowledge Base"),
  define("workspace.knowledge-base.manage", "Quản lý Knowledge Base"),
  define("workspace.file.read", "Xem file"),
  define("workspace.file.create", "Tải file lên"),
  define("workspace.file.delete", "Xóa file"),
  define("workspace.secret.read", "Xem Secret"),
  define("workspace.secret.manage", "Quản lý Secret"),

  // Organization scope
  define("organization.organization.read", "Xem thông tin Organization"),
  define("organization.organization.update", "Cập nhật Organization"),
  define(
    "organization.organization.configure",
    "Thay đổi cấu hình Organization",
  ),
  define(
    "organization.workspace.create",
    "Tạo Workspace mới trong Organization",
  ),
  define("organization.workspace.read", "Xem danh sách Workspace"),
  define("organization.user.invite", "Mời người dùng vào Organization"),
  define("organization.member.read", "Xem thành viên Organization"),
  define("organization.member.update", "Đổi Role thành viên Organization"),
  define("organization.member.delete", "Gỡ thành viên khỏi Organization"),
  define("organization.role.read", "Xem danh sách Role"),
  define("organization.billing.read", "Xem thông tin Billing"),
  define("organization.billing.manage", "Quản lý Billing"),

  // Platform scope (system administration)
  define("platform.billing.manage", "Quản lý Billing toàn hệ thống"),
  define("platform.user.manage", "Quản lý người dùng toàn hệ thống"),
]);

const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(
  PERMISSIONS.map((p) => p.key),
);

export const PERMISSION_KEYS: readonly PermissionKey[] = Object.freeze(
  PERMISSIONS.map((p) => p.key),
);

/** Is this string a permission the catalog actually defines? */
export function isKnownPermission(key: string): key is PermissionKey {
  return PERMISSION_KEY_SET.has(key);
}

/** Reject any permission string not in the catalog — used at every write boundary. */
export function assertKnownPermissions(
  keys: readonly string[],
): PermissionKey[] {
  const unknown = keys.filter((key) => !isKnownPermission(key));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown permission(s): ${unknown.join(", ")}`);
  }
  return keys as PermissionKey[];
}

/** Extract the scope segment without a full parse. */
export function scopeOf(key: PermissionKey): PermissionScope {
  return key.slice(0, key.indexOf(".")) as PermissionScope;
}
