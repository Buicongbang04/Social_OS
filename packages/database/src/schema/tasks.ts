import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { taskPriorityEnum, taskStatusEnum } from "./_enums";
import { auditColumns, idColumn, idRef, metadataColumn } from "./_shared";
import { executions } from "./executions";
import { workspaces } from "./workspaces";

/**
 * One node of an Execution's plan.
 *
 * A retry reuses the same row and increments `attempt` — it does not insert a
 * new task (docs/runtime/04_TASK_EXECUTOR.md), so the task id stays a stable
 * handle for logs, events and the queue across every attempt.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: idColumn(),
    executionId: idRef("execution_id")
      .notNull()
      .references(() => executions.id, { onDelete: "cascade" }),
    // Denormalised from the execution: the scheduler filters by workspace on
    // its hot path and should not need a join to do it.
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),

    capability: varchar("capability", { length: 120 }).notNull(),
    /** Set by the dispatcher at dispatch time, null while pending. */
    workerId: varchar("worker_id", { length: 64 }),

    inputs: jsonb("inputs").notNull().default({}),
    outputs: jsonb("outputs"),
    /** Ids of tasks that must reach COMPLETED first. */
    dependencies: jsonb("dependencies").notNull().default([]),

    status: taskStatusEnum("status").notNull().default("PENDING"),
    priority: taskPriorityEnum("priority").notNull().default("NORMAL"),

    timeoutMs: integer("timeout_ms").notNull(),
    retryPolicy: jsonb("retry_policy").notNull(),
    attempt: integer("attempt").notNull().default(0),
    lastError: text("last_error"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    ...auditColumns,
    ...metadataColumn,
  },
  (table) => [
    index("tasks_execution_idx").on(table.executionId, table.status),
    index("tasks_workspace_idx").on(table.workspaceId),
    index("tasks_status_idx").on(table.status),
  ],
);
