import type {
  Metadata,
  SecretId,
  SecretVersionId,
  SoftDeletableEntity,
  UserId,
  WorkspaceId,
} from "@repo/core";

/**
 * Where a secret applies, per docs/platform/12_SECRET_MANAGER.md.
 *
 * The doc lists six scopes. Two are implemented: PLATFORM for what the
 * operator configures once, WORKSPACE for what a tenant brings. The rest are
 * absent rather than stubbed — a scope that exists in the enum but is never
 * checked reads as a boundary that is enforced, which is worse than not having
 * it.
 */
export const SECRET_SCOPES = ["PLATFORM", "WORKSPACE"] as const;
export type SecretScope = (typeof SECRET_SCOPES)[number];

/**
 * A stored credential — an API key, an OAuth token, a webhook signing key.
 *
 * The value is deliberately absent from this type. `docs/platform/12_SECRET_MANAGER.md`
 * says it plainly: "Giá trị Secret không bao giờ xuất hiện trong Metadata". A
 * type that carried the plaintext would leak it into every log line that ever
 * serialised a secret, and those lines are written by people who did not know
 * they were handling one.
 */
export type Secret = SoftDeletableEntity<SecretId> & {
  /** Null for a PLATFORM secret, which belongs to no tenant. */
  workspaceId: WorkspaceId | null;
  scope: SecretScope;
  /**
   * The reference name, e.g. `providers/anthropic`.
   *
   * Unique within its scope, so `secret://providers/anthropic` resolves to
   * exactly one thing.
   */
  name: string;
  description: string | null;
  /** Which version is used when this secret is resolved. */
  activeVersion: number;
  /** The last few characters, for telling two keys apart on screen. */
  hint: string;
  /** When this should be replaced, if the issuer said. */
  expiresAt: Date | null;
  metadata: Metadata;
};

/**
 * One version of a secret's value.
 *
 * Versions are kept rather than overwritten because rotation is not atomic
 * across the systems that hold a credential: a key replaced here is still in
 * flight somewhere else for a while, and being able to read the previous one
 * is what makes a rollback possible instead of an outage.
 */
export type SecretVersion = {
  id: SecretVersionId;
  secretId: SecretId;
  version: number;
  /** Which encryption key sealed this. See @repo/secrets. */
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  createdAt: Date;
  createdBy: UserId | null;
};

export type PutSecretInput = {
  workspaceId: WorkspaceId | null;
  scope: SecretScope;
  name: string;
  /** The plaintext. Sealed before it reaches the database, never stored raw. */
  value: string;
  description?: string | null;
  expiresAt?: Date | null;
  metadata?: Metadata;
};

/**
 * A `secret://name` reference, as it appears in configuration.
 *
 * Components store the reference, never the value — that is the whole point of
 * the indirection: a workflow definition can be exported, logged or shown on
 * screen without carrying a credential with it.
 */
export const SECRET_REFERENCE_PREFIX = "secret://";

export function isSecretReference(value: string): boolean {
  return value.startsWith(SECRET_REFERENCE_PREFIX);
}

/** The name inside a reference, or null when it is not one. */
export function secretNameFrom(reference: string): string | null {
  if (!isSecretReference(reference)) return null;
  const name = reference.slice(SECRET_REFERENCE_PREFIX.length).trim();
  return name === "" ? null : name;
}
