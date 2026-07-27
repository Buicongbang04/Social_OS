import {
  Body,
  Controller,
  Delete,
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
import {
  addMemberSchema,
  createWorkspaceSchema,
  listQuerySchema,
  updateWorkspaceSchema,
  type AddMemberBody,
  type CreateWorkspaceBody,
  type ListQuery,
  type UpdateWorkspaceBody,
} from "./workspaces.dto";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  /**
   * Lists only workspaces the caller is a member of, so no permission check is
   * needed — the repository query is already scoped to their memberships.
   */
  @AuthenticatedOnly()
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return toPagedEnvelope(
      await this.workspaces.listForUser(user.userId, query),
    );
  }

  /**
   * Permission is organization-scoped and checked inside the service, because
   * the target organization comes from the body rather than the route — the
   * guard resolves ids from route params or headers only.
   */
  @AuthenticatedOnly()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createWorkspaceSchema))
    body: CreateWorkspaceBody,
  ) {
    return this.workspaces.create(body, user.userId);
  }

  @RequirePermission("workspace.workspace.read")
  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.getForUser(
      parseRouteId("workspace", id),
      user.userId,
    );
  }

  @RequirePermission("workspace.workspace.update")
  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema))
    body: UpdateWorkspaceBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.update(
      parseRouteId("workspace", id),
      body,
      user.userId,
    );
  }

  @RequirePermission("workspace.workspace.delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @Query(new ZodValidationPipe(updateWorkspaceSchema.pick({ version: true })))
    query: { version: number },
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.workspaces.remove(
      parseRouteId("workspace", id),
      query.version,
      user.userId,
    );
  }

  @RequirePermission("workspace.member.read")
  @Get(":workspaceId/members")
  async listMembers(
    @Param("workspaceId") workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return toPagedEnvelope(
      await this.workspaces.listMembers(
        parseRouteId("workspace", workspaceId),
        user.userId,
        query,
      ),
    );
  }

  @RequirePermission("workspace.member.create")
  @Post(":workspaceId/members")
  @HttpCode(HttpStatus.CREATED)
  async addMember(
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.addMember(
      parseRouteId("workspace", workspaceId),
      body,
      user.userId,
    );
  }

  @RequirePermission("workspace.member.delete")
  @Delete(":workspaceId/members/:userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param("workspaceId") workspaceId: string,
    @Param("userId") userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.workspaces.removeMember(
      parseRouteId("workspace", workspaceId),
      parseRouteId("user", userId),
      user.userId,
    );
  }
}
