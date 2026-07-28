import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  newId,
  type ExecutionId,
  type TaskId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import {
  DrizzleSecretRepository,
  DrizzleSocialAccountRepository,
  closeDbClient,
  createDbClient,
  schemaTables,
  truncateTenantData,
  type DatabaseClient,
} from "@repo/database";
import { Keyring } from "@repo/secrets";
import { RuntimeError, type CapabilityContext } from "@repo/runtime";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildSocialPublish } from "./capabilities/social";

const DATABASE_URL = process.env.DATABASE_URL;

/**
 * Publishing, against real Postgres and a real HTTP server standing in for
 * Graph.
 *
 * This is the one capability whose mistakes cannot be undone by running it
 * again, so the assertions lean towards what must NOT happen: no post when the
 * target is ambiguous, no post when the credential is gone, and nothing
 * reported as published that the platform did not confirm.
 */
describe.skipIf(!DATABASE_URL)("social.publish (integration)", () => {
  let db: DatabaseClient;
  let graph: Server;
  let keyring: Keyring;
  let accounts: DrizzleSocialAccountRepository;
  let secrets: DrizzleSecretRepository;
  let publish: ReturnType<typeof buildSocialPublish>;
  let unattendedPublish: ReturnType<typeof buildSocialPublish>;
  let workspaceId: WorkspaceId;
  let userId: UserId;

  /** What Graph was asked, and how it should answer. */
  const seen: { url?: string; auth?: string | null; body?: URLSearchParams } =
    {};
  let behaviour: { status: number; body: string };
  /** What the fake Page already has on it, for the duplicate check to find. */
  let existingPosts: { id: string; message: string; created_time: string }[];
  let feedReads: number;

  const context = (
    inputs: Record<string, unknown> = {},
    previous: Record<string, Record<string, unknown>> = {},
  ): CapabilityContext =>
    ({
      inputs,
      previous,
      attempt: 0,
      workspaceId,
      executionId: newId("execution") as ExecutionId,
      taskId: newId("task") as TaskId,
      ownerId: userId,
      trigger: "MANUAL",
      correlationId: "req_test",
    }) as CapabilityContext;

  /** Connect a page, tokens and all, the way the API would. */
  const connect = async (externalId: string, displayName: string) => {
    const secretName = `connections/facebook/${externalId}`;
    const sealed = keyring.seal(
      JSON.stringify({ accessToken: `tok-${externalId}`, refreshToken: null }),
    );

    await secrets.put(
      {
        workspaceId,
        scope: "WORKSPACE",
        name: secretName,
        value: "",
        ...sealed,
        hint: "••••••••test",
      },
      userId,
    );

    return accounts.connect(
      {
        workspaceId,
        connectorId: "facebook",
        externalId,
        displayName,
        scopes: [],
        secretName,
      },
      userId,
    );
  };

  beforeAll(async () => {
    graph = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        // A feed read is the duplicate check, not a publish. Answered
        // separately so a test can say "this post is already there" without
        // changing how the publish itself behaves.
        if (request.method === "GET" && request.url?.includes("/feed?")) {
          feedReads += 1;
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: existingPosts }));
          return;
        }

        seen.url = request.url;
        seen.auth = request.headers.authorization ?? null;
        seen.body = new URLSearchParams(Buffer.concat(chunks).toString());
        response.writeHead(behaviour.status, {
          "content-type": "application/json",
        });
        response.end(behaviour.body);
      });
    });

    await new Promise<void>((resolve) => graph.listen(0, resolve));
    process.env.FACEBOOK_GRAPH_URL = `http://127.0.0.1:${
      (graph.address() as AddressInfo).port
    }/v21.0`;

    const key = randomBytes(32).toString("base64");
    keyring = new Keyring("test", [
      { id: "test", key: Buffer.from(key, "base64") },
    ]);

    db = createDbClient(DATABASE_URL!, { maxConnections: 3 });
    accounts = new DrizzleSocialAccountRepository(db);
    secrets = new DrizzleSecretRepository(db);
    publish = buildSocialPublish({
      accounts,
      secrets,
      keyring,
      allowUnattended: false,
    });
    unattendedPublish = buildSocialPublish({
      accounts,
      secrets,
      keyring,
      allowUnattended: true,
    });
  });

  afterAll(async () => {
    if (graph)
      await new Promise<void>((resolve) => graph.close(() => resolve()));
    if (db) await closeDbClient(db);
  });

  beforeEach(async () => {
    await truncateTenantData(db);
    delete seen.url;
    delete seen.body;
    behaviour = { status: 200, body: JSON.stringify({ id: "page-1_777" }) };
    existingPosts = [];
    feedReads = 0;

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");

    await db
      .insert(schemaTables.users)
      .values({ id: userId, email: "pub@test.local", status: "ACTIVE" });
    await db.insert(schemaTables.organizations).values({
      id: organizationId,
      name: "Test Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(schemaTables.workspaces).values({
      id: workspaceId,
      organizationId,
      name: "A",
      slug: `a-${workspaceId.slice(-8).toLowerCase()}`,
    });
  });

  it("posts the generated content to the only connected page", async () => {
    await connect("page-1", "Tiximax Chính Thức");

    const result = await publish.handler(
      context(
        {},
        { "content.generate": { title: "Tiêu đề", body: "Nội dung." } },
      ),
    );

    expect(seen.url).toBe("/v21.0/page-1/feed");
    expect(seen.auth).toBe("Bearer tok-page-1");
    expect(seen.body?.get("message")).toBe("Tiêu đề\n\nNội dung.");
    expect(result.published).toBe(true);
    expect((result.posts as { postId: string }[])[0]?.postId).toBe(
      "page-1_777",
    );
  });

  it("refuses to choose when several pages are connected", async () => {
    // "Post it" is a sentence missing its object. Picking one would be the
    // platform choosing somebody's audience for them, and there is no undo.
    await connect("page-1", "Trang một");
    await connect("page-2", "Trang hai");

    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(failure.message).toContain("Trang một");
    expect(failure.message).toContain("Trang hai");
    // Nothing went out.
    expect(seen.url).toBeUndefined();
  });

  it("posts to the page the plan named, out of several", async () => {
    await connect("page-1", "Trang một");
    await connect("page-2", "Trang hai");

    await publish.handler(
      context({ page: "Trang hai" }, { "content.generate": { body: "x" } }),
    );

    expect(seen.url).toBe("/v21.0/page-2/feed");
  });

  it("takes the page id as readily as the name", async () => {
    await connect("page-1", "Trang một");
    await connect("page-2", "Trang hai");

    await publish.handler(
      context({ accounts: ["page-2"] }, { "content.generate": { body: "x" } }),
    );

    expect(seen.url).toBe("/v21.0/page-2/feed");
  });

  it("stops rather than substituting when the named page is not connected", async () => {
    // A plan naming a page this workspace does not have is a plan built on a
    // wrong assumption. Posting somewhere else is not a recovery from that.
    await connect("page-1", "Trang một");

    const failure = (await publish
      .handler(
        context(
          { page: "Trang không tồn tại" },
          { "content.generate": { body: "x" } },
        ),
      )
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(seen.url).toBeUndefined();
  });

  it("says so plainly when nothing is connected", async () => {
    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("chưa kết nối");
  });

  it("will not publish for a workspace that is not the caller's", async () => {
    // The account belongs to another workspace, so from here it does not exist.
    const otherWorkspace = newId("workspace");
    await connect("page-1", "Trang một");

    const failure = (await publish
      .handler({ ...context(), workspaceId: otherWorkspace })
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(seen.url).toBeUndefined();
  });

  it("stops when the credential has been taken away", async () => {
    // Disconnecting removes the secret. A token cached anywhere would keep
    // working, which is the difference between revoking access and asking
    // politely.
    const account = await connect("page-1", "Trang một");
    const secret = await secrets.findByName(
      workspaceId,
      "WORKSPACE",
      account.secretName,
    );
    await secrets.remove(workspaceId, secret!.id, userId);

    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(failure.retryable).toBe(false);
    expect(seen.url).toBeUndefined();
  });

  it("stops mid-campaign when the credential is taken away between posts", async () => {
    // The claim being protected: the token is read at publish time, not held.
    // Removing the credential after a successful post has to stop the next one,
    // or "disconnect" only means "disconnect from now until something
    // restarts".
    const account = await connect("page-1", "Trang một");
    await publish.handler(context({}, { "content.generate": { body: "x" } }));
    expect(seen.url).toBe("/v21.0/page-1/feed");

    const secret = await secrets.findByName(
      workspaceId,
      "WORKSPACE",
      account.secretName,
    );
    await secrets.remove(workspaceId, secret!.id, userId);
    delete seen.url;

    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "y" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(seen.url).toBeUndefined();
  });

  it("will not publish on a scheduled run", async () => {
    // What actually happened here: live publishing was switched on, and a
    // scheduled Goal put marketing copy on a real Page minutes later with
    // nobody watching.
    //
    // The first version of this guard read `ownerId === null` and never fired,
    // because a scheduled Execution inherits the Goal's owner. The test passed
    // anyway — it built the context by hand with ownerId null, so it proved
    // the assumption rather than the system. `trigger` is a real field the
    // scheduler sets, and `verify:stack` publishing from a cron run is what
    // exposed the difference.
    await connect("page-1", "Trang một");

    const failure = (await publish
      .handler({
        ...context({}, { "content.generate": { body: "x" } }),
        trigger: "SCHEDULE",
      })
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(failure.retryable).toBe(false);
    expect(seen.url).toBeUndefined();
  });

  it("still publishes when a person ran it, schedule or not", async () => {
    // A Goal with a schedule can also be run by hand, and that run has a
    // person behind it. Refusing it would make scheduled Goals unusable even
    // when somebody is sitting there watching.
    await connect("page-1", "Trang một");

    await publish.handler({
      ...context({}, { "content.generate": { body: "x" } }),
      trigger: "MANUAL",
      ownerId: null,
    });

    expect(seen.url).toBe("/v21.0/page-1/feed");
  });

  it("does publish on a schedule once the operator has said so", async () => {
    // The escape hatch has to exist — posting on a schedule is the point of a
    // marketing platform — but it is a decision someone makes on purpose.
    await connect("page-1", "Trang một");

    await unattendedPublish.handler({
      ...context({}, { "content.generate": { body: "x" } }),
      trigger: "SCHEDULE",
    });

    expect(seen.url).toBe("/v21.0/page-1/feed");
  });

  it("ignores a connection the platform has revoked", async () => {
    const account = await connect("page-1", "Trang một");
    await accounts.updateStatus(account.id, "REVOKED", userId);

    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure.message).toContain("chưa kết nối");
    expect(seen.url).toBeUndefined();
  });

  it("marks the connection expired when the platform rejects the token", async () => {
    // Otherwise the connection sits at ACTIVE while every publish fails, and
    // the only way to find out is to read a task's error text.
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 400,
      body: JSON.stringify({
        error: { code: 190, error_subcode: 463, message: "expired" },
      }),
    };

    await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch(() => undefined);

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "EXPIRED",
    );
  });

  it("marks it revoked when the permission was taken away", async () => {
    // A different remedy: reconnecting fails again until the person restores
    // the permission on Facebook itself.
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 400,
      body: JSON.stringify({
        error: { code: 190, error_subcode: 458, message: "app removed" },
      }),
    };

    await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch(() => undefined);

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "REVOKED",
    );
  });

  it("leaves the connection alone when the post itself was wrong", async () => {
    // Disconnecting a working Page over one malformed post would be a far
    // worse failure than the one being reported.
    const account = await connect("page-1", "Trang một");
    behaviour = {
      status: 400,
      body: JSON.stringify({ error: { code: 100, message: "bad param" } }),
    };

    await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch(() => undefined);

    expect((await accounts.find(workspaceId, account.id))?.status).toBe(
      "ACTIVE",
    );
  });

  it("does not post twice when a retry follows a dropped connection", async () => {
    // The hazard this exists for: Facebook accepted the post, the answer was
    // lost, the engine retried. Posting again puts one message on somebody's
    // audience twice, and there is no undo.
    await connect("page-1", "Trang một");
    existingPosts = [
      {
        id: "page-1_555",
        message: "x",
        created_time: new Date().toISOString(),
      },
    ];

    const result = await publish.handler({
      ...context({}, { "content.generate": { body: "x" } }),
      attempt: 1,
    });

    const posts = result.posts as { postId: string; alreadyPosted: boolean }[];
    expect(posts[0]?.postId).toBe("page-1_555");
    expect(posts[0]?.alreadyPosted).toBe(true);
    // Nothing was published: the only call was the feed read.
    expect(seen.url).toBeUndefined();
  });

  it("does publish on a retry when the earlier attempt never landed", async () => {
    await connect("page-1", "Trang một");
    existingPosts = [];

    const result = await publish.handler({
      ...context({}, { "content.generate": { body: "x" } }),
      attempt: 2,
    });

    expect(seen.url).toBe("/v21.0/page-1/feed");
    expect(
      (result.posts as { alreadyPosted: boolean }[])[0]?.alreadyPosted,
    ).toBe(false);
  });

  it("does not confuse an older identical post for this one", async () => {
    // A campaign that runs the same sentence next month is not a duplicate of
    // this attempt, and suppressing it would silently drop a real post.
    await connect("page-1", "Trang một");
    existingPosts = [
      {
        id: "page-1_old",
        message: "x",
        created_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ];

    await publish.handler({
      ...context({}, { "content.generate": { body: "x" } }),
      attempt: 1,
    });

    expect(seen.url).toBe("/v21.0/page-1/feed");
  });

  it("does not treat a merely similar post as the same one", async () => {
    // Two posts that differ at all are two posts. Matching loosely would
    // silently drop a real one — the failure nobody notices, because the
    // symptom is a post that simply is not there.
    await connect("page-1", "Trang một");
    existingPosts = [
      {
        id: "page-1_similar",
        message: "Bài hôm qua về cùng chủ đề",
        created_time: new Date().toISOString(),
      },
    ];

    await publish.handler({
      ...context({}, { "content.generate": { body: "Bài hôm nay" } }),
      attempt: 1,
    });

    expect(seen.url).toBe("/v21.0/page-1/feed");
    expect(seen.body?.get("message")).toBe("Bài hôm nay");
  });

  it("does not read the feed on the first attempt", async () => {
    // There is by definition nothing to find, and a read before every post
    // would spend a round trip to learn nothing.
    await connect("page-1", "Trang một");

    await publish.handler(context({}, { "content.generate": { body: "x" } }));

    expect(feedReads).toBe(0);
  });

  it("does not report a post the platform never confirmed", async () => {
    // A 200 with no id leaves nothing that can be edited, deleted or linked to.
    await connect("page-1", "Trang một");
    behaviour = { status: 200, body: JSON.stringify({ ok: true }) };

    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
  });

  it("refuses an empty post before it reaches the platform", async () => {
    await connect("page-1", "Trang một");

    const failure = (await publish
      .handler(context({}, { "content.generate": {} }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure).toBeInstanceOf(RuntimeError);
    expect(seen.url).toBeUndefined();
  });

  it("publishes what was written, not a paraphrase of it", async () => {
    // The plan's own `message` wins when there is one, but with nothing said
    // the upstream body goes out verbatim — asking a model to copy a long body
    // into a JSON field gets a paraphrase, and the thing published would not be
    // the thing that was reviewed.
    await connect("page-1", "Trang một");
    const body = "Dòng một.\nDòng hai với ký tự đặc biệt: — “trích dẫn”.";

    await publish.handler(context({}, { "content.generate": { body } }));

    expect(seen.body?.get("message")).toBe(body);
  });
});
