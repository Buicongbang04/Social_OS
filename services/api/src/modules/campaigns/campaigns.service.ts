import { Inject, Injectable } from "@nestjs/common";
import type { WorkspaceId } from "@repo/core";
import type { ContentPieceId, UserId } from "@repo/core";
import { NotFoundError, ValidationError } from "@repo/core";
import type {
  Campaign,
  CampaignRepository,
  ContentPiece,
  ContentPieceRepository,
} from "@repo/domain";
import {
  generateVertexImage,
  priceOf,
  serviceAccountFromEnv,
  type ServiceAccount,
} from "@repo/ai";
import type { AiUsageRecorder } from "@repo/ai";
import { newId } from "@repo/core";
import { renderBanner, type BannerSize } from "@repo/media";
import type { ObjectStore } from "@repo/storage";
import { AI_USAGE_REPOSITORY } from "../../infra/database/database.module";
import { OBJECT_STORE } from "../../infra/storage/storage.module";
import {
  CAMPAIGN_REPOSITORY,
  CONTENT_PIECE_REPOSITORY,
} from "../../infra/database/database.module";
import { ConnectionsService } from "../connections/connections.service";

/** What draws the pictures. */
const IMAGE_MODEL = "gemini-2.5-flash-image";

/** How many recent posts to read engagement for, per connected Page. */
const STATS_WINDOW = 50;

export type CampaignReportRow = {
  campaignId: string | null;
  name: string;
  status: Campaign["status"] | null;
  drafts: number;
  approved: number;
  published: number;
  failed: number;
  /** Summed over the posts numbers could actually be read for. */
  likes: number;
  comments: number;
  shares: number;
  /**
   * Posts that went out but whose numbers are not in the total.
   *
   * Carried rather than folded away, the same reason `unpricedCalls` is on the
   * spend view: a post older than the window this reads contributes nothing,
   * so a total presented without this count is quietly understated and the
   * reader has no way to know by how much.
   */
  postsWithoutStats: number;
};

