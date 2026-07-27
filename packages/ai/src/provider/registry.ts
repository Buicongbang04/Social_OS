import type { ProviderAdapter, ProviderName } from "./types";

/**
 * Provider lifecycle, per the state diagram in
 * docs/runtime/05_PROVIDER_GATEWAY.md.
 */
export const PROVIDER_STATUSES = [
  "REGISTERED",
  "HEALTHY",
  "BUSY",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "RECOVERING",
] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/**
 * Allowed transitions. Anything not listed is refused, so a typo cannot
 * silently mark a dead provider healthy.
 *
 * The doc's diagram is reproduced exactly, plus three edges it omits. Marked
 * so a reader can tell spec from decision:
 *
 * - RECOVERING -> UNAVAILABLE (ADDED). The doc only lets RECOVERING go to
 *   HEALTHY. A failed recovery probe would then have nowhere to go and the
 *   provider would sit in RECOVERING — a state the Gateway will not dispatch
 *   to — permanently. That is a deadlock, not a policy.
 * - BUSY -> RATE_LIMITED and BUSY -> UNAVAILABLE (ADDED). You learn a provider
 *   is throttled or down *from the response to a call in flight*, which is
 *   precisely when it is BUSY. Routing that through HEALTHY first would mean
 *   briefly publishing "healthy" about a provider we just saw fail.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<ProviderStatus, readonly ProviderStatus[]>
> = Object.freeze({
  REGISTERED: ["HEALTHY"],
  HEALTHY: ["BUSY", "RATE_LIMITED", "UNAVAILABLE"],
  BUSY: ["HEALTHY", "RATE_LIMITED", "UNAVAILABLE"],
  RATE_LIMITED: ["HEALTHY"],
  UNAVAILABLE: ["RECOVERING"],
  RECOVERING: ["HEALTHY", "UNAVAILABLE"],
});

export function canTransition(
  from: ProviderStatus,
  to: ProviderStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Registry metadata, per the doc's YAML example (models, streaming, vision,
 * tools, status).
 */
export type ProviderDescriptor = {
  provider: ProviderName;
  models: readonly string[];
  streaming: boolean;
  vision: boolean;
  tools: boolean;
};

export type ProviderEntry = ProviderDescriptor & {
  status: ProviderStatus;
  adapter: ProviderAdapter;
  /** Why it left HEALTHY. Null while healthy. */
  lastError: string | null;
  /**
   * Epoch ms before which a demoted provider should not be tried again. Null
   * while healthy, or when the demotion has no natural expiry.
   */
  retryAfter: number | null;
};

/**
 * How long a demotion suppresses a provider.
 *
 * The doc draws RateLimited -> Healthy and Recovering -> Healthy but never says
 * what triggers them, so these are our numbers. Without an expiry a single 429
 * would sideline the configured default provider for the lifetime of the
 * process — and a 429 is usually over within seconds.
 */
export const DEFAULT_COOLDOWN_MS: Readonly<
  Partial<Record<ProviderStatus, number>>
> = Object.freeze({
  RATE_LIMITED: 60_000,
  UNAVAILABLE: 30_000,
});

/**
 * Which providers exist, what they can do, and whether they are currently
 * worth calling.
 *
 * BUSY is modelled because the doc names it, but the Gateway never sets it:
 * one status field cannot express "three of eight concurrent calls are in
 * flight", so using it as a concurrency signal would be wrong the moment two
 * requests overlap. Concurrency limiting belongs to a rate limiter, and this
 * registry tracks health only.
 */
export class ProviderRegistry {
  private readonly entries = new Map<ProviderName, ProviderEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  register(adapter: ProviderAdapter, descriptor: ProviderDescriptor): void {
    if (this.entries.has(descriptor.provider)) {
      throw new Error(`Provider ${descriptor.provider} is already registered.`);
    }
    this.entries.set(descriptor.provider, {
      ...descriptor,
      adapter,
      status: "REGISTERED",
      lastError: null,
      retryAfter: null,
    });
    // A freshly registered provider is assumed usable; the first failure is
    // what demotes it. Requiring an explicit health probe before the first
    // call would add a round trip to every cold start.
    this.transition(descriptor.provider, "HEALTHY");
  }

  get(provider: ProviderName): ProviderEntry | null {
    return this.entries.get(provider) ?? null;
  }

  has(provider: ProviderName): boolean {
    return this.entries.has(provider);
  }

  list(): readonly ProviderEntry[] {
    return [...this.entries.values()];
  }

  statusOf(provider: ProviderName): ProviderStatus | null {
    return this.entries.get(provider)?.status ?? null;
  }

  /**
   * Move a provider along its lifecycle. Returns false — rather than throwing —
   * when the edge is not allowed, because status bookkeeping must never be the
   * reason a user's request fails.
   */
  transition(
    provider: ProviderName,
    to: ProviderStatus,
    reason?: string,
    cooldownMs: number | undefined = DEFAULT_COOLDOWN_MS[to],
  ): boolean {
    const entry = this.entries.get(provider);
    if (!entry) return false;
    if (entry.status === to) return true;
    if (!canTransition(entry.status, to)) return false;

    entry.status = to;
    entry.lastError = to === "HEALTHY" ? null : (reason ?? entry.lastError);
    entry.retryAfter =
      to === "HEALTHY" || cooldownMs === undefined
        ? null
        : this.now() + cooldownMs;
    return true;
  }

  /**
   * Mark a provider healthy again from wherever it is.
   *
   * UNAVAILABLE has to pass through RECOVERING to reach HEALTHY, which is the
   * doc's graph and worth keeping — but a caller reporting "this just worked"
   * should not have to know that.
   */
  markHealthy(provider: ProviderName): boolean {
    if (this.statusOf(provider) === "UNAVAILABLE") {
      this.transition(provider, "RECOVERING");
    }
    return this.transition(provider, "HEALTHY");
  }

  /**
   * True when the Gateway should send traffic here.
   *
   * A demoted provider becomes dispatchable again once its cooldown lapses.
   * Nothing else would ever re-test it: the Gateway only reaches a demoted
   * provider when every healthy one has already failed, so without an expiry a
   * single 429 would sideline the configured default indefinitely. The next
   * successful call is what actually restores HEALTHY.
   */
  isDispatchable(provider: ProviderName): boolean {
    const entry = this.entries.get(provider);
    if (!entry) return false;
    if (entry.status === "HEALTHY" || entry.status === "BUSY") return true;
    return entry.retryAfter !== null && this.now() >= entry.retryAfter;
  }
}
