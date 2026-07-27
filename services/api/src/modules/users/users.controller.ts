import { Controller, Get, Inject } from "@nestjs/common";
import { NotFoundError } from "@repo/core";
import type { UserRepository } from "@repo/domain";
import { toPublicUser } from "@repo/domain";
import {
  AuthenticatedOnly,
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { USER_REPOSITORY } from "../../infra/database/database.module";

@Controller("users")
export class UsersController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  /** Current principal. No permission needed beyond a valid token. */
  @AuthenticatedOnly()
  @Get("me")
  async me(@CurrentUser() principal: AuthenticatedUser) {
    const user = await this.users.findById(principal.userId);

    // The token verified, but the row is gone (deleted between requests).
    if (!user) {
      throw new NotFoundError("User not found.", "USER_NOT_FOUND");
    }

    const profile = await this.users.findProfile(user.id);

    return { ...toPublicUser(user), profile };
  }
}
