import { canPublish, findConnector } from "@repo/connectors";
import type { ContentPiece, ContentPieceRepository } from "@repo/domain";
import { createLogger } from "@repo/logger";
import type { Metrics } from "@repo/observability";
import {
  openToken,
  publishOnce,
  type VaultAccess,
} from "./capabilities/social";

const logger = createLogger("content-publisher");

export type ContentPublisherOptions = {
  /** How many due pieces one sweep may claim. */
  batchSize?: number;
  /** How often to look for pieces that have come due. */
  intervalMs?: number;
  /**
   * How long a piece may sit mid-send before it counts as abandoned.
   *
   * Well above any publish call: a piece in PUBLISHING is normal for the second
   * the platform takes to answer, and calling that a crash would fail posts
   * that are on their way out.
   */
  stuckAfterMs?: number;
};

const DEFAULTS = {
  batchSize: 10,
  // A minute is the finest granularity anyone schedules at, and a post going
  // out fifteen seconds late is not a thing anybody notices.
  intervalMs: 15_000,
  stuckAfterMs: 5 * 60 * 1000,
} as const;

export type ContentPublisherDeps = VaultAccess & {
  pieces: ContentPieceRepository;
  metrics?: Metrics;
};

/**
 * Sends what the calendar says is due.
 *
 * The authorisation is the approval, and it is per post. This is what makes it
 * different from a recurring Goal that publishes — the case that has already
 * gone wrong here, where connecting a channel silently changed what every
 * schedule in the system did at three in the morning. Here a person wrote a
 * specific body, chose a specific time, and pressed Duyệt on that exact text.
 * Nothing else is ever sent: a DRAFT whose date has passed stays a DRAFT.
 *
 * Which is also why this is not behind SOCIAL_PUBLISH_UNATTENDED. That switch
 * exists because a scheduled Goal publishes something nobody read; gating an
 * approved post on it would make the Duyệt button do nothing and say nothing,
 * which is worse than either answer.
 */
export class ContentPublisher {
  private readonly options: Required<ContentPublisherOptions>;
  private running = false;

