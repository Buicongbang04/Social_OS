import { and, eq, isNull, sql } from "drizzle-orm";
import type { Metadata, SocialAccountId, WorkspaceId } from "@repo/core";
import { newId } from "@repo/core";
import type {
  ConnectSocialAccountInput,
  SocialAccount,
  SocialAccountRepository,
  SocialAccountStatus,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { socialAccounts } from "../schema";

type Row = typeof socialAccounts.$inferSelect;

function toAccount(row: Row): SocialAccount {
  return {
    id: row.id as SocialAccountId,
    workspaceId: row.workspaceId as WorkspaceId,
    connectorId: row.connectorId,
    externalId: row.externalId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    scopes: row.scopes,
    status: row.status,
    secretName: row.secretName,
    expiresAt: row.expiresAt,
    connectedAt: row.connectedAt,
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

export class DrizzleSocialAccountRepository implements SocialAccountRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list(workspaceId: WorkspaceId): Promise<SocialAccount[]> {
    const rows = await this.db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.workspaceId, workspaceId),
          isNull(socialAccounts.deletedAt),
        ),
      )
      .orderBy(socialAccounts.connectorId, socialAccounts.displayName);

    return rows.map(toAccount);
  }

  async find(
    workspaceId: WorkspaceId,
    id: SocialAccountId,
  ): Promise<SocialAccount | null> {
    const rows = await this.db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.id, id),
          // Scoped by workspace in the query, not checked afterwards. A find
          // that returns the row and leaves the caller to compare is a find
          // that leaks the moment one caller forgets.
          eq(socialAccounts.workspaceId, workspaceId),
          isNull(socialAccounts.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toAccount(rows[0]) : null;
  }

  async findByExternalId(
    workspaceId: WorkspaceId,
    connectorId: string,
    externalId: string,
  ): Promise<SocialAccount | null> {
    const rows = await this.db
      .select()
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.workspaceId, workspaceId),
          eq(socialAccounts.connectorId, connectorId),
          eq(socialAccounts.externalId, externalId),
          isNull(socialAccounts.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toAccount(rows[0]) : null;
  }

  /**
   * Connect, or reconnect.
   *
   * Upsert on (workspace, connector, external id) because pressing connect
   * again for a page that is already there must land on the same row. A second
   * row would mean two tokens for one audience, and disconnecting one would
   * leave the other publishing.
   *
   * `deletedAt` is cleared for the same reason it is in the secret repository:
   * the soft-deleted row still holds the unique key, so leaving the flag set
   * would make reconnecting a silent no-op.
   */
  async connect(
    input: ConnectSocialAccountInput,
    actorId: string | null,
  ): Promise<SocialAccount> {
    const values = {
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      scopes: [...input.scopes],
      status: "ACTIVE" as const,
      secretName: input.secretName,
      expiresAt: input.expiresAt ?? null,
      connectedAt: new Date(),
      metadata: input.metadata ?? {},
      deletedAt: null,
      deletedBy: null,
      updatedAt: new Date(),
      updatedBy: actorId,
    };

    const rows = await this.db
      .insert(socialAccounts)
      .values({
        id: newId("socialAccount"),
        workspaceId: input.workspaceId,
        connectorId: input.connectorId,
        externalId: input.externalId,
        createdBy: actorId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          socialAccounts.workspaceId,
          socialAccounts.connectorId,
          socialAccounts.externalId,
        ],
        set: { ...values, version: sql`${socialAccounts.version} + 1` },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Connecting the account returned no row.");
    return toAccount(row);
  }

  async updateStatus(
    id: SocialAccountId,
    status: SocialAccountStatus,
    actorId: string | null,
  ): Promise<SocialAccount | null> {
    const rows = await this.db
      .update(socialAccounts)
      .set({
        status,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${socialAccounts.version} + 1`,
      })
      .where(and(eq(socialAccounts.id, id), isNull(socialAccounts.deletedAt)))
      .returning();

    return rows[0] ? toAccount(rows[0]) : null;
  }

  async disconnect(
    workspaceId: WorkspaceId,
    id: SocialAccountId,
    actorId: string | null,
  ): Promise<SocialAccount | null> {
    const rows = await this.db
      .update(socialAccounts)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        status: "REVOKED",
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${socialAccounts.version} + 1`,
      })
      .where(
        and(
          eq(socialAccounts.id, id),
          eq(socialAccounts.workspaceId, workspaceId),
          isNull(socialAccounts.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toAccount(rows[0]) : null;
  }
}
