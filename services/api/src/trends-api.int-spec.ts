import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@repo/core";
import { TrendsService } from "./modules/trends/trends.service";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * Trend discovery, over HTTP.
 *
 * Google's feed is public and free, so these call it for real — it is the only
 * way to find out that the feed still has the shape the parser expects, which
 * is the thing most likely to break and the thing no fixture can catch.
 *
 * YouTube is not called: it needs a key, and the tests that matter for it are
 * about what happens when there is none.
 */
process.env.SECRET_KEYS = `test:${randomBytes(32).toString("base64")}`;
process.env.SECRET_PRIMARY_KEY = "test";

const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!hasInfra)("trends API (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let aliceWorkspace: string;

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
    alice = await registerUser(testApp, "alice@trends.test");
    aliceWorkspace = (await createTenant(testApp, alice, "alice")).workspaceId;
  });

  it("reads what Vietnam is searching for", async () => {
    const response = await testApp
      .http()
      .get("/api/v1/trends?limit=5")
      .set(as(alice, aliceWorkspace))
      .expect(200);

    // Asserted on shape, not on content: what the country searches for today
    // is not something a test can know, but that every row carries a term and
    // names its source is.
    expect(response.body.data.length).toBeGreaterThan(0);
    expect(response.body.data.length).toBeLessThanOrEqual(5);
    for (const item of response.body.data) {
      expect(item.source).toBe("google");
      expect(typeof item.title).toBe("string");
      expect(item.title.length).toBeGreaterThan(0);
    }
  });

  it("hands back a Date from the cache, not a string that looks like one", async () => {
    // JSON has no date type, so `at` goes into the cache as a Date and would
    // come out as a string. Over HTTP that is invisible — the response is JSON
    // either way — so this asks the service directly, which is the only place
    // the difference shows. It matters for the next caller that is not a
    // controller: `at.getTime()` on a string throws.
    const trends = testApp.app.get(TrendsService);
    const workspaceId = aliceWorkspace as WorkspaceId;

    const fresh = await trends.read(workspaceId, "google", "VN", 3);
    const cached = await trends.read(workspaceId, "google", "VN", 3);

    const dated = cached.find((item) => item.at !== null);
    expect(fresh.length).toBeGreaterThan(0);
    expect(dated?.at).toBeInstanceOf(Date);
  });

  it("says what is missing when YouTube has no key", async () => {
    // A workspace that has connected nothing and an operator who set nothing
    // should be told which of the two to fix, not handed a 500. 400 rather
    // than the 422 the query schema gives: the request was well formed, the
    // server just has nothing to answer it with.
    delete process.env.YOUTUBE_API_KEY;

    const response = await testApp
      .http()
      .get("/api/v1/trends?source=youtube")
      .set(as(alice, aliceWorkspace))
      .expect(400);

    expect(JSON.stringify(response.body)).toContain("sources/youtube");
  });

  it("refuses a geo that is not a country code", async () => {
    await testApp
      .http()
      .get("/api/v1/trends?geo=Việt Nam")
      .set(as(alice, aliceWorkspace))
      .expect(422);
  });

  it("refuses a source it has never heard of", async () => {
    // Not a 404 on an empty list: asking for TikTok trends and getting nothing
    // back reads as "TikTok is quiet today", which would be a lie.
    await testApp
      .http()
      .get("/api/v1/trends?source=tiktok")
      .set(as(alice, aliceWorkspace))
      .expect(422);
  });

  it("will not fetch more than a screenful", async () => {
    await testApp
      .http()
      .get("/api/v1/trends?limit=500")
      .set(as(alice, aliceWorkspace))
      .expect(422);
  });

  it("needs a signature", async () => {
    await testApp.http().get("/api/v1/trends").expect(401);
  });
});
