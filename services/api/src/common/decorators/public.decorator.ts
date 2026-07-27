import {
  SetMetadata,
  createParamDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import type { UserId } from "@repo/core";

export const IS_PUBLIC_KEY = "auth:isPublic";
export const AUTHENTICATED_ONLY_KEY = "auth:authenticatedOnly";

/** No token required — login, register, health. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * A valid token is required but no specific permission. Marking this
 * explicitly (rather than leaving a route unannotated) is what lets a test
 * assert that every route has made a deliberate authorization choice.
 */
export const AuthenticatedOnly = () =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, true);

export type AuthenticatedUser = {
  userId: UserId;
  sessionId: string;
  email: string;
};

/** Injects the authenticated principal established by JwtStrategy. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
