import { Body, Controller, Headers, Post } from "@nestjs/common";
import { CONTENT_CHANNELS, CONTENT_LENGTHS, CONTENT_TONES } from "@repo/ai";
import { ValidationError, isId } from "@repo/core";
import type { WorkspaceId } from "@repo/core";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import { ApiZodBody } from "../../common/openapi/zod-body";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { ContentService } from "./content.service";

/** Long enough for a blog post, short enough that a paste is not a denial of service. */
const MAX_CONTENT = 20_000;

const writeSchema = z.object({
  brief: z.string().trim().min(1).max(4_000),
  channel: z.enum(CONTENT_CHANNELS),
  tone: z.enum(CONTENT_TONES),
  length: z.enum(CONTENT_LENGTHS),
  // Free text rather than an enum: the world has more languages than a list
  // somebody remembers to extend.
  language: z.string().trim().min(1).max(60).default("tiếng Việt"),
});

const rewriteSchema = z.object({
  original: z.string().trim().min(1).max(MAX_CONTENT),
  instruction: z.string().trim().min(1).max(500),
  language: z.string().trim().min(1).max(60).optional(),
});

const translateSchema = z.object({
  original: z.string().trim().min(1).max(MAX_CONTENT),
  targetLanguage: z.string().trim().min(1).max(60),
});

const competitorSchema = z.object({
  // Length capped well above any real URL: the point is to refuse a paste of
  // an entire article, not to police a long query string.
  url: z.string().trim().min(1).max(2_000),
});

const seoSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT),
});

/**
 * The content studio.
 *
 * `workspace.workflow.execute` rather than a read permission: these calls spend
 * the workspace's money. Somebody who may look at the platform should not be
 * able to run up a bill on it.
 */
@Controller("content")
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(writeSchema)
  @Post("write")
  async write(
    @Body(new ZodValidationPipe(writeSchema)) body: z.infer<typeof writeSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.content.write(
      requireWorkspace(workspaceHeader),
      user.userId,
      body,
    );
  }

  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(rewriteSchema)
  @Post("rewrite")
  async rewrite(
    @Body(new ZodValidationPipe(rewriteSchema))
    body: z.infer<typeof rewriteSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.content.rewrite(
      requireWorkspace(workspaceHeader),
      user.userId,
      body,
    );
  }

  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(translateSchema)
  @Post("translate")
  async translate(
    @Body(new ZodValidationPipe(translateSchema))
    body: z.infer<typeof translateSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.content.translate(
      requireWorkspace(workspaceHeader),
      user.userId,
      body,
    );
  }

  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(seoSchema)
  @Post("seo")
  async seo(
    @Body(new ZodValidationPipe(seoSchema)) body: z.infer<typeof seoSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.content.seo(
      requireWorkspace(workspaceHeader),
      user.userId,
      body,
    );
  }

  /**
   * Read a competitor's page and say what it tells us.
   *
   * `execute` like the rest of the studio, because it spends the workspace's
   * money — and unlike the others it also reaches out to a third party's
   * server, which is not something a read-only member should be able to do in
   * this workspace's name.
   */
  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(competitorSchema)
  @Post("competitor")
  async competitor(
    @Body(new ZodValidationPipe(competitorSchema))
    body: z.infer<typeof competitorSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) workspaceHeader: string,
  ) {
    return this.content.analyseCompetitor(
      requireWorkspace(workspaceHeader),
      user.userId,
      body.url,
    );
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
