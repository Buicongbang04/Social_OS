import type { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { fetchPostStats } from "./stats";

const ENV = {
  FACEBOOK_GRAPH_URL: "https://graph.test/v21.0",
} as NodeJS.ProcessEnv;
const TARGET = { externalId: "page-1", accessToken: "tok-1" };

type Seen = { url?: string; auth?: string | null };

function answering(
  status: number,
  body: unknown,
  seen: Seen = {},
): typeof globalThis.fetch {
  return (async (url: string, init: RequestInit = {}) => {
    seen.url = String(url);
    seen.auth = new Headers(init.headers).get("authorization");
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
}

const post = {
  id: "page-1_55",
  created_time: "2026-07-22T03:36:14+0000",
  message: "Bài về dịch vụ mua hộ",
  likes: { summary: { total_count: 12 } },
  comments: { summary: { total_count: 3 } },
  shares: { count: 2 },
};

describe("fetchPostStats", () => {
  it("reads the counts and where the post is", async () => {
    const seen: Seen = {};
    const stats = await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(200, { data: [post] }, seen),
    });

    expect(seen.auth).toBe("Bearer tok-1");
    expect(stats[0]).toEqual({
      postId: "page-1_55",
      createdAt: "2026-07-22T03:36:14+0000",
      message: "Bài về dịch vụ mua hộ",
      likes: 12,
      comments: 3,
      shares: 2,
      url: "https://www.facebook.com/page-1/posts/55",
    });
  });

  it("asks for counts without the rows behind them", async () => {
    // Without `.limit(0)` Graph returns every like and comment, which is a
    // great deal of other people's data moved around to display a number.
    const seen: Seen = {};
    await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(200, { data: [] }, seen),
    });

    expect(seen.url).toContain("likes.summary(true).limit(0)");
    expect(seen.url).toContain("comments.summary(true).limit(0)");
  });

  it("reads a missing count as zero, not unknown", async () => {
    // Graph omits `shares` entirely on a post nobody shared. Treating that as
    // unknown would put a dash where a real zero belongs.
    const stats = await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(200, {
        data: [{ id: "p_1", created_time: "2026-07-01T00:00:00+0000" }],
      }),
    });

    expect(stats[0]?.likes).toBe(0);
    expect(stats[0]?.shares).toBe(0);
  });

  it("trims a long post down to something recognisable", async () => {
    const stats = await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(200, {
        data: [{ ...post, message: "b".repeat(300) }],
      }),
    });

    expect(stats[0]?.message).toHaveLength(121);
  });

  it("collapses the whitespace a post is written with", async () => {
    // A post is full of newlines and emoji spacing. Left alone, a snippet is
    // three words and a wall of blank space.
    const stats = await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(200, {
        data: [{ ...post, message: "Dòng một\n\n\nDòng hai" }],
      }),
    });

    expect(stats[0]?.message).toBe("Dòng một Dòng hai");
  });

  it("separates a refusal from an outage", async () => {
    const refused = (await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(403, {
        error: { message: "requires pages_read_engagement" },
      }),
    }).catch((error: unknown) => error)) as RuntimeError;
    expect(refused.retryable).toBe(false);

    const unwell = (await fetchPostStats(TARGET, {
      env: ENV,
      fetch: answering(500, {}),
    }).catch((error: unknown) => error)) as RuntimeError;
    expect(unwell.retryable).toBe(true);
  });
});
