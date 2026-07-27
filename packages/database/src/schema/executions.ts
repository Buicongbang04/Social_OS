import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { executionStatusEnum, goalPriorityEnum } from "./_enums";
import { auditColumns, idColumn, idRef, metadataColumn } from "./_shared";
import { goals } from "./goals";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * One run of a Goal.
 *
 * No soft-delete columns: an Execution is an operational record of what the
 * runtime actually did. It is archived, never deleted, because the audit trail
 * ("Never Lose Execution State", docs/kernel/14_ERROR_HANDLING.md) is the
 * point of storing it.
 */
export const executions = pgTable(
  "executions",
  {
    id: idColumn(),
    goalId: idRef("goal_id")
      .notNull()
      .references(() => goals.id),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    ownerId: idRef("owner_id")
      .notNull()
      .references(() => users.id),

    status: executionStatusEnum("status").notNull().default("CREATED"),
    priority: goalPriorityEnum("priority").notNull().default("NORMAL"),

    /** The ExecutionPlan, stored whole so a run can be replayed as planned. */
    plan: jsonb("plan"),
    outputs: jsonb("outputs"),
    failureReason: text("failure_reason"),

    /** Shared by every event of this run — the key for tracing it end to end. */
    correlationId: varchar("correlation_id", { length: 64 }).notNull(),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    ...auditColumns,
    ...metadataColumn,
  },
  (table) => [
    index("executions_workspace_idx").on(table.workspaceId, table.status),
    index("executions_goal_idx").on(table.goalId),
    // The scheduler's hot query: "what is still running?"
    index("executions_status_idx").on(table.status),
    index("executions_correlation_idx").on(table.correlationId),
  ],
);
