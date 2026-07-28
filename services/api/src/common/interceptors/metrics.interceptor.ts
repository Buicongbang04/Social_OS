import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Metrics, routeLabel } from "@repo/observability";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";

/**
 * How long each request took, by route.
 *
 * The route is the template Nest matched, not the path that arrived — a label
 * whose values are unbounded mints one time series per execution id, and a
 * metrics store fails under that quietly, which is to say exactly when
 * something is going wrong.
 *
 * `/metrics` itself is not measured. A scraper polling every fifteen seconds
 * would otherwise dominate the request histogram and make the numbers about
 * itself.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: Metrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (request.path.endsWith("/metrics")) return next.handle();

    const started = process.hrtime.bigint();
    const record = () => {
      const response = http.getResponse<Response>();
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;

      this.metrics.httpDuration.observe(
        {
          method: request.method,
          route: routeOf(request),
          // A string, because that is what a Prometheus label is. Passing a
          // number works and then reads back as "200" anyway, so being
          // explicit costs nothing and surprises nobody.
          status: String(response.statusCode),
        },
        seconds,
      );
    };

    // Recorded on both paths. Measuring only successes would leave the slowest
    // requests — the ones that timed out or threw — out of the histogram, and
    // the graph would look healthiest when the service is worst.
    return next.handle().pipe(tap({ next: record, error: record }));
  }
}

/**
 * The route template, falling back to a scrubbed path.
 *
 * Express fills `route.path` only once a handler has matched. A 404 never
 * matches one, so those would be unlabelled — and scrubbing the raw path keeps
 * them countable without letting ids in.
 */
function routeOf(request: Request): string {
  const matched = (request.route as { path?: string } | undefined)?.path;
  const base = request.baseUrl ?? "";
  return matched ? routeLabel(`${base}${matched}`) : routeLabel(request.path);
}
