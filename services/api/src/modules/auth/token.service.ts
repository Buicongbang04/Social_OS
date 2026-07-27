import { Inject, Injectable } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import type Redis from "ioredis";
import type { UserId } from "@repo/core";
import { UnauthorizedError } from "@repo/core";
import type { AppConfig } from "../../config/app.config";
import { REDIS_CLIENT } from "../../infra/redis/redis.module";

/**
 * Access-token claims.
 *
 * Deliberately carries no roles or permissions: those are per-workspace and
 * must stay revocable, so they are resolved server-side on every request
 * (docs/platform/07_AUTHORIZATION.md — server-side evaluation only).
 */
export type AccessTokenPayload = {
  sub: UserId;
  /** Session id, so a single session can be revoked without touching the others. */
  sid: string;
  email: string;
  typ: "access";
};

const ISSUER = "ai-social-os";
const AUDIENCE = "api";

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async signAccessToken(
    payload: Omit<AccessTokenPayload, "typ">,
  ): Promise<string> {
    return this.jwt.signAsync(
      { ...payload, typ: "access" satisfies AccessTokenPayload["typ"] },
      {
        secret: this.config.authSecret,
        expiresIn: this.config.accessTokenTtlSeconds,
        issuer: ISSUER,
        audience: AUDIENCE,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;

    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.authSecret,
        issuer: ISSUER,
        audience: AUDIENCE,
      });
    } catch {
      throw new UnauthorizedError(
        "Access token is invalid or has expired.",
        "INVALID_TOKEN",
      );
    }

    if (payload.typ !== "access") {
      throw new UnauthorizedError("Wrong token type.", "INVALID_TOKEN");
    }

    if (await this.isSessionRevoked(payload.sid)) {
      throw new UnauthorizedError(
        "Session has been revoked.",
        "SESSION_REVOKED",
      );
    }

    return payload;
  }

  /**
   * Logout must take effect immediately, but an access token stays
   * cryptographically valid until it expires. A short-lived denylist bridges
   * that gap: entries only need to outlive the access-token TTL.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await this.redis.set(
      revokedKey(sessionId),
      "1",
      "EX",
      this.config.accessTokenTtlSeconds + 60,
    );
  }

  async isSessionRevoked(sessionId: string): Promise<boolean> {
    const value = await this.redis.get(revokedKey(sessionId));
    return value !== null;
  }
}

function revokedKey(sessionId: string): string {
  return `revoked:sid:${sessionId}`;
}
