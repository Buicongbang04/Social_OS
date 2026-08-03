import type {
  CampaignId,
  ContentPieceId,
  Metadata,
  SocialAccountId,
  SoftDeletableEntity,
  WorkspaceId,
} from "@repo/core";

/**
 * Where a campaign is in its life.
 *
 * `DRAFT` is being planned, `ACTIVE` is running, `DONE` has finished on its own
 * terms. Archiving is the soft delete, and is not a status: a campaign that was
 * archived halfway is still a campaign that never finished, and collapsing the
 * two would lose that.
 */
export const CAMPAIGN_STATUSES = ["DRAFT", "ACTIVE", "DONE"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/**
 * Where one piece of content is in its life.
 *
 * `APPROVED` sits between draft and published on purpose. Somebody says a piece
 * is ready, and something else — later, possibly unattended — sends it. Without
 * a state in between, "ready to go out" and "gone out" are the same fact and
 * nothing can tell whether a person ever looked.
 */
/**
 * Where a piece is on its way out.
 *
 * `PUBLISHING` is not decoration. It is the row a runtime node claims before
 * it calls the platform, and it is what stops two nodes sending the same post
 * to the same audience — a mistake with no undo. A piece found sitting in it
 * after a crash is left for a person, never retried: the call may have landed
 * with only the answer lost, and posting again is a worse answer than asking.
 */
export const CONTENT_PIECE_STATUSES = [
  "DRAFT",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
] as const;
export type ContentPieceStatus = (typeof CONTENT_PIECE_STATUSES)[number];

/**
 * A campaign: a name, a period, and the pieces that belong to it.
 *
 * Deliberately thin. It exists to group and to date, and every attempt to make
 * a campaign object also hold budget, audience and targets ends up duplicating
 * whatever the platform it publishes to already models better.
 */
export type Campaign = SoftDeletableEntity<CampaignId> & {
  workspaceId: WorkspaceId;
  name: string;
  /** What this campaign is for, in the words of whoever planned it. */
  objective: string | null;
  status: CampaignStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  metadata: Metadata;
};

/**
 * One piece of content, scheduled or not.
 *
 * `campaignId` is nullable because that is how the work actually arrives: a
 * post gets written before anyone decides which campaign it belongs to, and
 * forcing a campaign first would mean inventing an empty one to hold a draft.
 */
export type ContentPiece = SoftDeletableEntity<ContentPieceId> & {
  workspaceId: WorkspaceId;
  campaignId: CampaignId | null;
  /** Which connected account it goes to; null means the only one on its channel. */
  socialAccountId: SocialAccountId | null;
  title: string;
  body: string;
  hashtags: readonly string[];
  /** Where it is meant to go. Matches a connector id, or a channel with none. */
  channel: string;
  /**
   * When it should go out — an absolute instant, not a wall-clock time.
   *
   * The client sends an instant it worked out from the user's own timezone.
   * Storing "09:00" and a zone separately would mean deciding what happens to a
   * scheduled post when a workspace changes country, and nobody has decided.
   */
  scheduledAt: Date | null;
  status: ContentPieceStatus;
  /** The platform's post id, once it has one. Null until published. */
  publishedPostId: string | null;
  publishedAt: Date | null;
  /** Why the last publish attempt failed. Null while healthy. */
  lastError: string | null;
  metadata: Metadata;
};

export type CreateCampaignInput = {
  workspaceId: WorkspaceId;
  name: string;
  objective?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  metadata?: Metadata;
};

export type UpdateCampaignInput = {
  name?: string;
  objective?: string | null;
  status?: CampaignStatus;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type CreateContentPieceInput = {
  workspaceId: WorkspaceId;
  campaignId?: CampaignId | null;
  socialAccountId?: SocialAccountId | null;
  title: string;
  body: string;
  hashtags?: readonly string[];
  channel: string;
  scheduledAt?: Date | null;
  metadata?: Metadata;
};

export type UpdateContentPieceInput = {
  campaignId?: CampaignId | null;
  socialAccountId?: SocialAccountId | null;
  title?: string;
  body?: string;
  hashtags?: readonly string[];
  channel?: string;
  scheduledAt?: Date | null;
  status?: ContentPieceStatus;
};

export type CampaignRepository = {
  list(workspaceId: WorkspaceId): Promise<Campaign[]>;
  find(workspaceId: WorkspaceId, id: CampaignId): Promise<Campaign | null>;
  create(input: CreateCampaignInput, actorId: string | null): Promise<Campaign>;
  update(
    workspaceId: WorkspaceId,
    id: CampaignId,
    input: UpdateCampaignInput,
    actorId: string | null,
  ): Promise<Campaign | null>;
  archive(
    workspaceId: WorkspaceId,
    id: CampaignId,
    actorId: string | null,
  ): Promise<boolean>;
};

export type ContentPieceRepository = {
  list(
    workspaceId: WorkspaceId,
    filter?: { campaignId?: CampaignId; from?: Date; to?: Date },
  ): Promise<ContentPiece[]>;
  find(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
  ): Promise<ContentPiece | null>;
  create(
    input: CreateContentPieceInput,
    actorId: string | null,
  ): Promise<ContentPiece>;
  update(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
    input: UpdateContentPieceInput,
    actorId: string | null,
  ): Promise<ContentPiece | null>;
  archive(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
    actorId: string | null,
  ): Promise<boolean>;

  /**
   * Take ownership of what is due, across every workspace.
   *
   * Not scoped to one workspace, unlike everything above it: the runtime sweeps
   * on behalf of all of them and has no workspace to be scoped to. The claim is
   * one statement — read and mark together — because reading first and marking
   * second is exactly the window two nodes both fit through.
   *
   * Only `APPROVED` is ever claimed. A draft nobody looked at must not go out
   * because a date on it happened to pass.
   */
  claimDue(now: Date, limit: number): Promise<ContentPiece[]>;

  /** Record what the platform said, and stop the piece moving again. */
  settle(
    id: ContentPieceId,
    outcome:
      | { status: "PUBLISHED"; postId: string; publishedAt: Date }
      | { status: "FAILED"; error: string },
  ): Promise<void>;

  /**
   * Pieces stuck mid-send, so a person can be told.
   *
   * `olderThan` exists because a piece being in PUBLISHING is normal for the
   * second a publish takes; it is only evidence of a crash once it has been
   * there far longer than any call could run.
   */
  listStuck(olderThan: Date, limit: number): Promise<ContentPiece[]>;
};
