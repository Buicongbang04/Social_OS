import { XMLParser } from "fast-xml-parser";
import {
  TrendSourceError,
  type TrendItem,
  type TrendQuery,
  type TrendSource,
} from "./types";

const FEED = "https://trends.google.com/trending/rss";

/**
 * What Vietnam is searching for today, from Google's public RSS feed.
 *
 * Not the official Trends API. That exists — announced July 2025 — but a year
 * on it is still an application-gated alpha, so it is not something this
 * platform can be built on today. The RSS feed needs no key, no quota and no
 * approval, and it is the thing Google actually publishes for this.
 *
 * What that costs: **only today's trending searches**. Interest-over-time, term
 * comparison and the five-year history are what the gated API adds and this
 * cannot do. It answers "what is hot now", not "was this hotter last month".
 */
export class GoogleTrendsSource implements TrendSource {
  readonly name = "google" as const;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly feedUrl = FEED,
  ) {}

  async fetch(query: TrendQuery = {}): Promise<TrendItem[]> {
    const geo = (query.geo ?? "VN").toUpperCase();
    const url = `${this.feedUrl}?geo=${encodeURIComponent(geo)}`;

    let body: string;
    try {
      const response = await this.fetchImpl(url);
      if (!response.ok) {
        // A geo Google does not know answers 200 with an empty feed, so a
        // non-200 here is the feed itself being unavailable, not a bad query.
        throw new TrendSourceError(
          this.name,
          `Google Trends trả về ${response.status}.`,
        );
      }
      body = await response.text();
    } catch (caught) {
      if (caught instanceof TrendSourceError) throw caught;
      throw new TrendSourceError(
        this.name,
        "Không gọi được Google Trends.",
        caught,
      );
    }

    return this.parse(body).slice(0, query.limit ?? 20);
  }

  private parse(xml: string): TrendItem[] {
    const parser = new XMLParser({
      // Every field here is text. Left on, the parser turns a title like
      // "2026" into the number 2026 and a term of "true" into a boolean, and
      // the shape depends on what people happened to search for that day.
      parseTagValue: false,
      ignoreAttributes: true,
    });

    let items: unknown;
    try {
      items = parser.parse(xml)?.rss?.channel?.item;
    } catch (caught) {
      throw new TrendSourceError(this.name, "Không đọc được RSS.", caught);
    }

    // One item comes back as an object, several as an array. A feed with
    // exactly one trend is rare, which is what makes it worth handling here.
    const list =
      items === undefined ? [] : Array.isArray(items) ? items : [items];

    return list.map((raw) => {
      const item = raw as Record<string, unknown>;
      const news = firstNewsItem(item["ht:news_item"]);
      const at = item["pubDate"] ? new Date(String(item["pubDate"])) : null;

      return {
        source: this.name,
        title: String(item["title"] ?? "").trim(),
        // Kept as Google writes it — "200+", "20K+" is a band, and reading it
        // as 200 would turn a floor into a measurement.
        volume: item["ht:approx_traffic"]
          ? String(item["ht:approx_traffic"])
          : null,
        // The news link, not the feed's own <link> — every item carries the
        // same feed URL there, which would give twenty rows one destination.
        url: news?.url ?? null,
        at: at && !Number.isNaN(at.getTime()) ? at : null,
        context: news?.title ?? null,
      };
    });
  }
}

function firstNewsItem(
  raw: unknown,
): { title: string; url: string | null } | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (!first || typeof first !== "object") return null;

  const item = first as Record<string, unknown>;
  const title = item["ht:news_item_title"];
  if (title === undefined) return null;

  return {
    title: String(title),
    url: item["ht:news_item_url"] ? String(item["ht:news_item_url"]) : null,
  };
}
