import {
  Body,
  Controller,
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
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  approvalSchema,
  listQuerySchema,
  type ApprovalBody,
  type ListQuery,
} from "./goals.dto";
import { GoalsService } from "./goals.service";

@Controller("executions")
export class ExecutionsController {
  constructor(private readonly goals: GoalsService) {}

  @RequirePermission("workspace.execution.read")
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ) {
    return toPagedEnvelope(
      await this.goals.listExecutions(
        requireWorkspace(workspaceHeader),
        user.userId,
        query,
      ),
    );
  }

  @RequirePermission("workspace.execution.read")
  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.getExecution(parseRouteId("execution", id), user.userId);
  }

  /** The plan's tasks and their current state — the progress view. */
  @RequirePermission("workspace.execution.read")
  @Get(":id/tasks")
  async tasks(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.listTasks(parseRouteId("execution", id), user.userId);
  }

  /** What this run has cost in AI provider calls so far. */
  @RequirePermission("workspace.execution.read")
  @Get(":id/usage")
  async usage(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.goals.listUsage(parseRouteId("execution", id), user.userId);
  }

  /**
   * Approve or reject a run that is waiting on a person.
   *
   * Requires workflow.execute, not merely execution.read: approving is the act
   * of authorising the side effect the run was paused before performing.
   */
  @RequirePermission("workspace.workflow.execute")
  @Post(":id/approval")
  @HttpCode(HttpStatus.OK)
  async approval(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(approvalSchema)) body: ApprovalBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goals.decideApproval(
      parseRouteId("execution", id),
      user.userId,
      body,
    );
  }

  /**
   * Request cancellation. 202, not 200: the Execution enters CANCELLING and
   * only reaches CANCELLED once the runtime has unwound in-flight work.
   */
  @RequirePermission("workspace.workflow.execute")
  @Post(":id/cancel")
  @HttpCode(HttpStatus.ACCEPTED)
  async cancel(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.goals.cancel(parseRouteId("execution", id), user.userId);
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(
      `A valid ${WORKSPACE_ID_HEADER} header is required.`,
    );
  }
  return header;
}
