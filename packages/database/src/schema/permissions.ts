import {
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  permissionActionEnum,
  permissionResourceEnum,
  permissionScopeEnum,
  workspaceRoleEnum,
} from "./_enums";
import { auditColumns } from "./_shared";

/**
 * The permission catalog and role→permission mapping, mirrored into the
 * database by the seed so the runtime source of truth is data, not code
 * (docs/platform/08_PERMISSION_MODEL.md: "không hardcode Permission trong
 * Source Code"). A drift test asserts these rows match @repo/domain.
 */
export const permissions = pgTable("permissions", {
  key: varchar("key", { length: 120 }).primaryKey(),
  scope: permissionScopeEnum("scope").notNull(),
  resource: permissionResourceEnum("resource").notNull(),
  action: permissionActionEnum("action").notNull(),
  description: text("description").notNull(),
  createdAt: auditColumns.createdAt,
  updatedAt: auditColumns.updatedAt,
});

/**
 * System roles for the workspace scope. Organization-scope role permissions are
 * resolved from @repo/domain directly; only workspace roles are materialised
 * here because they are the ones an admin UI will eventually customise.
 */
export const roles = pgTable(
  "roles",
  {
    key: workspaceRoleEnum("key").primaryKey(),
    description: text("description").notNull(),
    createdAt: auditColumns.createdAt,
    updatedAt: auditColumns.updatedAt,
  },
  (table) => [uniqueIndex("roles_key_unique").on(table.key)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleKey: workspaceRoleEnum("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 120 })
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.permissionKey] })],
);
