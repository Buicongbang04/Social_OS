import {
  Controller,
  Get,
  Header,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Metrics } from "@repo/observability";
import { secretsMatch } from "@repo/secrets";
import { Public } from "../../common/decorators/public.decorator";
import { raw } from "../../common/interceptors/response-envelope.interceptor";

/**
 * The scrape endpoint.
 *
 * `@Public` because a Prometheus scraper has no user session — and guarded by a
 * shared token instead, which is what a scraper can carry. Without
 * `METRICS_TOKEN` configured the route answers 404 rather than serving: an
 * installation that has not thought about this should not be publishing its
 * error rates and spend to whoever asks.
 *
 * 404 rather than 401 when unconfigured, so a scan cannot tell a disabled
 * endpoint from one whose token it has not guessed yet.
 */
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: Metrics) {}

  @Public()
  @Get()
  @Header("cache-control", "no-store")
  // The exposition format, not JSON. Prometheus parses text/plain line by line
  // and rejects anything else outright.
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  async scrape(@Headers("authorization") authorization?: string) {
    const expected = process.env.METRICS_TOKEN?.trim();
    if (!expected) throw new NotFoundException();

    const offered = authorization?.replace(/^Bearer\s+/i, "") ?? "";
    // Constant time: this token is submitted by whoever calls the endpoint,
    // which is to say by anyone, and a plain comparison leaks how much of it
    // was right.
    if (!secretsMatch(offered, expected)) throw new UnauthorizedException();

    // `raw` so the response envelope leaves it alone. Wrapped in {"data": ...}
    // this is a JSON document that happens to contain metrics, and a scraper
    // rejects it — which is exactly what shipped until a test asserted on the
    // shape of the body rather than on a substring inside it.
    return raw(await this.metrics.scrape());
  }
}
