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
 * The content studio, over HTTP and against a real model.
 *
 * These call the provider that is configured, so they assert on shape and on
 * the guarantees the code can keep — that a draft comes back, that it is
 * metered, that one workspace cannot spend on another's behalf — and not on
 * what the model wrote. What a 7B model produces varies; whether the round
 * trip works does not.
 */
process.env.SECRET_KEYS = `test:${randomBytes(32).toString("base64")}`;
process.env.SECRET_PRIMARY_KEY = "test";

const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const hasProvider = Boolean(process.env.AI_PROVIDER?.trim());

describe.skipIf(!hasInfra)("content API (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const as = (user: RegisteredUser, workspaceId: string) => ({
    Authorization: `Bearer ${user.accessToken}`,
    "X-Workspace-Id": workspaceId,
  });

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();
    alice = await registerUser(testApp, "alice@content.test");
    bob = await registerUser(testApp, "bob@content.test");
    aliceWorkspace = (await createTenant(testApp, alice, "alice")).workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob")).workspaceId;
  });

  it("refuses a brief that is empty, before spending anything", async () => {
    await testApp
      .http()
      .post("/api/v1/content/write")
      .set(as(alice, aliceWorkspace))
      .send({
        brief: "   ",
        channel: "facebook",
        tone: "than-thien",
        length: "vua",
      })
      .expect(422);
  });

  it("refuses a channel the platform does not write for", async () => {
    // An unknown channel would otherwise reach the model as free text and come
    // back as a post for a platform nobody can publish to.
    await testApp
      .http()
      .post("/api/v1/content/write")
      .set(as(alice, aliceWorkspace))
      .send({
        brief: "b",
        channel: "myspace",
        tone: "than-thien",
        length: "vua",
      })
      .expect(422);
  });

  it("will not let one workspace spend on another's behalf", async () => {
    // These calls cost money. The guard has to hold here as everywhere else.
    await testApp
      .http()
      .post("/api/v1/content/write")
      .set(as(bob, aliceWorkspace))
      .send({
        brief: "b",
        channel: "facebook",
        tone: "than-thien",
        length: "vua",
      })
      .expect(404);
    void bobWorkspace;
  });

  it.skipIf(!hasProvider)(
    "writes a draft and records what it cost",
    async () => {
      const response = await testApp
        .http()
        .post("/api/v1/content/write")
        .set(as(alice, aliceWorkspace))
        .send({
          brief: "Giới thiệu dịch vụ mua hộ hàng Nhật, nhấn vào phí minh bạch",
          channel: "facebook",
          tone: "than-thien",
          length: "ngan",
        })
        .expect(201);

      const draft = response.body.data;
      expect(draft.object.body.trim()).not.toBe("");
      expect(draft.object.title.trim()).not.toBe("");
      expect(Array.isArray(draft.object.hashtags)).toBe(true);
      expect(draft.promptVersion).toBeTruthy();

      // The ledger, not just the response. A studio that spends without
      // leaving a row is one nobody can budget for.
      const spend = await testApp
        .http()
        .get("/api/v1/usage")
        .set(as(alice, aliceWorkspace))
        .expect(200);

      expect(spend.body.data.total.calls).toBeGreaterThan(0);
      expect(
        spend.body.data.byModel.some(
          (row: { model: string }) => row.model === draft.model,
        ),
      ).toBe(true);
    },
    180_000,
  );

  it.skipIf(!hasProvider)(
    "rewrites what it is given and reports what it could not do",
    async () => {
      const response = await testApp
        .http()
        .post("/api/v1/content/rewrite")
        .set(as(alice, aliceWorkspace))
        .send({
          original:
            "Bên em nhận mua hộ hàng Nhật, phí 8% giá trị đơn, giao trong 7 đến 10 ngày.",
          instruction: "Viết ngắn hơn",
        })
        .expect(201);

      expect(response.body.data.object.body.trim()).not.toBe("");
      // `notes` is part of the contract whether or not it has anything in it:
      // a client that has to check for the field's existence will forget.
      expect(Array.isArray(response.body.data.object.notes)).toBe(true);
    },
    180_000,
  );

  it.skipIf(!hasProvider)(
    "suggests SEO over the content it was handed",
    async () => {
      const response = await testApp
        .http()
        .post("/api/v1/content/seo")
        .set(as(alice, aliceWorkspace))
        .send({
          content:
            "Dịch vụ mua hộ hàng Nhật Bản, phí minh bạch, giao 7-10 ngày về Việt Nam.",
        })
        .expect(201);

      const seo = response.body.data.object;
      expect(seo.titles.length).toBeGreaterThan(0);
      expect(seo.metaDescription.trim()).not.toBe("");
      expect(seo.keywords.length).toBeGreaterThan(0);
    },
    180_000,
  );

  it("refuses a URL that is not a web address", async () => {
    await testApp
      .http()
      .post("/api/v1/content/competitor")
      .set(as(alice, aliceWorkspace))
      .send({ url: "đối thủ của tôi" })
      .expect(400);
  });

  it("will not read the local filesystem", async () => {
    // `file:` would make the platform read this machine's disk on request.
    await testApp
      .http()
      .post("/api/v1/content/competitor")
      .set(as(alice, aliceWorkspace))
      .send({ url: "file:///etc/passwd" })
      .expect(400);
  });

  it("refuses an empty URL before spending anything", async () => {
    await testApp
      .http()
      .post("/api/v1/content/competitor")
      .set(as(alice, aliceWorkspace))
      .send({ url: "   " })
      .expect(422);
  });

  it("needs permission to read a competitor in this workspace's name", async () => {
    await testApp
      .http()
      .post("/api/v1/content/competitor")
      .set(as(bob, aliceWorkspace))
      .send({ url: "https://example.com" })
      .expect(404);
  });

  it.skipIf(!hasProvider)(
    "reads a real page and says what it sells",
    async () => {
      // Against the live site and the configured model. Asserted on shape, not
      // on what the model wrote: what a page says today is not something a
      // test can know, but that the round trip works and is metered is.
      const response = await testApp
        .http()
        .post("/api/v1/content/competitor")
        .set(as(alice, aliceWorkspace))
        .send({ url: "https://vnexpress.net/" })
        .expect(201);

      expect(response.body.data.page.title).toBeTruthy();
      expect(Array.isArray(response.body.data.object.topics)).toBe(true);
      expect(response.body.data.costUsd).toBeDefined();
    },
    120_000,
  );
});
