import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { entityStatusEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { organizations } from "./organizations";

/**
 * Workspace is the isolation boundary: every tenant resource belongs to
 * exactly one Workspace (docs/platform/03_WORKSPACE_MANAGEMENT.md).
 *
 * `onDelete: "restrict"` on the organization FK is intentional — an
 * Organization with live Workspaces must not disappear underneath them.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: idColumn(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    organizationId: idRef("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    status: entityStatusEnum("status").notNull().default("ACTIVE"),
    ...metadataColumn,
    ...auditColumns,
    ...softDeleteColumns,
  },
  (table) => [
    // Slug is unique per organization, not globally.
    uniqueIndex("workspaces_org_slug_unique")
      .on(table.organizationId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    index("workspaces_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);
