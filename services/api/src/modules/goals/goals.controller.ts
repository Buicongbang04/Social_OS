import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ValidationError, isId, toPagedEnvelope } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { ApiZodBody } from "../../common/openapi/zod-body";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  createGoalSchema,
  listQuerySchema,
  type CreateGoalBody,
  type ListQuery,
} from "./goals.dto";
import { GoalsService } from "./goals.service";

/**
 * Runtime API, per docs/kernel/13_RUNTIME_API.md.
 *
 * Lives in services/api rather than services/runtime so it inherits the
 * authentication, RBAC, rate limiting and error envelope built in Phase 0.
 * The runtime process stays headless and consumes what these endpoints write.
 *
 * Workspace context comes from the `x-workspace-id` header, which is also what
 * PermissionGuard authorises against — the two cannot disagree.
 */
@Controller("goals")
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(createGoalSchema)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createGoalSchema)) body: CreateGoalBody,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.goals.createGoal(
      requireWorkspace(workspaceHeader),
      user.userId,
      body,
    );
  }

  @RequirePermission("workspace.workflow.read")
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return toPagedEnvelope(
      await this.goals.listGoals(
        requireWorkspace(workspaceHeader),
        user.userId,
        query,
      ),
    );
  }

  /**
   * Stop a Goal. DELETE because that is what a client means by it, though the
   * row stays: an archived Goal keeps its history and its past runs.
   */
  @RequirePermission("workspace.workflow.delete")
  @Delete(":id")
  async archive(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goals.archiveGoal(parseRouteId("goal", id), user.userId);
  }

  @RequirePermission("workspace.workflow.read")
  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.getGoal(parseRouteId("goal", id), user.userId);
  }

  /**
   * Submit the Goal for execution. Returns 202: the work is accepted, not
   * finished — the runtime plans and runs it asynchronously.
   */
  @RequirePermission("workspace.workflow.execute")
  @Post(":id/executions")
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goals.submit(id, user.userId);
  }
}

/**
 * The guard already required this header to authorise the request; re-reading
 * it here keeps the value the controller acts on identical to the value that
 * was authorised, rather than deriving a second one.
 */
function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(
      `A valid ${WORKSPACE_ID_HEADER} header is required.`,
    );
  }
  return header;
}
