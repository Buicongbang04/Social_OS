import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTestApp,
  registerUser,
  type TestApp,
} from "./testing/test-app";

/**
 * The scrape endpoint, over HTTP.
 *
 * What matters here is not that a number is right — a counter's value depends
 * on whatever else the process did. It is that the endpoint is off unless
 * switched on, that it refuses a wrong token, and that ids from a request path
 * never reach a label.
 */
process.env.METRICS_TOKEN = "scrape-token-for-the-test";

const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!hasInfra)("metrics endpoint (integration)", () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();
    process.env.METRICS_TOKEN = "scrape-token-for-the-test";
  });

  it("serves the exposition format to a scraper with the token", async () => {
    const response = await testApp
      .http()
      .get("/metrics")
      .set("Authorization", "Bearer scrape-token-for-the-test")
      .expect(200);

    // The body IS the exposition, not JSON containing it. Asserting a
    // substring passes either way — and the wrapped version shipped, because
    // that is what the first version of this test asserted.
    expect(response.text.startsWith("# HELP")).toBe(true);
    expect(() => JSON.parse(response.text)).toThrow();
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("http_request_duration_seconds");
    expect(response.text).toContain("process_cpu_user_seconds_total");
  });

  it("refuses a wrong token", async () => {
    await testApp
      .http()
      .get("/metrics")
      .set("Authorization", "Bearer wrong-token-entirely-here")
      .expect(401);

    await testApp.http().get("/metrics").expect(401);
  });

  it("is not there at all when no token is configured", async () => {
    // 404 rather than 401, so a scan cannot tell a disabled endpoint from one
    // whose token it has not guessed.
    delete process.env.METRICS_TOKEN;

    await testApp.http().get("/metrics").expect(404);
  });

  it("labels a route by its template, never by the id in the path", async () => {
    // The failure this prevents: one time series per execution ever run. A
    // metrics store dies under that, and it dies quietly.
    // It has to be a request that actually reaches the interceptor. Guards run
    // first, so anything the guard rejects is never measured; and Nest runs no
    // interceptor for a path that matches no route at all, so a plain 404 is
    // not measured either. An authorised request for an execution that does
    // not exist is both matched and allowed through.
    const alice = await registerUser(testApp, "metrics@test.local");
    const workspace = (await createTenant(testApp, alice, "metrics"))
      .workspaceId;

    await testApp
      .http()
      .get("/api/v1/executions/exe_01KYKVMBZZ3R7C0EV6G6X7PSQ2")
      .set("Authorization", `Bearer ${alice.accessToken}`)
      .set("X-Workspace-Id", workspace)
      .expect(404);

    const response = await testApp
      .http()
      .get("/metrics")
      .set("Authorization", "Bearer scrape-token-for-the-test")
      .expect(200);

    expect(response.text).not.toContain("01KYKVMBZZ3R7C0EV6G6X7PSQ2");
    expect(response.text).toContain('route="/api/v1/executions/:id"');
  });

  it("does not measure itself", async () => {
    // A scraper polling every fifteen seconds would otherwise dominate the
    // histogram and make the numbers about itself.
    await testApp
      .http()
      .get("/metrics")
      .set("Authorization", "Bearer scrape-token-for-the-test")
      .expect(200);

    const response = await testApp
      .http()
      .get("/metrics")
      .set("Authorization", "Bearer scrape-token-for-the-test")
      .expect(200);

    expect(response.text).not.toContain('route="/metrics"');
  });
});
