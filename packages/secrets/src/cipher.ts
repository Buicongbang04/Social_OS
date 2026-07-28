import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { RuntimeError } from "@repo/runtime";

/**
 * AES-256-GCM.
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a
 * ciphertext altered in the database fails to decrypt instead of decrypting to
 * something else. For a table holding API keys and OAuth tokens, silently
 * returning altered bytes is worse than returning nothing — the caller would
 * send them to a vendor and get an authentication error that names nothing.
 */
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
/** 96 bits, the size GCM is defined for. Longer is not stronger, only slower. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * One encryption key, and the id it is known by.
 *
 * The id travels with every ciphertext so a key can be replaced without
 * rewriting the table: old values still say which key opens them. A vault that
 * stored only the bytes would make key rotation a migration that has to
 * succeed completely or lose everything.
 */
export type EncryptionKey = {
  id: string;
  /** 32 bytes. Anything else is refused rather than padded. */
  key: Buffer;
};

/**
 * A value encrypted at rest.
 *
 * Stored as its parts rather than one concatenated blob so a mistake in the
 * splitting cannot silently turn part of the ciphertext into an IV.
 */
export type SealedValue = {
  keyId: string;
  /** base64 */
  iv: string;
  /** base64 */
  tag: string;
  /** base64 */
  ciphertext: string;
};

/**
 * The keys this process can open secrets with.
 *
 * More than one on purpose: rotation means writing with a new key while old
 * values are still readable with the previous one. A keyring that held a
 * single key would make rotation an outage.
 */
export class Keyring {
  private readonly keys = new Map<string, Buffer>();

  constructor(
    private readonly primaryId: string,
    keys: readonly EncryptionKey[],
  ) {
    for (const entry of keys) {
      if (entry.key.length !== KEY_BYTES) {
        throw new RuntimeError(
          "SECURITY",
          `Encryption key ${entry.id} is ${entry.key.length} bytes, not ${KEY_BYTES}.`,
          { retryable: false, context: { keyId: entry.id } },
        );
      }
      this.keys.set(entry.id, entry.key);
    }

    if (!this.keys.has(primaryId)) {
      throw new RuntimeError(
        "SECURITY",
        `The primary key ${primaryId} is not in the keyring.`,
        { retryable: false, context: { keyId: primaryId } },
      );
    }
  }

  /**
   * Build a keyring from the environment.
   *
   * Format: `SECRET_KEYS=v1:<base64>,v2:<base64>` and `SECRET_PRIMARY_KEY=v2`.
   * Refused rather than defaulted when absent: a vault that generates itself a
   * key at startup encrypts everything with a key that disappears on restart,
   * and the failure only shows up the next time something is read.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): Keyring | null {
    const raw = env.SECRET_KEYS?.trim();
    const primary = env.SECRET_PRIMARY_KEY?.trim();
    if (!raw || !primary) return null;

    const keys = raw.split(",").map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) {
        throw new RuntimeError(
          "SECURITY",
          "SECRET_KEYS entries must look like `id:base64key`.",
          { retryable: false },
        );
      }
      return {
        id: entry.slice(0, separator).trim(),
        key: Buffer.from(entry.slice(separator + 1).trim(), "base64"),
      };
    });

    return new Keyring(primary, keys);
  }

  /** A fresh 32-byte key, base64, for an operator to put in the environment. */
  static generateKey(): string {
    return randomBytes(KEY_BYTES).toString("base64");
  }

  seal(plaintext: string): SealedValue {
    const key = this.keys.get(this.primaryId)!;
    // A fresh IV every time. Reusing one under the same key breaks GCM
    // completely — not gradually — and the two ciphertexts leak their XOR.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);

    return {
      keyId: this.primaryId,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  open(sealed: SealedValue): string {
    const key = this.keys.get(sealed.keyId);
    if (!key) {
      throw new RuntimeError(
        "SECURITY",
        `No key ${sealed.keyId} in the keyring; this secret cannot be read.`,
        { retryable: false, context: { keyId: sealed.keyId } },
      );
    }

    const iv = Buffer.from(sealed.iv, "base64");
    const tag = Buffer.from(sealed.tag, "base64");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new RuntimeError("SECURITY", "Malformed sealed value.", {
        retryable: false,
        context: { keyId: sealed.keyId },
      });
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.ciphertext, "base64")),
        // Throws when the tag does not match — which is the whole point of
        // GCM and must never be caught and ignored.
        decipher.final(),
      ]).toString("utf8");
    } catch (error: unknown) {
      throw new RuntimeError(
        "SECURITY",
        "Secret failed authentication; it has been altered or the wrong key was used.",
        { retryable: false, context: { keyId: sealed.keyId }, cause: error },
      );
    }
  }

  /** Which key a value should be re-sealed under, if any. */
  needsRotation(sealed: SealedValue): boolean {
    return sealed.keyId !== this.primaryId;
  }
}

/**
 * Compare two secrets without leaking which byte differed.
 *
 * A plain `===` returns as soon as it finds a difference, and the time it took
 * says how much of the value was right. That matters for anything an attacker
 * can submit repeatedly — a webhook signature, an API key handed back for
 * checking.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length is not secret and timingSafeEqual throws on a mismatch, so it is
  // checked first and separately.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The last few characters, for showing which key is configured.
 *
 * Enough for a human to tell two keys apart, not enough to be a key. Short
 * values are masked entirely rather than partly revealed.
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(8);
  return `${"•".repeat(8)}${value.slice(-4)}`;
}
