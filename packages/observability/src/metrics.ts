import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

/**
 * What this process measures.
 *
 * One registry rather than prom-client's global default, so a test can build
 * its own and two suites cannot leave counters on each other. The global
 * registry is a singleton that survives between tests, which makes an assertion
 * about a count depend on what ran before it.
 */
export class Metrics {
  readonly registry: Registry;

  /**
   * HTTP requests, by route template.
   *
   * The template, never the path: `/executions/:id` and not the id itself.
   * A label whose values are unbounded creates one time series per id, and a
   * metrics store falls over quietly under that — the failure is a monitoring
   * system that stops working exactly when something is going wrong.
   */
  readonly httpDuration: Histogram<"method" | "route" | "status">;

  /**
   * Provider calls, by provider and model.
   *
   * Separate from the `ai_usage` table on purpose. That is the accounting
   * record and must be exact; this is for watching, and is allowed to be
   * sampled, reset by a restart, and lost. Trying to serve both from one place
   * would make the ledger depend on a metrics scrape.
   */
  readonly aiCalls: Counter<"provider" | "model" | "outcome">;
  readonly aiDuration: Histogram<"provider" | "model">;

  /**
   * Posts that reached a platform, or did not.
   *
   * The only counter here about something irreversible, which is why the
   * failure label distinguishes a refusal from an outage: one needs somebody
   * to look, the other usually fixes itself.
   */
  readonly publishes: Counter<"connector" | "outcome">;

  constructor(options: { defaultMetrics?: boolean } = {}) {
    this.registry = new Registry();

    // Process memory, event loop lag, GC. Cheap, and the first thing anyone
    // asks for when a service is slow rather than wrong.
    if (options.defaultMetrics !== false) {
      collectDefaultMetrics({ register: this.registry });
    }

    this.httpDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "Thời gian xử lý một request HTTP",
      labelNames: ["method", "route", "status"] as const,
      // Tuned for this service rather than left at the library default. The
      // API answers most reads in single-digit milliseconds, and a chat turn
      // takes seconds — buckets that cover only one of those tell you nothing
      // about the other.
      buckets: [0.005, 0.025, 0.1, 0.5, 1, 2.5, 5, 10, 30],
      registers: [this.registry],
    });

    this.aiCalls = new Counter({
      name: "ai_provider_calls_total",
      help: "Số lời gọi tới AI provider",
      labelNames: ["provider", "model", "outcome"] as const,
      registers: [this.registry],
    });

    this.aiDuration = new Histogram({
      name: "ai_provider_duration_seconds",
      help: "Thời gian một lời gọi AI provider",
      labelNames: ["provider", "model"] as const,
      buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    this.publishes = new Counter({
      name: "social_publishes_total",
      help: "Số bài đã gửi tới nền tảng mạng xã hội",
      labelNames: ["connector", "outcome"] as const,
      registers: [this.registry],
    });
  }

  /** The exposition text a scraper reads. */
  async scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}

/**
 * Reduce a request path to something safe to use as a label.
 *
 * Ids are replaced with `:id` rather than kept. A prefixed ULID is unique per
 * row, so leaving them in would mint a new time series for every execution ever
 * run — which is how a metrics store dies, and it dies silently.
 */
export function routeLabel(path: string): string {
  return (
    path
      // Prefixed ULIDs, e.g. exe_01KYK...
      .replace(/\/[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}/gi, "/:id")
      // Anything else long and idish: bare ULIDs, uuids, numeric ids.
      .replace(/\/[0-9A-HJKMNP-TV-Z]{26}/gi, "/:id")
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "/:id",
      )
      .replace(/\/\d+/g, "/:id") || "/"
  );
}
