import type { SessionId, UserId } from "@repo/core";
import type { CreateSessionInput, Session } from "../entities/session.entity";

export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;

  /** Refresh flow looks the session up by token hash, never by raw token. */
  findByRefreshTokenHash(refreshTokenHash: string): Promise<Session | null>;

  create(input: CreateSessionInput): Promise<Session>;

  /** One-time-use rotation: swaps the stored hash and stamps `rotatedAt`. */
  rotate(
    id: SessionId,
    nextRefreshTokenHash: string,
    expiresAt: Date,
  ): Promise<Session | null>;

  revoke(id: SessionId): Promise<boolean>;

  revokeAllForUser(userId: UserId): Promise<number>;

  deleteExpired(before: Date): Promise<number>;
}
