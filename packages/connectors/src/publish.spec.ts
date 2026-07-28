import { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import {
  credentialVerdict,
  publishToFacebook,
  verifyPageToken,
} from "./publish";

const ENV = {
  FACEBOOK_GRAPH_URL: "https://graph.test/v21.0",
} as NodeJS.ProcessEnv;

type Seen = {
  url?: string;
  method?: string;
  auth?: string | null;
  body?: URLSearchParams;
};

function answering(
  status: number,
  body: string,
  seen: Seen = {},
): typeof globalThis.fetch {
  return (async (url: string, init: RequestInit = {}) => {
    seen.url = String(url);
    seen.method = init.method ?? "GET";
    seen.auth = new Headers(init.headers).get("authorization");
    if (init.body) seen.body = new URLSearchParams(String(init.body));
    return new Response(body, { status });
  }) as unknown as typeof globalThis.fetch;
}

const caught = async (run: Promise<unknown>): Promise<RuntimeError> =>
  (await run.catch((error: unknown) => error)) as RuntimeError;

describe("verifyPageToken", () => {
  it("accepts a token that really belongs to the page", async () => {
    const seen: Seen = {};
    const identity = await verifyPageToken("page-1", "tok-1", {
      fetch: answering(
        200,
        JSON.stringify({ id: "page-1", name: "Trang A" }),
        seen,
      ),
      env: ENV,
    });

    expect(identity).toEqual({ externalId: "page-1", displayName: "Trang A" });
    expect(seen.url).toContain("https://graph.test/v21.0/page-1");
  });

  it("puts the token in a header, never the query string", async () => {
    // Query strings land in access logs, browser history and error reports.
    // This one is a live credential for somebody's audience.
    const seen: Seen = {};
    await verifyPageToken("page-1", "tok-secret", {
      fetch: answering(200, JSON.stringify({ id: "page-1", name: "A" }), seen),
      env: ENV,
    });

    expect(seen.auth).toBe("Bearer tok-secret");
    expect(seen.url).not.toContain("tok-secret");
  });

  it("refuses a token that answers for something else", async () => {
    // A user token answers happily and will not post to a page. Catching it
    // here is the difference between a clear message now and a permission
    // error days later.
    const failure = await caught(
      verifyPageToken("page-1", "user-token", {
        fetch: answering(200, JSON.stringify({ id: "usr-99", name: "Ai Đó" })),
        env: ENV,
      }),
    );

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(failure.message).toContain("usr-99");
  });

  it("does not retry a token the platform refused", async () => {
    const failure = await caught(
      verifyPageToken("page-1", "bad", {
        fetch: answering(
          401,
          JSON.stringify({ error: { message: "Invalid OAuth access token" } }),
        ),
        env: ENV,
      }),
    );

    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("Invalid OAuth access token");
  });
});

describe("credentialVerdict", () => {
  const graph = (code: number, subcode?: number) =>
    JSON.stringify({
      error: {
        code,
        message: "x",
        ...(subcode ? { error_subcode: subcode } : {}),
      },
    });

  it("says nothing about the credential for an ordinary refusal", () => {
    // A malformed post or a rate limit says nothing about the token, and
    // marking the connection dead over one would disconnect a working Page.
    expect(credentialVerdict(graph(100))).toBeNull();
    expect(credentialVerdict(graph(4))).toBeNull();
    expect(credentialVerdict("not json at all")).toBeNull();
    expect(credentialVerdict("{}")).toBeNull();
  });

  it("calls a plain token error expired", () => {
    expect(credentialVerdict(graph(190))).toBe("EXPIRED");
    expect(credentialVerdict(graph(190, 463))).toBe("EXPIRED");
  });

  it("calls a withdrawn permission revoked", () => {
    // Different remedy: reconnecting will fail again until the person restores
    // the permission on the platform itself.
    expect(credentialVerdict(graph(190, 458))).toBe("REVOKED");
    expect(credentialVerdict(graph(190, 460))).toBe("REVOKED");
  });
});

describe("publishToFacebook", () => {
  const target = { externalId: "page-1", accessToken: "tok-1" };

  it("posts the message and reports where it landed", async () => {
    const seen: Seen = {};
    const post = await publishToFacebook(
      target,
      { message: "Xin chào từ Tiximax" },
      {
        fetch: answering(200, JSON.stringify({ id: "page-1_555" }), seen),
        env: ENV,
      },
    );

    expect(seen.method).toBe("POST");
    expect(seen.url).toBe("https://graph.test/v21.0/page-1/feed");
    expect(seen.body?.get("message")).toBe("Xin chào từ Tiximax");
    expect(post.externalId).toBe("page-1_555");
    expect(post.url).toBe("https://www.facebook.com/page-1/posts/555");
  });

  it("attaches a link only when there is one", async () => {
    const withLink: Seen = {};
    await publishToFacebook(
      target,
      { message: "m", link: "https://tiximax.test/bai-viet" },
      {
        fetch: answering(200, JSON.stringify({ id: "p_1" }), withLink),
        env: ENV,
      },
    );
    expect(withLink.body?.get("link")).toBe("https://tiximax.test/bai-viet");

    const without: Seen = {};
    await publishToFacebook(
      target,
      { message: "m" },
      {
        fetch: answering(200, JSON.stringify({ id: "p_1" }), without),
        env: ENV,
      },
    );
    expect(without.body?.has("link")).toBe(false);
  });

  it("refuses an empty post without calling the platform", async () => {
    // Never what anyone meant, and this is not the layer to guess what they did
    // mean.
    const seen: Seen = {};
    const failure = await caught(
      publishToFacebook(
        target,
        { message: "   " },
        { fetch: answering(200, "{}", seen), env: ENV },
      ),
    );

    expect(failure.retryable).toBe(false);
    expect(seen.url).toBeUndefined();
  });

  it("does not call a 200 with no post id a success", async () => {
    // Nothing could edit, delete or link to it. Reporting it as published
    // would be a claim this code cannot support.
    const failure = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        { fetch: answering(200, JSON.stringify({ ok: true })), env: ENV },
      ),
    );

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(failure.retryable).toBe(false);
  });

  it("does not retry a post the platform rejected outright", async () => {
    const failure = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        {
          fetch: answering(
            403,
            JSON.stringify({
              error: {
                type: "OAuthException",
                message: "requires pages_manage_posts",
              },
            }),
          ),
          env: ENV,
        },
      ),
    );

    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("pages_manage_posts");
  });

  it("does retry a rate limit and a platform outage", async () => {
    const limited = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        {
          fetch: answering(
            429,
            JSON.stringify({ error: { message: "slow down" } }),
          ),
          env: ENV,
        },
      ),
    );
    expect(limited.retryable).toBe(true);

    const unwell = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        { fetch: answering(500, "{}"), env: ENV },
      ),
    );
    expect(unwell.retryable).toBe(true);
  });

  it("carries the credential verdict on the error it throws", async () => {
    // So the caller can mark the connection without parsing the vendor's body
    // again, and without this module knowing connections exist.
    const failure = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        {
          fetch: answering(
            400,
            JSON.stringify({
              error: { code: 190, error_subcode: 463, message: "expired" },
            }),
          ),
          env: ENV,
        },
      ),
    );

    expect(failure.context?.credential).toBe("EXPIRED");
  });

  it("says nothing about the credential when the post itself was wrong", async () => {
    const failure = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        {
          fetch: answering(
            400,
            JSON.stringify({ error: { code: 100, message: "bad param" } }),
          ),
          env: ENV,
        },
      ),
    );

    expect(failure.context?.credential).toBeUndefined();
  });

  it("does not echo the token back in an error", async () => {
    // Graph quotes what was sent, and this string goes into logs and into task
    // output that people read.
    const failure = await caught(
      publishToFacebook(
        { externalId: "page-1", accessToken: "tok-very-secret" },
        { message: "m" },
        {
          fetch: answering(
            400,
            JSON.stringify({
              error: {
                message: "bad request",
                access_token: "tok-very-secret",
              },
            }),
          ),
          env: ENV,
        },
      ),
    );

    expect(failure.message).not.toContain("tok-very-secret");
  });

  it("keeps a dropped connection retryable, unlike a refusal", async () => {
    // The request may well have arrived. Whoever retries has to be ready for a
    // duplicate, which is the engine's decision to make, not this layer's.
    const failure = await caught(
      publishToFacebook(
        target,
        { message: "m" },
        {
          fetch: (() => {
            throw new Error("ECONNRESET");
          }) as unknown as typeof globalThis.fetch,
          env: ENV,
        },
      ),
    );

    expect(failure.retryable).toBe(true);
  });
});
