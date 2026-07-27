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
