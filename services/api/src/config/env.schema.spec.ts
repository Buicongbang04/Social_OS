import { describe, expect, it } from "vitest";
import { validateEnv } from "./env.schema";

const valid = {
  DATABASE_URL: "postgresql://user:pass@localhost:5433/db",
  REDIS_URL: "redis://localhost:6380",
  AUTH_SECRET: "a".repeat(32),
};

describe("validateEnv", () => {
  it("applies documented defaults", () => {
    const env = validateEnv(valid);

    expect(env.API_PORT).toBe(3100);
    expect(env.API_PREFIX).toBe("api/v1");
    expect(env.NODE_ENV).toBe("development");
    // docs/platform/09_API_GATEWAY.md: User 100/min, Workspace 10.000/hour.
    expect(env.RATE_LIMIT_USER_PER_MINUTE).toBe(100);
    expect(env.RATE_LIMIT_WORKSPACE_PER_HOUR).toBe(10_000);
    expect(env.AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.AUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(2_592_000);
  });

  it("coerces numeric strings, since env vars are always strings", () => {
    const env = validateEnv({ ...valid, API_PORT: "8080" });
    expect(env.API_PORT).toBe(8080);
  });

  it("rejects a short AUTH_SECRET", () => {
    expect(() => validateEnv({ ...valid, AUTH_SECRET: "too-short" })).toThrow(
      /AUTH_SECRET must be at least 32 characters/,
    );
  });

  it("has no fallback for AUTH_SECRET", () => {
    const { AUTH_SECRET: _omitted, ...withoutSecret } = valid;
    expect(() => validateEnv(withoutSecret)).toThrow(/AUTH_SECRET/);
  });

  it("rejects a malformed DATABASE_URL", () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("rejects an argon2 timeCost below argon2's own minimum", () => {
    expect(() =>
      validateEnv({ ...valid, AUTH_ARGON2_TIME_COST: "1" }),
    ).toThrow();
  });

  it("reports every problem at once, not just the first", () => {
    expect(() => validateEnv({ AUTH_SECRET: "short" })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL[\s\S]*AUTH_SECRET/,
    );
  });
});
