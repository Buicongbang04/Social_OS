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
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { NotFoundError, ValidationError, isId } from "@repo/core";
import type {
  CampaignId,
  ContentPieceId,
  SocialAccountId,
  WorkspaceId,
} from "@repo/core";
import {
  CAMPAIGN_STATUSES,
  CONTENT_PIECE_STATUSES,
  type CampaignRepository,
  type ContentPieceRepository,
  type SocialAccountRepository,
} from "@repo/domain";
import { z } from "zod";
import {
  CurrentUser,
  type AuthenticatedUser,
} from "../../common/decorators/public.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import { WORKSPACE_ID_HEADER } from "../../common/guards/permission.guard";
import {
  CAMPAIGN_REPOSITORY,
  CONTENT_PIECE_REPOSITORY,
  SOCIAL_ACCOUNT_REPOSITORY,
} from "../../infra/database/database.module";
import { ApiZodBody } from "../../common/openapi/zod-body";
import { parseRouteId } from "../../common/parse-id";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CampaignsService } from "./campaigns.service";

/**
 * An instant, sent as ISO 8601.
 *
 * Refused rather than coerced when unparseable: `new Date("thứ ba")` is
 * `Invalid Date`, which Postgres rejects with a message about a bind parameter
 * that names nothing the caller sent.
 */
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200),
  objective: z.string().trim().max(2_000).optional(),
  startsAt: instant.optional(),
  endsAt: instant.optional(),
});

const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  objective: z.string().trim().max(2_000).nullable().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  startsAt: instant.nullable().optional(),
  endsAt: instant.nullable().optional(),
});

const imageSchema = z.object({
  /**
   * What to draw, in words.
   *
   * The caller's description, not the post's text. A model handed marketing
   * copy draws the words; handed a description of a photograph it draws the
   * photograph.
   */
  prompt: z.string().trim().min(1).max(2_000),
});

const bannerSchema = z.object({
  size: z.enum(["facebook-post", "square", "story"]).optional(),
  /** Usually a page name or a domain. Left out when there is nothing to sign. */
  footer: z.string().trim().max(60).optional(),
});

/**
 * The calendar window, off the query string.
 *
 * Validated with zod like every body is, so a date nobody can read fails the
 * same way and with the same status wherever it arrives — rather than 400 from
 * a hand-written check on the query and 422 from the pipe on the body.
 */
