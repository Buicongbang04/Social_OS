import type { Metrics } from "./metrics";

/**
 * Anything that can be asked to record one provider call.
 *
 * Declared here rather than imported from `@repo/ai` so this package does not
 * depend on that one. Observability watching the AI layer must not be a reason
 * the AI layer cannot be built or tested on its own.
 */
export type UsageLike = {
  provider: string;
  model: string;
  latencyMs: number;
  finishReason: string;
};

export type Recorder<T extends UsageLike> = {
  record(record: T): Promise<void>;
};

/**
 * Count and time provider calls on the way to the ledger.
 *
 * A decorator rather than a hook inside the repository: the repository writes
 * the accounting record, which has to be exact, and this is for watching, which
 * is allowed to be lost on a restart. Putting both in one place would make the
 * ledger depend on the metrics being healthy.
 *
 * The metric is incremented **after** the row is written, so a scrape can never
 * show a call the ledger does not have. The other order would make the two
 * disagree in the direction that looks like missing revenue.
 */
export function withMetrics<T extends UsageLike>(
  recorder: Recorder<T>,
  metrics: Metrics,
): Recorder<T> {
  return {
    async record(record: T): Promise<void> {
      await recorder.record(record);

      const labels = { provider: record.provider, model: record.model };
      metrics.aiCalls.inc({ ...labels, outcome: record.finishReason });
      metrics.aiDuration.observe(labels, record.latencyMs / 1000);
    },
  };
}
