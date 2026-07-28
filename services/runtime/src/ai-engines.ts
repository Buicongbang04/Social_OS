import {
  LlmIntentAnalyzer,
  LlmPlanner,
  createAiCapabilities,
  buildGatewayFromEnv,
  resolveProviders,
  text,
  type AiUsageRecord,
  type AiUsageRecorder,
  type ProviderGateway,
  type ProviderName,
} from "@repo/ai";
import type {
  CapabilityImplementation,
  CapabilityRegistry,
  IntentAnalyzer,
  Planner,
} from "@repo/runtime";
import { KeywordIntentAnalyzer, TemplatePlanner } from "@repo/runtime";

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

  // Shared with services/api rather than built twice: a provider chain that
  // differs between processes means the same workspace gets different answers
  // depending on which one served the request.
  const built = buildGatewayFromEnv(env);
  if (!built) {
    throw new Error(
      "resolveProviders found a chain but buildGatewayFromEnv did not.",
    );
  }
  const { gateway, models } = built;

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