const calendarQuerySchema = z.object({
  campaignId: z.string().optional(),
  from: instant.optional(),
  to: instant.optional(),
  /** Narrow to one status — what a screen that only cares about failures asks. */
  status: z.enum(CONTENT_PIECE_STATUSES).optional(),
  /**
   * How many at most.
   *
   * No default: an unbounded read is what the calendar wants, and a limit
   * applied when nobody asked would drop days off the end of it silently.
   */
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const createPieceSchema = z.object({
  campaignId: z.string().optional(),
  /**
   * Which connected account to post to.
   *
   * Optional, and left out means "the only one on this channel" — with a single
   * Page connected there is nothing to choose, and requiring one would make a
   * draft unsavable until somebody picked.
   */
  socialAccountId: z.string().optional(),
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  hashtags: z.array(z.string().trim().max(40)).max(12).optional(),
  channel: z.string().trim().min(1).max(40),
  scheduledAt: instant.optional(),
});

const updatePieceSchema = z.object({
  campaignId: z.string().nullable().optional(),
  socialAccountId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  hashtags: z.array(z.string().trim().max(40)).max(12).optional(),
  channel: z.string().trim().min(1).max(40).optional(),
  scheduledAt: instant.nullable().optional(),
  /**
   * What a person may set, which is not every status there is.
   *
   * `PUBLISHING`, `PUBLISHED` and `FAILED` are the publisher's to write — they
   * are records of what happened, not instructions. A client that could set
   * PUBLISHED would make the calendar claim a post exists that nobody sent,
   * and one that could set PUBLISHING would park a piece where the sweep never
   * looks at it again.
   */
  status: z.enum(["DRAFT", "APPROVED"]).optional(),
});

/**
 * Campaigns, and the pieces that go out.
 *
 * Read is `workspace.workflow.read` and write is `workspace.workflow.create`:
 * planning what a workspace will publish is the same kind of authority as
 * defining what it will do, and inventing a separate resource for it would give
 * two names to one decision.
 */
@Controller("campaigns")
export class CampaignsController {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY)
    private readonly campaigns: CampaignRepository,
    private readonly report_: CampaignsService,
  ) {}

  @RequirePermission("workspace.workflow.read")
  @Get()
  async list(@Headers(WORKSPACE_ID_HEADER) header: string) {
    return this.campaigns.list(requireWorkspace(header));
  }

  /**
   * How each campaign is doing.
   *
   * Declared before `:id` would be if there were one — Nest matches routes in
   * declaration order, and a later `@Get(":id")` would otherwise swallow
   * `/report` and try to parse it as a campaign id.
   */
  @RequirePermission("workspace.workflow.read")
  @Get("report")
  async report(@Headers(WORKSPACE_ID_HEADER) header: string) {
    return this.report_.report(requireWorkspace(header));
  }

  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(createCampaignSchema)
  @Post()
  async create(
    @Body(new ZodValidationPipe(createCampaignSchema))
    body: z.infer<typeof createCampaignSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ) {
    return this.campaigns.create(
      { workspaceId: requireWorkspace(header), ...body },
      user.userId,
    );
  }

  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(updateCampaignSchema)
  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema))
    body: z.infer<typeof updateCampaignSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ) {
    const updated = await this.campaigns.update(
      requireWorkspace(header),
      parseRouteId("campaign", id),
      body,
      user.userId,
    );
    // 404 rather than 403 for something in another workspace: 403 would
    // confirm the campaign exists.
    if (!updated) throw new NotFoundError("Không tìm thấy chiến dịch.");
    return updated;
  }

  @RequirePermission("workspace.workflow.delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ): Promise<void> {
    const archived = await this.campaigns.archive(
      requireWorkspace(header),
      parseRouteId("campaign", id),
      user.userId,
    );
    if (!archived) throw new NotFoundError("Không tìm thấy chiến dịch.");
  }
}

/**
 * The content itself, and the calendar over it.
 *
 * A separate controller because a piece does not need a campaign — routing it
 * under `/campaigns/:id/pieces` would make the common case, a draft belonging
 * to nothing, unreachable.
 */
@Controller("content-pieces")
export class ContentPiecesController {
  constructor(
    @Inject(CONTENT_PIECE_REPOSITORY)
    private readonly pieces: ContentPieceRepository,
    @Inject(SOCIAL_ACCOUNT_REPOSITORY)
    private readonly accounts: SocialAccountRepository,
    private readonly banners: CampaignsService,
  ) {}

  /**
   * The account, checked against the workspace that asked for it.
   *
   * Without this the id is stored as given, so a workspace can name another
   * one's Page. It would never actually publish there — the sweep only ever
   * looks at connections belonging to the piece's own workspace — but the row
   * would carry a pointer across a tenant boundary, and the failure a person
   * eventually sees would say the channel was disconnected rather than that it
   * was never theirs.
   */
  private async requireAccount(
    workspaceId: WorkspaceId,
    raw: string,
  ): Promise<SocialAccountId> {
    const id = parseRouteId("socialAccount", raw) as SocialAccountId;
    const account = await this.accounts.find(workspaceId, id);
    if (!account) throw new NotFoundError("Không tìm thấy kênh đã chọn.");
    return id;
  }

