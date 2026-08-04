import type { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { fetchComments, fetchInbox, fetchRecentComments } from "./inbox";

const ENV = {
  FACEBOOK_GRAPH_URL: "https://graph.test/v21.0",
} as NodeJS.ProcessEnv;

const TARGET = { externalId: "page-1", accessToken: "tok-1" };

type Seen = {
  url?: string;
  auth?: string | null;
  /** How many requests were made — the point of reading the feed nested. */
  calls?: number;
};

function answering(
  status: number,
  body: unknown,
  seen: Seen = {},
): typeof globalThis.fetch {
  return (async (url: string, init: RequestInit = {}) => {
    seen.url = String(url);
    seen.auth = new Headers(init.headers).get("authorization");
    seen.calls = (seen.calls ?? 0) + 1;
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status },
    );
  }) as unknown as typeof globalThis.fetch;
}

const caught = async (run: Promise<unknown>): Promise<RuntimeError> =>
  (await run.catch((error: unknown) => error)) as RuntimeError;

describe("fetchInbox", () => {
  const thread = {
    id: "t_1",
    updated_time: "2026-07-28T10:00:00+0000",
    unread_count: 2,
    participants: {
      data: [
        { id: "page-1", name: "Công Nghệ mới" },
        { id: "u_9", name: "Khách hàng A" },
      ],
    },
    messages: { data: [{ message: "Cho mình hỏi phí ship về Hà Nội?" }] },
  };

  it("reads threads with who wrote and what they last said", async () => {
    const seen: Seen = {};
    const threads = await fetchInbox(TARGET, {
      env: ENV,
      fetch: answering(200, { data: [thread] }, seen),
    });

    expect(seen.auth).toBe("Bearer tok-1");
    expect(seen.url).toContain("https://graph.test/v21.0/page-1/conversations");
    expect(threads[0]).toEqual({
      id: "t_1",
      participant: "Khách hàng A",
      updatedAt: "2026-07-28T10:00:00+0000",
      lastMessage: "Cho mình hỏi phí ship về Hà Nội?",
      unread: true,
    });
  });

  it("names the customer, not the Page", async () => {
    // The Page is a participant in its own threads. Taking the first name in
    // the list would label every thread with the Page's own name, which tells
    // whoever is reading nothing at all.
    const threads = await fetchInbox(TARGET, {
      env: ENV,
      fetch: answering(200, {
        data: [
          {
            ...thread,
            participants: {
              data: [
                { id: "u_9", name: "Khách hàng A" },
                { id: "page-1", name: "Công Nghệ mới" },
              ],
            },
          },
        ],
      }),
    });

    expect(threads[0]?.participant).toBe("Khách hàng A");
  });

  it("calls a thread read when nothing is outstanding", async () => {
    const threads = await fetchInbox(TARGET, {
      env: ENV,
      fetch: answering(200, { data: [{ ...thread, unread_count: 0 }] }),
    });

    expect(threads[0]?.unread).toBe(false);
  });

  it("trims a long message rather than carrying all of it", async () => {
    // These end up in logs, in task outputs stored forever, and in a model's
    // context. A customer's whole message does not need to be in any of them.
    const long = "a".repeat(500);
    const threads = await fetchInbox(TARGET, {
      env: ENV,
      fetch: answering(200, {
        data: [{ ...thread, messages: { data: [{ message: long }] } }],
      }),
    });

    expect(threads[0]?.lastMessage).toHaveLength(201);
    expect(threads[0]?.lastMessage?.endsWith("…")).toBe(true);
  });

  it("survives a thread with no messages in it", async () => {
    const threads = await fetchInbox(TARGET, {
      env: ENV,
      fetch: answering(200, { data: [{ ...thread, messages: undefined }] }),
    });

    expect(threads[0]?.lastMessage).toBeNull();
  });

  it("will not be asked for more than Graph will give", async () => {
    // A caller asking for a thousand threads gets a page of fifty rather than
    // a request Graph rejects outright.
    const seen: Seen = {};
    await fetchInbox(TARGET, {
      limit: 1000,
      env: ENV,
      fetch: answering(200, { data: [] }, seen),
    });

    expect(seen.url).toContain("limit=50");
  });

  it("separates a refusal from an outage", async () => {
    const refused = await caught(
      fetchInbox(TARGET, {
        env: ENV,
        fetch: answering(403, {
          error: { message: "requires pages_messaging" },
        }),
      }),
    );
    expect(refused.retryable).toBe(false);
    expect(refused.message).toContain("pages_messaging");

    const unwell = await caught(
      fetchInbox(TARGET, { env: ENV, fetch: answering(500, {}) }),
    );
    expect(unwell.retryable).toBe(true);
  });
});

