import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { messageRoleEnum } from "./_enums";
import {
  auditColumns,
  ID_LENGTH,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { users } from "./users";
import { workspaces } from "./workspaces";

/** One chat thread, per docs/ai/06_AGENT_MEMORY.md's short-term memory. */
export const conversations = pgTable(
  "conversations",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Null when the runtime started the thread rather than a person. */
    createdByUser: idRef("created_by_user").references(() => users.id),

    title: varchar("title", { length: 300 }).notNull(),
    /**
     * Denormalised so the thread list is an indexed sort rather than a join
     * and an aggregate over every message ever sent.
     */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),

    /**
     * What the turns that fell out of the context window said.
     *
     * A long thread outgrows any window, and the alternative to this is
     * silence: the model simply stops knowing the beginning, gives an answer
     * that contradicts something agreed ten turns ago, and nothing anywhere
     * says why. docs/ai/06_AGENT_MEMORY.md calls this Memory Consolidation.
     */
    summary: text("summary"),
    /**
     * How many messages the summary already covers.
     *
     * A count rather than a message id because that is what the window is
     * measured in, and because it makes "is the summary behind?" one
     * subtraction instead of a lookup.
     */
    summarisedCount: integer("summarised_count").notNull().default(0),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    // Matches the list query's actual sort key. Indexing lastMessageAt alone
    // would not serve `coalesce(last_message_at, created_at)`, and the
    // repository has to sort on the coalesce because Postgres puts NULLs first
    // on a DESC sort — see the comment there.
    index("conversations_workspace_idx").on(
      table.workspaceId,
      sql`coalesce(${table.lastMessageAt}, ${table.createdAt}) desc`,
    ),
  ],
);

/**
 * One turn in a thread.
 *
 * Insert-only, like `execution_events` and `ai_usage`: this is the record of
 * what was actually said, and a transcript that can be edited after the fact
 * is not a transcript. There are deliberately no audit or soft-delete columns —
 * deleting the conversation is what removes a thread.
 */
export const messages = pgTable(
  "messages",
  {
    id: idColumn(),
    conversationId: idRef("conversation_id")
      .notNull()
      .references(() => conversations.id),
    /**
     * Repeated from the conversation on purpose.
     *
     * Every read filters on it, and carrying it here means the filter is one
     * index lookup rather than a join — and, more importantly, that a query
     * which forgets to join still cannot cross tenants.
     */
    workspaceId: varchar("workspace_id", { length: ID_LENGTH }).notNull(),

    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),

    /** Null on a user or system message: nothing generated those. */
    provider: varchar("provider", { length: 40 }),
    model: varchar("model", { length: 120 }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** Numeric, not float — see ai_usage for why money is never a double. */
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 })
      .notNull()
      .default("0"),
    finishReason: varchar("finish_reason", { length: 30 }),
    /**
     * The stream died partway and this is what had arrived.
     *
     * Kept rather than discarded: the reader already saw this text and the
     * vendor already billed for it, so a transcript without it disagrees with
     * both the screen and the invoice.
     */
    truncated: boolean("truncated").notNull().default(false),

    ...metadataColumn,
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The thread read: one conversation, in order.
    index("messages_conversation_idx").on(table.conversationId, table.createdAt),
    index("messages_workspace_idx").on(table.workspaceId, table.createdAt),
  ],
);
