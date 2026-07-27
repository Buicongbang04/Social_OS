import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  membershipStatusEnum,
  organizationRoleEnum,
  workspaceRoleEnum,
} from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { organizations } from "./organizations";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * Membership joins User ↔ Workspace (N:M).
 *
 * `permissionGrants`/`permissionDenies` are per-membership overrides layered on
 * the role matrix; both are validated against the permission catalog in
 * @repo/domain before any write, so unknown strings cannot enter the database.
 *
 * Crucially, a membership row is scoped to ONE workspace — that is what makes
 * "permissions do not accumulate across workspaces" structural rather than a
 * rule someone has to remember.
 */
export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: idRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull(),
    permissionGrants: text("permission_grants")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    permissionDenies: text("permission_denies")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: membershipStatusEnum("status").notNull().default("ACTIVE"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...metadataColumn,
    ...auditColumns,
    ...softDeleteColumns,
  },
  (table) => [
    uniqueIndex("workspace_memberships_workspace_user_unique")
      .on(table.workspaceId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    // Drives "list the workspaces this user can see".
    index("workspace_memberships_user_idx").on(table.userId),
    index("workspace_memberships_workspace_role_idx").on(
      table.workspaceId,
      table.role,
    ),
  ],
);

/** Organization roles are an independent set from workspace roles. */
export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: idColumn(),
    organizationId: idRef("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: idRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organizationRoleEnum("role").notNull(),
    permissionGrants: text("permission_grants")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    permissionDenies: text("permission_denies")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: membershipStatusEnum("status").notNull().default("ACTIVE"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...metadataColumn,
    ...auditColumns,
    ...softDeleteColumns,
  },
  (table) => [
    uniqueIndex("organization_memberships_org_user_unique")
      .on(table.organizationId, table.userId)
      .where(sql`${table.deletedAt} is null`),
    index("organization_memberships_user_idx").on(table.userId),
  ],
);
