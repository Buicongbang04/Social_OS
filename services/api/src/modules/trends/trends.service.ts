import { Inject, Injectable } from "@nestjs/common";
import type { WorkspaceId } from "@repo/core";
import { ValidationError } from "@repo/core";
import {
  GoogleTrendsSource,
  TrendSourceError,
  YouTubeTrendsSource,
  type TrendItem,
  type TrendSourceName,
} from "@repo/trends";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../../infra/redis/redis.module";
import { SecretsService } from "../secrets/secrets.service";

/** Where a workspace's own YouTube key lives in the vault. */
export const YOUTUBE_SECRET_NAME = "sources/youtube";

/**
 * How long a source's answer is reused.
 *
 * Trending searches move on the order of hours, so a fifteen-minute cache
 * costs nothing anybody would notice and is the difference between one call a
 * quarter-hour and one per person who opens the screen. YouTube's free quota
 * is 10,000 units a day; ten people refreshing would otherwise be the only
 * thing that spends it.
 */
const CACHE_TTL_SECONDS = 15 * 60;

/**
 * Reading trends, on behalf of a workspace.
 *
 * The cache key holds the source, the geo and the limit but **not** the
 * workspace: what Vietnam is searching for is the same question no matter who
 * asks it, and keying by workspace would multiply identical calls by the number
 * of tenants. It does not hold a key or anything derived from one.
 */
@Injectable()
export class TrendsService {
  constructor(
    private readonly secrets: SecretsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async read(
    workspaceId: WorkspaceId,
    source: TrendSourceName,
    geo: string,
    limit: number,
  ): Promise<TrendItem[]> {
    const cacheKey = `trends:${source}:${geo.toUpperCase()}:${limit}`;

    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return reviveDates(JSON.parse(cached) as TrendItem[]);

    const items = await this.fetch(workspaceId, source, geo, limit);

    // Cached after the call succeeds, never before: a failure written to the
    // cache would make one bad minute last fifteen.
    await this.redis
      .set(cacheKey, JSON.stringify(items), "EX", CACHE_TTL_SECONDS)
      .catch(() => null);

    return items;
  }

  private async fetch(
    workspaceId: WorkspaceId,
    source: TrendSourceName,
    geo: string,
    limit: number,
  ): Promise<TrendItem[]> {
    try {
      if (source === "google") {
        return await new GoogleTrendsSource().fetch({ geo, limit });
      }

      const key = await this.youtubeKey(workspaceId);
      return await new YouTubeTrendsSource(key).fetch({ geo, limit });
    } catch (caught) {
      // Turned into a ValidationError so the caller gets the source's own
      // words — "hết quota cho hôm nay" is actionable, and a 500 saying
      // nothing is not.
      if (caught instanceof TrendSourceError) {
        throw new ValidationError(caught.message);
      }
      throw caught;
    }
  }

  /**
   * The workspace's key if it has one, otherwise the operator's.
   *
   * The same order as the AI gateway uses, for the same reason: a workspace
   * that brings its own key spends its own quota, and one that has not brought
   * one can still try the feature.
   */
  private async youtubeKey(workspaceId: WorkspaceId): Promise<string> {
    const own = await this.secrets.resolve(workspaceId, YOUTUBE_SECRET_NAME);
    const key = own ?? process.env.YOUTUBE_API_KEY?.trim();

    if (!key) {
      throw new ValidationError(
        `Chưa có khoá YouTube. Lưu một khoá tên "${YOUTUBE_SECRET_NAME}" ở Kho khoá, hoặc đặt YOUTUBE_API_KEY cho cả máy chủ.`,
      );
    }
    return key;
  }
}

/**
 * `at` is a Date going into the cache and a string coming out.
 *
 * JSON has no date type, so without this a cached read and an uncached read
 * hand back two different shapes for the same call — and only the second
 * person to open the screen sees the broken one.
 */
function reviveDates(items: TrendItem[]): TrendItem[] {
  return items.map((item) => ({
    ...item,
    at: item.at === null ? null : new Date(item.at),
  }));
}
