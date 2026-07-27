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
import { users } from "./users";

/**
 * Organization is the tenant root (docs/platform/05_ORGANIZATION.md).
 * One Organization owns many Workspaces; a Workspace belongs to exactly one.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: idColumn(),
    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    ownerId: idRef("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: entityStatusEnum("status").notNull().default("ACTIVE"),
    ...metadataColumn,
    ...auditColumns,
    ...softDeleteColumns,
  },
  (table) => [
    uniqueIndex("organizations_slug_unique")
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
    index("organizations_owner_idx").on(table.ownerId),
    index("organizations_status_idx").on(table.status),
  ],
);
