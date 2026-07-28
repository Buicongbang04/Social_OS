import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Put,
} from "@nestjs/common";
import { NotFoundError, ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import type { WorkspaceMemoryRepository } from "@repo/domain";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { WORKSPACE_MEMORY_REPOSITORY } from "../../infra/database/database.module";

const rememberSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(2_000),
});

/**
 * What the platform remembers about a workspace, and the ability to change it.
 *
 * This surface is not optional. Memory that shapes every answer and cannot be
 * inspected is the frightening kind: when it is wrong, the only symptom is that
 * the output has quietly been wrong for a while, and there is nowhere to look.
 *
 * PUT rather than POST because remembering is idempotent — the key is the
 * identity, and saying the same thing twice must not leave two answers to one
 * question.
 */
@Controller("memory")
export class MemoryController {
  constructor(
    @Inject(WORKSPACE_MEMORY_REPOSITORY)
    private readonly memory: WorkspaceMemoryRepository,
  ) {}

  @RequirePermission("workspace.workspace.read")
  @Get()
  async list(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.memory.list(requireWorkspace(workspaceHeader));
  }

  @RequirePermission("workspace.workspace.configure")
  @Put()
  async remember(
    @Body(new ZodValidationPipe(rememberSchema))
    body: z.infer<typeof rememberSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.memory.remember(
      { workspaceId: requireWorkspace(workspaceHeader), ...body },
      user.userId,
    );
  }

  @RequirePermission("workspace.workspace.configure")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async forget(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ): Promise<void> {
    const forgotten = await this.memory.forget(
      requireWorkspace(workspaceHeader),
      parseRouteId("workspaceMemory", id),
      user.userId,
    );

    // 404 rather than a silent 204: "forget this" reporting success while
    // nothing was forgotten is how a fact survives an attempt to remove it.
    if (!forgotten) throw new NotFoundError("Không tìm thấy mục ghi nhớ.");
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
