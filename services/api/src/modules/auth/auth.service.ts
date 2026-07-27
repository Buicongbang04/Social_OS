import { Inject, Injectable } from "@nestjs/common";
import type { SessionId, UserId } from "@repo/core";
import { ConflictError, UnauthorizedError } from "@repo/core";
import { PasswordService, RefreshTokenService } from "@repo/auth";
import type {
  PublicUser,
  SessionRepository,
  User,
  UserRepository,
} from "@repo/domain";
import { isSessionUsable, toPublicUser } from "@repo/domain";
import { AppConfig } from "../../config/app.config";
import {
  SESSION_REPOSITORY,
  USER_REPOSITORY,
} from "../../infra/database/database.module";
import type { AuthTokens, LoginInput, RegisterInput } from "./auth.dto";
import { TokenService } from "./token.service";

export type RequestFingerprint = {
  ipAddress?: string | null;
  userAgent?: string | null;
  device?: string | null;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  async register(
    input: RegisterInput,
    fingerprint: RequestFingerprint,
  ): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictError(
        "An account with this email already exists.",
        "EMAIL_ALREADY_EXISTS",
      );
    }

    const passwordHash = await this.passwords.hash(input.password);

    const user = await this.users.createWithLocalIdentity({
      email: input.email,
      username: input.username ?? null,
      fullName: input.fullName ?? null,
      passwordHash,
    });

    const tokens = await this.issueTokens(user, fingerprint);
    return { user: toPublicUser(user), tokens };
  }

  async login(
    input: LoginInput,
    fingerprint: RequestFingerprint,
  ): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const user = await this.users.findByEmail(input.email);

    // Same error for "no such user" and "wrong password" so the endpoint
    // cannot be used to enumerate which emails are registered.
    const identity = user
      ? await this.users.findIdentity(user.id, "LOCAL")
      : null;

    if (!user || !identity?.passwordHash) {
      // Still spend the hashing time, otherwise response latency leaks whether
      // the account exists.
      await this.passwords.hash(input.password);
      throw new UnauthorizedError(
        "Email or password is incorrect.",
        "INVALID_CREDENTIALS",
      );
    }

    const valid = await this.passwords.verify(
      identity.passwordHash,
      input.password,
    );
    if (!valid) {
      throw new UnauthorizedError(
        "Email or password is incorrect.",
        "INVALID_CREDENTIALS",
      );
    }

    this.assertUserCanLogIn(user);

    // Transparently upgrade a hash made with older/weaker parameters.
    if (this.passwords.needsRehash(identity.passwordHash)) {
      await this.users.updatePasswordHash(
        user.id,
        await this.passwords.hash(input.password),
      );
    }

    const tokens = await this.issueTokens(user, fingerprint);
    return { user: toPublicUser(user), tokens };
  }

  /**
   * One-time-use refresh with rotation. Presenting a token whose session is
   * already revoked (or whose hash no longer matches) is treated as theft: the
   * whole session is killed rather than merely rejected.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = this.refreshTokens.hash(refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(hash);

    if (!session) {
      throw new UnauthorizedError(
        "Refresh token is invalid.",
        "INVALID_REFRESH_TOKEN",
      );
    }

    if (!isSessionUsable(session)) {
      await this.tokens.revokeSession(session.id);
      throw new UnauthorizedError(
        "Refresh token is no longer valid.",
        "REFRESH_TOKEN_EXPIRED",
      );
    }

    const user = await this.users.findById(session.userId);
    if (!user) {
      await this.sessions.revoke(session.id);
      throw new UnauthorizedError(
        "Account no longer exists.",
        "ACCOUNT_NOT_FOUND",
      );
    }

    this.assertUserCanLogIn(user);

    const next = this.refreshTokens.generate();
    const expiresAt = this.refreshExpiry();

    const rotated = await this.sessions.rotate(
      session.id,
      next.hash,
      expiresAt,
    );
    if (!rotated) {
      // Lost a race with a concurrent rotate or a revoke — do not issue tokens.
      throw new UnauthorizedError(
        "Refresh token has already been used.",
        "REFRESH_TOKEN_REUSED",
      );
    }

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      email: user.email,
    });

    return this.toAuthTokens(accessToken, next.token);
  }

  async logout(sessionId: SessionId): Promise<void> {
    await this.sessions.revoke(sessionId);
    // Kill the still-valid access token too, not just the refresh token.
    await this.tokens.revokeSession(sessionId);
  }

  async logoutAll(userId: UserId): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
  }

  private assertUserCanLogIn(user: User): void {
    if (user.status === "SUSPENDED") {
      throw new UnauthorizedError(
        "This account is suspended.",
        "ACCOUNT_SUSPENDED",
      );
    }
    if (user.status === "DISABLED" || user.status === "DELETED") {
      throw new UnauthorizedError(
        "This account is no longer active.",
        "ACCOUNT_DISABLED",
      );
    }
  }

  private async issueTokens(
    user: User,
    fingerprint: RequestFingerprint,
  ): Promise<AuthTokens> {
    const refresh = this.refreshTokens.generate();

    const session = await this.sessions.create({
      userId: user.id,
      refreshTokenHash: refresh.hash,
      device: fingerprint.device ?? null,
      ipAddress: fingerprint.ipAddress ?? null,
      userAgent: fingerprint.userAgent ?? null,
      expiresAt: this.refreshExpiry(),
    });

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      sid: session.id,
      email: user.email,
    });

    return this.toAuthTokens(accessToken, refresh.token);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000);
  }

  private toAuthTokens(accessToken: string, refreshToken: string): AuthTokens {
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.config.accessTokenTtlSeconds,
    };
  }
}