/**
 * How campaigns are doing.
 *
 * Two sources that do not join in the database: the pieces are ours, the
 * engagement belongs to Facebook. They are matched on the platform's own post
 * id, which is the only thing both sides agree on.
 *
 * What this deliberately does not report is AI cost per campaign. `ai_usage`
 * has no campaign on it and could not honestly have one — a draft is written in
 * the studio before anyone decides which campaign it belongs to, so any
 * attribution would be a guess presented as an accounting figure.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(CAMPAIGN_REPOSITORY)
    private readonly campaigns: CampaignRepository,
    @Inject(CONTENT_PIECE_REPOSITORY)
    private readonly pieces: ContentPieceRepository,
    private readonly connections: ConnectionsService,
    // Optional, like everywhere else that touches storage: a deployment with no
    // MinIO still runs, and only the picture is missing.
    @Inject(OBJECT_STORE)
    private readonly store: ObjectStore | null,
    @Inject(AI_USAGE_REPOSITORY)
    private readonly usage: AiUsageRecorder,
  ) {}

  /**
   * The model that draws.
   *
   * Fixed rather than configurable. A different image model has a different
   * price and a different response shape, and the one place that matters would
   * be silently wrong for both.
   */
  private readonly serviceAccount: ServiceAccount | null =
    serviceAccountFromEnv();

  /**
   * Draw a banner for a piece and keep it.
   *
   * Rendered from the piece rather than from whatever the caller sends, so the
   * picture always says what the post says. A banner built from a separate
   * title is one that goes out contradicting the words underneath it.
   *
   * The storage key is saved, not a URL: a presigned URL expires, and storing
   * one would leave the calendar showing a picture that stops loading minutes
   * after somebody made it.
   */
  async renderBannerFor(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
    userId: UserId,
    options: { size?: BannerSize; footer?: string } = {},
  ): Promise<{ piece: ContentPiece; url: string }> {
    if (!this.store) {
      throw new ValidationError(
        "Chưa cấu hình kho lưu trữ. Đặt MINIO_URL để dùng được ảnh.",
      );
    }

    const piece = await this.pieces.find(workspaceId, id);
    if (!piece) throw new NotFoundError("Không tìm thấy nội dung.");

    const png = await renderBanner({
      title: piece.title,
      // The first sentence, not the whole post: a subtitle is a line, and a
      // paragraph shrunk to fit one is a paragraph nobody can read.
      subtitle: firstSentence(piece.body),
      footer: options.footer,
      size: options.size,
    });

    const location = {
      workspaceId,
      folder: "posts" as const,
      // The piece's own id, so rendering twice replaces the picture rather
      // than leaving the old one orphaned in the bucket forever.
      name: `${piece.id}.png`,
    };

    await this.store.put({
      ...location,
      body: png,
      contentType: "image/png",
      fileName: `${piece.id}.png`,
    });

    const stored = await this.pieces.update(
      workspaceId,
      id,
      { imageKey: location.name },
      userId,
    );

    return {
      piece: stored ?? piece,
      url: await this.store.presignGet(location),
    };
  }

  /**
   * Draw a picture for a piece from a description, and keep it.
   *
   * Shares `imageKey` with the banner, because a piece has one picture. Asking
   * for a generated image replaces a banner and the other way round — two
   * slots would mean deciding at publish time which one goes out, and that
   * decision has no right answer.
   *
   * The prompt is the caller's, not the post's. A model handed marketing copy
   * draws the words; handed a description of a photograph it draws the
   * photograph.
   */
  async generateImageFor(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
    userId: UserId,
    prompt: string,
  ): Promise<{ piece: ContentPiece; url: string; costUsd: string }> {
    const piece = await this.pieces.find(workspaceId, id);
    if (!piece) throw new NotFoundError("Không tìm thấy nội dung.");

    const drawn = await this.draw(
      workspaceId,
      userId,
      prompt,
      `${piece.id}.png`,
    );

    const stored = await this.pieces.update(
      workspaceId,
      id,
      { imageKey: drawn.key },
      userId,
    );

    return {
      piece: stored ?? piece,
      url: drawn.url,
      costUsd: drawn.costUsd,
    };
  }

  /**
   * Draw several pictures for a post that may not exist yet.
   *
   * Attached to nothing: they are candidates, and the one somebody picks is
   * saved with the piece. Generating straight onto a piece meant the only way
   * to see a second option was to overwrite the first, so nobody ever compared
   * two — they took whatever came out.
   *
   * Sequential rather than parallel. Each call bills, and a fleet of them
   * firing at once is how a quota refusal turns four charges into four
   * failures with one picture to show for it.
   */
  /**
   * A link to the picture already on a piece.
   *
   * Minted on demand rather than stored: a presigned URL expires, and one kept
   * on the row would leave the calendar showing a picture that stops loading a
   * few minutes after somebody made it.
   */
  async imageUrlFor(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
  ): Promise<{ url: string | null }> {
    const piece = await this.pieces.find(workspaceId, id);
    if (!piece) throw new NotFoundError("Không tìm thấy nội dung.");
    if (!piece.imageKey || !this.store) return { url: null };

    return {
      url: await this.store.presignGet({
        workspaceId,
        folder: "posts",
        name: piece.imageKey,
      }),
    };
  }

  async generateImages(
    workspaceId: WorkspaceId,
    userId: UserId,
    prompt: string,
    count: number,
  ): Promise<{ images: { key: string; url: string }[]; costUsd: string }> {
    const images: { key: string; url: string }[] = [];
    let total = 0;

    for (let index = 0; index < count; index += 1) {
      const drawn = await this.draw(
        workspaceId,
        userId,
        prompt,
        `${newId("contentPiece")}.png`,
      ).catch((error: unknown) => {
        // What was drawn before the failure is kept and returned: it has been
        // paid for, and throwing it away to report a clean error would charge
        // for pictures nobody ever sees.
        if (images.length === 0) throw error;
        return null;
      });
      if (!drawn) break;

      images.push({ key: drawn.key, url: drawn.url });
      total += Number(drawn.costUsd);
    }

    return { images, costUsd: total.toFixed(8) };
  }

  /**
   * One picture: drawn, stored, metered.
   *
   * The metering is here rather than at each caller because an unmetered image
   * is the most expensive single call this platform makes, and a second copy
   * of this code is where that gets forgotten.
   */
  private async draw(
    workspaceId: WorkspaceId,
    userId: UserId,
    prompt: string,
    name: string,
  ): Promise<{ key: string; url: string; costUsd: string }> {
    if (!this.store) {
      throw new ValidationError(
        "Chưa cấu hình kho lưu trữ. Đặt MINIO_URL để dùng được ảnh.",
      );
    }
    if (!this.serviceAccount) {
      throw new ValidationError(
        "Chưa cấu hình sinh ảnh. Đặt GOOGLE_SERVICE_ACCOUNT trỏ tới khoá service account có quyền Vertex AI.",
      );
    }

    const image = await generateVertexImage(
      {
        serviceAccount: this.serviceAccount,
        ...(process.env.GOOGLE_VERTEX_LOCATION?.trim()
          ? { location: process.env.GOOGLE_VERTEX_LOCATION.trim() }
          : {}),
      },
      prompt,
    ).catch((error: unknown) => {
      // A refusal or a quota is something the caller can act on, so it carries
      // a status rather than surfacing as a 500 about our own server.
      throw new ValidationError(
        error instanceof Error ? error.message : String(error),
      );
    });

    const location = { workspaceId, folder: "posts" as const, name };

    await this.store.put({
      ...location,
      body: image.data,
      contentType: image.mimeType,
      fileName: name,
    });

    const price = priceOf("google", IMAGE_MODEL);
    const totalUsd = price
      ? (image.usage.inputTokens / 1_000_000) * price.inputUsdPerMillion +
        (image.usage.outputTokens / 1_000_000) * price.outputUsdPerMillion
      : 0;

    await this.usage
      .record({
        id: newId("aiUsage"),
        workspaceId,
        userId,
        executionId: null,
        taskId: null,
        correlationId: null,
        provider: "google",
        model: IMAGE_MODEL,
        operation: "image.generate",
        usage: {
          inputTokens: image.usage.inputTokens,
          outputTokens: image.usage.outputTokens,
          totalTokens: image.usage.totalTokens,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        cost: {
          inputUsd: 0,
          outputUsd: 0,
          totalUsd,
          // `priced` false says the number is a floor, not a figure. An
          // unpriced model contributes nothing to the total, and the spend
          // view counts those separately rather than quietly understating.
          priced: price !== null,
        },
        latencyMs: 0,
        finishReason: "stop",
        metadata: {},
        timestamp: new Date(),
      })
      .catch(() => {
        // The picture exists and has been paid for either way. A failed ledger
        // write is never allowed to undo that.

        console.error("[campaigns] failed to record image.generate");
      });

    return {
      key: location.name,
      url: await this.store.presignGet(location),
      costUsd: totalUsd.toFixed(8),
    };
  }

  async report(workspaceId: WorkspaceId): Promise<{
    rows: CampaignReportRow[];
    /** Channels whose numbers could not be read, and why. */
    unreadable: { account: string; reason: string }[];
  }> {
    const [summaries, campaigns, stats] = await Promise.all([
      this.pieces.summariseByCampaign(workspaceId),
      this.campaigns.list(workspaceId),
      // Failing to read engagement must not fail the report: the piece counts
      // are ours and are worth showing on their own.
      //
      // A backstop rather than the main path, and untested because it cannot
      // be reached from outside — `stats` collects per-channel failures into
      // `failed` instead of throwing, which is the case the test above covers.
      // This only catches something unexpected further down.
      this.connections
        .stats(workspaceId, STATS_WINDOW)
        .catch((error: unknown) => ({
          posts: [],
          failed: [
            {
              account: "—",
              reason: error instanceof Error ? error.message : String(error),
            },
          ],
        })),
    ]);

    const engagement = new Map(stats.posts.map((post) => [post.postId, post]));
    const named = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

    const rows = summaries.map((summary): CampaignReportRow => {
      const found = summary.publishedPostIds
        .map((id) => engagement.get(id))
        .filter((post) => post !== undefined);

      const campaign =
        summary.campaignId === null ? null : named.get(summary.campaignId);

      return {
        campaignId: summary.campaignId,
        // A campaign that has been archived still has its pieces, so its row
        // survives it. Showing the id alone would leave somebody looking at a
        // row of numbers with no idea what it counted.
        name:
          summary.campaignId === null
            ? "Không thuộc chiến dịch nào"
            : (campaign?.name ?? "Chiến dịch đã lưu trữ"),
        status: campaign?.status ?? null,
        drafts: summary.drafts,
        approved: summary.approved,
        published: summary.published,
        failed: summary.failed,
        likes: found.reduce((total, post) => total + post.likes, 0),
        comments: found.reduce((total, post) => total + post.comments, 0),
        shares: found.reduce((total, post) => total + post.shares, 0),
        postsWithoutStats: summary.publishedPostIds.length - found.length,
      };
    });

    // Most posts first, then most drafts. A report is read to find what is
    // working, and what is working is what has gone out.
    rows.sort(
      (a, b) =>
        b.published - a.published ||
        b.drafts + b.approved - (a.drafts + a.approved),
    );

    return { rows, unreadable: stats.failed };
  }
}

/**
 * The opening sentence, for the line under the title.
 *
 * A subtitle is one line. A whole post shrunk to fit one is a post nobody
 * reads, and the first sentence is the part written to be read first anyway.
 */
function firstSentence(body: string): string | undefined {
  const first = body
    .trim()
    .split(/(?<=[.!?])\s/)[0]
    ?.trim();
  return first && first.length > 0 ? first.slice(0, 160) : undefined;
}
