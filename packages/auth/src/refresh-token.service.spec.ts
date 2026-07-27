import { describe, expect, it } from "vitest";
import { RefreshTokenService } from "./refresh-token.service";

const service = new RefreshTokenService();

describe("RefreshTokenService", () => {
  it("generates a URL-safe token with its hash", () => {
    const { token, hash } = service.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });

  it("never repeats a token", () => {
    const tokens = new Set(
      Array.from({ length: 1000 }, () => service.generate().token),
    );
    expect(tokens.size).toBe(1000);
  });

  it("hashes deterministically so a stored hash can be looked up", () => {
    const { token, hash } = service.generate();
    expect(service.hash(token)).toBe(hash);
  });

  it("matches only the originating token", () => {
    const { token, hash } = service.generate();
    const other = service.generate();

    expect(service.matches(token, hash)).toBe(true);
    expect(service.matches(other.token, hash)).toBe(false);
    expect(service.matches("", hash)).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    const { token } = service.generate();
    expect(service.matches(token, "short")).toBe(false);
    expect(service.matches(token, "")).toBe(false);
  });
});
