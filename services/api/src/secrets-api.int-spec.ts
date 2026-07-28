import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * The vault, over HTTP.
 *
 * Set before the app boots because the keyring is read from the environment at
 * module construction. Generated here rather than taken from `.env` so the
 * suite proves the vault works on a fresh key, and so CI needs no secret of its
 * own to run it.
 */
process.env.SECRET_KEYS = `test:${randomBytes(32).toString("base64")}`;
process.env.SECRET_PRIMARY_KEY = "test";

const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

const ANTHROPIC_KEY = "sk-ant-api03-khoá-riêng-của-workspace";

describe.skipIf(!hasInfra)("secrets API (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const as = (user: RegisteredUser, workspaceId: string) => ({
    Authorization: `Bearer ${user.accessToken}`,
    "X-Workspace-Id": workspaceId,
  });

  const store = (
    user: RegisteredUser,
    workspaceId: string,
    body: { name: string; value: string; description?: string },
  ) =>
    testApp.http().put("/api/v1/secrets").set(as(user, workspaceId)).send(body);

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();

    alice = await registerUser(testApp, "alice@secrets.test");
    bob = await registerUser(testApp, "bob@secrets.test");

    aliceWorkspace = (await createTenant(testApp, alice, "alice")).workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob")).workspaceId;
  });

  it("stores a credential and never hands it back", async () => {
    // The whole design in one assertion: written in, used from inside, and no
    // route anywhere returns it.
    await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: ANTHROPIC_KEY,
      description: "Khoá của Alice",
    }).expect(200);

    const listed = await testApp
      .http()
      .get("/api/v1/secrets")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(JSON.stringify(listed.body)).not.toContain(ANTHROPIC_KEY);
    expect(listed.body.data[0].hint).toBe("••••••••pace");
    expect(listed.body.data[0].name).toBe("providers/anthropic");
  });

  it("puts the workspace on its own key once one is connected", async () => {
    // Why the vault exists. Before this the workspace spent the operator's
    // credential; after it, its own.
    const before = await testApp
      .http()
      .get("/api/v1/secrets/providers")
      .set(as(alice, aliceWorkspace))
      .expect(200);
    expect(before.body.data).toEqual({ source: "platform", providers: [] });

    await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: ANTHROPIC_KEY,
    }).expect(200);

    const after = await testApp
      .http()
      .get("/api/v1/secrets/providers")
      .set(as(alice, aliceWorkspace))
      .expect(200);
    expect(after.body.data).toEqual({
      source: "workspace",
      providers: ["anthropic"],
    });
  });

  it("does not move another workspace onto that key", async () => {
    await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: ANTHROPIC_KEY,
    }).expect(200);

    // Alice first, deliberately: resolution is cached, and a cache that is not
    // keyed per workspace would hand Bob whatever Alice's request just put in
    // it. Asking Bob on a cold cache would prove nothing.
    await testApp
      .http()
      .get("/api/v1/secrets/providers")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    const bobs = await testApp
      .http()
      .get("/api/v1/secrets/providers")
      .set(as(bob, bobWorkspace))
      .expect(200);

    expect(bobs.body.data).toEqual({ source: "platform", providers: [] });
  });

  it("stops using a credential the moment it is revoked", async () => {
    // The difference between revoking a key and asking politely. A cache that
    // kept serving the deleted key would leave it live until the process
    // restarted, which is not what the button says.
    const stored = await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: ANTHROPIC_KEY,
    }).expect(200);

    await testApp
      .http()
      .get("/api/v1/secrets/providers")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    await testApp
      .http()
      .delete(`/api/v1/secrets/${stored.body.data.id}`)
      .set(as(alice, aliceWorkspace))
      .expect(204);

    const after = await testApp
      .http()
      .get("/api/v1/secrets/providers")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    expect(after.body.data).toEqual({ source: "platform", providers: [] });
  });

  it("rotates without losing the previous value", async () => {
    const first = await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: "sk-ant-cũ-nhưng-chạy-được",
    }).expect(200);
    expect(first.body.data.activeVersion).toBe(1);

    const second = await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: "sk-ant-mới-nhưng-hỏng",
    }).expect(200);
    expect(second.body.data.activeVersion).toBe(2);

    // A bad rotation is a rollback, not an outage.
    const rolled = await testApp
      .http()
      .post(`/api/v1/secrets/${second.body.data.id}/rollback`)
      .set(as(alice, aliceWorkspace))
      .send({ version: 1 })
      .expect(201);

    expect(rolled.body.data.activeVersion).toBe(1);
  });

  it("hides one workspace's credentials from another", async () => {
    const stored = await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: ANTHROPIC_KEY,
    }).expect(200);

    const bobsList = await testApp
      .http()
      .get("/api/v1/secrets")
      .set(as(bob, bobWorkspace))
      .expect(200);
    expect(bobsList.body.data).toEqual([]);

    // Not 403: confirming the id exists is itself a leak.
    await testApp
      .http()
      .delete(`/api/v1/secrets/${stored.body.data.id}`)
      .set(as(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .post(`/api/v1/secrets/${stored.body.data.id}/rollback`)
      .set(as(bob, bobWorkspace))
      .send({ version: 1 })
      .expect(404);
  });

  it("refuses a workspace header that is not the caller's", async () => {
    // Holding a valid token is not authority over an arbitrary workspace id.
    // 404 rather than 403, as everywhere else: 403 would confirm it exists.
    await testApp
      .http()
      .get("/api/v1/secrets")
      .set(as(bob, aliceWorkspace))
      .expect(404);
  });

  it("rejects a name that could pose as something else", async () => {
    await store(alice, aliceWorkspace, {
      name: "../../etc/passwd",
      value: "x",
    }).expect(422);

    await store(alice, aliceWorkspace, {
      name: "providers/anthropic",
      value: "",
    }).expect(422);
  });
});
