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
  Put,
} from "@nestjs/common";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { WorkspaceGatewayFactory } from "../../infra/ai/workspace-gateway";
import { SecretsService } from "./secrets.service";

const putSchema = z.object({
  /**
   * A reference name, e.g. `providers/anthropic`. Slashes are the namespace;
   * anything else is rejected so a name cannot be made to look like a path
   * somewhere else.
   */
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9][a-z0-9._/-]*$/, "Chỉ chữ thường, số, . _ - và /"),
  value: z.string().min(1).max(8_000),
  description: z.string().trim().max(500).optional(),
});

const rollbackSchema = z.object({ version: z.number().int().positive() });

/**
 * Credentials a workspace brings.
 *
 * Note what this controller does not have: any route that returns a value.
 * Secrets are written in and used from inside the server; reading one back out
 * over HTTP would put every stored credential one authorisation bug away from
 * being exfiltrated, and there is no feature that needs it — the screen shows a
 * masked hint, which is enough to tell two keys apart.
 */
@Controller("secrets")
export class SecretsController {
  constructor(
    private readonly secrets: SecretsService,
    private readonly gateways: WorkspaceGatewayFactory,
  ) {}

  @RequirePermission("workspace.secret.read")
  @Get()
  async list(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.secrets.list(requireWorkspace(workspaceHeader));
  }

  /**
   * Whose key this workspace is spending.
   *
   * Saving a credential is otherwise unverifiable from the outside: no route
   * returns a value, so a key that was stored but never picked up looks exactly
   * like one that works, right until a bill arrives on the wrong account.
   */
  @RequirePermission("workspace.secret.read")
  @Get("providers")
  async providers(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.gateways.status(requireWorkspace(workspaceHeader));
  }

  @RequirePermission("workspace.secret.manage")
  @Put()
  async put(
    @Body(new ZodValidationPipe(putSchema)) body: z.infer<typeof putSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.secrets.put(
      requireWorkspace(workspaceHeader),
      user.userId,
      body,
    );
  }

  @RequirePermission("workspace.secret.manage")
  @Post(":id/rollback")
  async rollback(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(rollbackSchema))
    body: z.infer<typeof rollbackSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.secrets.rollback(
      requireWorkspace(workspaceHeader),
      parseRouteId("secret", id),
      body.version,
      user.userId,
    );
  }

  @RequirePermission("workspace.secret.manage")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ): Promise<void> {
    await this.secrets.remove(
      requireWorkspace(workspaceHeader),
      parseRouteId("secret", id),
      user.userId,
    );
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
