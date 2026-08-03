import { describe, expect, it } from "vitest";
import { TrendSourceError } from "./types";
import { YouTubeTrendsSource } from "./youtube";

const PAYLOAD = {
  items: [
    {
      id: "abc123",
      snippet: {
        title: "Đi chợ Nhật cùng mình",
        channelTitle: "Tiximax",
        publishedAt: "2026-08-02T10:00:00Z",
      },
      statistics: { viewCount: "184392" },
    },
    {
      id: "def456",
      snippet: { title: "Video không có thống kê", channelTitle: "Ai đó" },
    },
  ],
};

const respondWith = (body: unknown, init: ResponseInit = {}) =>
  (async () =>
    new Response(JSON.stringify(body), init)) as unknown as typeof fetch;

describe("YouTubeTrendsSource", () => {
  it("reads the title, the channel and the view count", async () => {
    const source = new YouTubeTrendsSource("key", respondWith(PAYLOAD));

    const [first] = await source.fetch();

    expect(first?.title).toBe("Đi chợ Nhật cùng mình");
    expect(first?.context).toBe("Tiximax");
    expect(first?.volume).toBe("184392");
    expect(first?.url).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("survives a video the API returned no statistics for", async () => {
    // `statistics` is absent for a video whose owner hid its counts. Reading
    // it as zero would put a real video at the bottom of a list sorted by
    // views, which is worse than saying nothing.
    const source = new YouTubeTrendsSource("key", respondWith(PAYLOAD));

    const items = await source.fetch();

    expect(items[1]?.volume).toBeNull();
    expect(items[1]?.at).toBeNull();
  });

  it("asks for the trending chart, not for a search", async () => {
    // `search` costs 100 quota units against 1, and would need the platform to
    // decide what to search for — which is the question, not the answer.
    let asked = "";
    const source = new YouTubeTrendsSource("key", (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(PAYLOAD));
    }) as unknown as typeof fetch);

    await source.fetch({ geo: "vn" });

    expect(asked).toContain("chart=mostPopular");
    expect(asked).toContain("regionCode=VN");
  });

  it("never asks for more than the API will give", async () => {
    // maxResults above 50 is a 400, and the caller asking for 200 should get
    // 50 rather than an error about a parameter they never set.
    let asked = "";
    const source = new YouTubeTrendsSource("key", (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(PAYLOAD));
    }) as unknown as typeof fetch);

    await source.fetch({ limit: 200 });

    expect(asked).toContain("maxResults=50");
  });

  it("says the quota ran out, rather than repeating a 403", async () => {
    // A 403 is either a key that is wrong or a quota that is spent. Those are
    // fixed by different people, so the message has to tell them apart.
    const source = new YouTubeTrendsSource(
      "key",
      respondWith(
        { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } },
        { status: 403 },
      ),
    );

    await expect(source.fetch()).rejects.toThrow(/quota/i);
  });

  it("passes on what the API said when a key is refused", async () => {
    const source = new YouTubeTrendsSource(
      "wrong",
      respondWith(
        {
          error: {
            message: "API key not valid",
            errors: [{ reason: "badRequest" }],
          },
        },
        { status: 400 },
      ),
    );

    await expect(source.fetch()).rejects.toThrow(/API key not valid/);
  });

  it("names itself when the call never lands", async () => {
    const source = new YouTubeTrendsSource("key", (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);

    const failure = await source.fetch().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TrendSourceError);
    expect((failure as TrendSourceError).source).toBe("youtube");
  });
});
