import type { ProviderDescriptor } from "./registry";
import type { ProviderName } from "./types";

/**
 * Default capability metadata per provider, matching the registry YAML in
 * docs/runtime/05_PROVIDER_GATEWAY.md (models, streaming, vision, tools).
 *
 * `models` is the set we have prices for and expect to be asked for; it is a
 * hint for callers choosing a model, not an allowlist — the adapters pass
 * whatever model string they are given straight through, because a table in
 * this repo should never be the reason a newly released model is unreachable.
 */
export const PROVIDER_CATALOG: Readonly<
  Record<ProviderName, Omit<ProviderDescriptor, "provider">>
> = Object.freeze({
  anthropic: {
    models: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
      "claude-opus-4-8",
    ],
    streaming: true,
    vision: true,
    tools: true,
  },
  openai: {
    models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.6-terra"],
    streaming: true,
    vision: true,
    tools: true,
  },
  google: {
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.5-flash"],
    streaming: true,
    vision: true,
    tools: true,
  },
  ollama: {
    // Whatever the operator has pulled locally. Left open on purpose.
    models: [],
    streaming: true,
    vision: false,
    // Reached through the OpenAI-compatible endpoint, whose tool support
    // depends on the local model rather than on the server.
    tools: false,
  },
});

/**
 * The model used when a request names a provider but no model.
 *
 * Deliberately mid-tier rather than cheapest: Intent analysis and planning
 * decide what the platform is about to *do*, and a wrong plan costs far more
 * than the token difference. Callers that know better pass `model`.
 */
export const DEFAULT_MODELS: Readonly<Record<ProviderName, string>> =
  Object.freeze({
    anthropic: "claude-sonnet-5",
    openai: "gpt-5.4",
    google: "gemini-2.5-flash",
    ollama: "llama3.1",
  });

export function describeProvider(provider: ProviderName): ProviderDescriptor {
  return { provider, ...PROVIDER_CATALOG[provider] };
}
