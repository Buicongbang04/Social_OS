import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { auditColumns, idColumn, idRef } from "./_shared";
import { users } from "./users";

/**
 * Backs the `Idempotency-Key` header on POST (docs/api/03_REST_API.md), so a
 * retried create does not produce a duplicate resource. Rows expire rather than
 * being soft-deleted — operational data, like sessions.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: idColumn(),
    key: varchar("key", { length: 200 }).notNull(),
    userId: idRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: varchar("endpoint", { length: 200 }).notNull(),
    /** Hash of the request body: the same key with a different body is a client bug. */
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: auditColumns.createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_user_key_unique").on(table.userId, table.key),
    index("idempotency_keys_expires_at_idx").on(table.expiresAt),
  ],
);
