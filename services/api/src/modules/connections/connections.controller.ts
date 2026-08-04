import {
  Body,
  Controller,
  Logger,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import type { Response } from "express";
import {
  CurrentUser,
  Public,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { ApiZodBody } from "../../common/openapi/zod-body";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { parseRouteId } from "../../common/parse-id";
import { z } from "zod";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ConnectionsService, returnUrl } from "./connections.service";

/**
 * Connecting a workspace to a social platform.
 *
 * Note what is not here: any route that returns a token. The credentials this
 * flow produces go straight into the vault, and the connection rows carry only
 * a reference — same rule as the secrets controller, for the same reason.
 */
const pagesSchema = z.object({
  /**
   * A user access token, not a Page one.
   *
   * The upper bound is generous because Facebook's long-lived user tokens are
   * long, and a limit that cut a valid one would look like the token being
   * wrong.
   */
  userAccessToken: z.string().trim().min(20).max(8_000),
});

const attachPagesSchema = pagesSchema.extend({
  externalIds: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_.-]+$/, "Chỉ chữ, số, . _ -"),
    )
    .min(1)
    .max(50),
});

const attachSchema = z.object({
  /** The Page's own id, as Facebook shows it. Digits, and long. */
  externalId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_.-]+$/, "Chỉ chữ, số, . _ -"),
  accessToken: z.string().trim().min(20).max(8_000),
});

@Controller("connections")
export class ConnectionsController {
  private readonly logger = new Logger(ConnectionsController.name);

  constructor(private readonly connections: ConnectionsService) {}

  @RequirePermission("workspace.connector.read")
  @Get()
  async list(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.connections.list(requireWorkspace(workspaceHeader));
  }

  /** The platforms on offer, and whether the operator has configured each. */
  @RequirePermission("workspace.connector.read")
  @Get("catalog")
  catalog() {
    return this.connections.catalog();
  }

  /**
   * Messages waiting on the workspace's channels.
   *
   * `read`, not `manage`: seeing what customers have written is ordinary
   * awareness of the work, while connecting or removing a channel changes who
   * can be posted to.
   */
  @RequirePermission("workspace.connector.read")
  @Get("inbox")
  async inbox(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.connections.inbox(requireWorkspace(workspaceHeader));
  }

  /**
   * Comments waiting under recent posts.
   *
   * `read` like the inbox, and for the same reason: seeing what customers
   * wrote is ordinary awareness of the work.
   */
  @RequirePermission("workspace.connector.read")
  @Get("comments")
  async comments(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.connections.comments(requireWorkspace(workspaceHeader));
  }

  /** How recent posts have done on each connected channel. */
  @RequirePermission("workspace.connector.read")
  @Get("stats")
  async stats(@Headers(WORKSPACE_ID_HEADER) workspaceHeader: string) {
    return this.connections.stats(requireWorkspace(workspaceHeader));
  }

  @RequirePermission("workspace.connector.manage")
  @Post(":connectorId/start")
  async start(
    @Param("connectorId") connectorId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.connections.start(
      requireWorkspace(workspaceHeader),
      user.userId,
      connectorId,
    );
  }

  /**
   * Attach a Page with a token the operator already holds.
   *
   * `manage`, not `read`: this decides what the platform may post to somebody's
   * audience, which is the same authority as completing an OAuth flow.
   */
  @RequirePermission("workspace.connector.manage")
  @ApiZodBody(attachSchema)
  @Post(":connectorId/token")
  async attach(
    @Param("connectorId") connectorId: string,
    @Body(new ZodValidationPipe(attachSchema))
    body: z.infer<typeof attachSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.connections.attachToken(
      requireWorkspace(workspaceHeader),
      user.userId,
      connectorId,
      body,
    );
  }

  /**
   * List the Pages a user token can manage.
   *
   * A POST, though it reads: the token goes in the body because a GET would put
   * a live credential in the query string, and query strings end up in access
   * logs and browser history.
   */
  @RequirePermission("workspace.connector.manage")
  @ApiZodBody(pagesSchema)
  @HttpCode(HttpStatus.OK)
  @Post(":connectorId/pages")
  async pages(
    @Param("connectorId") connectorId: string,
    @Body(new ZodValidationPipe(pagesSchema)) body: z.infer<typeof pagesSchema>,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.connections.listPages(
      requireWorkspace(workspaceHeader),
      connectorId,
      body.userAccessToken,
    );
  }

  /** Connect the chosen Pages, reporting each that could not be. */
  @RequirePermission("workspace.connector.manage")
  @ApiZodBody(attachPagesSchema)
  @Post(":connectorId/pages/attach")
  async attachPages(
    @Param("connectorId") connectorId: string,
    @Body(new ZodValidationPipe(attachPagesSchema))
    body: z.infer<typeof attachPagesSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.connections.attachPages(
      requireWorkspace(workspaceHeader),
      user.userId,
      connectorId,
      body,
    );
  }

  /**
   * Where the platform sends the browser back.
   *
   * Public, and it has to be: the request arrives straight from Facebook with
   * none of our headers on it. All authority comes from `state` resolving to a
   * record this server wrote, which is single use.
   *
   * It answers with a redirect rather than JSON because a person is looking at
   * it — landing on a page of raw JSON after granting permissions reads as
   * something having gone wrong even when it worked.
   */
  @Public()
  @Get(":connectorId/callback")
  async callback(
    @Param("connectorId") connectorId: string,
    @Query("state") state: string | undefined,
    @Query("code") code: string | undefined,
    @Query("error") error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    // The user pressed cancel on the platform's own screen. Not an error to
    // report, just a decision to carry back.
    if (error) {
      response.redirect(
        returnUrl({ connected: "cancelled", connector: connectorId }),
      );
      return;
    }

    if (!state || !code) {
      response.redirect(
        returnUrl({ connected: "failed", connector: connectorId }),
      );
      return;
    }

    try {
      const result = await this.connections.complete({ state, code });
      response.redirect(
        returnUrl({
          connected: "ok",
          connector: result.connectorId,
          account: result.account.displayName,
        }),
      );
    } catch (caught: unknown) {
      // Logged here rather than rethrown. Rethrowing would replace the
      // redirect with an error page the person cannot act on — but swallowing
      // it silently would leave the operator with a failed connection and
      // nothing anywhere to say why, which is worse.
      this.logger.error(
        `Kết nối ${connectorId} thất bại: ${
          caught instanceof Error ? caught.message : String(caught)
        }`,
      );

      // The reason stays out of the URL. It can quote the platform's own error
      // text, which lands in browser history and in every proxy log between
      // here and the browser.
      response.redirect(
        returnUrl({ connected: "failed", connector: connectorId }),
      );
    }
  }

  @RequirePermission("workspace.connector.manage")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ): Promise<void> {
    await this.connections.disconnect(
      requireWorkspace(workspaceHeader),
      parseRouteId("socialAccount", id),
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
