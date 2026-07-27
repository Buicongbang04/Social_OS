import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import type { SuccessEnvelope } from "@repo/core";

/** Opt out for responses that must not be wrapped (health checks, redirects). */
export const RAW_RESPONSE = Symbol("RAW_RESPONSE");

export type RawResponse<T> = { [RAW_RESPONSE]: true; body: T };

export function raw<T>(body: T): RawResponse<T> {
  return { [RAW_RESPONSE]: true, body };
}

/**
 * Wraps every handler return value into the documented success envelope
 * `{ data, meta, links }` (docs/api/03_REST_API.md), so controllers return
 * plain domain objects and never assemble envelopes by hand.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        // 204 and friends.
        if (value === undefined || value === null) return value;

        if (isRawResponse(value)) return value.body;

        // Already an envelope (e.g. a paginated result built by the service).
        if (isEnvelope(value)) return value;

        return { data: value } satisfies SuccessEnvelope<unknown>;
      }),
    );
  }
}

function isRawResponse(value: unknown): value is RawResponse<unknown> {
  return typeof value === "object" && value !== null && RAW_RESPONSE in value;
}

function isEnvelope(value: unknown): value is SuccessEnvelope<unknown> {
  return typeof value === "object" && value !== null && "data" in value;
}
