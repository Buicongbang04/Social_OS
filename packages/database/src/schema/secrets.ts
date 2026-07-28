import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { secretScopeEnum } from "./_enums";
import {
  auditColumns,
  ID_LENGTH,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { workspaces } from "./workspaces";

/**
 * A stored credential, per docs/platform/12_SECRET_MANAGER.md.
 *
 * The value is not in this table. It lives in `secret_versions`, sealed, and
 * this row holds only what may safely be shown: the name, the scope, which
 * version is live, and the last few characters so a human can tell two keys
 * apart. The doc is explicit — "Giá trị Secret không bao giờ xuất hiện trong
 * Metadata" — and splitting the tables is what makes that structural rather
 * than a rule someone has to remember.
 */
export const secrets = pgTable(
  "secrets",
  {
    id: idColumn(),
    /** Null for a PLATFORM secret, which belongs to no tenant. */
    workspaceId: idRef("workspace_id").references(() => workspaces.id),
    scope: secretScopeEnum("scope").notNull(),

    name: varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    activeVersion: integer("active_version").notNull().default(1),
    /** Masked. Never enough to be a credential. */
    hint: varchar("hint", { length: 40 }).notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    index("secrets_workspace_idx").on(table.workspaceId, table.scope),
    /**
     * One secret per name per workspace, so `secret://providers/anthropic`
     * resolves to exactly one thing.
     *
     * Postgres treats NULLs as distinct in a unique index, so PLATFORM
     * secrets — whose workspace is null — would not be constrained by this
     * alone. `secrets_platform_name_key` below covers them.
     */
    uniqueIndex("secrets_name_key").on(table.workspaceId, table.name),
    // The partial index the comment above depends on. Without it a PLATFORM
    // secret could be created twice under one name and `secret://` would
    // resolve to whichever row came back first.
    uniqueIndex("secrets_platform_name_key")
      .on(table.name)
      .where(sql`${table.workspaceId} is null`),
    index("secrets_expiry_idx").on(table.expiresAt),
  ],
);

/**
 * One sealed value.
 *
 * Insert-only. Rotation writes a new row and moves `secrets.active_version`,
 * because a credential replaced here is still in flight elsewhere for a while
 * and being able to go back is what makes a bad rotation a rollback rather
 * than an outage.
 */
export const secretVersions = pgTable(
  "secret_versions",
  {
    id: idColumn(),
    secretId: varchar("secret_id", { length: ID_LENGTH }).notNull(),
    version: integer("version").notNull(),

    /** Which encryption key sealed this. See @repo/secrets. */
    keyId: varchar("key_id", { length: 40 }).notNull(),
    iv: varchar("iv", { length: 32 }).notNull(),
    tag: varchar("tag", { length: 32 }).notNull(),
    ciphertext: text("ciphertext").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: varchar("created_by", { length: ID_LENGTH }),
  },
  (table) => [
    uniqueIndex("secret_versions_key").on(table.secretId, table.version),
    /** Finds everything sealed by a retired key, for re-sealing. */
    index("secret_versions_key_id_idx").on(table.keyId),
  ],
);
