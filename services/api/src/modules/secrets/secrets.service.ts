import { Inject, Injectable } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  type SecretId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import type { Secret, SecretRepository, SecretScope } from "@repo/domain";
import { Keyring, maskSecret } from "@repo/secrets";
import { SECRET_REPOSITORY } from "../../infra/database/database.module";
import { SecretChanges } from "../../infra/secrets/secret-changes";
import { KEYRING } from "../../infra/secrets/secrets.module";

@Injectable()
export class SecretsService {
  constructor(
    @Inject(SECRET_REPOSITORY) private readonly secrets: SecretRepository,
    @Inject(KEYRING) private readonly keyring: Keyring | null,
    private readonly changes: SecretChanges,
  ) {}

  async list(workspaceId: WorkspaceId): Promise<Secret[]> {
    return this.secrets.list(workspaceId, "WORKSPACE");
  }

  /** Store a value. The plaintext is sealed here and never travels further. */
  async put(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: { name: string; value: string; description?: string },
  ): Promise<Secret> {
    const keyring = this.requireKeyring();
    const sealed = keyring.seal(input.value);

    const secret = await this.secrets.put(
      {
        workspaceId,
        scope: "WORKSPACE",
        name: input.name,
        value: input.value,
        description: input.description ?? null,
        ...sealed,
        // Enough for a human to tell two keys apart, never enough to be one.
        hint: maskSecret(input.value),
      },
      userId,
    );

    this.changes.changed(workspaceId);
    return secret;
  }

  async remove(
    workspaceId: WorkspaceId,
    id: SecretId,
    userId: UserId,
  ): Promise<void> {
    const removed = await this.secrets.remove(workspaceId, id, userId);
    // 404 rather than a silent 204: "delete this credential" reporting success
    // while the credential still resolves is how a revoked key stays usable.
    if (!removed) throw new NotFoundError("Không tìm thấy bí mật.");
    // Announced after the write, so nothing can rebuild a cache from the old
    // row and put the revoked key straight back.
    this.changes.changed(workspaceId);
  }

  async rollback(
    workspaceId: WorkspaceId,
    id: SecretId,
    version: number,
    userId: UserId,
  ): Promise<Secret> {
    const owned = await this.secrets.list(workspaceId, "WORKSPACE");
    if (!owned.some((secret) => secret.id === id)) {
      throw new NotFoundError("Không tìm thấy bí mật.");
    }

    const rolled = await this.secrets.activate(id, version, userId);
    if (!rolled) throw new NotFoundError("Không có phiên bản đó.");

    this.changes.changed(workspaceId);
    return rolled;
  }

  /**
   * Open a secret for use.
   *
   * Server-side only — nothing routes an HTTP response through this. The
   * distinction is the point of the whole design: a value is written in and
   * used from inside, and never read back out.
   */
  async resolve(
    workspaceId: WorkspaceId,
    name: string,
    scope: SecretScope = "WORKSPACE",
  ): Promise<string | null> {
    if (!this.keyring) return null;

    const secret = await this.secrets.findByName(
      scope === "PLATFORM" ? null : workspaceId,
      scope,
      name,
    );
    if (!secret) return null;

    const version = await this.secrets.activeVersion(secret.id);
    if (!version) return null;

    return this.keyring.open(version);
  }

  private requireKeyring(): Keyring {
    if (!this.keyring) {
      throw new ValidationError(
        "Chưa cấu hình khoá mã hoá. Đặt SECRET_KEYS và SECRET_PRIMARY_KEY.",
      );
    }
    return this.keyring;
  }
}
