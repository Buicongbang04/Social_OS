import { Inject, Injectable } from "@nestjs/common";
import type { WorkspaceId } from "@repo/core";
import type {
  Campaign,
  CampaignRepository,
  ContentPieceRepository,
} from "@repo/domain";
import {
  CAMPAIGN_REPOSITORY,
  CONTENT_PIECE_REPOSITORY,
} from "../../infra/database/database.module";
import { ConnectionsService } from "../connections/connections.service";

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
  ) {}

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