  /**
   * The calendar.
   *
   * `from`/`to` narrow it to a window; without them everything comes back,
   * scheduled first. A window with no matches is an empty list, not a 404 — a
   * quiet week is an answer.
   */
  @RequirePermission("workspace.workflow.read")
  @Get()
  async list(
    @Headers(WORKSPACE_ID_HEADER) header: string,
    @Query(new ZodValidationPipe(calendarQuerySchema))
    query: z.infer<typeof calendarQuerySchema>,
  ) {
    const { campaignId, ...window } = query;
    return this.pieces.list(requireWorkspace(header), {
      ...window,
      ...(campaignId
        ? { campaignId: parseRouteId("campaign", campaignId) }
        : {}),
    });
  }

  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(createPieceSchema)
  @Post()
  async create(
    @Body(new ZodValidationPipe(createPieceSchema))
    body: z.infer<typeof createPieceSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ) {
    return this.pieces.create(
      {
        workspaceId: requireWorkspace(header),
        ...body,
        campaignId: body.campaignId
          ? parseRouteId("campaign", body.campaignId)
          : null,
        socialAccountId: body.socialAccountId
          ? await this.requireAccount(
              requireWorkspace(header),
              body.socialAccountId,
            )
          : null,
      },
      user.userId,
    );
  }

  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(updatePieceSchema)
  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePieceSchema))
    body: z.infer<typeof updatePieceSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ) {
    const { campaignId, socialAccountId, ...rest } = body;
    const updated = await this.pieces.update(
      requireWorkspace(header),
      parseRouteId("contentPiece", id),
      {
        ...rest,
        // `undefined` leaves it alone, `null` takes it out of its campaign.
        // Collapsing the two would move a piece every time somebody renamed it.
        ...(campaignId === undefined
          ? {}
          : {
              campaignId: campaignId
                ? (parseRouteId("campaign", campaignId) as CampaignId)
                : null,
            }),
        // Same rule: absent leaves the target alone, null goes back to "the
        // only account on this channel".
        ...(socialAccountId === undefined
          ? {}
          : {
              socialAccountId: socialAccountId
                ? await this.requireAccount(
                    requireWorkspace(header),
                    socialAccountId,
                  )
                : null,
            }),
      },
      user.userId,
    );
    if (!updated) throw new NotFoundError("Không tìm thấy nội dung.");
    return updated;
  }

  /**
   * Draw a banner for this piece.
   *
   * `create` rather than `read`: it writes an object to storage and changes the
   * piece, and it costs bytes somebody pays for.
   */
  @RequirePermission("workspace.workflow.create")
  @ApiZodBody(bannerSchema)
  @Post(":id/banner")
  async banner(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(bannerSchema))
    body: z.infer<typeof bannerSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ) {
    return this.banners.renderBannerFor(
      requireWorkspace(header),
      parseRouteId("contentPiece", id) as ContentPieceId,
      user.userId,
      body,
    );
  }

  /**
   * Draw a picture for this piece.
   *
   * `execute` rather than `create`, unlike the banner: this one spends money
   * at a provider. Drawing ten pictures nobody asked for is a bill, and the
   * banner — which costs nothing — stays on the cheaper permission.
   */
  @RequirePermission("workspace.workflow.execute")
  @ApiZodBody(imageSchema)
  @Post(":id/image")
  async image(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(imageSchema))
    body: z.infer<typeof imageSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ) {
    return this.banners.generateImageFor(
      requireWorkspace(header),
      parseRouteId("contentPiece", id) as ContentPieceId,
      user.userId,
      body.prompt,
    );
  }

  @RequirePermission("workspace.workflow.delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers(WORKSPACE_ID_HEADER) header: string,
  ): Promise<void> {
    const archived = await this.pieces.archive(
      requireWorkspace(header),
      parseRouteId("contentPiece", id) as ContentPieceId,
      user.userId,
    );
    if (!archived) throw new NotFoundError("Không tìm thấy nội dung.");
  }
}

function requireWorkspace(header: string | undefined): WorkspaceId {
  if (!header || !isId("workspace", header)) {
    throw new ValidationError(`Thiếu hoặc sai header ${WORKSPACE_ID_HEADER}.`);
  }
  return header;
}
