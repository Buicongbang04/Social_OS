import { and, eq, isNull, lt } from "drizzle-orm";
import type { SessionId, UserId } from "@repo/core";
import { newId } from "@repo/core";
import type {
  CreateSessionInput,
  Session,
  SessionRepository,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { sessions } from "../schema";

type SessionRow = typeof sessions.$inferSelect;

function toEntity(row: SessionRow): Session {
  return {
    id: row.id as SessionId,
    userId: row.userId as UserId,
    refreshTokenHash: row.refreshTokenHash,
    device: row.device,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    rotatedAt: row.rotatedAt,
  };
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: SessionId): Promise<Session | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<Session | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshTokenHash, refreshTokenHash))
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async create(input: CreateSessionInput): Promise<Session> {
    const rows = await this.db
      .insert(sessions)
      .values({
        id: newId("session"),
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        device: input.device ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Insert returned no row");
    return toEntity(row);
  }

  /**
   * One-time-use rotation. The WHERE clause requires the session to still be
   * un-revoked, so a rotate on a revoked session is a no-op the caller can
   * detect (null) and treat as token reuse.
   */
  async rotate(
    id: SessionId,
    nextRefreshTokenHash: string,
    expiresAt: Date,
  ): Promise<Session | null> {
    const now = new Date();
    const rows = await this.db
      .update(sessions)
      .set({
        refreshTokenHash: nextRefreshTokenHash,
        expiresAt,
        rotatedAt: now,
        lastActivityAt: now,
      })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async revoke(id: SessionId): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    return rows.length > 0;
  }

  async revokeAllForUser(userId: UserId): Promise<number> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    return rows.length;
  }

  async deleteExpired(before: Date): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, before))
      .returning({ id: sessions.id });

    return rows.length;
  }
}
