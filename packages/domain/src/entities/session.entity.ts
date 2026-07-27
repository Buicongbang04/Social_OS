import type { SessionId, UserId } from "@repo/core";

/**
 * Fields per docs/platform/06_AUTHENTICATION.md.
 *
 * The session row is the source of truth for a refresh token; only its hash is
 * stored, never the token itself. Sessions are hard-deleted/expired rather than
 * soft-deleted — a deliberate exception to the soft-delete default, since they
 * are operational rather than business data.
 */
export type Session = {
  id: SessionId;
  userId: UserId;
  refreshTokenHash: string;
  device: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
};

export type CreateSessionInput = {
  userId: UserId;
  refreshTokenHash: string;
  device?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
};

export function isSessionUsable(
  session: Session,
  now: Date = new Date(),
): boolean {
  return session.revokedAt === null && session.expiresAt > now;
}
