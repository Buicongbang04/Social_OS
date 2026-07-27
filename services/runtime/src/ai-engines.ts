import {
  DEFAULT_MODELS,
  LlmIntentAnalyzer,
  LlmPlanner,
  createAiCapabilities,
  ProviderGateway,
  ProviderRegistry,
  VercelProviderAdapter,
  describeProvider,
  isProviderName,
  type AiUsageRecord,
  type AiUsageRecorder,
  type ProviderName,
} from "@repo/ai";
import type {
  CapabilityImplementation,
  CapabilityRegistry,
  IntentAnalyzer,
  Planner,
} from "@repo/runtime";
import { KeywordIntentAnalyzer, TemplatePlanner } from "@repo/runtime";

/** Where each provider's credential lives. */
const API_KEY_ENV: Readonly<Record<ProviderName, string>> = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  // Local, unauthenticated.
  ollama: "",
});

export type AiEngines = {
  intentAnalyzer: IntentAnalyzer;
  planner: Planner;
  /**
   * Capabilities that call a model. Empty in keyword mode, and they replace
   * the deterministic builtin of the same id when present — the caller
   * registers these last so the override is explicit rather than incidental.
   */
  capabilities: readonly CapabilityImplementation[];
  /**
   * The gateway these engines run on, or null in keyword mode.
   *
   * Exposed so the knowledge stack can embed through the same chain, the same
   * retry policy and the same pricing table. Building a second gateway would
   * mean a provider demoted for rate limiting on one path stayed Healthy on
   * the other.
   */
  gateway: ProviderGateway | null;
  /** What was actually selected, for the startup log. */
  mode: "llm" | "keyword";
  providers: readonly ProviderName[];
  /**
   * The model each provider was actually given.
   *
   * In the startup log because "which model is this running?" is the first
   * question asked of any surprising answer or bill, and reading it back from
   * configuration gets it wrong exactly when configuration is the problem.
   */
  models: Readonly<Partial<Record<ProviderName, string>>>;
};

/**
 * Choose the Intent and Planning engines from configuration.
 *
 * Falls back to the deterministic Phase 1 engines when no provider is
 * configured, so the runtime still starts and still runs a goal end to end
 * with no API key and no spend. That matters for CI and for anyone cloning the
 * repo: a platform that cannot boot without a paid credential is a platform
 * most people never see working.
 */
export function buildAiEngines(input: {
  capabilities: CapabilityRegistry;
  recorder: AiUsageRecorder;
  env?: NodeJS.ProcessEnv;
  onUsageError?: (error: unknown, record: AiUsageRecord) => void;
}): AiEngines {
  const env = input.env ?? process.env;
  const configured = resolveProviders(env);

  if (configured.length === 0) {
    return {
      intentAnalyzer: new KeywordIntentAnalyzer(),
      planner: new TemplatePlanner(input.capabilities),
      capabilities: [],
      gateway: null,
      mode: "keyword",
      providers: [],
      models: {},
    };
  }

  const registry = new ProviderRegistry();
  const models: Partial<Record<ProviderName, string>> = {};

  for (const provider of configured) {
    const defaultModel = text(env.AI_MODEL) ?? DEFAULT_MODELS[provider];
    models[provider] = defaultModel;

    registry.register(
      new VercelProviderAdapter({
        provider,
        defaultModel,
        ...keyFor(provider, env),
        ...(provider === "ollama" && text(env.OLLAMA_BASE_URL)
          ? { baseUrl: text(env.OLLAMA_BASE_URL) }
          : {}),
      }),
      describeProvider(provider),
    );
  }

  const gateway = new ProviderGateway(registry, {
    default: configured[0] as ProviderName,
    fallback: configured.slice(1),
    timeoutMs: positiveInt(env.AI_TIMEOUT_MS, 60_000),
    attempts: positiveInt(env.AI_ATTEMPTS, 3),
  });

  const shared = {
    gateway,
    recorder: input.recorder,
    ...(text(env.AI_MODEL) ? { model: text(env.AI_MODEL) } : {}),
    ...(input.onUsageError ? { onUsageError: input.onUsageError } : {}),
  };

  return {
    intentAnalyzer: new LlmIntentAnalyzer(shared),
    planner: new LlmPlanner({ ...shared, capabilities: input.capabilities }),
    capabilities: createAiCapabilities(shared),
    gateway,
    mode: "llm",
    providers: configured,
    models,
  };
}

/**
 * `AI_PROVIDER` is the chain, most preferred first: `anthropic,openai`.
 *
 * A provider named without its API key is dropped rather than registered,
 * because registering it would put a guaranteed 401 into the fallback chain —
 * the request would still succeed via the next provider, but only after paying
 * a round trip for a failure that was knowable at startup.
 */
function resolveProviders(env: NodeJS.ProcessEnv): readonly ProviderName[] {
  const raw = env.AI_PROVIDER?.trim();
  if (!raw) return [];

  const seen = new Set<ProviderName>();
  const chain: ProviderName[] = [];

  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (!isProviderName(name) || seen.has(name)) continue;

    const keyEnv = API_KEY_ENV[name];
    if (keyEnv && !env[keyEnv]) continue;

    seen.add(name);
    chain.push(name);
  }

  return chain;
}

function keyFor(
  provider: ProviderName,
  env: NodeJS.ProcessEnv,
): { apiKey?: string } {
  const keyEnv = API_KEY_ENV[provider];
  const value = keyEnv ? env[keyEnv] : undefined;
  return value ? { apiKey: value } : {};
}

/**
 * A set environment variable, or undefined.
 *
 * `.env` files declare a variable and leave it blank to show it exists —
 * `AI_MODEL=` — which reaches the process as an empty string, not as absent.
 * `??` does not catch that, so `env.AI_MODEL ?? DEFAULT` yields "" and the
 * request goes out with no model at all. The vendor's answer is "model is
 * required", which reads as a bug in the gateway rather than in the config.
 */
function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
