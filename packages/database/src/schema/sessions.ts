import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { auditColumns, idColumn, idRef } from "./_shared";
import { users } from "./users";

/**
 * Refresh-token sessions (docs/platform/06_AUTHENTICATION.md).
 *
 * Only the SHA-256 hash of the refresh token is stored — the raw token exists
 * solely in the client's possession. Sessions expire/are revoked rather than
 * soft-deleted: they are operational data, a deliberate exception to the
 * soft-delete default in docs/data/02_DATA_MODEL.md.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: idColumn(),
    userId: idRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }).notNull(),
    device: varchar("device", { length: 200 }),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),
    createdAt: auditColumns.createdAt,
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Set when the token is rotated, so reuse of an old token is detectable. */
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("sessions_refresh_token_hash_unique").on(
      table.refreshTokenHash,
    ),
    index("sessions_user_idx").on(table.userId),
    // Supports the expired-session cleanup job.
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);