describe("fetchRecentComments", () => {
  const FEED = JSON.stringify({
    data: [
      {
        id: "page-1_10",
        message: "Bài mới nhất",
        comments: {
          data: [
            {
              id: "c_2",
              from: { name: "Bách Ngũ" },
              message: "còn hàng không shop",
              created_time: "2026-08-03T10:00:00+0000",
            },
          ],
        },
      },
      {
        id: "page-1_9",
        message: "Bài cũ hơn",
        comments: {
          data: [
            {
              id: "c_1",
              from: { name: "Lan" },
              message: "ship về Huế bao nhiêu?",
              created_time: "2026-08-01T08:00:00+0000",
            },
          ],
        },
      },
    ],
  });

  it("reads every post's comments in one request", async () => {
    // Reading the feed and then each post separately is eleven round trips to
    // answer one question, and eleven chances for a rate limit.
    const seen: Seen = {};
    const comments = await fetchRecentComments(TARGET, {
      env: ENV,
      fetch: answering(200, FEED, seen),
    });

    expect(comments).toHaveLength(2);
    expect(seen.calls).toBe(1);
    expect(seen.url).toContain("/feed?");
    expect(seen.url).toContain("comments.limit(10)");
  });

  it("says which post each comment sits under", async () => {
    // A question with no context is unanswerable: "còn hàng không" needs the
    // post to say what "hàng" is.
    const comments = await fetchRecentComments(TARGET, {
      env: ENV,
      fetch: answering(200, FEED),
    });

    expect(comments[0]?.postId).toBe("page-1_10");
    expect(comments[0]?.postExcerpt).toBe("Bài mới nhất");
  });

  it("puts the newest comment first, not the newest post", async () => {
    // The feed's own order is by post. A week-old comment on today's post
    // would otherwise sit above an hour-old one further down.
    const comments = await fetchRecentComments(TARGET, {
      env: ENV,
      fetch: answering(
        200,
        JSON.stringify({
          data: [
            {
              id: "page-1_10",
              message: "Bài mới",
              comments: {
                data: [
                  {
                    id: "c_old",
                    message: "cũ",
                    created_time: "2026-07-01T00:00:00+0000",
                  },
                ],
              },
            },
            {
              id: "page-1_9",
              message: "Bài cũ",
              comments: {
                data: [
                  {
                    id: "c_new",
                    message: "mới",
                    created_time: "2026-08-03T00:00:00+0000",
                  },
                ],
              },
            },
          ],
        }),
      ),
    });

    expect(comments.map((comment) => comment.id)).toEqual(["c_new", "c_old"]);
  });

  it("says Người dùng rather than guessing at a name it was not given", async () => {
    // Facebook omits `from` for anyone who has not granted the app something,
    // which is most people.
    const comments = await fetchRecentComments(TARGET, {
      env: ENV,
      fetch: answering(
        200,
        JSON.stringify({
          data: [
            {
              id: "page-1_10",
              comments: {
                data: [
                  {
                    id: "c",
                    message: "alo",
                    created_time: "2026-08-03T00:00:00+0000",
                  },
                ],
              },
            },
          ],
        }),
      ),
    });

    expect(comments[0]?.author).toBe("Người dùng");
    expect(comments[0]?.postExcerpt).toBeNull();
  });

  it("returns nothing for a Page whose posts have no comments", async () => {
    const comments = await fetchRecentComments(TARGET, {
      env: ENV,
      fetch: answering(200, JSON.stringify({ data: [{ id: "page-1_10" }] })),
    });

    expect(comments).toEqual([]);
  });

  it("will not ask for more than Graph will give", async () => {
    const seen: Seen = {};
    await fetchRecentComments(TARGET, {
      posts: 500,
      perPost: 500,
      env: ENV,
      fetch: answering(200, FEED, seen),
    });

    expect(seen.url).toContain("limit=50");
    expect(seen.url).toContain("comments.limit(50)");
  });
});

describe("fetchComments", () => {
  it("reads who commented and what they said", async () => {
    const seen: Seen = {};
    const comments = await fetchComments(TARGET, "page-1_55", {
      env: ENV,
      fetch: answering(
        200,
        {
          data: [
            {
              id: "c_1",
              from: { name: "Khách hàng B" },
              message: "Còn hàng không shop?",
              created_time: "2026-07-28T10:05:00+0000",
            },
          ],
        },
        seen,
      ),
    });

    expect(seen.url).toContain("/page-1_55/comments");
    expect(comments[0]?.author).toBe("Khách hàng B");
    expect(comments[0]?.message).toBe("Còn hàng không shop?");
  });

  it("names an anonymous commenter rather than leaving a blank", async () => {
    const comments = await fetchComments(TARGET, "p_1", {
      env: ENV,
      fetch: answering(200, { data: [{ id: "c_2", message: "hay quá" }] }),
    });

    expect(comments[0]?.author).toBe("Người dùng");
  });
});
