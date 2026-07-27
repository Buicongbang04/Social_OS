import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { UnauthorizedError } from "@repo/core";
import { AppConfig } from "../../config/app.config";
import type { AuthenticatedUser } from "../../common/decorators/public.decorator";
import { requestContext } from "../../common/context/request-context";
import { TokenService } from "./token.service";

/**
 * Passport strategy for access tokens.
 *
 * `passport-jwt` verifies the signature and expiry; the revocation check has
 * to happen here because a signed token stays valid until it expires and
 * logout must take effect immediately.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: AppConfig,
    private readonly tokens: TokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.authSecret,
      issuer: "ai-social-os",
      audience: "api",
    });
  }

  async validate(payload: {
    sub: string;
    sid: string;
    email: string;
    typ?: string;
  }): Promise<AuthenticatedUser> {
    if (payload.typ !== "access") {
      throw new UnauthorizedError("Wrong token type.", "INVALID_TOKEN");
    }

    if (await this.tokens.isSessionRevoked(payload.sid)) {
      throw new UnauthorizedError(
        "Session has been revoked.",
        "SESSION_REVOKED",
      );
    }

    // Make the principal available to loggers for the rest of the request.
    requestContext.setUserId(payload.sub);

    return {
      userId: payload.sub as AuthenticatedUser["userId"],
      sessionId: payload.sid,
      email: payload.email,
    };
  }
}
