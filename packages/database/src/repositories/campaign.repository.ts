import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type {
  CampaignId,
  ContentPieceId,
  Metadata,
  SocialAccountId,
  WorkspaceId,
} from "@repo/core";
import { newId } from "@repo/core";
import type {
  Campaign,
  CampaignRepository,
  CampaignSummary,
  ContentPiece,
  ContentPieceRepository,
  CreateCampaignInput,
  CreateContentPieceInput,
  UpdateCampaignInput,
  UpdateContentPieceInput,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { campaigns, contentPieces } from "../schema";

/**
 * How many pieces sit in one status.
 *
 * `count(*) filter (where ...)` rather than five separate queries: one pass
 * over the rows answers all of them, and five would each re-read the same
 * index.
 *
 * PUBLISHING is deliberately absent from the report. It lasts a second or two,
 * and a column that is almost always zero teaches a reader to ignore it.
 */
function countWhere(status: string) {
  return sql<number>`count(*) filter (where ${contentPieces.status} = ${status})`;
}

type CampaignRow = typeof campaigns.$inferSelect;
type PieceRow = typeof contentPieces.$inferSelect;

function toCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id as CampaignId,
    workspaceId: row.workspaceId as WorkspaceId,
    name: row.name,
    objective: row.objective,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

function toPiece(row: PieceRow): ContentPiece {
  return {
    id: row.id as ContentPieceId,
    workspaceId: row.workspaceId as WorkspaceId,
    campaignId: (row.campaignId as CampaignId | null) ?? null,
    socialAccountId: (row.socialAccountId as SocialAccountId | null) ?? null,
    title: row.title,
    body: row.body,
    hashtags: row.hashtags,
    channel: row.channel,
    scheduledAt: row.scheduledAt,
    imageKey: row.imageKey,
    status: row.status,
    publishedPostId: row.publishedPostId,
    publishedAt: row.publishedAt,
    lastError: row.lastError,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

/**
 * Only the fields that were actually supplied.
 *
 * Not what protects a partial update from wiping what it did not mention —
 * drizzle already ignores `undefined` in `.set()`, which a break-check proved
 * when removing this changed nothing. What it does is let the caller tell
 * "nothing to change" from "change these": an update whose every field is
 * undefined would otherwise still write, bumping `version` and the audit
 * columns for a request that asked for nothing.
 *
 * `null` still means "clear it", and that distinction is drizzle's to keep.
 */
function given<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export class DrizzleCampaignRepository implements CampaignRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list(workspaceId: WorkspaceId): Promise<Campaign[]> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
        ),
      )
      // Newest first: a campaign list is read to find what is running now, not
      // to browse history.
      .orderBy(sql`${campaigns.createdAt} desc`);

    return rows.map(toCampaign);
  }

  async find(
    workspaceId: WorkspaceId,
    id: CampaignId,
  ): Promise<Campaign | null> {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, id),
          // Scoped in the query, never checked afterwards.
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toCampaign(rows[0]) : null;
  }

  async create(
    input: CreateCampaignInput,
    actorId: string | null,
  ): Promise<Campaign> {
    const rows = await this.db
      .insert(campaigns)
      .values({
        id: newId("campaign"),
        workspaceId: input.workspaceId,
        name: input.name,
        objective: input.objective ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        metadata: input.metadata ?? {},
        createdBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Creating the campaign returned no row.");
    return toCampaign(row);
  }

  async update(
    workspaceId: WorkspaceId,
    id: CampaignId,
    input: UpdateCampaignInput,
    actorId: string | null,
  ): Promise<Campaign | null> {
    const changes = given(input);
    if (Object.keys(changes).length === 0) return this.find(workspaceId, id);

    const rows = await this.db
      .update(campaigns)
      .set({
        ...changes,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${campaigns.version} + 1`,
      })
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toCampaign(rows[0]) : null;
  }

  async archive(
    workspaceId: WorkspaceId,
    id: CampaignId,
    actorId: string | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(campaigns)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${campaigns.version} + 1`,
      })
      .where(
        and(
          eq(campaigns.id, id),
          eq(campaigns.workspaceId, workspaceId),
          isNull(campaigns.deletedAt),
        ),
      )
      .returning({ id: campaigns.id });

    return rows.length > 0;
  }
}

export class DrizzleContentPieceRepository implements ContentPieceRepository {
  constructor(private readonly db: DatabaseClient) {}

  async list(
    workspaceId: WorkspaceId,
    filter: { campaignId?: CampaignId; from?: Date; to?: Date } = {},
  ): Promise<ContentPiece[]> {
    const rows = await this.db
      .select()
      .from(contentPieces)
      .where(
        and(
          eq(contentPieces.workspaceId, workspaceId),
          isNull(contentPieces.deletedAt),
          ...(filter.campaignId
            ? [eq(contentPieces.campaignId, filter.campaignId)]
            : []),
          // A window filters out unscheduled pieces by construction: a piece
          // with no date is not in any range, and a calendar showing undated
          // drafts on an arbitrary day would be lying about when they go out.
          ...(filter.from ? [gte(contentPieces.scheduledAt, filter.from)] : []),
          ...(filter.to ? [lte(contentPieces.scheduledAt, filter.to)] : []),
        ),
      )
      // Scheduled first, in order; undated last.
      //
      // `nulls last` is written out even though it is already the default for
      // ASC in Postgres — DESC is the direction that puts them first. Saying it
      // means the ordering survives someone flipping the direction later, and
      // stops the next reader having to remember which way round it is.
      .orderBy(
        sql`${contentPieces.scheduledAt} asc nulls last`,
        asc(contentPieces.createdAt),
      );

    return rows.map(toPiece);
  }

  async find(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
  ): Promise<ContentPiece | null> {
    const rows = await this.db
      .select()
      .from(contentPieces)
      .where(
        and(
          eq(contentPieces.id, id),
          eq(contentPieces.workspaceId, workspaceId),
          isNull(contentPieces.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toPiece(rows[0]) : null;
  }

  async create(
    input: CreateContentPieceInput,
    actorId: string | null,
  ): Promise<ContentPiece> {
    const rows = await this.db
      .insert(contentPieces)
      .values({
        id: newId("contentPiece"),
        workspaceId: input.workspaceId,
        campaignId: input.campaignId ?? null,
        socialAccountId: input.socialAccountId ?? null,
        title: input.title,
        body: input.body,
        hashtags: [...(input.hashtags ?? [])],
        channel: input.channel,
        scheduledAt: input.scheduledAt ?? null,
        metadata: input.metadata ?? {},
        createdBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Creating the content piece returned no row.");
    return toPiece(row);
  }

  async update(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
    input: UpdateContentPieceInput,
    actorId: string | null,
  ): Promise<ContentPiece | null> {
    const { hashtags, ...rest } = given(input);
    const changes = {
      ...rest,
      // Copied rather than passed through: the domain type is readonly and
      // drizzle wants a mutable array it may keep. Pulled out of the spread
      // rather than overridden after it, because the spread's own type is what
      // the compiler objects to.
      ...(hashtags === undefined ? {} : { hashtags: [...hashtags] }),
    };
    if (Object.keys(changes).length === 0) return this.find(workspaceId, id);

    const rows = await this.db
      .update(contentPieces)
      .set({
        ...changes,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${contentPieces.version} + 1`,
      })
      .where(
        and(
          eq(contentPieces.id, id),
          eq(contentPieces.workspaceId, workspaceId),
          isNull(contentPieces.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toPiece(rows[0]) : null;
  }

  async archive(
    workspaceId: WorkspaceId,
    id: ContentPieceId,
    actorId: string | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(contentPieces)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${contentPieces.version} + 1`,
      })
      .where(
        and(
          eq(contentPieces.id, id),
          eq(contentPieces.workspaceId, workspaceId),
          isNull(contentPieces.deletedAt),
        ),
      )
      .returning({ id: contentPieces.id });

    return rows.length > 0;
  }

  /**
   * Claim what is due, in one statement.
   *
   * One statement is what makes it safe. Reading first and marking second
   * leaves a window two nodes both fit through; here the `status = 'APPROVED'`
   * test and the write happen together, and a second node that blocks on the
   * locked row re-evaluates the subquery when it wakes, finds PUBLISHING, and
   * claims nothing. Verified against Postgres with two independent connection
   * pools rather than assumed.
   *
   * `for update skip locked` is therefore about throughput, not safety: it
   * lets that second sweep step over what this one holds and pick up different
   * work instead of waiting. Worth having, but it is not the thing standing
   * between one post and two.
   */
  async claimDue(now: Date, limit: number): Promise<ContentPiece[]> {
    const rows = await this.db
      .update(contentPieces)
      .set({
        status: "PUBLISHING",
        updatedAt: new Date(),
        version: sql`${contentPieces.version} + 1`,
      })
      // The locked subquery is raw because that is the part that matters and
      // drizzle has no builder for it. The update around it is not, so the
      // returned rows come back through drizzle's column mapping — written as
      // one raw statement, `returning *` hands back snake_case keys and every
      // field reads as undefined, which is exactly what the first version did.
      .where(
        sql`${contentPieces.id} in (
          select id from content_pieces
          where status = 'APPROVED'
            and scheduled_at is not null
            -- Sent as text with an explicit cast: a Date interpolated into raw
            -- SQL reaches the driver as an object it refuses.
            and scheduled_at <= ${now.toISOString()}::timestamptz
            and deleted_at is null
          order by scheduled_at asc
          limit ${limit}
          for update skip locked
        )`,
      )
      .returning();

    return rows.map(toPiece);
  }

  async settle(
    id: ContentPieceId,
    outcome:
      | { status: "PUBLISHED"; postId: string; publishedAt: Date }
      | { status: "FAILED"; error: string },
  ): Promise<void> {
    await this.db
      .update(contentPieces)
      .set({
        status: outcome.status,
        // Cleared on success. A piece that failed, was fixed and went out
        // still showing yesterday's error reads as still broken.
        lastError: outcome.status === "FAILED" ? outcome.error : null,
        ...(outcome.status === "PUBLISHED"
          ? {
              publishedPostId: outcome.postId,
              publishedAt: outcome.publishedAt,
            }
          : {}),
        updatedAt: new Date(),
        version: sql`${contentPieces.version} + 1`,
      })
      .where(eq(contentPieces.id, id));
  }

  async summariseByCampaign(
    workspaceId: WorkspaceId,
  ): Promise<CampaignSummary[]> {
    const rows = await this.db
      .select({
        campaignId: contentPieces.campaignId,
        drafts: countWhere("DRAFT"),
        approved: countWhere("APPROVED"),
        published: countWhere("PUBLISHED"),
        failed: countWhere("FAILED"),
        // Only the ids that exist. `filter (where ...)` rather than a plain
        // aggregate, because array_agg over a column full of nulls returns an
        // array of nulls rather than an empty one.
        publishedPostIds: sql<
          string[] | null
        >`array_agg(${contentPieces.publishedPostId}) filter (where ${contentPieces.publishedPostId} is not null)`,
      })
      .from(contentPieces)
      .where(
        and(
          eq(contentPieces.workspaceId, workspaceId),
          isNull(contentPieces.deletedAt),
        ),
      )
      .groupBy(contentPieces.campaignId);

    return rows.map((row) => ({
      campaignId: (row.campaignId as CampaignId | null) ?? null,
      drafts: Number(row.drafts),
      approved: Number(row.approved),
      published: Number(row.published),
      failed: Number(row.failed),
      publishedPostIds: row.publishedPostIds ?? [],
    }));
  }

  async listStuck(olderThan: Date, limit: number): Promise<ContentPiece[]> {
    const rows = await this.db
      .select()
      .from(contentPieces)
      .where(
        and(
          eq(contentPieces.status, "PUBLISHING"),
          lte(contentPieces.updatedAt, olderThan),
          isNull(contentPieces.deletedAt),
        ),
      )
      .limit(limit);

    return rows.map(toPiece);
  }
}
