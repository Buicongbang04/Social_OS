import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { toPagedEnvelope } from "@repo/core";
import {
  AuthenticatedOnly,
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { listQuerySchema, type ListQuery } from "../workspaces/workspaces.dto";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  type CreateOrganizationBody,
  type UpdateOrganizationBody,
} from "./organizations.dto";
import { OrganizationsService } from "./organizations.service";

@Controller("organizations")
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** Scoped to the caller's memberships by the repository query. */
  @AuthenticatedOnly()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return toPagedEnvelope(
      await this.organizations.listForUser(user.userId, query),
    );
  }

  /** Entry point into the tenant model — no pre-existing scope to check. */
  @AuthenticatedOnly()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrganizationSchema))
    body: CreateOrganizationBody,
  ) {
    return this.organizations.create(body, user.userId);
  }

  @RequirePermission("organization.organization.read")
  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.organizations.getForUser(
      parseRouteId("organization", id),
      user.userId,
    );
  }

  @RequirePermission("organization.organization.update")
  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateOrganizationSchema))
    body: UpdateOrganizationBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.organizations.update(
      parseRouteId("organization", id),
      body,
      user.userId,
    );
  }
}
