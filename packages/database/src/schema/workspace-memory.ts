import {
  index,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { memorySourceEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { workspaces } from "./workspaces";

/**
 * Durable facts about a workspace — long-term memory per
 * docs/ai/06_AGENT_MEMORY.md: brand voice, standing preferences, constraints
 * that outlive any one conversation.
 *
 * What a document says is deliberately not here. That is Semantic Memory, it
 * lives in Qdrant, and it is retrieved per question rather than carried in
 * every prompt — a distinction that matters because everything in this table
 * is sent with every single request.
 */
export const workspaceMemory = pgTable(
  "workspace_memory",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),

    key: varchar("key", { length: 120 }).notNull(),
    value: text("value").notNull(),
    source: memorySourceEnum("source").notNull().default("MANUAL"),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    index("workspace_memory_workspace_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    /**
     * One value per key per workspace.
     *
     * Without this, remembering the same thing twice leaves the model to
     * reconcile two answers to one question — and it will pick one, silently.
     */
    uniqueIndex("workspace_memory_key_key").on(table.workspaceId, table.key),
  ],
);
