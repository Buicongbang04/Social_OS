import { VercelProviderAdapter } from "../adapters/vercel-adapter";
import { DEFAULT_MODELS, describeProvider } from "./catalog";
import { ProviderGateway } from "./gateway";
import { ProviderRegistry } from "./registry";
import { isProviderName, type ProviderName } from "./types";

/** Where each provider's credential lives. */
const API_KEY_ENV: Readonly<Record<ProviderName, string>> = Object.freeze({
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  // Local, unauthenticated.
  ollama: "",
  openrouter: "OPENROUTER_API_KEY",
});

export type GatewayFromEnv = {
  gateway: ProviderGateway;
  providers: readonly ProviderName[];
  /** The model each provider was actually given, for the startup log. */
  models: Readonly<Partial<Record<ProviderName, string>>>;
};

/**
 * Build a Gateway from the environment, or return null when none is configured.
 *
 * Lives here rather than in a service because both services need one now — the
 * runtime to plan and execute, the API to hold a conversation — and two copies
 * of this would drift. What must not drift is which providers exist and in
 * what order: a chain that differs between processes means the same workspace
 * gets different answers depending on which one served the request.
 */
export function buildGatewayFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GatewayFromEnv | null {
  const configured = resolveProviders(env);
  if (configured.length === 0) return null;

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

  return {
    gateway: new ProviderGateway(registry, {
      default: configured[0] as ProviderName,
      fallback: configured.slice(1),
      timeoutMs: positiveInt(env.AI_TIMEOUT_MS, 60_000),
      attempts: positiveInt(env.AI_ATTEMPTS, 3),
    }),
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
export function resolveProviders(
  env: NodeJS.ProcessEnv,
): readonly ProviderName[] {
  const raw = text(env.AI_PROVIDER);
  if (!raw) return [];

  const seen = new Set<ProviderName>();
  const chain: ProviderName[] = [];

  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase();
    if (!isProviderName(name) || seen.has(name)) continue;

    const keyEnv = API_KEY_ENV[name];
    if (keyEnv && !text(env[keyEnv])) continue;

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
  const value = keyEnv ? text(env[keyEnv]) : undefined;
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
export function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
