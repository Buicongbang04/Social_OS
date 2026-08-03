import { describe, expect, it } from "vitest";
import { GoogleTrendsSource } from "./google";
import { TrendSourceError } from "./types";

/**
 * The feed shape, taken from a real response on 3 August 2026.
 *
 * Trimmed to the fields that are read, and kept verbatim otherwise — including
 * the `ht:` namespace prefixes, which are the part a parser gets wrong.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
  <channel>
    <title>Daily Search Trends</title>
    <item>
      <title>sân bay</title>
      <ht:approx_traffic>200+</ht:approx_traffic>
      <link>https://trends.google.com/trending/rss?geo=VN</link>
      <pubDate>Sun, 2 Aug 2026 22:10:00 -0700</pubDate>
      <ht:news_item>
        <ht:news_item_title>Hành khách phải đi đâu để bắt xe công nghệ?</ht:news_item_title>
        <ht:news_item_url>https://www.24h.com.vn/tin-tuc</ht:news_item_url>
      </ht:news_item>
    </item>
    <item>
      <title>0888</title>
      <ht:approx_traffic>20K+</ht:approx_traffic>
      <pubDate>Sun, 2 Aug 2026 20:00:00 -0700</pubDate>
    </item>
  </channel>
</rss>`;

const respondWith = (body: string, init: ResponseInit = {}) =>
  (async () => new Response(body, init)) as unknown as typeof fetch;

describe("GoogleTrendsSource", () => {
  it("reads the term, the band and the news headline", async () => {
    const source = new GoogleTrendsSource(respondWith(FEED));

    const [first] = await source.fetch();

    expect(first?.title).toBe("sân bay");
    expect(first?.volume).toBe("200+");
    expect(first?.context).toBe("Hành khách phải đi đâu để bắt xe công nghệ?");
    expect(first?.at?.toISOString()).toBe("2026-08-03T05:10:00.000Z");
  });

  it("links to the news, not to the feed", async () => {
    // Every item's own <link> is the feed URL itself. Using it would give
    // twenty rows on screen one destination between them.
    const source = new GoogleTrendsSource(respondWith(FEED));

    const [first] = await source.fetch();

    expect(first?.url).toBe("https://www.24h.com.vn/tin-tuc");
  });

  it("keeps a term that looks like a number exactly as searched", async () => {
    // People search for phone numbers and prices. A parser left to guess types
    // reads "0888" as the number 888 and "1.50" as 1.5 — the leading zero and
    // the trailing zero are gone before any code here sees the term, so
    // converting back to a string afterwards cannot recover them.
    const source = new GoogleTrendsSource(respondWith(FEED));

    const items = await source.fetch();

    expect(items[1]?.title).toBe("0888");
  });

  it("survives an item with no news attached", async () => {
    const source = new GoogleTrendsSource(respondWith(FEED));

    const items = await source.fetch();

    expect(items[1]?.context).toBeNull();
    expect(items[1]?.url).toBeNull();
  });

  it("reads a feed carrying exactly one trend", async () => {
    // The parser gives an object for one item and an array for several. A
    // quiet day is exactly when this would break.
    const single = FEED.replace(
      /<item>\s*<title>0888<\/title>[\s\S]*?<\/item>/,
      "",
    );
    const source = new GoogleTrendsSource(respondWith(single));

    const items = await source.fetch();

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("sân bay");
  });

  it("returns nothing, rather than failing, for a geo with no trends", async () => {
    const empty = `<rss version="2.0"><channel><title>Daily Search Trends</title></channel></rss>`;
    const source = new GoogleTrendsSource(respondWith(empty));

    expect(await source.fetch({ geo: "aq" })).toEqual([]);
  });

  it("asks for the geo it was given, upper-cased", async () => {
    let asked = "";
    const source = new GoogleTrendsSource((async (url: string) => {
      asked = url;
      return new Response(FEED);
    }) as unknown as typeof fetch);

    await source.fetch({ geo: "us" });

    expect(asked).toContain("geo=US");
  });

  it("says which source failed when the feed is down", async () => {
    const source = new GoogleTrendsSource(respondWith("", { status: 503 }));

    await expect(source.fetch()).rejects.toBeInstanceOf(TrendSourceError);
  });

  it("cuts the list to the limit asked for", async () => {
    const source = new GoogleTrendsSource(respondWith(FEED));

    expect(await source.fetch({ limit: 1 })).toHaveLength(1);
  });
});
