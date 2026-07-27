import type { AiUsageRecord, AiUsageRecorder } from "@repo/ai";
import type { WorkspaceId } from "@repo/core";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { aiUsage, workspaces } from "../schema";

/**
 * Persists metered provider calls.
 *
 * Insert-only. There is deliberately no update or delete method: this table is
 * what an invoice is derived from, and a repository that can rewrite it is a
 * repository that can rewrite a bill.
 */
export class DrizzleAiUsageRepository implements AiUsageRecorder {
  constructor(private readonly db: DatabaseClient) {}

  async record(record: AiUsageRecord): Promise<void> {
    await this.db.insert(aiUsage).values({
      id: record.id,
      workspaceId: record.workspaceId,
      // Derived rather than passed in. The caller has a Goal, which carries a
      // workspace but no organization; asking it to supply one anyway invites
      // the two disagreeing, and this column exists only so the billing
      // roll-up does not need a join.
      organizationId: sql`(select ${workspaces.organizationId} from ${workspaces} where ${workspaces.id} = ${record.workspaceId})`,
      userId: record.userId,
      executionId: record.executionId,
      taskId: record.taskId,
      correlationId: record.correlationId,
      provider: record.provider,
      model: record.model,
      operation: record.operation,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      totalTokens: record.usage.totalTokens,
      cachedInputTokens: record.usage.cachedInputTokens,
      reasoningTokens: record.usage.reasoningTokens,
      // Passed as a string so the exact decimal reaches Postgres untouched.
      // Handing a JS number to a numeric column round-trips through binary
      // floating point, which is how a fraction of a cent goes missing per row.
      costUsd: record.cost.totalUsd.toFixed(8),
      costPriced: record.cost.priced,
      latencyMs: record.latencyMs,
      finishReason: record.finishReason,
      metadata: record.metadata,
      timestamp: record.timestamp,
    });
  }

  /**
   * What one workspace spent over a period.
   *
   * Summed in SQL rather than in JavaScript: `numeric` addition in Postgres is
   * exact, whereas pulling a month of rows into JS and adding them accumulates
   * floating-point error in the one number nobody wants to be approximate.
   */
  async summarise(
    workspaceId: WorkspaceId,
    from: Date,
    to: Date,
  ): Promise<{
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    /** Calls whose model had no price. Their cost is missing from the total. */
    unpricedCalls: number;
  }> {
    const [row] = await this.db
      .select({
        calls: sql<number>`count(*)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
        costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
        unpricedCalls: sql<number>`count(*) filter (where not ${aiUsage.costPriced})::int`,
      })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.workspaceId, workspaceId),
          gte(aiUsage.timestamp, from),
          lte(aiUsage.timestamp, to),
        ),
      );

    return (
      row ?? {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: "0",
        unpricedCalls: 0,
      }
    );
  }
}
