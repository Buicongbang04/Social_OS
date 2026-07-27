import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { ID_LENGTH, idColumn, idRef } from "./_shared";
import { organizations } from "./organizations";
import { workspaces } from "./workspaces";

/**
 * One metered AI provider call, per docs/platform/24_BILLING_METERING.md.
 *
 * Insert-only and never updated, for the same reason `execution_events` is:
 * this is the meter reading an invoice is derived from, and a number that can
 * be edited after the fact is not a meter. There are deliberately no audit
 * columns — `timestamp` is the only time that means anything here.
 *
 * The doc's generic Usage Record is (resource, quantity, unit). That shape
 * cannot hold "2,300 in and 850 out" — the doc's own AI example — in one row
 * without either splitting it across two rows or hiding it in JSON, and both
 * make the cost query worse. So this is the AI-specific meter with the
 * dimensions the doc names (workspace, organization, user, provider, model,
 * time, feature) as real columns; a generic usage view can be projected over
 * it later.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: idColumn(),

    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    organizationId: idRef("organization_id")
      .notNull()
      .references(() => organizations.id),
    /** Null for calls the runtime makes on its own behalf, e.g. a scheduled run. */
    userId: varchar("user_id", { length: ID_LENGTH }),

    // No FKs: a usage record must survive its Execution being archived or
    // purged, otherwise last quarter's bill stops being reconstructable
    // exactly when someone disputes it.
    executionId: varchar("execution_id", { length: ID_LENGTH }),
    taskId: varchar("task_id", { length: ID_LENGTH }),
    correlationId: varchar("correlation_id", { length: 64 }),

    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    /** What the call was for — the doc's "Feature" dimension. */
    operation: varchar("operation", { length: 60 }).notNull(),

    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /**
     * Kept separately so Billing can apply each vendor's cache discount later.
     * The gateway charges these at the full input rate on purpose rather than
     * guessing a discount it cannot verify.
     */
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),

    /**
     * Numeric, not double precision: money summed in floating point drifts,
     * and this column is aggregated across a month's rows to produce a bill.
     * Eight decimal places because a single cheap call can cost well under a
     * cent.
     */
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 })
      .notNull()
      .default("0"),
    /**
     * False when no price was known for the model. Without this, an unpriced
     * call is indistinguishable from a free one and a report quietly
     * understates spend.
     */
    costPriced: boolean("cost_priced").notNull().default(false),

    latencyMs: integer("latency_ms").notNull().default(0),
    finishReason: varchar("finish_reason", { length: 30 }),

    metadata: jsonb("metadata").notNull().default({}),

    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The billing query: everything one workspace spent in a period.
    index("ai_usage_workspace_idx").on(table.workspaceId, table.timestamp),
    index("ai_usage_organization_idx").on(
      table.organizationId,
      table.timestamp,
    ),
    // The attribution query: what one run cost.
    index("ai_usage_execution_idx").on(table.executionId),
    // The vendor query: spend split by provider and model.
    index("ai_usage_provider_idx").on(
      table.provider,
      table.model,
      table.timestamp,
    ),
  ],
);
