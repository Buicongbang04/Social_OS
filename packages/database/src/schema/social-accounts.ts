import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { socialAccountStatusEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { workspaces } from "./workspaces";

/**
 * A social platform account a workspace has connected.
 *
 * The tokens are not in this table. `secretName` points into the vault, where
 * they are sealed — the same split as `secrets` and `secret_versions`, for the
 * same reason: a row that can be selected, logged or dumped must not be able to
 * carry a live credential for someone's audience.
 */
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),

    connectorId: varchar("connector_id", { length: 40 }).notNull(),
    /** The platform's id, which survives the account being renamed. */
    externalId: varchar("external_id", { length: 200 }).notNull(),
    displayName: varchar("display_name", { length: 300 }).notNull(),
    avatarUrl: text("avatar_url"),

    /** What was granted, which can be less than what was asked for. */
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: socialAccountStatusEnum("status").notNull().default("ACTIVE"),
    /** A reference into the vault, never a token. */
    secretName: varchar("secret_name", { length: 200 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    index("social_accounts_workspace_idx").on(
      table.workspaceId,
      table.connectorId,
    ),
    /**
     * One row per account per workspace.
     *
     * Reconnecting a page has to update this row rather than add a second one:
     * two rows for one audience means two tokens and no way to say which is
     * live, so a revoked connection would keep publishing from the other.
     *
     * Not filtered on `deleted_at`, deliberately — a disconnected account
     * still holds its place, so reconnecting revives the row it had before
     * and keeps its history rather than starting again.
     */
    uniqueIndex("social_accounts_external_key").on(
      table.workspaceId,
      table.connectorId,
      table.externalId,
    ),
    /** For the job that will refresh tokens before they run out. */
    index("social_accounts_expiry_idx").on(table.expiresAt),
  ],
);
