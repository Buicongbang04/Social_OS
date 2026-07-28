import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiZodBody } from "../../common/openapi/zod-body";
import type { Request } from "express";
import type { SessionId } from "@repo/core";
import {
  AuthenticatedOnly,
  CurrentUser,
  Public,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
} from "./auth.dto";
import { AuthService } from "./auth.service";
import { type RequestFingerprint } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @ApiZodBody(registerSchema)
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
  ) {
    return this.auth.register(body, fingerprint(req));
  }

  /**
   * Stricter limit than the global 100/min: login is the endpoint an attacker
   * would use for credential stuffing (docs/platform/06_AUTHENTICATION.md
   * "Login Rate Limiting").
   */
  @Public()
  @Throttle({ user: { limit: 5, ttl: 60_000 } })
  @ApiZodBody(loginSchema)
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
  ) {
    return this.auth.login(body, fingerprint(req));
  }

  @Public()
  @Throttle({ user: { limit: 10, ttl: 60_000 } })
  @ApiZodBody(refreshSchema)
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ) {
    return this.auth.refresh(body.refreshToken);
  }

  @AuthenticatedOnly()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.auth.logout(user.sessionId as SessionId);
  }
}

function fingerprint(req: Request): RequestFingerprint {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    device: null,
  };
}