  constructor(
    private readonly deps: ContentPublisherDeps,
    options: ContentPublisherOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info(
      { intervalMs: this.options.intervalMs },
      "content publisher started",
    );

    while (this.running) {
      try {
        await this.tick();
      } catch (error) {
        // One bad sweep must not stop the calendar for everybody.
        logger.error({ err: error }, "content publisher tick failed");
      }
      await sleep(this.options.intervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  /** One pass. Returns how many pieces it sent or failed. */
  async tick(): Promise<number> {
    await this.failAbandoned();

    const due = await this.deps.pieces.claimDue(
      new Date(),
      this.options.batchSize,
    );

    // One at a time. Publishing in parallel would mean a failure halfway
    // through leaves an unknown subset already posted.
    for (const piece of due) {
      await this.send(piece);
    }

    return due.length;
  }

  private async send(piece: ContentPiece): Promise<void> {
    try {
      const account = await this.resolveAccount(piece);
      const token = await openToken(this.deps, piece.workspaceId, account);

      const { post } = await publishOnce(
        this.deps,
        account,
        { externalId: account.externalId, accessToken: token },
        { message: bodyOf(piece), link: null },
        // Zero: this is the first attempt on this piece. A claimed piece is
        // never handed back for another try, so there is never a second one —
        // which is what makes the feed check publishOnce does on retries
        // unnecessary here rather than merely skipped.
        0,
      );

      await this.deps.pieces.settle(piece.id, {
        status: "PUBLISHED",
        postId: post.externalId,
        publishedAt: new Date(),
      });

      this.deps.metrics?.publishes.inc({
        connector: account.connectorId,
        outcome: "ok",
      });

      // The id and the workspace, never the body. What went out is the
      // customer's words, and a log is the wrong place for them.
      logger.info(
        {
          pieceId: piece.id,
          workspaceId: piece.workspaceId,
          postId: post.externalId,
        },
        "published a scheduled piece",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.deps.pieces.settle(piece.id, {
        status: "FAILED",
        error: message,
      });

      // Labelled with the piece's channel rather than an account's connector:
      // the failure may well be that there was no account to read one from.
      this.deps.metrics?.publishes.inc({
        connector: piece.channel,
        outcome: "failed",
      });

      logger.error(
        { pieceId: piece.id, workspaceId: piece.workspaceId, err: error },
        "scheduled piece failed to publish",
      );
    }
  }

  /**
   * The connected account this piece goes to.
   *
   * A piece that names one gets that one, and nothing else — a post written for
   * a Korean-goods Page must not land on a Japanese-goods Page because somebody
   * disconnected the first. When it names none, the only account on its channel
   * is unambiguous and is used; two are not, and it stops. Choosing for someone
   * is choosing their audience, and there is no undo for that.
   */
  private async resolveAccount(piece: ContentPiece) {
    const publishable = (
      await this.deps.accounts.list(piece.workspaceId)
    ).filter((account) => {
      const connector = findConnector(account.connectorId);
      return connector !== null && canPublish(connector);
    });

    if (piece.socialAccountId !== null) {
      const named = publishable.find(
        (account) => account.id === piece.socialAccountId,
      );

      if (!named) {
        // Said separately from "not connected at all", because the fix is
        // different: this one was chosen and has since gone away.
        throw new Error(
          "Kênh đã chọn cho bài này không còn kết nối. Nối lại, hoặc chọn kênh khác.",
        );
      }
      if (named.status !== "ACTIVE") {
        throw new Error(
          `Kênh "${named.displayName}" đang ở trạng thái ${named.status}. Nối lại rồi duyệt lại bài.`,
        );
      }
      return named;
    }

    const onChannel = publishable.filter(
      (account) =>
        account.status === "ACTIVE" && account.connectorId === piece.channel,
    );

    if (onChannel.length === 0) {
      throw new Error(
        `Chưa có kênh ${piece.channel} nào đang kết nối và đăng được. Vào phần Kênh mạng xã hội để nối.`,
      );
    }

    if (onChannel.length > 1) {
      throw new Error(
        `Có ${onChannel.length} kênh ${piece.channel} đang nối mà bài chưa chọn kênh nào: ${onChannel
          .map((account) => account.displayName)
          .join(", ")}. Mở bài và chọn kênh rồi duyệt lại.`,
      );
    }

    return onChannel[0]!;
  }

  /**
   * Fail anything left mid-send, rather than sending it again.
   *
   * A piece stuck in PUBLISHING means a node died between claiming it and
   * hearing back. The call may never have arrived, or it may have arrived and
   * been accepted with only the answer lost — and there is no way to tell from
   * here. Retrying is how one post becomes two on a real audience, so this
   * stops and says so, and a person decides.
   */
  private async failAbandoned(): Promise<void> {
    const stuck = await this.deps.pieces.listStuck(
      new Date(Date.now() - this.options.stuckAfterMs),
      this.options.batchSize,
    );

    for (const piece of stuck) {
      await this.deps.pieces.settle(piece.id, {
        status: "FAILED",
        error:
          "Tiến trình dừng giữa chừng khi đang đăng. Không rõ bài đã lên hay chưa — " +
          "hãy mở kênh kiểm tra, rồi duyệt lại nếu chưa có.",
      });

      logger.warn(
        { pieceId: piece.id, workspaceId: piece.workspaceId },
        "content piece was abandoned mid-publish",
      );
    }
  }
}

/**
 * What actually gets posted.
 *
 * Hashtags go on the end because that is where they belong in a post, and the
 * title is left out: it is how the piece is found in the calendar, not
 * something anybody wants as the first line of what they wrote.
 */
function bodyOf(piece: ContentPiece): string {
  const tags = piece.hashtags.map((tag) => `#${tag}`).join(" ");
  return tags === "" ? piece.body : `${piece.body}\n\n${tags}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
