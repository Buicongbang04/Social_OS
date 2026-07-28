import {
  DEFAULT_RETRY_POLICY,
  retryDelayMs,
  RuntimeError,
} from "@repo/runtime";
import {
  classifyFailure,
  isWorthFallingBackFrom,
  ProviderStreamError,
  toRuntimeError,
  type ProviderFailure,
} from "./errors";
import { costOf, priceOf, type ModelPrice } from "./pricing";
import { EMPTY_USAGE, type Cost } from "./types";
import type { ProviderRegistry } from "./registry";
import type {
  AdapterResult,
  EmbeddingRequest,
  EmbeddingResult,
  ProviderAdapter,
  ProviderName,
  ProviderObjectResponse,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
  StructuredSchema,
} from "./types";

/** An embedding result plus what the Gateway measured and priced. */
export type ProviderEmbedding = EmbeddingResult & {
  provider: ProviderName;
  latencyMs: number;
  cost: Cost;
};

/**
 * Gateway configuration, mirroring the `providers:` block in
 * docs/runtime/19_RUNTIME_CONFIGURATION.md (default / fallback / timeout /
 * retry).
 */
export type GatewayConfig = {
  default: ProviderName;
  fallback: readonly ProviderName[];
  timeoutMs: number;
  /** Attempts per provider, including the first. 1 disables retry. */
  attempts: number;
  pricing?: Readonly<Record<string, ModelPrice>>;
};

export const DEFAULT_GATEWAY_CONFIG: Omit<GatewayConfig, "default"> =
  Object.freeze({
    fallback: [],
    // docs/runtime/19_RUNTIME_CONFIGURATION.md: `timeout: 60s, retry: 3`.
    timeoutMs: 60_000,
    attempts: 3,
  });

/** Seams so tests do not sleep in real time. */
export type GatewayClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

const REAL_CLOCK: GatewayClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/**
 * The only way the Runtime talks to a model vendor.
 *
 * Everything a worker would otherwise have to repeat — retry with backoff,
 * falling through to another vendor, measuring latency, converting tokens to
 * money, keeping provider health current — happens once, here. A worker sees
 * one request type and one response type and never learns who answered.
 */
