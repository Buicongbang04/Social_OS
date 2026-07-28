import { describe, expect, it } from "vitest";
import { Metrics } from "./metrics";
import { withMetrics } from "./usage-metrics";

const call = {
  provider: "anthropic",
  model: "claude-test",
  latencyMs: 1500,
  finishReason: "stop",
};

describe("withMetrics", () => {
  it("counts and times a call once the ledger has it", async () => {
    const metrics = new Metrics({ defaultMetrics: false });
    const written: unknown[] = [];

    await withMetrics(
      { record: async (r) => void written.push(r) },
      metrics,
    ).record(call);

    const text = await metrics.scrape();
    expect(written).toHaveLength(1);
    expect(text).toContain(
      'ai_provider_calls_total{provider="anthropic",model="claude-test",outcome="stop"} 1',
    );
    expect(text).toContain(
      'ai_provider_duration_seconds_sum{provider="anthropic",model="claude-test"} 1.5',
    );
  });

  it("counts nothing when the ledger write failed", async () => {
    // The other order would let a scrape show a call the ledger does not have,
    // and the two would disagree in the direction that looks like missing
    // revenue.
    const metrics = new Metrics({ defaultMetrics: false });
    const failing = {
      record: async () => {
        throw new Error("cơ sở dữ liệu hỏng");
      },
    };

    await expect(withMetrics(failing, metrics).record(call)).rejects.toThrow();
    expect(await metrics.scrape()).not.toContain("ai_provider_calls_total{");
  });

  it("separates outcomes, so a run of failures is visible", async () => {
    const metrics = new Metrics({ defaultMetrics: false });
    const recorder = withMetrics({ record: async () => undefined }, metrics);

    await recorder.record(call);
    await recorder.record({ ...call, finishReason: "error" });

    const text = await metrics.scrape();
    expect(text).toContain('outcome="stop"} 1');
    expect(text).toContain('outcome="error"} 1');
  });
});
