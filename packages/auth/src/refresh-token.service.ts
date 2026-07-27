import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * Rationale: a refresh token must be revocable the instant a user logs out.
 * A self-contained JWT cannot be revoked without a lookup anyway, so the JWT
 * buys nothing here and would leak claims into long-lived client storage.
 * Only the SHA-256 hash is persisted (see the `sessions` table) — a database
 * leak therefore does not hand out usable tokens.
 */
export const REFRESH_TOKEN_BYTES = 32;

export type GeneratedRefreshToken = {
  /** Returned to the client exactly once. */
  token: string;
  /** Stored in `sessions.refresh_token_hash`. */
  hash: string;
};

export class RefreshTokenService {
  generate(): GeneratedRefreshToken {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
    return { token, hash: this.hash(token) };
  }

  /**
   * Plain SHA-256, deliberately not argon2: this input is 256 bits of
   * cryptographic randomness, not a low-entropy human password, so there is
   * nothing for a slow KDF to defend against — and refresh happens on a hot
   * path where argon2's cost would be paid on every token rotation.
   */
  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /** Constant-time comparison of two hex digests. */
  matches(token: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(token), "hex");
    const expected = Buffer.from(expectedHash, "hex");

    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
