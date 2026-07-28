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
  let workspaceId: WorkspaceId;
  let userId: UserId;

  /** What Graph was asked, and how it should answer. */
  const seen: { url?: string; auth?: string | null; body?: URLSearchParams } =
    {};
  let behaviour: { status: number; body: string };

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
    publish = buildSocialPublish({ accounts, secrets, keyring });
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

  it("ignores a connection the platform has revoked", async () => {
    const account = await connect("page-1", "Trang một");
    await accounts.updateStatus(account.id, "REVOKED", userId);

    const failure = (await publish
      .handler(context({}, { "content.generate": { body: "x" } }))
      .catch((error: unknown) => error)) as RuntimeError;

    expect(failure.message).toContain("chưa kết nối");
    expect(seen.url).toBeUndefined();
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
