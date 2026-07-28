import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_PRICING, costOf, priceOf } from "./pricing";
import type { TokenUsage } from "./types";

const usage = (input: number, output: number): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});

describe("model pricing", () => {
  it("prices a call from the published per-million rates", () => {
    // claude-sonnet-5 is $3 in / $15 out per million.
    const cost = costOf(
      usage(1_000_000, 200_000),
      priceOf("anthropic", "claude-sonnet-5"),
    );

    expect(cost.inputUsd).toBeCloseTo(3, 10);
    expect(cost.outputUsd).toBeCloseTo(3, 10);
    expect(cost.totalUsd).toBeCloseTo(6, 10);
    expect(cost.priced).toBe(true);
  });

  it("reports an unknown model as unpriced rather than free", () => {
    // The distinction matters: a report that sums unknown-price calls as $0
    // understates spend and nobody notices until the invoice arrives.
    const cost = costOf(usage(500_000, 500_000), priceOf("openai", "gpt-nope"));

    expect(cost.priced).toBe(false);
    expect(cost.totalUsd).toBe(0);
  });

  it("treats local Ollama inference as a known zero, not an unknown", () => {
    const cost = costOf(usage(900_000, 900_000), priceOf("ollama", "llama3.1"));

    expect(cost.priced).toBe(true);
    expect(cost.totalUsd).toBe(0);
  });

  it("accepts an overriding price table so a vendor change needs no release", () => {
    const cost = costOf(usage(1_000_000, 0), {
      inputUsdPerMillion: 42,
      outputUsdPerMillion: 0,
    });

    expect(cost.totalUsd).toBeCloseTo(42, 10);
  });

  it("looks up an overridden table ahead of the built-in one", () => {
    const price = priceOf("anthropic", "claude-sonnet-5", {
      "anthropic:claude-sonnet-5": {
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 2,
      },
    });

    expect(price).toEqual({ inputUsdPerMillion: 1, outputUsdPerMillion: 2 });
  });

  it("charges cached input at the full rate, as a deliberate upper bound", () => {
    // Cache discounts differ per vendor and per model. Overstating is safe;
    // guessing a discount we cannot verify would undercharge the workspace.
    // The raw cached count survives on TokenUsage for Billing to re-price.
    const withCache: TokenUsage = {
      ...usage(1_000_000, 0),
      cachedInputTokens: 900_000,
    };

    const cost = costOf(withCache, priceOf("anthropic", "claude-sonnet-5"));

    expect(cost.totalUsd).toBeCloseTo(3, 10);
    expect(withCache.cachedInputTokens).toBe(900_000);
  });

  it("keys every built-in entry as provider:model", () => {
    for (const key of Object.keys(DEFAULT_MODEL_PRICING)) {
      expect(key).toMatch(/^(anthropic|openai|google|ollama):.+/);
    }
  });
});

describe("OpenRouter pricing", () => {
  it("prices a model through the vendor its id names", () => {
    // Listing several hundred OpenRouter ids by hand would be stale in a week;
    // the id already carries the vendor whose price this table holds.
    expect(priceOf("openrouter", "anthropic/claude-sonnet-5")).toEqual(
      priceOf("anthropic", "claude-sonnet-5"),
    );
    expect(priceOf("openrouter", "openai/gpt-5.4")).toEqual(
      priceOf("openai", "gpt-5.4"),
    );
  });

  it("reports a model it has no price for as unpriced, not as free", () => {
    // The distinction `priced` exists for: an unknown price and a genuine zero
    // must not be summed into the same report.
    expect(priceOf("openrouter", "someone-else/unknown-model")).toBeNull();
    expect(priceOf("openrouter", "no-slash-at-all")).toBeNull();
  });

  it("does not treat an OpenRouter model as locally free", () => {
    // Ollama's zero is real. Routing a hosted model through OpenRouter is not
    // free, and inheriting that branch would bill every call at nothing.
    const cost = costOf(
      {
        inputTokens: 1_000_000,
        outputTokens: 0,
        totalTokens: 1_000_000,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      priceOf("openrouter", "anthropic/claude-sonnet-5"),
    );

    expect(cost.priced).toBe(true);
    expect(cost.totalUsd).toBeCloseTo(3, 10);
  });
});
