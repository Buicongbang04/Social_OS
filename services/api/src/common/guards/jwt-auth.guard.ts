import { Injectable, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { UnauthorizedError } from "@repo/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Global authentication guard: every route requires a valid access token
 * unless explicitly marked @Public(). Defaulting to "protected" means adding a
 * new controller cannot accidentally expose an unauthenticated endpoint.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;
    return super.canActivate(context);
  }

  /** Translate Passport's generic failure into our error envelope. */
  override handleRequest<TUser>(err: unknown, user: TUser): TUser {
    if (err) throw err;

    if (!user) {
      throw new UnauthorizedError("Authentication required.", "UNAUTHORIZED");
    }

    return user;
  }
}
