import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { campaignStatusEnum, contentPieceStatusEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { socialAccounts } from "./social-accounts";
import { workspaces } from "./workspaces";

/** A named grouping of content, with a period. */
export const campaigns = pgTable(
  "campaigns",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),

    name: varchar("name", { length: 200 }).notNull(),
    objective: text("objective"),
    status: campaignStatusEnum("status").notNull().default("DRAFT"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    index("campaigns_workspace_idx").on(table.workspaceId, table.status),
    index("campaigns_period_idx").on(table.startsAt),
  ],
);

/**
 * One piece of content.
 *
 * `campaign_id` is nullable, because that is the order the work happens in: a
 * post gets written before anyone decides which campaign it belongs to, and
 * requiring one would mean inventing an empty campaign to hold a draft.
 */
export const contentPieces = pgTable(
  "content_pieces",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    campaignId: idRef("campaign_id").references(() => campaigns.id),
    /**
     * Which connected account this goes to.
     *
     * Nullable, and that is a real state rather than an unfinished one: with a
     * single Page connected there is nothing to choose, and forcing a choice
     * would mean every draft had to name an account before it could be saved.
     * Null means "the only one on this channel", and the publisher refuses if
     * that stops being true.
     */
    socialAccountId: idRef("social_account_id").references(
      () => socialAccounts.id,
    ),

    title: varchar("title", { length: 300 }).notNull(),
    body: text("body").notNull(),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    channel: varchar("channel", { length: 40 }).notNull(),

    /**
     * An absolute instant, not a wall-clock time.
     *
     * The client works it out from the user's own timezone and sends the
     * instant. Storing "09:00" plus a zone would mean deciding what happens to
     * a scheduled post when a workspace changes country, and nobody has.
     */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    status: contentPieceStatusEnum("status").notNull().default("DRAFT"),

    /** The platform's own id, once there is one. */
    publishedPostId: varchar("published_post_id", { length: 200 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastError: text("last_error"),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    /**
     * The calendar query: everything in a window, for one workspace.
     *
     * Leading with the workspace rather than the date, because every read is
     * scoped to one and a date-first index would scan across tenants before
     * filtering.
     */
    index("content_pieces_calendar_idx").on(
      table.workspaceId,
      table.scheduledAt,
    ),
    index("content_pieces_campaign_idx").on(table.campaignId),
    index("content_pieces_account_idx").on(table.socialAccountId),
    /** For whatever eventually sends these: what is due and not yet out. */
    index("content_pieces_due_idx").on(table.status, table.scheduledAt),
  ],
);
