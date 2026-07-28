import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, inMemoryTokenStore } from "./client";
import { ApiError } from "./error";
import type { AuthTokens } from "./types";

const TOKENS: AuthTokens = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  tokenType: "Bearer",
  expiresIn: 900,
};

type Call = { url: string; init: RequestInit };

/** A fetch that answers from a queue and records what it was asked. */
function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error(`No stubbed response for ${String(url)}`);
      return next();
    },
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const ok = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });

const fail = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function header(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

describe("ApiClient", () => {
  let store: ReturnType<typeof inMemoryTokenStore>;

  beforeEach(() => {
    store = inMemoryTokenStore(TOKENS);
  });

  it("unwraps the success envelope so callers see the payload", async () => {
    const { fetch } = fakeFetch([() => ok({ id: "gol_1", title: "Test" })]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    const goal = await client.getGoal("gol_1");

    expect(goal.id).toBe("gol_1");
  });

  it("attaches the workspace header the API authorises against", async () => {
    // Forgetting it turns a valid request into a confusing 400, which is why
    // the client owns it rather than every caller.
    const { fetch, calls } = fakeFetch([() => ok([])]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
      workspaceId: "wsp_1",
    });

    await client.listGoals();

    expect(header(calls[0]!, "x-workspace-id")).toBe("wsp_1");
  });

  it("does not send the workspace header on calls that are not scoped to one", async () => {
    const { fetch, calls } = fakeFetch([() => ok({ id: "usr_1" })]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
      workspaceId: "wsp_1",
    });

    await client.me();

    expect(header(calls[0]!, "x-workspace-id")).toBeUndefined();
  });

  it("never sends the access token on login or register", async () => {
    // A stale token on an anonymous endpoint is at best noise and at worst
    // authenticates the wrong account into a fresh session.
    const { fetch, calls } = fakeFetch([
      () => ok({ user: {}, tokens: TOKENS }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    await client.login({ email: "a@b.c", password: "secret" });

    expect(header(calls[0]!, "authorization")).toBeUndefined();
  });

  it("stores the tokens a successful login returns", async () => {
    const fresh: AuthTokens = { ...TOKENS, accessToken: "access-new" };
    const { fetch } = fakeFetch([() => ok({ user: {}, tokens: fresh })]);
    const empty = inMemoryTokenStore(null);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: empty,
    });

    await client.login({ email: "a@b.c", password: "secret" });

    expect(empty.read()?.accessToken).toBe("access-new");
  });

  it("refreshes once on a 401 and replays the original request", async () => {
    const { fetch, calls } = fakeFetch([
      () => fail(401, { code: "TOKEN_EXPIRED", message: "expired" }),
      () => ok({ ...TOKENS, accessToken: "access-2" }),
      () => ok([{ id: "gol_1" }]),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    const goals = await client.listGoals();

    expect(goals).toHaveLength(1);
    expect(calls[1]?.url).toContain("/auth/refresh");
    // The replay carries the new token, not the expired one.
    expect(header(calls[2]!, "authorization")).toBe("Bearer access-2");
  });

  it("refreshes only once when several requests expire together", async () => {
    // Refresh tokens are one-time-use with rotation, and the API treats a
    // reused one as theft and kills the session. Racing them would not merely
    // waste a call — it would sign the user out.
    const { fetch, calls } = fakeFetch([
      () => fail(401, { code: "TOKEN_EXPIRED", message: "expired" }),
      () => fail(401, { code: "TOKEN_EXPIRED", message: "expired" }),
      () => fail(401, { code: "TOKEN_EXPIRED", message: "expired" }),
      () => ok({ ...TOKENS, accessToken: "access-2" }),
      () => ok([]),
      () => ok([]),
      () => ok([]),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    await Promise.all([
      client.listGoals(),
      client.listExecutions(),
      client.listGoals(),
    ]);

    const refreshes = calls.filter((c) => c.url.includes("/auth/refresh"));
    expect(refreshes).toHaveLength(1);
  });

  it("gives up rather than looping when the refreshed token is also rejected", async () => {
    const { fetch } = fakeFetch([
      () => fail(401, { code: "TOKEN_EXPIRED", message: "expired" }),
      () => ok({ ...TOKENS, accessToken: "access-2" }),
      () => fail(401, { code: "FORBIDDEN", message: "still no" }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    await expect(client.listGoals()).rejects.toBeInstanceOf(ApiError);
  });

  it("clears the session and says so when refresh itself fails", async () => {
    const onSignedOut = vi.fn();
    const { fetch } = fakeFetch([
      () => fail(401, { code: "TOKEN_EXPIRED", message: "expired" }),
      () => fail(401, { code: "INVALID_REFRESH_TOKEN", message: "gone" }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
      onSignedOut,
    });

    await expect(client.listGoals()).rejects.toBeInstanceOf(ApiError);
    expect(store.read()).toBeNull();
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  it("does not try to refresh when there is no session to refresh", async () => {
    const { fetch, calls } = fakeFetch([
      () => fail(401, { code: "UNAUTHENTICATED", message: "no token" }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: inMemoryTokenStore(null),
    });

    await expect(client.listGoals()).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it("surfaces field errors so a form can point at the offending input", async () => {
    const { fetch } = fakeFetch([
      () =>
        fail(422, {
          code: "VALIDATION_FAILED",
          message: "Invalid",
          requestId: "req_1",
          details: [
            { field: "objective", message: "too short" },
            { field: "title", message: "required" },
          ],
        }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    const error = (await client
      .createGoal({ title: "", objective: "x" })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.isValidation).toBe(true);
    expect(error.fieldErrors()).toEqual({
      objective: "too short",
      title: "required",
    });
    expect(error.requestId).toBe("req_1");
  });

  it("still reports the status when the error body is not JSON", async () => {
    // A proxy timeout returns an HTML page. Losing the status there would
    // leave the UI with nothing to show.
    const { fetch } = fakeFetch([
      () => new Response("<html>504</html>", { status: 504 }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    const error = (await client
      .listGoals()
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(504);
    expect(error.code).toBe("HTTP_504");
  });

  it("treats 204 as success with no body", async () => {
    const { fetch } = fakeFetch([() => new Response(null, { status: 204 })]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    await expect(client.logout()).resolves.toBeUndefined();
    expect(store.read()).toBeNull();
  });

  it("clears the session even when logout fails on the server", async () => {
    // Keeping a token the server may already have revoked would leave the UI
    // pretending to be signed in.
    const { fetch } = fakeFetch([
      () => fail(500, { code: "INTERNAL", message: "boom" }),
      () => fail(500, { code: "INTERNAL", message: "boom" }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: store,
    });

    await expect(client.logout()).rejects.toBeInstanceOf(ApiError);
    expect(store.read()).toBeNull();
  });

  it("does not double the slash when the base URL has a trailing one", async () => {
    const { fetch, calls } = fakeFetch([() => ok([])]);
    const client = new ApiClient({
      baseUrl: "http://api.test/api/v1/",
      fetch,
      tokens: store,
    });

    await client.listGoals();

    expect(calls[0]?.url).toBe("http://api.test/api/v1/goals");
  });
});

describe("ApiClient — documents", () => {
  it("sends the file as multipart without naming the content type", async () => {
    // The boundary is part of the content type and only the runtime knows it,
    // so a hand-written `multipart/form-data` header produces one the server
    // cannot parse the body against — and the upload fails with a message
    // about a missing file rather than about the header.
    const { fetch, calls } = fakeFetch([() => ok({ id: "doc_1" })]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: inMemoryTokenStore(TOKENS),
    });
    client.setWorkspace("wsp_1");

    await client.uploadDocument(
      new File(["nội dung"], "ghi-chu.txt", { type: "text/plain" }),
    );

    const { init } = calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("does not JSON-stringify the form", async () => {
    // `JSON.stringify(new FormData())` is "{}" — the request would succeed at
    // the transport layer and arrive with no file at all.
    const { fetch, calls } = fakeFetch([() => ok({ id: "doc_1" })]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: inMemoryTokenStore(TOKENS),
    });

    await client.uploadDocument(new File(["x"], "a.txt", { type: "text/plain" }));

    expect(typeof calls[0]!.init.body).not.toBe("string");
  });

  it("scopes every document call to the workspace", async () => {
    const { fetch, calls } = fakeFetch([
      () => ok([]),
      () => ok({ url: "http://minio/x" }),
    ]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: inMemoryTokenStore(TOKENS),
    });
    client.setWorkspace("wsp_1");

    await client.listDocuments();
    await client.documentDownloadUrl("doc_1");

    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers["x-workspace-id"]).toBe("wsp_1");
    }
  });

  it("returns the download URL rather than the envelope around it", async () => {
    const { fetch } = fakeFetch([() => ok({ url: "http://minio/signed" })]);
    const client = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: inMemoryTokenStore(TOKENS),
    });

    expect(await client.documentDownloadUrl("doc_1")).toBe(
      "http://minio/signed",
    );
  });
});

describe("ApiClient — chat streaming", () => {
  /** A response whose body arrives in the given pieces. */
  function sseResponse(pieces: string[]) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const client = (fetch: typeof globalThis.fetch) => {
    const api = new ApiClient({
      baseUrl: "http://api.test",
      fetch,
      tokens: inMemoryTokenStore(TOKENS),
    });
    api.setWorkspace("wsp_1");
    return api;
  };

  const drain = async (api: ApiClient) => {
    const events = [];
    for await (const event of api.streamMessage("cnv_1", "xin chào")) {
      events.push(event);
    }
    return events;
  };

  it("yields each delta and the final message", async () => {
    const { fetch } = fakeFetch([
      () =>
        sseResponse([
          'event: delta\ndata: {"text":"Cà "}\n\n',
          'event: delta\ndata: {"text":"phê"}\n\n',
          'event: done\ndata: {"id":"msg_1","role":"assistant","content":"Cà phê"}\n\n',
        ]),
    ]);

    const events = await drain(client(fetch));

    expect(events.map((e) => e.type)).toEqual(["delta", "delta", "done"]);
    expect(
      events
        .filter((e): e is { type: "delta"; text: string } => e.type === "delta")
        .map((e) => e.text)
        .join(""),
    ).toBe("Cà phê");
  });

  it("keeps an event that straddles two network reads", async () => {
    // A read is not an event. One read can carry half of one, and parsing per
    // read drops whatever crosses the boundary — which shows up as text going
    // missing from the middle of long answers.
    const { fetch } = fakeFetch([
      () =>
        sseResponse([
          'event: delta\ndata: {"te',
          'xt":"nguyên vẹn"}\n\nevent: done\ndata: {"id":"msg_1"}\n\n',
        ]),
    ]);

    const events = await drain(client(fetch));

    expect(events[0]).toEqual({ type: "delta", text: "nguyên vẹn" });
    expect(events[1]?.type).toBe("done");
  });

  it("carries the partial answer on an error event", async () => {
    const { fetch } = fakeFetch([
      () =>
        sseResponse([
          'event: delta\ndata: {"text":"một nửa"}\n\n',
          'event: error\ndata: {"message":"provider dropped","partial":{"id":"msg_2","content":"một nửa","truncated":true}}\n\n',
        ]),
    ]);

    const events = await drain(client(fetch));

    const failure = events.at(-1) as {
      type: "error";
      message: string;
      partial: { content: string } | null;
    };
    expect(failure.type).toBe("error");
    expect(failure.partial?.content).toBe("một nửa");
  });

  it("ignores an event type it does not know", async () => {
    // A server that adds an event must not break a conversation that works.
    const { fetch } = fakeFetch([
      () =>
        sseResponse([
          'event: heartbeat\ndata: {}\n\n',
          'event: delta\ndata: {"text":"vẫn chạy"}\n\n',
        ]),
    ]);

    const events = await drain(client(fetch));

    expect(events).toEqual([{ type: "delta", text: "vẫn chạy" }]);
  });

  it("sends the workspace header and the message body", async () => {
    const { fetch, calls } = fakeFetch([
      () => sseResponse(['event: done\ndata: {"id":"msg_1"}\n\n']),
    ]);

    await drain(client(fetch));

    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-workspace-id"]).toBe("wsp_1");
    expect(headers.authorization).toBe("Bearer access-1");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      content: "xin chào",
    });
  });

  it("throws rather than streaming when the request is refused outright", async () => {
    // Before the first byte the server can still answer normally, so this is
    // a status code and is surfaced as one.
    const { fetch } = fakeFetch([
      () =>
        fail(404, {
          code: "NOT_FOUND",
          message: "Không tìm thấy hội thoại.",
          requestId: "req_1",
        }),
    ]);

    await expect(drain(client(fetch))).rejects.toThrow(ApiError);
  });
});
