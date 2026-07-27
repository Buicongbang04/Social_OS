import {
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { idColumn, idRef, ID_LENGTH } from "./_shared";
import { workspaces } from "./workspaces";

/**
 * Durable event log for the runtime.
 *
 * Append-only and never updated: the docs require events to be replayable
 * (docs/kernel/11_EVENT_BUS.md), and an event that can be edited after the
 * fact is not an audit trail. There are deliberately no audit columns —
 * `timestamp` is the only time that means anything for an immutable record.
 *
 * This is a Postgres table rather than a dedicated event store; per the
 * MVP-first decision recorded in docs/data/05_EVENT_STORE.md, Kafka/EventStore
 * is the later upgrade once volume or replay needs outgrow this.
 */
export const executionEvents = pgTable(
  "execution_events",
  {
    id: idColumn(),
    type: varchar("type", { length: 80 }).notNull(),
    source: varchar("source", { length: 60 }).notNull(),

    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    // No FK to executions: events must survive their Execution being archived
    // or purged, otherwise the audit trail disappears exactly when it is
    // needed for a post-mortem.
    executionId: varchar("execution_id", { length: ID_LENGTH }),
    taskId: varchar("task_id", { length: ID_LENGTH }),

    correlationId: varchar("correlation_id", { length: 64 }).notNull(),
    /** Payload schema version — consumers must handle older ones. */
    version: integer("version").notNull().default(1),

    payload: jsonb("payload").notNull().default({}),
    metadata: jsonb("metadata").notNull().default({}),

    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The trace query: everything that happened in one run, in order.
    index("execution_events_execution_idx").on(
      table.executionId,
      table.timestamp,
    ),
    index("execution_events_correlation_idx").on(table.correlationId),
    index("execution_events_workspace_idx").on(
      table.workspaceId,
      table.timestamp,
    ),
    index("execution_events_type_idx").on(table.type),
  ],
);
