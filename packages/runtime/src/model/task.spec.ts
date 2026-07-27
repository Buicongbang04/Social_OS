import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_POLICY,
  canRetry,
  retryDelayMs,
  type RetryPolicy,
} from "./task";

const exponential: RetryPolicy = {
  maxAttempts: 5,
  backoff: "EXPONENTIAL",
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
};

describe("retry backoff", () => {
  it("doubles the wait on each attempt", () => {
    // Spreading retries stops a struggling downstream service from being
    // hammered by every task at once.
    expect(retryDelayMs(exponential, 1)).toBe(1_000);
    expect(retryDelayMs(exponential, 2)).toBe(2_000);
    expect(retryDelayMs(exponential, 3)).toBe(4_000);
    expect(retryDelayMs(exponential, 4)).toBe(8_000);
  });

  it("clamps at maxDelayMs so a late attempt never sleeps unboundedly", () => {
    expect(retryDelayMs(exponential, 20)).toBe(60_000);
  });

  it("keeps a fixed policy constant", () => {
    const fixed: RetryPolicy = { ...exponential, backoff: "FIXED" };
    expect(retryDelayMs(fixed, 1)).toBe(1_000);
    expect(retryDelayMs(fixed, 5)).toBe(1_000);
  });

  it("never returns a negative delay for a zeroth attempt", () => {
    expect(retryDelayMs(exponential, 0)).toBeGreaterThanOrEqual(0);
  });

  it("uses the documented defaults", () => {
    // docs/kernel/14_ERROR_HANDLING.md: max_attempts 3, exponential, max 60s.
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_POLICY.backoff).toBe("EXPONENTIAL");
    expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(60_000);
  });
});

describe("canRetry", () => {
  it("allows attempts up to the policy limit", () => {
    expect(canRetry({ attempt: 0, retryPolicy: DEFAULT_RETRY_POLICY })).toBe(
      true,
    );
    expect(canRetry({ attempt: 2, retryPolicy: DEFAULT_RETRY_POLICY })).toBe(
      true,
    );
  });

  it("stops once the budget is spent, so a broken task cannot loop forever", () => {
    expect(canRetry({ attempt: 3, retryPolicy: DEFAULT_RETRY_POLICY })).toBe(
      false,
    );
    expect(canRetry({ attempt: 99, retryPolicy: DEFAULT_RETRY_POLICY })).toBe(
      false,
    );
  });

  it("honours a per-task override", () => {
    const generous: RetryPolicy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 10 };
    expect(canRetry({ attempt: 5, retryPolicy: generous })).toBe(true);
  });
});
