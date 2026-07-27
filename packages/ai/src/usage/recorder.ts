import { newId } from "@repo/core";
import type {
  AiUsageId,
  ExecutionId,
  Metadata,
  TaskId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type {
  Cost,
  FinishReason,
  ProviderName,
  ProviderResponse,
  TokenUsage,
} from "../provider/types";

/**
 * One metered provider call, per docs/platform/24_BILLING_METERING.md.
 *
 * Carries both the priced figure and the raw token counts. The price is our
 * arithmetic against a table that can be wrong or out of date; the tokens are
 * what the vendor actually reported, and are what a later re-pricing has to
 * work from.
 *
 * There is no organizationId: it is derivable from the workspace, and asking
 * every caller to carry it invites the two disagreeing. The repository fills
 * the denormalised column in from the workspace on insert.
 */
export type AiUsageRecord = {
  id: AiUsageId;
  workspaceId: WorkspaceId;
  /** Null for work the runtime does on its own behalf, e.g. a scheduled run. */
  userId: UserId | null;
  executionId: ExecutionId | null;
  taskId: TaskId | null;
  correlationId: string | null;
  provider: ProviderName;
  model: string;
  /** What the call was for, e.g. "intent.analyze". */
  operation: string;
  usage: TokenUsage;
  cost: Cost;
  latencyMs: number;
  finishReason: FinishReason;
  metadata: Metadata;
  timestamp: Date;
};

/** Where usage records go. Implemented against Postgres in @repo/database. */
export interface AiUsageRecorder {
  record(record: AiUsageRecord): Promise<void>;
}

/** Everything about a call except what the provider returned. */
export type UsageContext = {
  workspaceId: WorkspaceId;
  userId?: UserId | null;
  executionId?: ExecutionId | null;
  taskId?: TaskId | null;
  correlationId?: string | null;
  operation: string;
};

export function usageRecordFrom(
  response: ProviderResponse,
  context: UsageContext,
): AiUsageRecord {
  return {
    id: newId("aiUsage"),
    workspaceId: context.workspaceId,
    userId: context.userId ?? null,
    executionId: context.executionId ?? null,
    taskId: context.taskId ?? null,
    correlationId: context.correlationId ?? null,
    provider: response.provider,
    model: response.model,
    operation: context.operation,
    usage: response.usage,
    cost: response.cost,
    latencyMs: response.latencyMs,
    finishReason: response.finishReason,
    metadata: response.metadata,
    timestamp: new Date(),
  };
}

/**
 * Record usage without letting a metering failure fail the work.
 *
 * By the time this runs the provider has already answered and we have already
 * been charged, so throwing here would turn a database hiccup into a failed
 * user request while still costing the money. Losing the row silently is just
 * as bad in the other direction — it is revenue that never gets billed — so
 * the failure is always surfaced, never swallowed.
 */
export async function recordUsageSafely(
  recorder: AiUsageRecorder,
  record: AiUsageRecord,
  onError: (error: unknown, record: AiUsageRecord) => void = defaultOnError,
): Promise<void> {
  try {
    await recorder.record(record);
  } catch (error) {
    onError(error, record);
  }
}

function defaultOnError(error: unknown, record: AiUsageRecord): void {
  // Deliberately noisy rather than a silent no-op: an unrecorded call is
  // unbilled revenue, and a service that has not wired its own handler should
  // still find out.
  console.error(
    `[ai-usage] failed to record ${record.operation} on ${record.provider}/${record.model} for workspace ${record.workspaceId}:`,
    error,
  );
}

/** Collects records in memory. For tests and for local runs with no database. */
export class InMemoryUsageRecorder implements AiUsageRecorder {
  readonly records: AiUsageRecord[] = [];

  async record(record: AiUsageRecord): Promise<void> {
    this.records.push(record);
  }

  totalUsd(): number {
    return this.records.reduce((sum, r) => sum + r.cost.totalUsd, 0);
  }

  totalTokens(): number {
    return this.records.reduce((sum, r) => sum + r.usage.totalTokens, 0);
  }
}
