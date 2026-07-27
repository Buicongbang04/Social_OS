import argon2 from "argon2";

/**
 * Password hashing with argon2id (docs/platform/06_AUTHENTICATION.md requires
 * "thuật toán mạnh" without naming one; argon2id is the current OWASP
 * recommendation and won the Password Hashing Competition).
 *
 * Defaults follow the OWASP cheat sheet's argon2id profile. They are
 * overridable so CI can run a cheap profile without making production weak by
 * accident — the override is explicit, not an environment-sniffing default.
 */
export type PasswordHashOptions = {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
};

export const DEFAULT_PASSWORD_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2, // argon2 rejects anything below 2
  parallelism: 1,
} as const;

/** argon2's own lower bound; anything less is rejected at hash time. */
export const MIN_TIME_COST = 2;

export class PasswordService {
  private readonly options: Required<PasswordHashOptions>;

  constructor(options: PasswordHashOptions = {}) {
    this.options = {
      memoryCost: options.memoryCost ?? DEFAULT_PASSWORD_OPTIONS.memoryCost,
      timeCost: options.timeCost ?? DEFAULT_PASSWORD_OPTIONS.timeCost,
      parallelism: options.parallelism ?? DEFAULT_PASSWORD_OPTIONS.parallelism,
    };
  }

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, {
      type: argon2.argon2id,
      ...this.options,
    });
  }

  /**
   * Constant-time comparison performed inside argon2. Returns false rather
   * than throwing on a malformed hash, so a corrupted row cannot turn a failed
   * login into a 500 that leaks implementation detail.
   */
  async verify(hash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainPassword);
    } catch {
      return false;
    }
  }

  /**
   * True when the stored hash used weaker parameters than we now require, so
   * the caller can transparently re-hash after a successful login.
   */
  needsRehash(hash: string): boolean {
    try {
      // `needsRehash` derives the algorithm from the digest itself, so its
      // options type deliberately excludes `type`.
      return argon2.needsRehash(hash, this.options);
    } catch {
      // Unparseable hash — treat as needing a rehash rather than trusting it.
      return true;
    }
  }
}
