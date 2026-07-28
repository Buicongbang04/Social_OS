import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  Metadata,
  SecretId,
  SecretVersionId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { newId } from "@repo/core";
import type {
  PutSecretInput,
  Secret,
  SecretRepository,
  SecretScope,
  SecretVersion,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { secrets, secretVersions } from "../schema";

type SecretRow = typeof secrets.$inferSelect;
type VersionRow = typeof secretVersions.$inferSelect;

function toSecret(row: SecretRow): Secret {
  return {
    id: row.id as SecretId,
    workspaceId: row.workspaceId as WorkspaceId | null,
    scope: row.scope,
    name: row.name,
    description: row.description,
    activeVersion: row.activeVersion,
    hint: row.hint,
    expiresAt: row.expiresAt,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

function toVersion(row: VersionRow): SecretVersion {
  return {
    id: row.id as SecretVersionId,
    secretId: row.secretId as SecretId,
    version: row.version,
    keyId: row.keyId,
    iv: row.iv,
    tag: row.tag,
    ciphertext: row.ciphertext,
    createdAt: row.createdAt,
    createdBy: row.createdBy as UserId | null,
  };
}

/**
 * Scoping a secret query.
 *
 * A PLATFORM secret has no workspace, and `eq(column, null)` is never true in
 * SQL — so the two cases genuinely need different predicates. Writing this once
 * is what stops a later query from using `eq` and silently matching nothing.
 */
function ownedBy(workspaceId: WorkspaceId | null) {
  return workspaceId === null
    ? isNull(secrets.workspaceId)
    : eq(secrets.workspaceId, workspaceId);
}

export class DrizzleSecretRepository implements SecretRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list(
    workspaceId: WorkspaceId | null,
    scope: SecretScope,
  ): Promise<Secret[]> {
    const rows = await this.db
      .select()
      .from(secrets)
      .where(
        and(ownedBy(workspaceId), eq(secrets.scope, scope), isNull(secrets.deletedAt)),
      )
      .orderBy(secrets.name);

    return rows.map(toSecret);
  }

  async findByName(
    workspaceId: WorkspaceId | null,
    scope: SecretScope,
    name: string,
  ): Promise<Secret | null> {
    const rows = await this.db
      .select()
      .from(secrets)
      .where(
        and(
          ownedBy(workspaceId),
          eq(secrets.scope, scope),
          eq(secrets.name, name),
          isNull(secrets.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toSecret(rows[0]) : null;
  }

  async activeVersion(secretId: SecretId): Promise<SecretVersion | null> {
    const rows = await this.db
      .select({ version: secretVersions })
      .from(secretVersions)
      .innerJoin(
        secrets,
        and(
          eq(secrets.id, secretVersions.secretId),
          // Joined on the pointer rather than read separately, so a version
          // cannot be handed back after the secret has moved on. Two queries
          // would leave a window where a rollback is in flight and the caller
          // gets the value that was just retired.
          eq(secrets.activeVersion, secretVersions.version),
          isNull(secrets.deletedAt),
        ),
      )
      .where(eq(secretVersions.secretId, secretId))
      .limit(1);

    return rows[0] ? toVersion(rows[0].version) : null;
  }

  async versions(secretId: SecretId): Promise<SecretVersion[]> {
    const rows = await this.db
      .select()
      .from(secretVersions)
      .where(eq(secretVersions.secretId, secretId))
      .orderBy(desc(secretVersions.version));

    return rows.map(toVersion);
  }

  /**
   * Store a new version and point the secret at it.
   *
   * One transaction, because a version row without the pointer moved is a
   * value nothing can read, and a pointer moved without the row is a secret
   * that resolves to nothing — the second being far worse, since it takes down
   * whatever was using the credential.
   */
  async put(
    input: PutSecretInput & {
      keyId: string;
      iv: string;
      tag: string;
      ciphertext: string;
      hint: string;
    },
    actorId: UserId | null,
  ): Promise<Secret> {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(secrets)
        .where(
          and(
            input.workspaceId === null
              ? isNull(secrets.workspaceId)
              : eq(secrets.workspaceId, input.workspaceId),
            eq(secrets.scope, input.scope),
            eq(secrets.name, input.name),
          ),
        )
        .limit(1);

      const previous = existing[0];
      const nextVersion = previous ? previous.activeVersion + 1 : 1;
      const secretId = (previous?.id ?? newId("secret")) as SecretId;

      await tx.insert(secretVersions).values({
        id: newId("secretVersion"),
        secretId,
        version: nextVersion,
        keyId: input.keyId,
        iv: input.iv,
        tag: input.tag,
        ciphertext: input.ciphertext,
        createdBy: actorId,
      });

      const values = {
        activeVersion: nextVersion,
        hint: input.hint,
        description: input.description ?? previous?.description ?? null,
        expiresAt: input.expiresAt ?? null,
        metadata: input.metadata ?? {},
        // Cleared, because putting a value back is the same act as putting it
        // there the first time — a soft-deleted row still holds the unique
        // name, so leaving the flag would make the save a silent no-op.
        deletedAt: null,
        deletedBy: null,
        updatedAt: new Date(),
        updatedBy: actorId,
      };

      const rows = previous
        ? await tx
            .update(secrets)
            .set({ ...values, version: sql`${secrets.version} + 1` })
            .where(eq(secrets.id, secretId))
            .returning()
        : await tx
            .insert(secrets)
            .values({
              id: secretId,
              workspaceId: input.workspaceId,
              scope: input.scope,
              name: input.name,
              createdBy: actorId,
              ...values,
            })
            .returning();

      const row = rows[0];
      if (!row) throw new Error("Writing the secret returned no row.");
      return toSecret(row);
    });
  }

  /**
   * Point the secret back at an earlier version.
   *
   * Refuses a version that does not exist, rather than moving the pointer at
   * nothing: the pointer is what resolution reads, and aiming it into space
   * takes down whatever was using the credential with no way to see why.
   */
  async activate(
    secretId: SecretId,
    version: number,
    actorId: UserId | null,
  ): Promise<Secret | null> {
    const exists = await this.db
      .select({ id: secretVersions.id })
      .from(secretVersions)
      .where(
        and(
          eq(secretVersions.secretId, secretId),
          eq(secretVersions.version, version),
        ),
      )
      .limit(1);

    if (exists.length === 0) return null;

    const rows = await this.db
      .update(secrets)
      .set({
        activeVersion: version,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${secrets.version} + 1`,
      })
      .where(and(eq(secrets.id, secretId), isNull(secrets.deletedAt)))
      .returning();

    return rows[0] ? toSecret(rows[0]) : null;
  }

  async remove(
    workspaceId: WorkspaceId | null,
    id: SecretId,
    actorId: UserId | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(secrets)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${secrets.version} + 1`,
      })
      .where(
        and(eq(secrets.id, id), ownedBy(workspaceId), isNull(secrets.deletedAt)),
      )
      .returning({ id: secrets.id });

    return rows.length > 0;
  }
}
