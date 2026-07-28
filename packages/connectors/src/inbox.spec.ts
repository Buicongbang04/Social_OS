import type { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { fetchComments, fetchInbox } from "./inbox";

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
