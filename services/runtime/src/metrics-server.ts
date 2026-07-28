import { createServer, type Server } from "node:http";
import type { Metrics } from "@repo/observability";
import { secretsMatch } from "@repo/secrets";

/**
 * A scrape endpoint for the runtime.
 *
 * The runtime has no HTTP server of its own, which meant the process that does
 * the work — planning, calling providers, posting to real audiences — was the
 * one nothing could see. The API was observable and the runtime was not, which
 * is exactly backwards.
 *
 * Deliberately not a framework. One route, no routing table, no middleware
 * chain: anything more would be a second web application to keep alive inside a
 * worker process.
 */
export function startMetricsServer(
  metrics: Metrics,
  options: { port?: number; token?: string } = {},
): Server | null {
  const token = options.token ?? process.env.METRICS_TOKEN?.trim();
  const port =
    options.port ?? (Number(process.env.RUNTIME_METRICS_PORT) || 3101);

  // Off unless a token is configured, same as the API. An installation that
  // has not thought about this should not be publishing how much it spends and
  // how often it fails.
  if (!token) return null;

  const server = createServer((request, response) => {
    if (request.url?.split("?")[0] !== "/metrics") {
      response.writeHead(404).end();
      return;
    }

    const offered =
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    // Constant time: this is submitted by whoever calls the endpoint.
    if (!secretsMatch(offered, token)) {
      response.writeHead(401).end();
      return;
    }

    void metrics
      .scrape()
      .then((body) => {
        response.writeHead(200, {
          "content-type": metrics.contentType,
          "cache-control": "no-store",
        });
        response.end(body);
      })
      .catch(() => {
        // A failed scrape must not take the worker down with it.
        response.writeHead(500).end();
      });
  });

  server.listen(port);
  return server;
}
