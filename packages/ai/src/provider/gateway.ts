import {
  DEFAULT_RETRY_POLICY,
  retryDelayMs,
  RuntimeError,
} from "@repo/runtime";
import {
  classifyFailure,
  isWorthFallingBackFrom,
  toRuntimeError,
  type ProviderFailure,
} from "./errors";
import { costOf, priceOf, type ModelPrice } from "./pricing";
import type { ProviderRegistry } from "./registry";
import type {
  AdapterResult,
  ProviderAdapter,
  ProviderName,
  ProviderObjectResponse,
  ProviderRequest,
  ProviderResponse,
  StructuredSchema,
} from "./types";

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
   * Which providers to try, in order.
   *
   * A caller that names a provider gets exactly that provider. Falling back
   * from an explicit choice would substitute a different vendor — a different
   * price, a different data-residency story, possibly a different answer —
   * behind the back of someone who was specific on purpose.
   */
  private chainFor(request: ProviderRequest): readonly ProviderName[] {
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
