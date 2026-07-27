import type { AiUsageRecord, AiUsageRecorder } from "@repo/ai";
import type { ExecutionId, WorkspaceId } from "@repo/core";
import type { SpendReader } from "@repo/runtime";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";
import { aiUsage, workspaces } from "../schema";

/**
 * Persists metered provider calls.
 *
 * Insert-only. There is deliberately no update or delete method: this table is
 * what an invoice is derived from, and a repository that can rewrite it is a
 * repository that can rewrite a bill.
 */
export class DrizzleAiUsageRepository implements AiUsageRecorder, SpendReader {
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
   * What one execution has spent so far.
   *
   * Summed in SQL: this is read before every task to decide whether the run may
   * continue, and pulling every row into JS to add them would get slower as the
   * run gets longer — exactly the runs that most need the check.
   */
  async spentUsd(executionId: ExecutionId): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
      })
      .from(aiUsage)
      .where(eq(aiUsage.executionId, executionId));

    return Number(row?.total ?? 0);
  }

  /**
   * Every metered call made for one execution, oldest first.
   *
   * Takes no userId: callers reach this only after resolving the Execution
   * through a membership-scoped read, so authorisation has already happened
   * and re-deriving it here would be a second, divergent rule.
   */
  async listByExecution(executionId: string): Promise<
    readonly {
      id: string;
      operation: string;
      provider: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: string;
      costPriced: boolean;
      latencyMs: number;
      timestamp: Date;
    }[]
  > {
    return this.db
      .select({
        id: aiUsage.id,
        operation: aiUsage.operation,
        provider: aiUsage.provider,
        model: aiUsage.model,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        totalTokens: aiUsage.totalTokens,
        costUsd: aiUsage.costUsd,
        costPriced: aiUsage.costPriced,
        latencyMs: aiUsage.latencyMs,
        timestamp: aiUsage.timestamp,
      })
      .from(aiUsage)
      .where(eq(aiUsage.executionId, executionId))
      .orderBy(asc(aiUsage.timestamp));
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
