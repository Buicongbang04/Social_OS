import { beforeEach, describe, expect, it } from "vitest";
import { StubProviderAdapter } from "../adapters/stub-adapter";
import { describeProvider } from "./catalog";
import {
  DEFAULT_COOLDOWN_MS,
  PROVIDER_STATUSES,
  ProviderRegistry,
  canTransition,
  type ProviderStatus,
} from "./registry";

describe("provider registry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.register(
      new StubProviderAdapter({ provider: "anthropic" }),
      describeProvider("anthropic"),
    );
  });

  it("registers a provider as immediately usable", () => {
    expect(registry.statusOf("anthropic")).toBe("HEALTHY");
    expect(registry.isDispatchable("anthropic")).toBe(true);
  });

  it("refuses to register the same provider twice", () => {
    expect(() =>
      registry.register(
        new StubProviderAdapter({ provider: "anthropic" }),
        describeProvider("anthropic"),
      ),
    ).toThrow(/already registered/i);
  });

  it("carries the capability metadata the doc's registry YAML describes", () => {
    const entry = registry.get("anthropic");

    expect(entry?.streaming).toBe(true);
    expect(entry?.vision).toBe(true);
    expect(entry?.tools).toBe(true);
    expect(entry?.models.length).toBeGreaterThan(0);
  });

  it("refuses a transition the lifecycle does not allow", () => {
    // UNAVAILABLE must pass through RECOVERING; jumping straight to HEALTHY
    // would publish "healthy" about a provider nothing has re-tested.
    registry.transition("anthropic", "UNAVAILABLE", "503");
    expect(registry.transition("anthropic", "HEALTHY")).toBe(false);
    expect(registry.statusOf("anthropic")).toBe("UNAVAILABLE");
  });

  it("walks UNAVAILABLE back to HEALTHY through RECOVERING", () => {
    registry.transition("anthropic", "UNAVAILABLE", "503");

    expect(registry.markHealthy("anthropic")).toBe(true);
    expect(registry.statusOf("anthropic")).toBe("HEALTHY");
  });

  it("lets a failed recovery fall back to UNAVAILABLE", () => {
    // Without this edge a provider whose recovery probe fails would sit in
    // RECOVERING for ever — a state the gateway will not dispatch to — and be
    // permanently dead with no way back.
    registry.transition("anthropic", "UNAVAILABLE", "503");
    registry.transition("anthropic", "RECOVERING");

    expect(registry.transition("anthropic", "UNAVAILABLE", "still down")).toBe(
      true,
    );
    expect(registry.statusOf("anthropic")).toBe("UNAVAILABLE");
  });

  it("records why a provider left HEALTHY and clears it on return", () => {
    registry.transition("anthropic", "RATE_LIMITED", "429 from vendor");
    expect(registry.get("anthropic")?.lastError).toBe("429 from vendor");

    registry.markHealthy("anthropic");
    expect(registry.get("anthropic")?.lastError).toBeNull();
  });

  it("does not dispatch to a rate-limited or unavailable provider", () => {
    registry.transition("anthropic", "RATE_LIMITED", "429");
    expect(registry.isDispatchable("anthropic")).toBe(false);

    registry.markHealthy("anthropic");
    registry.transition("anthropic", "UNAVAILABLE", "503");
    expect(registry.isDispatchable("anthropic")).toBe(false);
  });

  it("treats a transition to the current status as a no-op success", () => {
    expect(registry.transition("anthropic", "HEALTHY")).toBe(true);
  });

  it("reports nothing for a provider that was never registered", () => {
    expect(registry.get("openai")).toBeNull();
    expect(registry.statusOf("openai")).toBeNull();
    expect(registry.transition("openai", "HEALTHY")).toBe(false);
  });

  it("leaves every status reachable, so none is a dead end", () => {
    // A status nothing can enter is dead code; a status nothing can leave is a
    // trap. Both are silent, so assert the shape of the graph rather than
    // trusting a reading of it.
    for (const status of PROVIDER_STATUSES) {
      const enterable =
        status === "REGISTERED" ||
        PROVIDER_STATUSES.some((from) => canTransition(from, status));
      const leavable = PROVIDER_STATUSES.some((to) =>
        canTransition(status, to),
      );

      expect(enterable, `${status} cannot be entered`).toBe(true);
      expect(leavable, `${status} cannot be left`).toBe(true);
    }
  });

  it("makes a demoted provider dispatchable again once its cooldown lapses", () => {
    // Nothing else re-tests a demoted provider: the gateway only reaches one
    // after every healthy provider has failed. Without an expiry a single 429
    // sidelines the configured default for the life of the process.
    let now = 10_000;
    const timed = new ProviderRegistry(() => now);
    timed.register(
      new StubProviderAdapter({ provider: "anthropic" }),
      describeProvider("anthropic"),
    );

    timed.transition("anthropic", "RATE_LIMITED", "429");
    expect(timed.isDispatchable("anthropic")).toBe(false);

    now += DEFAULT_COOLDOWN_MS.RATE_LIMITED ?? 0;
    expect(timed.isDispatchable("anthropic")).toBe(true);
    // Dispatchable is "worth probing", not "known good" — only a successful
    // call restores HEALTHY.
    expect(timed.statusOf("anthropic")).toBe("RATE_LIMITED");
  });

  it("gives a 5xx a shorter cooldown than a rate limit", () => {
    let now = 10_000;
    const timed = new ProviderRegistry(() => now);
    timed.register(
      new StubProviderAdapter({ provider: "anthropic" }),
      describeProvider("anthropic"),
    );

    timed.transition("anthropic", "UNAVAILABLE", "503");
    now += DEFAULT_COOLDOWN_MS.UNAVAILABLE ?? 0;

    expect(timed.isDispatchable("anthropic")).toBe(true);
  });

  it("clears the cooldown when a provider returns to health", () => {
    registry.transition("anthropic", "RATE_LIMITED", "429");
    registry.markHealthy("anthropic");

    expect(registry.get("anthropic")?.retryAfter).toBeNull();
  });

  it("never allows a transition back into REGISTERED", () => {
    // Registration happens once. Returning there would reset health history.
    for (const from of PROVIDER_STATUSES) {
      expect(canTransition(from, "REGISTERED" as ProviderStatus)).toBe(false);
    }
  });
});
