import { describe, expect, it } from "vitest";
import { Metrics, routeLabel } from "./metrics";

describe("routeLabel", () => {
  it("replaces the ids that would mint a series each", () => {
    // A prefixed ULID is unique per row. Left in a label it creates one time
    // series per execution ever run, which is how a metrics store dies — and
    // it dies quietly, exactly when something is going wrong.
    expect(
      routeLabel("/api/v1/executions/exe_01KYKVMBZZ3R7C0EV6G6X7PSQ2"),
    ).toBe("/api/v1/executions/:id");
    expect(
      routeLabel("/api/v1/executions/exe_01KYKVMBZZ3R7C0EV6G6X7PSQ2/tasks"),
    ).toBe("/api/v1/executions/:id/tasks");
  });

  it("replaces uuids and numeric ids too", () => {
    expect(routeLabel("/things/6f1e2a3b-4c5d-6e7f-8a9b-0c1d2e3f4a5b")).toBe(
      "/things/:id",
    );
    expect(routeLabel("/things/12345")).toBe("/things/:id");
  });

  it("leaves an ordinary path alone", () => {
    // Over-eager matching would collapse distinct routes into one line and
    // hide which of them is slow.
    expect(routeLabel("/api/v1/connections/inbox")).toBe(
      "/api/v1/connections/inbox",
    );
    expect(routeLabel("/api/v1/secrets/providers")).toBe(
      "/api/v1/secrets/providers",
    );
  });
});

describe("Metrics", () => {
  it("exposes what it was told, in the format a scraper reads", async () => {
    const metrics = new Metrics({ defaultMetrics: false });
    metrics.httpDuration.observe(
      { method: "GET", route: "/api/v1/usage", status: "200" },
      0.03,
    );
    metrics.publishes.inc({ connector: "facebook", outcome: "ok" });

    const text = await metrics.scrape();

    expect(text).toContain("http_request_duration_seconds_bucket");
    expect(text).toContain('route="/api/v1/usage"');
    expect(text).toContain(
      'social_publishes_total{connector="facebook",outcome="ok"} 1',
    );
    expect(metrics.contentType).toContain("text/plain");
  });

  it("keeps its own registry, not the library's global one", async () => {
    // prom-client's default registry is a singleton that outlives a test. Two
    // suites sharing it makes any assertion about a count depend on what ran
    // before.
    const first = new Metrics({ defaultMetrics: false });
    const second = new Metrics({ defaultMetrics: false });

    first.publishes.inc({ connector: "facebook", outcome: "ok" });

    expect(await second.scrape()).not.toContain("social_publishes_total{");
  });

  it("has buckets covering both a fast read and a slow chat turn", async () => {
    // The library default tops out well below a chat turn, so every one of
    // them would land in +Inf and the histogram would say nothing about them.
    const metrics = new Metrics({ defaultMetrics: false });
    metrics.httpDuration.observe(
      { method: "POST", route: "/api/v1/chat", status: "200" },
      8,
    );

    const text = await metrics.scrape();
    const line = text
      .split("\n")
      .find((l) => l.includes('le="10"') && l.includes("/api/v1/chat"));

    expect(line?.trim().endsWith(" 1")).toBe(true);
  });
});
