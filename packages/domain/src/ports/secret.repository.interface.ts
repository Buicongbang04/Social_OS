import type { SecretId, UserId, WorkspaceId } from "@repo/core";
import type {
  PutSecretInput,
  Secret,
  SecretScope,
  SecretVersion,
} from "../entities/secret.entity";

/**
 * Where secrets live.
 *
 * Note what is missing: there is no method that returns a plaintext value.
 * Sealing and opening happen above this layer, so a repository that is
 * inspected, logged or mocked never holds a credential in the clear.
 */
export interface SecretRepository {
  /**
   * Metadata only, never values.
   *
   * This is what an API returns and what a screen shows — the doc is explicit
   * that a secret's value never appears in its metadata.
   */
  list(
    workspaceId: WorkspaceId | null,
    scope: SecretScope,
  ): Promise<Secret[]>;

  findByName(
    workspaceId: WorkspaceId | null,
    scope: SecretScope,
    name: string,
  ): Promise<Secret | null>;

  /** The sealed bytes of the version currently marked active. */
  activeVersion(secretId: SecretId): Promise<SecretVersion | null>;

  /**
   * Store a new version and make it active.
   *
   * Always a new version, never an overwrite: a key replaced here is still in
   * flight elsewhere for a while, and keeping the previous one is what turns a
   * bad rotation into a rollback rather than an outage.
   */
  put(
    input: PutSecretInput & {
      keyId: string;
      iv: string;
      tag: string;
      ciphertext: string;
      hint: string;
    },
    actorId: UserId | null,
  ): Promise<Secret>;

  /** Every version, newest first — for rollback and for re-sealing. */
  versions(secretId: SecretId): Promise<SecretVersion[]>;

  /** Point the secret back at an earlier version. */
  activate(
    secretId: SecretId,
    version: number,
    actorId: UserId | null,
  ): Promise<Secret | null>;

  remove(
    workspaceId: WorkspaceId | null,
    id: SecretId,
    actorId: UserId | null,
  ): Promise<boolean>;
}
