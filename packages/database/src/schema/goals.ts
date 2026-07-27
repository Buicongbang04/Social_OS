import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { goalPriorityEnum, goalStatusEnum, goalTypeEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * A Goal is the user's standing objective, expressed in natural language.
 * One Goal produces many Executions over time — a daily cron fires a fresh
 * Execution per run (docs/kernel/01_GOAL_MODEL.md).
 */
export const goals = pgTable(
  "goals",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    ownerId: idRef("owner_id")
      .notNull()
      .references(() => users.id),

    title: varchar("title", { length: 300 }).notNull(),
    /** The natural-language input to the Intent Engine. */
    objective: text("objective").notNull(),
    description: text("description"),

    type: goalTypeEnum("type").notNull().default("CONTENT"),
    priority: goalPriorityEnum("priority").notNull().default("NORMAL"),
    status: goalStatusEnum("status").notNull().default("CREATED"),

    constraints: jsonb("constraints").notNull().default({}),
    inputs: jsonb("inputs").notNull().default({}),
    outputs: jsonb("outputs").notNull().default([]),
    /** { cron, timezone } or null for a one-off Goal. */
    schedule: jsonb("schedule"),
    /**
     * When this Goal is next due to fire. Null for a one-off Goal, and null
     * once a recurring one is archived.
     *
     * Stored rather than derived so "what is due now" is an indexed range scan
     * instead of parsing every cron expression in the table on every tick.
     * It doubles as the concurrency token: firing compares-and-swaps on this
     * value, so two runtime nodes cannot both claim the same occurrence.
     */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    // Every list query is workspace-scoped, so this is the index that matters.
    index("goals_workspace_idx").on(table.workspaceId, table.status),
    index("goals_owner_idx").on(table.ownerId),
    // The scheduler's only query: due, and not deleted.
    index("goals_next_run_idx").on(table.nextRunAt),
  ],
);
