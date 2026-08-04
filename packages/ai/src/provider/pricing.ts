import type { Cost, ProviderName, TokenUsage } from "./types";

/** Published list price, in USD per one million tokens. */
export type ModelPrice = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

/**
 * Model list prices, keyed `provider:model`.
 *
 * These are a snapshot, checked against each vendor's public pricing page on
 * 2026-07-27. Prices move, so this table is only a default: pass your own to
 * ProviderGateway to override it without a release. An unlisted model is
 * reported `priced: false` rather than guessed at — see costOf.
 *
 * Ollama runs locally, so every Ollama model is a real zero rather than an
 * unknown one.
 */
export const DEFAULT_MODEL_PRICING: Readonly<Record<string, ModelPrice>> =
  Object.freeze({
    // Anthropic — platform.claude.com/docs/en/pricing
    "anthropic:claude-fable-5": {
      inputUsdPerMillion: 10,
      outputUsdPerMillion: 50,
    },
    "anthropic:claude-opus-5": {
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 25,
    },
    "anthropic:claude-opus-4-8": {
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 25,
    },
    "anthropic:claude-opus-4-7": {
      inputUsdPerMillion: 5,
      outputUsdPerMillion: 25,
    },
    "anthropic:claude-sonnet-5": {
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    },
    "anthropic:claude-sonnet-4-6": {
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    },
    "anthropic:claude-haiku-4-5": {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 5,
    },

    // OpenAI — developers.openai.com/api/docs/pricing
    "openai:gpt-5.6-sol": { inputUsdPerMillion: 5, outputUsdPerMillion: 30 },
    "openai:gpt-5.6-terra": {
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
    },
    "openai:gpt-5.6-luna": { inputUsdPerMillion: 1, outputUsdPerMillion: 6 },
    "openai:gpt-5.5": { inputUsdPerMillion: 5, outputUsdPerMillion: 30 },
    "openai:gpt-5.4": { inputUsdPerMillion: 2.5, outputUsdPerMillion: 15 },
    "openai:gpt-5.4-mini": {
      inputUsdPerMillion: 0.75,
      outputUsdPerMillion: 4.5,
    },
    "openai:gpt-5.4-nano": {
      inputUsdPerMillion: 0.2,
      outputUsdPerMillion: 1.25,
    },

    // Google — ai.google.dev/gemini-api/docs/pricing. The Pro tiers charge more
    // above a 200k-token prompt; we record the base rate, which is why costOf
    // is documented as an estimate and Billing re-prices from raw tokens.
    "google:gemini-3.6-flash": {
      inputUsdPerMillion: 1.5,
      outputUsdPerMillion: 7.5,
    },
    "google:gemini-3.5-flash": {
      inputUsdPerMillion: 1.5,
      outputUsdPerMillion: 9,
    },
    "google:gemini-3.5-flash-lite": {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
    },
    "google:gemini-2.5-pro": {
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 10,
    },
    // Vertex bills an image as output tokens — about 1,290 of them, which at
    // this rate is roughly $0.039 a picture. There is no free tier for it,
    // unlike the text models above.
    "google:gemini-2.5-flash-image": {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 30,
    },
    "google:gemini-2.5-flash": {
      inputUsdPerMillion: 0.3,
      outputUsdPerMillion: 2.5,
    },
    "google:gemini-2.5-flash-lite": {
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0.4,
    },
  });

export function priceKey(provider: ProviderName, model: string): string {
  return `${provider}:${model}`;
}

export function priceOf(
  provider: ProviderName,
  model: string,
  table: Readonly<Record<string, ModelPrice>> = DEFAULT_MODEL_PRICING,
): ModelPrice | null {
  const listed = table[priceKey(provider, model)];
  if (listed) return listed;

  // Local inference has no per-token charge; that is a known zero, not a gap.
  if (provider === "ollama") {
    return { inputUsdPerMillion: 0, outputUsdPerMillion: 0 };
  }

  /**
   * OpenRouter ids carry their vendor — `anthropic/claude-sonnet-5` — so the
   * price of the underlying model is already in this table under that vendor.
   * Listing several hundred OpenRouter ids by hand would be stale in a week.
   *
   * This is the vendor's list price, not necessarily what OpenRouter charges:
   * it routes to whichever host is available and takes its margin on credits
   * rather than per token. Spot-checked against OpenRouter's own published
   * per-token figures on 2026-07-28, where claude-opus-5 matched exactly. An
   * id whose vendor prefix is not one we know still comes back unpriced, which
   * is the honest answer.
   */
  if (provider === "openrouter") {
    const slash = model.indexOf("/");
    if (slash > 0) {
      const vendor = model.slice(0, slash);
      const bare = model.slice(slash + 1);
      return table[priceKey(vendor as ProviderName, bare)] ?? null;
    }
  }

  return null;
}

export const UNPRICED: Cost = Object.freeze({
  inputUsd: 0,
  outputUsd: 0,
  totalUsd: 0,
  priced: false,
});

/**
 * Price one call.
 *
 * An upper bound, on purpose: cached input tokens usually bill below the
 * standard input rate, but the discount differs per vendor and per model, and
 * quietly applying a rate we are not sure of would understate what the
 * workspace owes. `usage.cachedInputTokens` is carried through untouched so
 * Billing can apply the exact discount later.
 */
export function costOf(usage: TokenUsage, price: ModelPrice | null): Cost {
  if (!price) return UNPRICED;

  const inputUsd = (usage.inputTokens / 1_000_000) * price.inputUsdPerMillion;
  const outputUsd =
    (usage.outputTokens / 1_000_000) * price.outputUsdPerMillion;

  return {
    inputUsd,
    outputUsd,
    totalUsd: inputUsd + outputUsd,
    priced: true,
  };
}
