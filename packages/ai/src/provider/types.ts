import type { Metadata } from "@repo/core";

/** A JSON Schema document, as sent to the provider. */
export type JsonSchema = Record<string, unknown>;

/**
 * A shape the model must produce, plus the check that it did.
 *
 * Deliberately not a zod type. The Gateway hands the schema to a vendor as
 * JSON Schema and hands the answer back to whoever asked, so binding this
 * interface to one validation library would force every consumer onto that
 * library's release schedule — and the AI SDK's own generic schema parameter
 * does not typecheck against the zod major this repo is on. `structured()`
 * builds one of these from a zod schema for callers who want that.
 */
export type StructuredSchema<T> = {
  name: string;
  description?: string;
  jsonSchema: JsonSchema;
  /** Returns the validated value or throws. */
  parse(value: unknown): T;
};

/**
 * Providers with an adapter today.
 *
 * docs/runtime/05_PROVIDER_GATEWAY.md lists fifteen candidates. These four are
 * the ones ROADMAP Phase 2 actually commits to, and adding a fifth is a new
 * adapter file — no change to anything below.
 */
export const PROVIDER_NAMES = [
  "anthropic",
  "openai",
  "google",
  "ollama",
] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

export function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

export const MESSAGE_ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export type ProviderMessage = {
  role: MessageRole;
  content: string;
};

/**
 * A tool the model may call.
 *
 * Deliberately has no implementation: the Gateway reports the call and the
 * caller runs it. A Gateway that executed tools itself would be running
 * workspace side effects outside the Runtime's policy and audit path.
 */
export type ProviderTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type ResponseFormat = { type: "text" } | { type: "json" };

/**
 * The one request shape the whole Runtime uses, per the doc's Unified Request
 * Model. Each adapter converts it to its own provider's wire format.
 *
 * `provider` and `model` are optional: leave them out and the Gateway picks
 * from configuration (and may fall back). Set `provider` and you pin it —
 * see ProviderGateway for why pinning disables fallback.
 */
export type ProviderRequest = {
  provider?: ProviderName;
  model?: string;
  messages: readonly ProviderMessage[];
  tools?: readonly ProviderTool[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
  metadata?: Metadata;
};

export const FINISH_REASONS = [
  "stop",
  "length",
  "tool-calls",
  "content-filter",
  "error",
  "other",
] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];

/**
 * Raw token counts, always recorded even when the model has no price entry.
 *
 * Billing re-prices from these numbers rather than trusting `Cost`
 * (docs/platform/24_BILLING_METERING.md), so a price-table gap costs accuracy
 * in reporting but never loses the underlying meter reading.
 */
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
};

export type ProviderToolCall = {
  id: string;
  name: string;
  input: unknown;
};

/**
 * The doc shows `cost` as a single number. A single number cannot distinguish
 * "this ran on local Ollama and genuinely cost nothing" from "we have no price
 * for this model", and those two must not be summed into the same report —
 * hence `priced`. `totalUsd` is the doc's scalar.
 */
export type Cost = {
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
  priced: boolean;
};

/**
 * The one response shape, per the doc's Unified Response Model. `latency` is
 * spelled `latencyMs` to match the unit-suffixed names used everywhere else in
 * the repo (`timeoutMs`, `maxDelayMs`).
 */
export type ProviderResponse = {
  provider: ProviderName;
  model: string;
  text: string;
  toolCalls: readonly ProviderToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  latencyMs: number;
  cost: Cost;
  metadata: Metadata;
};

/**
 * One piece of a streaming answer.
 *
 * Deliberately three shapes, not the vendor SDK's two dozen. The whole point of
 * this package is that a caller writes against one surface no matter which
 * vendor answered, and a union that grows every time a vendor ships a feature
 * is not that surface. Reasoning traces, source citations and raw frames are
 * dropped rather than passed through: nothing here consumes them yet, and a
 * field that exists but is never read is a promise this layer has not kept.
 */
export type StreamChunk =
  /** A fragment of the answer, in order. Never the whole text so far. */
  | { type: "text"; delta: string }
  | { type: "tool-call"; call: ProviderToolCall }
  /**
   * The last chunk, carrying exactly what `generate()` would have returned.
   *
   * Usage and cost are only knowable here — a vendor reports token counts when
   * the response ends — so metering happens on this chunk and nowhere else. A
   * stream that fails partway never produces one, and the tokens generated
   * before the failure were still charged; see `ProviderStreamError`.
   */
  | { type: "done"; response: ProviderResponse };

/**
 * A stream that died after the caller had already seen part of the answer.
 *
 * Carries what was produced so far, because two things are true at once: the
 * answer is unusable, and the vendor has already billed for the tokens behind
 * it. Throwing a bare error would lose the second, and a workspace's bill would
 * quietly understate what it spent.
 */
export type StreamFailure = {
  textSoFar: string;
  usage: TokenUsage;
};

/** A ProviderResponse whose text was parsed and validated against a schema. */
export type ProviderObjectResponse<T> = ProviderResponse & { object: T };

/** One text turned into a vector, plus what it cost to do so. */
export type EmbeddingResult = {
  model: string;
  /** Same order as the input texts. */
  vectors: readonly (readonly number[])[];
  /** Length of each vector. Constant for a given model. */
  dimensions: number;
  usage: TokenUsage;
};

export type EmbeddingRequest = {
  provider?: ProviderName;
  model?: string;
  texts: readonly string[];
};

/**
 * What an adapter hands back. No latency and no cost: the Gateway measures and
 * prices centrally so every provider is treated identically and an adapter
 * cannot under-report what it charged.
 */
export type AdapterResult = {
  model: string;
  text: string;
  toolCalls: readonly ProviderToolCall[];
  usage: TokenUsage;
  finishReason: FinishReason;
  metadata: Metadata;
};

/**
 * One provider's transport and shape mapping — nothing else.
 *
 * No retry, no fallback, no pricing, no status tracking. Those live in the
 * Gateway, so they behave the same no matter which vendor answered.
 */
export interface ProviderAdapter {
  readonly provider: ProviderName;
  readonly defaultModel: string;
  generate(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): Promise<AdapterResult>;
  generateObject<T>(
    request: ProviderRequest,
    schema: StructuredSchema<T>,
    signal?: AbortSignal,
  ): Promise<AdapterResult & { object: T }>;
  /**
   * Turn texts into vectors.
   *
   * Optional because not every vendor offers embeddings — Anthropic has no
   * embedding API at all. Declaring it optional means the Gateway can skip a
   * provider that cannot do this rather than failing the whole chain, and the
   * absence is visible in the type instead of surfacing as a runtime error.
   */
  embed?(
    request: EmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<EmbeddingResult>;

  /**
   * The same request as `generate`, delivered in pieces.
   *
   * Optional for the same reason `embed` is: an adapter that cannot stream
   * should be skippable rather than a hole the Gateway falls into at runtime.
   *
   * The adapter yields text deltas and tool calls and finishes with the usage
   * and finish reason; latency and pricing stay in the Gateway, exactly as
   * they do for `generate`.
   */
  stream?(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AdapterStreamChunk, void, undefined>;
}

/** What an adapter yields. No latency, no cost — the Gateway adds those. */
export type AdapterStreamChunk =
  | { type: "text"; delta: string }
  | { type: "tool-call"; call: ProviderToolCall }
  | { type: "done"; result: AdapterResult };

export const EMPTY_USAGE: TokenUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});
