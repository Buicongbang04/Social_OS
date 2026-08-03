import {
  TrendSourceError,
  type TrendItem,
  type TrendQuery,
  type TrendSource,
} from "./types";

const ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";

type VideoResponse = {
  items?: {
    id?: string;
    snippet?: {
      title?: string;
      channelTitle?: string;
      publishedAt?: string;
    };
    statistics?: { viewCount?: string };
  }[];
  error?: { message?: string; errors?: { reason?: string }[] };
};

/**
 * What Vietnam is watching, from the YouTube Data API.
 *
 * `chart=mostPopular` rather than `search`: it is what YouTube itself calls
 * trending, it costs 1 quota unit against `search`'s 100, and it needs no query
 * — a search endpoint would need the platform to decide what to search for,
 * which is the question being asked, not the answer.
 *
 * The key is passed in rather than read from the environment, so a workspace's
 * own key can come from the Secret Manager without this knowing where keys
 * live.
 */
export class YouTubeTrendsSource implements TrendSource {
  readonly name = "youtube" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = ENDPOINT,
  ) {}

  async fetch(query: TrendQuery = {}): Promise<TrendItem[]> {
    const params = new URLSearchParams({
      part: "snippet,statistics",
      chart: "mostPopular",
      regionCode: (query.geo ?? "VN").toUpperCase(),
      maxResults: String(Math.min(query.limit ?? 20, 50)),
      key: this.apiKey,
    });

    let payload: VideoResponse;
    let ok: boolean;
    let status: number;
    try {
      const response = await this.fetchImpl(`${this.endpoint}?${params}`);
      ok = response.ok;
      status = response.status;
      payload = (await response.json()) as VideoResponse;
    } catch (caught) {
      throw new TrendSourceError(this.name, "Không gọi được YouTube.", caught);
    }

    if (!ok) {
      // The reason, not just the status: a 403 is either a key that is wrong
      // or a quota that ran out, and those two are fixed by different people
      // on different days.
      const reason = payload.error?.errors?.[0]?.reason ?? "";
      throw new TrendSourceError(
        this.name,
        reason === "quotaExceeded"
          ? "YouTube đã hết quota cho hôm nay."
          : `YouTube trả về ${status}: ${payload.error?.message ?? "không rõ lý do"}.`,
      );
    }

    return (payload.items ?? []).map((video) => {
      const at = video.snippet?.publishedAt
        ? new Date(video.snippet.publishedAt)
        : null;

      return {
        source: this.name,
        title: video.snippet?.title ?? "",
        // A real count, unlike Google's band — but still a string, so nothing
        // downstream can add a view count to a search volume.
        volume: video.statistics?.viewCount ?? null,
        url: video.id ? `https://www.youtube.com/watch?v=${video.id}` : null,
        at: at && !Number.isNaN(at.getTime()) ? at : null,
        context: video.snippet?.channelTitle ?? null,
      };
    });
  }
}
