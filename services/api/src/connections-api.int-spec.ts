import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * Connecting a social platform, end to end.
 *
 * The platform here is a real HTTP server started by this file rather than a
 * mock. That distinction has already earned its keep once in this repo: a
 * mocked vendor agrees with whatever the code does, and every bug worth finding
 * in an OAuth flow is a disagreement between the code and something on the
 * other end of a socket.
 *
 * It is not Facebook, and this suite does not claim it is — what it proves is
 * that the flow is correct against a server that follows the spec. The real
 * vendor is verified when the operator supplies app credentials.
 */
process.env.SECRET_KEYS = `test:${randomBytes(32).toString("base64")}`;
process.env.SECRET_PRIMARY_KEY = "test";
process.env.FACEBOOK_CLIENT_ID = "test-app";
process.env.FACEBOOK_CLIENT_SECRET = "test-secret";

const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

/** What the fake platform was asked, so tests can assert on it. */
type Seen = {
  tokenBody?: URLSearchParams;
  identityAuth?: string | null;
};

/** How the fake platform should behave on the next exchange. */
type Behaviour = {
  tokenStatus: number;
  tokenBody: string;
  identityStatus: number;
  identityBody: string;
};

describe.skipIf(!hasInfra)("connections API (integration)", () => {
  let testApp: TestApp;
  let platform: Server;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const seen: Seen = {};
  let behaviour: Behaviour;
  /** What the fake Page's inbox holds, and whether it can be read at all. */
  let conversations: unknown[];
  let inboxStatus: number;
  /** What the fake Page has posted, for the stats read. */
  let feedPosts: unknown[];
  let statsStatus: number;

  const as = (user: RegisteredUser, workspaceId: string) => ({
    Authorization: `Bearer ${user.accessToken}`,
    "X-Workspace-Id": workspaceId,
  });

  /** Start a connection and pull the `state` back out of the URL. */
  const beginConnect = async (
    user: RegisteredUser,
    workspaceId: string,
  ): Promise<{ url: string; state: string }> => {
    const response = await testApp
      .http()
      .post("/api/v1/connections/facebook/start")
      .set(as(user, workspaceId))
      .expect(201);

    const url = response.body.data.url as string;
    return { url, state: new URL(url).searchParams.get("state")! };
  };

  const callback = (query: Record<string, string>) =>
    testApp
      .http()
      .get("/api/v1/connections/facebook/callback")
      .query(query)
      .redirects(0);

  beforeAll(async () => {
    platform = createServer((request, response) => {
      const url = new URL(request.url!, "http://localhost");

      if (url.pathname === "/oauth/token") {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          seen.tokenBody = new URLSearchParams(
            Buffer.concat(chunks).toString(),
          );
          response.writeHead(behaviour.tokenStatus, {
            "content-type": "application/json",
          });
          response.end(behaviour.tokenBody);
        });
        return;
      }

      // The inbox read. Answered separately so a test can put messages on the
      // fake Page without changing how a token check behaves.
      // The stats read. Recognised by the fields it asks for, since it hits
      // the same /feed path the duplicate check uses.
      if (
        url.pathname.endsWith("/feed") &&
        url.search.includes("likes.summary")
      ) {
        response.writeHead(statsStatus, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            statsStatus === 200
              ? { data: feedPosts }
              : { error: { message: "requires pages_read_engagement" } },
          ),
        );
        return;
      }

      if (url.pathname.endsWith("/conversations")) {
        response.writeHead(inboxStatus, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            inboxStatus === 200
              ? { data: conversations }
              : { error: { message: "requires pages_messaging" } },
          ),
        );
        return;
      }

      // `/{page-id}` — how a pasted token is checked before anything is
      // stored.
      if (url.pathname.startsWith("/graph/")) {
        seen.identityAuth = request.headers.authorization ?? null;
        response.writeHead(behaviour.identityStatus, {
          "content-type": "application/json",
        });
        response.end(behaviour.identityBody);
        return;
      }

      if (url.pathname === "/me") {
        seen.identityAuth = request.headers.authorization ?? null;
        response.writeHead(behaviour.identityStatus, {
          "content-type": "application/json",
        });
        response.end(behaviour.identityBody);
        return;
      }

      response.writeHead(404).end();
    });

    await new Promise<void>((resolve) => platform.listen(0, resolve));
    const port = (platform.address() as AddressInfo).port;

    process.env.FACEBOOK_TOKEN_URL = `http://127.0.0.1:${port}/oauth/token`;
    process.env.FACEBOOK_IDENTITY_URL = `http://127.0.0.1:${port}/me`;
    process.env.FACEBOOK_AUTHORIZE_URL = `http://127.0.0.1:${port}/authorize`;
    process.env.FACEBOOK_GRAPH_URL = `http://127.0.0.1:${port}/graph`;

    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
    if (platform)
      await new Promise<void>((resolve) => platform.close(() => resolve()));
  });

  beforeEach(async () => {
    await testApp.reset();
    delete seen.tokenBody;
    delete seen.identityAuth;

    conversations = [];
    inboxStatus = 200;
    feedPosts = [];
    statsStatus = 200;

    behaviour = {
      tokenStatus: 200,
      tokenBody: JSON.stringify({
        access_token: "platform-token-abc",
        refresh_token: "platform-refresh-xyz",
        expires_in: 3600,
        scope: "pages_show_list,pages_manage_posts",
      }),
      identityStatus: 200,
      identityBody: JSON.stringify({
        id: "page-9001",
        name: "Tiximax Chính Thức",
      }),
    };

    alice = await registerUser(testApp, "alice@connect.test");
    bob = await registerUser(testApp, "bob@connect.test");

    aliceWorkspace = (await createTenant(testApp, alice, "alice")).workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob")).workspaceId;
  });

  it("connects an account and stores no token in the row", async () => {
    const { state } = await beginConnect(alice, aliceWorkspace);

    await callback({ state, code: "auth-code-1" }).expect(302);

    const listed = await testApp
      .http()
      .get("/api/v1/connections")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].displayName).toBe("Tiximax Chính Thức");
    expect(listed.body.data[0].externalId).toBe("page-9001");
    // The whole point of the vault reference: nothing in the row is a
    // credential, so no log line that serialises a connection can leak one.
    expect(JSON.stringify(listed.body)).not.toContain("platform-token-abc");
    expect(JSON.stringify(listed.body)).not.toContain("platform-refresh-xyz");
  });

  it("sends the platform a real exchange, not a guess", async () => {
    const { state } = await beginConnect(alice, aliceWorkspace);
    await callback({ state, code: "auth-code-2" }).expect(302);

    expect(seen.tokenBody?.get("grant_type")).toBe("authorization_code");
    expect(seen.tokenBody?.get("code")).toBe("auth-code-2");
    expect(seen.tokenBody?.get("client_secret")).toBe("test-secret");
    expect(seen.tokenBody?.get("redirect_uri")).toContain(
      "/connections/facebook/callback",
    );
    expect(seen.identityAuth).toBe("Bearer platform-token-abc");
  });

  it("keeps the workspace out of the URL the browser carries", async () => {
    // Anyone can hit a callback. If the workspace travelled in the redirect,
    // anyone could attach an account to a workspace of their choosing.
    const { url } = await beginConnect(alice, aliceWorkspace);

    expect(url).not.toContain(aliceWorkspace);
    expect(url).not.toContain(alice.accessToken);
  });

  it("refuses a state it never issued", async () => {
    // The only thing standing between an unauthenticated callback and someone
    // else's workspace.
    const response = await callback({
      state: "made-up-state",
      code: "auth-code",
    }).expect(302);

    expect(response.headers.location).toContain("connected=failed");
    expect(seen.tokenBody).toBeUndefined();
  });

  it("will not honour the same state twice", async () => {
    // A state that can be redeemed twice is a code that can be replayed.
    const { state } = await beginConnect(alice, aliceWorkspace);

    const first = await callback({ state, code: "code-1" }).expect(302);
    expect(first.headers.location).toContain("connected=ok");

    const second = await callback({ state, code: "code-1" }).expect(302);
    expect(second.headers.location).toContain("connected=failed");
  });

  it("records the scopes that were granted, not the ones asked for", async () => {
    // The platform granted two of the four. That difference is what the
    // workspace can really do, and publish time is too late to discover it.
    const { state } = await beginConnect(alice, aliceWorkspace);
    await callback({ state, code: "c" }).expect(302);

    const listed = await testApp
      .http()
      .get("/api/v1/connections")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(listed.body.data[0].scopes).toEqual([
      "pages_show_list",
      "pages_manage_posts",
    ]);
  });

  it("reconnecting the same page updates it rather than doubling it", async () => {
    const first = await beginConnect(alice, aliceWorkspace);
    await callback({ state: first.state, code: "c1" }).expect(302);

    behaviour.identityBody = JSON.stringify({
      id: "page-9001",
      name: "Tiximax — tên mới",
    });
    const second = await beginConnect(alice, aliceWorkspace);
    await callback({ state: second.state, code: "c2" }).expect(302);

    const listed = await testApp
      .http()
      .get("/api/v1/connections")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].displayName).toBe("Tiximax — tên mới");
  });

  it("stores nothing when the platform rejects the code", async () => {
    behaviour.tokenStatus = 400;
    behaviour.tokenBody = JSON.stringify({ error: "invalid_grant" });

    const { state } = await beginConnect(alice, aliceWorkspace);
    const response = await callback({ state, code: "bad" }).expect(302);

    expect(response.headers.location).toContain("connected=failed");
    expect(
      (
        await testApp
          .http()
          .get("/api/v1/connections")
          .set(as(alice, aliceWorkspace))
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });

  it("stores nothing when the token works but says who it is not", async () => {
    // A perfectly good token whose identity call is refused. Storing a
    // connection here would leave a row with no stable key, and the next
    // reconnection would sit beside it rather than replace it.
    behaviour.identityStatus = 403;
    behaviour.identityBody = JSON.stringify({ error: "insufficient scope" });

    const { state } = await beginConnect(alice, aliceWorkspace);
    await callback({ state, code: "c" }).expect(302);

    expect(
      (
        await testApp
          .http()
          .get("/api/v1/connections")
          .set(as(alice, aliceWorkspace))
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });

  it("carries a cancelled authorization back as a decision, not a failure", async () => {
    const response = await callback({
      error: "access_denied",
      error_description: "user cancelled",
    }).expect(302);

    expect(response.headers.location).toContain("connected=cancelled");
  });

  it("does not put the platform's error text in the redirect", async () => {
    // It lands in browser history and in every proxy log between here and the
    // browser.
    behaviour.tokenStatus = 400;
    behaviour.tokenBody = JSON.stringify({
      error: "invalid_grant",
      error_description: "code auth-code-secret already redeemed",
    });

    const { state } = await beginConnect(alice, aliceWorkspace);
    const response = await callback({ state, code: "auth-code-secret" }).expect(
      302,
    );

    expect(response.headers.location).not.toContain("auth-code-secret");
    expect(response.headers.location).not.toContain("already redeemed");
  });

  it("hides one workspace's connections from another", async () => {
    const { state } = await beginConnect(alice, aliceWorkspace);
    await callback({ state, code: "c" }).expect(302);

    const mine = await testApp
      .http()
      .get("/api/v1/connections")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(
      (
        await testApp
          .http()
          .get("/api/v1/connections")
          .set(as(bob, bobWorkspace))
          .expect(200)
      ).body.data,
    ).toEqual([]);

    // Not 403: confirming the id exists is itself a leak.
    await testApp
      .http()
      .delete(`/api/v1/connections/${mine.body.data[0].id}`)
      .set(as(bob, bobWorkspace))
      .expect(404);
  });

  it("takes the stored credential away when the connection is removed", async () => {
    // "Remove" that leaves a working token behind is not what the button says.
    const { state } = await beginConnect(alice, aliceWorkspace);
    await callback({ state, code: "c" }).expect(302);

    const listed = await testApp
      .http()
      .get("/api/v1/connections")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const before = await testApp
      .http()
      .get("/api/v1/secrets")
      .set(as(alice, aliceWorkspace))
      .expect(200);
    expect(
      before.body.data.some(
        (secret: { name: string }) =>
          secret.name === "connections/facebook/page-9001",
      ),
    ).toBe(true);

    await testApp
      .http()
      .delete(`/api/v1/connections/${listed.body.data[0].id}`)
      .set(as(alice, aliceWorkspace))
      .expect(204);

    const after = await testApp
      .http()
      .get("/api/v1/secrets")
      .set(as(alice, aliceWorkspace))
      .expect(200);
    expect(
      after.body.data.some(
        (secret: { name: string }) =>
          secret.name === "connections/facebook/page-9001",
      ),
    ).toBe(false);
  });

  it("attaches a Page from a token the operator already holds", async () => {
    // The path that exists because getting an app through review takes weeks.
    // Beside OAuth, not instead of it.
    behaviour.identityBody = JSON.stringify({
      id: "page-777",
      name: "Trang dán tay",
    });

    const attached = await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    expect(attached.body.data.displayName).toBe("Trang dán tay");
    expect(seen.identityAuth).toBe("Bearer a-real-looking-page-token");
    // Checked against the platform, not taken on trust.
    expect(JSON.stringify(attached.body)).not.toContain(
      "a-real-looking-page-token",
    );
  });

  it("stores nothing when the token is not for that Page", async () => {
    // A user token answers happily and will not post to a page. Storing it
    // would give a connection that looks healthy and fails at publish time.
    behaviour.identityBody = JSON.stringify({ id: "usr-1", name: "Ai Đó" });

    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      // 400, not 500: a mistyped token is a wrong value in a form, and
      // paging whoever is on call for that is how alerts stop being read.
      .send({ externalId: "page-777", accessToken: "a-user-token-not-a-page" })
      .expect(400);

    expect(
      (
        await testApp
          .http()
          .get("/api/v1/connections")
          .set(as(alice, aliceWorkspace))
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });

  it("stores nothing when the platform refuses the token", async () => {
    behaviour.identityStatus = 401;
    behaviour.identityBody = JSON.stringify({
      error: { message: "Invalid OAuth access token" },
    });

    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({ externalId: "page-777", accessToken: "expired-token-here-ok" })
      .expect(400);

    expect(
      (
        await testApp
          .http()
          .get("/api/v1/connections")
          .set(as(alice, aliceWorkspace))
          .expect(200)
      ).body.data,
    ).toEqual([]);
  });

  it("lets a pasted Page be disconnected like any other", async () => {
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });

    const attached = await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    await testApp
      .http()
      .delete(`/api/v1/connections/${attached.body.data.id}`)
      .set(as(alice, aliceWorkspace))
      .expect(204);

    // The credential goes with it, exactly as on the OAuth path.
    expect(
      (
        await testApp
          .http()
          .get("/api/v1/secrets")
          .set(as(alice, aliceWorkspace))
          .expect(200)
      ).body.data.some(
        (secret: { name: string }) =>
          secret.name === "connections/facebook/page-777",
      ),
    ).toBe(false);
  });

  it("shows messages waiting on a connected channel", async () => {
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    conversations = [
      {
        id: "t_1",
        updated_time: "2026-07-28T10:00:00+0000",
        unread_count: 1,
        participants: {
          data: [
            { id: "page-777", name: "Trang" },
            { id: "u_1", name: "Khách A" },
          ],
        },
        messages: { data: [{ message: "Còn hàng không shop?" }] },
      },
    ];

    const inbox = await testApp
      .http()
      .get("/api/v1/connections/inbox")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(inbox.body.data.threads).toHaveLength(1);
    expect(inbox.body.data.threads[0].participant).toBe("Khách A");
    expect(inbox.body.data.threads[0].unread).toBe(true);
    expect(inbox.body.data.failed).toEqual([]);
  });

  it("names a channel it could not read instead of hiding it", async () => {
    // An empty inbox and an inbox nobody could open look the same on screen,
    // and only one of them means there is nothing waiting.
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    inboxStatus = 403;

    const inbox = await testApp
      .http()
      .get("/api/v1/connections/inbox")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(inbox.body.data.threads).toEqual([]);
    expect(inbox.body.data.failed).toHaveLength(1);
    expect(inbox.body.data.failed[0].account).toBe("Trang");
  });

  it("puts the newest message first, across channels", async () => {
    // Sorting per channel would bury a message from an hour ago under a
    // week-old thread from the other one — which is the message that actually
    // needs answering.
    behaviour.identityBody = JSON.stringify({ id: "page-a", name: "Trang A" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({ externalId: "page-a", accessToken: "a-real-looking-page-token" })
      .expect(201);

    behaviour.identityBody = JSON.stringify({ id: "page-b", name: "Trang B" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({ externalId: "page-b", accessToken: "another-page-token-here" })
      .expect(201);

    // The same fake feed answers for both channels, so the two threads differ
    // only by time — which is exactly what the ordering has to get right.
    conversations = [
      {
        id: "t_old",
        updated_time: "2026-07-01T10:00:00+0000",
        unread_count: 0,
        participants: { data: [{ id: "u_1", name: "Khách cũ" }] },
        messages: { data: [{ message: "tuần trước" }] },
      },
      {
        id: "t_new",
        updated_time: "2026-07-28T10:00:00+0000",
        unread_count: 1,
        participants: { data: [{ id: "u_2", name: "Khách mới" }] },
        messages: { data: [{ message: "vừa nãy" }] },
      },
    ];

    const inbox = await testApp
      .http()
      .get("/api/v1/connections/inbox")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const times = inbox.body.data.threads.map(
      (thread: { updatedAt: string }) => thread.updatedAt,
    );
    expect(times).toEqual([...times].sort().reverse());
    expect(inbox.body.data.threads[0].participant).toBe("Khách mới");
  });

  it("does not show one workspace's messages to another", async () => {
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    conversations = [
      {
        id: "t_1",
        updated_time: "2026-07-28T10:00:00+0000",
        unread_count: 1,
        participants: { data: [{ id: "u_1", name: "Khách A" }] },
        messages: { data: [{ message: "riêng tư" }] },
      },
    ];

    const bobs = await testApp
      .http()
      .get("/api/v1/connections/inbox")
      .set(as(bob, bobWorkspace))
      .expect(200);

    expect(bobs.body.data.threads).toEqual([]);
  });

  it("reports how recent posts have done", async () => {
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    feedPosts = [
      {
        id: "page-777_1",
        created_time: "2026-07-20T00:00:00+0000",
        message: "Bài cũ",
        likes: { summary: { total_count: 1 } },
        comments: { summary: { total_count: 0 } },
      },
      {
        id: "page-777_2",
        created_time: "2026-07-27T00:00:00+0000",
        message: "Bài mới",
        likes: { summary: { total_count: 9 } },
        comments: { summary: { total_count: 2 } },
        shares: { count: 1 },
      },
    ];

    const stats = await testApp
      .http()
      .get("/api/v1/connections/stats")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(stats.body.data.posts).toHaveLength(2);
    // Newest first, so the post someone is likely asking about is at the top.
    expect(stats.body.data.posts[0].message).toBe("Bài mới");
    expect(stats.body.data.posts[0].likes).toBe(9);
    // A post nobody shared has no `shares` at all in the answer; that is a
    // real zero, not an unknown.
    expect(stats.body.data.posts[1].shares).toBe(0);
    expect(stats.body.data.posts[0].account).toBe("Trang");
  });

  it("names a channel whose stats could not be read", async () => {
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    statsStatus = 403;

    const stats = await testApp
      .http()
      .get("/api/v1/connections/stats")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(stats.body.data.posts).toEqual([]);
    expect(stats.body.data.failed[0].account).toBe("Trang");
  });

  it("does not show one workspace's numbers to another", async () => {
    behaviour.identityBody = JSON.stringify({ id: "page-777", name: "Trang" });
    await testApp
      .http()
      .post("/api/v1/connections/facebook/token")
      .set(as(alice, aliceWorkspace))
      .send({
        externalId: "page-777",
        accessToken: "a-real-looking-page-token",
      })
      .expect(201);

    feedPosts = [
      {
        id: "page-777_1",
        created_time: "2026-07-27T00:00:00+0000",
        message: "riêng tư",
        likes: { summary: { total_count: 5 } },
      },
    ];

    const bobs = await testApp
      .http()
      .get("/api/v1/connections/stats")
      .set(as(bob, bobWorkspace))
      .expect(200);

    expect(bobs.body.data.posts).toEqual([]);
  });

  it("says which platforms can actually be connected", async () => {
    // Rather than hiding the unconfigured ones, which reads as "not supported"
    // and never tells the operator they forgot the credentials.
    const catalog = await testApp
      .http()
      .get("/api/v1/connections/catalog")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const facebook = catalog.body.data.find(
      (entry: { id: string }) => entry.id === "facebook",
    );
    const tiktok = catalog.body.data.find(
      (entry: { id: string }) => entry.id === "tiktok",
    );

    expect(facebook.configured).toBe(true);
    expect(tiktok.configured).toBe(false);
  });

  it("refuses a platform this build cannot connect", async () => {
    await testApp
      .http()
      .post("/api/v1/connections/myspace/start")
      .set(as(alice, aliceWorkspace))
      .expect(404);
  });
});
