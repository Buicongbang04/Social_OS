import { Inject, Injectable } from "@nestjs/common";
import {
  ProviderGateway,
  ProviderRegistry,
  VercelProviderAdapter,
  describeProvider,
  isProviderName,
  DEFAULT_MODELS,
  type ProviderName,
} from "@repo/ai";
import type { WorkspaceId } from "@repo/core";
import { SecretChanges } from "../secrets/secret-changes";
import { SecretsService } from "../../modules/secrets/secrets.service";
import { AI_GATEWAY } from "./ai.tokens";

/** How long a built gateway is trusted before its keys are read again. */
const CACHE_TTL_MS = 60_000;

/** Whose credential a workspace's requests are spending. */
export type KeySource = "workspace" | "platform";

type Resolved = {
  gateway: ProviderGateway | null;
  source: KeySource;
  providers: readonly ProviderName[];
};

/**
 * Where a workspace's own key for a provider is kept.
 *
 * One name per provider, fixed rather than free-form, so a workspace connecting
 * Anthropic and a workspace connecting OpenAI end up in the same place and
 * resolution never has to guess.
 */
export function secretNameFor(provider: ProviderName): string {
  return `providers/${provider}`;
}

/**
 * Chooses the Gateway a request runs on.
 *
 * This is the point of the vault. Until now every workspace shared whatever key
 * was in the environment, which FR-031 says is not the model — a workspace
 * brings its own key, spends its own quota, and is rate limited on its own
 * behalf rather than on everybody else's.
 *
 * The environment key stays as the fallback. Removing it would break every
 * workspace that has not connected anything, and "you must supply an API key
 * before you can try the product" is a worse default than "the operator pays
 * for the trial".
 *
 * What it does not do yet: let a workspace pick its model. Its requests run on
 * the provider's default, because `AI_MODEL` is the operator's choice for the
 * operator's provider and passing it through would send `qwen2.5:7b` to
 * Anthropic. Per-workspace model choice needs somewhere to store it that is not
 * the vault — a preference is not a credential.
 */
@Injectable()
export class WorkspaceGatewayFactory {
  /**
   * Built gateways, keyed by workspace, with the moment each was built.
   *
   * Cached because resolving a key is a database read plus a decrypt, and a
   * chat turn would otherwise pay for it on every message.
   *
   * Expiry is not decoration. Invalidation below is in-process, so with more
   * than one API instance running a key revoked on instance A stays live on
   * instance B until something forces a rebuild. The TTL is what puts a bound
   * on that window: a revoked credential stops working everywhere within a
   * minute rather than at the next deploy.
   */
  private readonly cache = new Map<string, Resolved & { builtAt: number }>();

  constructor(
    private readonly secrets: SecretsService,
    changes: SecretChanges,
    @Inject(AI_GATEWAY) private readonly shared: ProviderGateway | null,
  ) {
    changes.onChange((workspaceId) => this.forget(workspaceId));
  }

  /**
   * The gateway for this workspace: its own keys if it has any, else the
   * platform's.
   */
  async forWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<ProviderGateway | null> {
    return (await this.resolve(workspaceId)).gateway;
  }

  /**
   * Which keys this workspace's requests actually run on.
   *
   * Answers the question a tenant asks after connecting one — "am I on my key
   * now?" — which they otherwise cannot tell apart from a key that was saved
   * and silently ignored, since nothing ever reads a value back out.
   */
  async status(
    workspaceId: WorkspaceId,
  ): Promise<{ source: KeySource; providers: readonly ProviderName[] }> {
    const { source, providers } = await this.resolve(workspaceId);
    return { source, providers };
  }

  private async resolve(workspaceId: WorkspaceId): Promise<Resolved> {
    const cached = this.cache.get(workspaceId);
    if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;

    const built = await this.build(workspaceId);
    this.cache.set(workspaceId, { ...built, builtAt: Date.now() });
    return built;
  }

  /** Drop a workspace's cached gateway, so the next call rebuilds it. */
  forget(workspaceId: WorkspaceId): void {
    this.cache.delete(workspaceId);
  }

  /**
   * Drop every cached gateway.
   *
   * For anything that invalidates the whole store at once — the test suite
   * truncating the database between cases, where a surviving entry would make
   * one case's credentials visible to the next.
   */
  clear(): void {
    this.cache.clear();
  }

  private async build(workspaceId: WorkspaceId): Promise<Resolved> {
    const platform = {
      gateway: this.shared,
      source: "platform" as const,
      providers: [],
    };

    // One listing rather than a resolve per provider: the names are not
    // secret, and asking for four keys to find that none exist is four
    // round trips to learn nothing.
    const stored = new Set(
      (await this.secrets.list(workspaceId)).map((secret) => secret.name),
    );

    const chain = resolveChain(process.env.AI_PROVIDER).filter((provider) =>
      stored.has(secretNameFor(provider)),
    );
    if (chain.length === 0) return platform;

    const registry = new ProviderRegistry();
    const usable: ProviderName[] = [];

    for (const provider of chain) {
      const key = await this.secrets.resolve(
        workspaceId,
        secretNameFor(provider),
      );
      // Listed but resolving to nothing: this process has no keyring at all.
      // Skipped rather than registered, because an adapter with no credential
      // turns a configuration problem into a vendor authentication error.
      //
      // A value that exists but fails to open is a different case and is not
      // caught here — it throws, deliberately. Falling back to the platform's
      // key would leave the workspace believing it is on its own credential
      // while the operator pays, and the first sign would be a bill.
      if (!key) continue;

      usable.push(provider);
      registry.register(
        new VercelProviderAdapter({
          provider,
          defaultModel: DEFAULT_MODELS[provider],
          apiKey: key,
        }),
        describeProvider(provider),
      );
    }

    const primary = usable[0];
    if (!primary) return platform;

    const gateway = new ProviderGateway(registry, {
      default: primary,
      // The rest of the workspace's own keys, in preference order. The
      // platform's providers are deliberately not in here: falling back onto
      // the operator's credential would bill them for a tenant whose own key
      // happened to be rate limited.
      fallback: usable.slice(1),
      timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 60_000,
      attempts: Number(process.env.AI_ATTEMPTS) || 3,
    });

    return { gateway, source: "workspace", providers: usable };
  }
}

/**
 * Which providers to look for a workspace key under, in preference order.
 *
 * The operator's `AI_PROVIDER` comes first because that is their stated
 * preference, and everything else follows — a workspace can bring a key for a
 * provider the operator never configured, and refusing it would make the
 * operator's environment a limit on what tenants may use.
 *
 * Ollama is excluded: it is local and unauthenticated, so a "key" for it means
 * nothing and offering the slot would suggest otherwise.
 */
function resolveChain(raw: string | undefined): ProviderName[] {
  const preferred = (raw ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(isProviderName)
    .filter((provider) => provider !== "ollama");

  const rest = (
    ["anthropic", "openai", "google", "openrouter"] as const
  ).filter((provider) => !preferred.includes(provider));

  return [...preferred, ...rest];
}