export class ProviderGateway {
  private readonly clock: GatewayClock;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: GatewayConfig,
    clock: Partial<GatewayClock> = {},
  ) {
    this.clock = { ...REAL_CLOCK, ...clock };
  }

  /** Free-form completion. */
  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    return this.run(request, (adapter, signal) =>
      adapter.generate(request, signal),
    );
  }

  /**
   * Completion constrained to a schema.
   *
   * Callers that must parse the answer — the Intent analyzer, the Planner —
   * use this instead of parsing free text, so the model cannot return
   * something structurally unusable.
   */
  async generateObject<T>(
    request: ProviderRequest,
    schema: StructuredSchema<T>,
  ): Promise<ProviderObjectResponse<T>> {
    let parsed: T | undefined;

    const response = await this.run(request, async (adapter, signal) => {
      const result = await adapter.generateObject(request, schema, signal);
      parsed = result.object;
      return result;
    });

    // `run` only returns after a successful call, and every success path above
    // assigns. Kept as a narrow rather than a cast so a future refactor that
    // breaks the invariant fails loudly instead of shipping `undefined`.
    if (parsed === undefined) {
      throw new RuntimeError(
        "INTERNAL",
        "The gateway returned a structured response with no parsed object.",
      );
    }
    return { ...response, object: parsed };
  }

  /**
   * Turn texts into vectors.
   *
   * Skips any provider that cannot embed rather than failing on it: Anthropic
   * has no embedding API, so a chain of `anthropic,openai` must quietly use
   * OpenAI here while still preferring Anthropic for generation.
   */
  async embed(request: EmbeddingRequest): Promise<ProviderEmbedding> {
    // Resolved once, into pairs, rather than filtered here and re-checked in
    // the loop: two guards for one fact means one of them is dead, and a dead
    // guard reads as protection that is not there.
    const chain = this.chainFor(request).flatMap((provider) => {
      const adapter = this.registry.get(provider)?.adapter;
      // Bound on purpose. Pulling a method off an object drops its `this`, and
      // the real adapters are classes that use it — the stub is an arrow
      // function, so it would not have shown the breakage until production.
      return adapter?.embed
        ? [{ provider, embed: adapter.embed.bind(adapter) }]
        : [];
    });

    if (chain.length === 0) {
      throw new RuntimeError(
        "PROVIDER",
        request.provider
          ? `Provider ${request.provider} cannot produce embeddings.`
          : "No registered provider can produce embeddings.",
        { retryable: false, context: { requested: request.provider ?? null } },
      );
    }

    const attempted: ProviderName[] = [];
    let lastFailure: ProviderFailure | null = null;
    let lastCause: unknown;
    let lastModel = "";

    for (const { provider, embed } of chain) {
      attempted.push(provider);

      for (let attempt = 1; attempt <= this.config.attempts; attempt += 1) {
        const startedAt = this.clock.now();
        try {
          const result = await embed(
            request,
            AbortSignal.timeout(this.config.timeoutMs),
          );
          lastModel = result.model;
          this.registry.markHealthy(provider);

          return {
            provider,
            ...result,
            latencyMs: this.clock.now() - startedAt,
            cost: costOf(
              result.usage,
              priceOf(provider, result.model, this.config.pricing),
            ),
          };
        } catch (error) {
          const failure = classifyFailure(error);
          lastFailure = failure;
          lastCause = error;

          if (failure.demoteTo) {
            this.registry.transition(
              provider,
              failure.demoteTo,
              failure.message,
            );
          }
          if (!isWorthFallingBackFrom(failure)) {
            throw toRuntimeError(
              failure,
              { provider, model: lastModel, attempted },
              error,
            );
          }
          if (attempt < this.config.attempts) {
            await this.clock.sleep(retryDelayMs(DEFAULT_RETRY_POLICY, attempt));
          }
        }
      }
    }

    throw toRuntimeError(
      lastFailure ?? {
        retryable: false,
        demoteTo: null,
        statusCode: undefined,
        message: "No provider in the chain produced embeddings.",
      },
      { provider: chain[0]?.provider as ProviderName, model: lastModel, attempted },
      lastCause,
    );
  }

  /**
   * Which providers to try, in order.
   *
   * A caller that names a provider gets exactly that provider. Falling back
   * from an explicit choice would substitute a different vendor — a different
   * price, a different data-residency story, possibly a different answer —
   * behind the back of someone who was specific on purpose.
   */
  private chainFor(request: {
    provider?: ProviderName;
  }): readonly ProviderName[] {
    if (request.provider) {
      // Still filtered by registration, so an unregistered pin reports "not
      // registered" rather than the generic exhausted-chain message.
      return this.registry.has(request.provider) ? [request.provider] : [];
    }

    const ordered = [this.config.default, ...this.config.fallback];
    const seen = new Set<ProviderName>();
    const chain = ordered.filter((name) => {
      if (seen.has(name) || !this.registry.has(name)) return false;
      seen.add(name);
      return true;
    });

    // Prefer providers we currently believe in, but keep the rest as a last
    // resort: a stale UNAVAILABLE flag must not be able to fail a request that
    // the provider would in fact serve.
    return [
      ...chain.filter((name) => this.registry.isDispatchable(name)),
      ...chain.filter((name) => !this.registry.isDispatchable(name)),
    ];
  }

  /**
   * The same completion, delivered in pieces.
   *
   * The one decision that makes this different from `generate`: **fallback and
   * retry stop the moment the first chunk is handed to the caller.** Before
   * that nothing has been seen and a failure can be retried on the next
   * provider exactly as usual. After it, retrying would replay the answer from
   * the beginning on top of text the reader already has — two half-answers
   * spliced together, and no way for the reader to tell. So a failure mid-
   * stream is a failure, and it carries what was produced so it can still be
   * metered: the vendor charged for those tokens whether or not they were
   * useful.
   *
   * Providers that cannot stream are skipped rather than fallen into, like
   * `embed`.
   */
  async *stream(
    request: ProviderRequest,
  ): AsyncGenerator<StreamChunk, void, undefined> {
    const chain = this.chainFor(request).flatMap((provider) => {
      const adapter = this.registry.get(provider)?.adapter;
      // Bound, for the same reason `embed` binds: the real adapters are
      // classes that read `this`.
      return adapter?.stream
        ? [{ provider, stream: adapter.stream.bind(adapter) }]
        : [];
    });

    if (chain.length === 0) {
      throw new RuntimeError(
        "PROVIDER",
        request.provider
          ? `Provider ${request.provider} cannot stream.`
          : "No registered provider can stream.",
        { retryable: false, context: { requested: request.provider ?? null } },
      );
    }

    const attempted: ProviderName[] = [];
    let lastFailure: ProviderFailure | null = null;
    let lastCause: unknown;
    let lastModel = "";

    for (const { provider, stream } of chain) {
      attempted.push(provider);
      const startedAt = this.clock.now();
      let delivered = 0;
      let textSoFar = "";

      try {
        for await (const chunk of stream(
          request,
          AbortSignal.timeout(this.config.timeoutMs),
        )) {
          if (chunk.type === "done") {
            this.registry.markHealthy(provider);
            lastModel = chunk.result.model;
            yield {
              type: "done",
              response: this.finalize(
                provider,
                chunk.result,
                this.clock.now() - startedAt,
                attempted,
                1,
              ),
            };
            return;
          }

          delivered += 1;
          if (chunk.type === "text") textSoFar += chunk.delta;
          yield chunk;
        }

        // The adapter ended without a `done`. Treated as a failure rather than
        // as an empty answer: a caller waiting for usage would otherwise wait
        // for ever, and a caller that ignores usage would bill nothing for a
        // response the vendor charged for.
        throw new RuntimeError(
          "PROVIDER",
          `Provider ${provider} ended the stream without finishing it.`,
          { retryable: true, context: { provider } },
        );
      } catch (error: unknown) {
        const failure = classifyFailure(error);
        lastFailure = failure;
        lastCause = error;

        if (failure.demoteTo) {
          this.registry.transition(provider, failure.demoteTo, failure.message);
        }

        // Past this point the caller has already seen part of the answer.
        if (delivered > 0) {
          throw new ProviderStreamError(
            `Provider ${provider} failed after streaming ${delivered} chunk(s): ${failure.message}`,
            { textSoFar, usage: EMPTY_USAGE },
            { provider, model: lastModel, attempted },
            error,
          );
        }

        if (!isWorthFallingBackFrom(failure)) {
          throw toRuntimeError(
            failure,
            { provider, model: lastModel, attempted },
            error,
          );
        }
      }
    }

    throw toRuntimeError(
      lastFailure ?? {
        retryable: false,
        demoteTo: null,
        statusCode: undefined,
        message: "No provider in the chain produced a stream.",
      },
      {
        provider: chain[0]?.provider as ProviderName,
        model: lastModel,
        attempted,
      },
      lastCause,
    );
  }

  private async run(
    request: ProviderRequest,
    call: (
      adapter: ProviderAdapter,
      signal: AbortSignal,
    ) => Promise<AdapterResult>,
  ): Promise<ProviderResponse> {
    const chain = this.chainFor(request);
    if (chain.length === 0) {
      throw new RuntimeError(
        "PROVIDER",
        request.provider
          ? `Provider ${request.provider} is not registered.`
          : "No AI provider is registered.",
        { retryable: false, context: { requested: request.provider ?? null } },
      );
    }

    const attempted: ProviderName[] = [];
    let lastFailure: ProviderFailure | null = null;
    let lastCause: unknown;
    let lastProvider: ProviderName = chain[0] as ProviderName;
    let lastModel = "";

    for (const provider of chain) {
      const entry = this.registry.get(provider);
      if (!entry) continue;

      attempted.push(provider);
      lastProvider = provider;
      const model = request.model ?? entry.adapter.defaultModel;
      lastModel = model;

      for (let attempt = 1; attempt <= this.config.attempts; attempt += 1) {
        const startedAt = this.clock.now();
        try {
          const result = await call(
            entry.adapter,
            AbortSignal.timeout(this.config.timeoutMs),
          );
          this.registry.markHealthy(provider);
          return this.finalize(
            provider,
            result,
            this.clock.now() - startedAt,
            attempted,
            attempt,
          );
        } catch (error) {
          const failure = classifyFailure(error);
          lastFailure = failure;
          lastCause = error;

          if (failure.demoteTo) {
            this.registry.transition(
              provider,
              failure.demoteTo,
              failure.message,
            );
          }

          // One test governs both "ask again" and "ask someone else", because
          // they have the same answer: a non-transient failure will not
          // improve by repeating it, and will not improve by repeating it
          // somewhere else either. Keeping it as a single decision point means
          // the rule cannot be changed in one place and not the other.
          if (!isWorthFallingBackFrom(failure)) {
            throw toRuntimeError(
              failure,
              { provider, model, attempted },
              error,
            );
          }

          if (attempt < this.config.attempts) {
            await this.clock.sleep(retryDelayMs(DEFAULT_RETRY_POLICY, attempt));
          }
        }
      }
    }

    throw toRuntimeError(
      lastFailure ?? {
        retryable: false,
        demoteTo: null,
        statusCode: undefined,
        message: "No provider in the chain produced a response.",
      },
      { provider: lastProvider, model: lastModel, attempted },
      lastCause,
    );
  }

  private finalize(
    provider: ProviderName,
    result: AdapterResult,
    latencyMs: number,
    attempted: readonly ProviderName[],
    attempt: number,
  ): ProviderResponse {
    return {
      provider,
      model: result.model,
      text: result.text,
      toolCalls: result.toolCalls,
      usage: result.usage,
      finishReason: result.finishReason,
      latencyMs,
      cost: costOf(
        result.usage,
        priceOf(provider, result.model, this.config.pricing),
      ),
      metadata: {
        ...result.metadata,
        // Enough to see, from a stored response alone, that a fallback
        // happened and how hard it was to get an answer.
        attemptedProviders: [...attempted],
        attempt,
      },
    };
  }
}
