import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { authProviderEnum, userStatusEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";

/**
 * User is platform-global — it can belong to several Organizations — so it
 * carries no tenant column. Isolation happens through membership tables.
 * Credentials never live here (see userIdentities).
 */
export const users = pgTable(
  "users",
  {
    id: idColumn(),
    email: varchar("email", { length: 320 }).notNull(),
    username: varchar("username", { length: 64 }),
    fullName: varchar("full_name", { length: 200 }),
    avatarUrl: text("avatar_url"),
    status: userStatusEnum("status").notNull().default("REGISTERED"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    ...metadataColumn,
    ...auditColumns,
    ...softDeleteColumns,
  },
  (table) => [
    // Case-insensitive uniqueness, ignoring soft-deleted rows so an address
    // can be reused after a user is deleted.
    uniqueIndex("users_email_unique")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("users_username_unique")
      .on(sql`lower(${table.username})`)
      .where(sql`${table.deletedAt} is null and ${table.username} is not null`),
    index("users_status_idx").on(table.status),
  ],
);

/**
 * Credential holder. Keeping it separate from `users` means adding OAuth or
 * SSO later is purely additive (docs/platform/06_AUTHENTICATION.md).
 * `passwordHash` is populated only for the LOCAL provider.
 */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: idColumn(),
    userId: idRef("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: authProviderEnum("provider").notNull(),
    providerAccountId: varchar("provider_account_id", {
      length: 320,
    }).notNull(),
    passwordHash: text("password_hash"),
    createdAt: auditColumns.createdAt,
    updatedAt: auditColumns.updatedAt,
  },
  (table) => [
    uniqueIndex("user_identities_provider_account_unique").on(
      table.provider,
      table.providerAccountId,
    ),
    uniqueIndex("user_identities_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
  ],
);

/** Profile explicitly holds no authentication data (docs/platform/04). */
export const userProfiles = pgTable("user_profiles", {
  userId: idRef("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("display_name", { length: 200 }),
  jobTitle: varchar("job_title", { length: 200 }),
  department: varchar("department", { length: 200 }),
  language: varchar("language", { length: 16 }).notNull().default("vi"),
  timeZone: varchar("time_zone", { length: 64 })
    .notNull()
    .default("Asia/Ho_Chi_Minh"),
  country: varchar("country", { length: 2 }),
  ...metadataColumn,
  createdAt: auditColumns.createdAt,
  updatedAt: auditColumns.updatedAt,
});
