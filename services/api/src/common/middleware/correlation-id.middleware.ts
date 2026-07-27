import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { newId } from "@repo/core";
import { requestContext } from "../context/request-context";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * Assigns every request a correlation id (docs/platform/09_API_GATEWAY.md).
 * An inbound id from an upstream caller is honoured so a trace survives across
 * services; otherwise a fresh `req_...` id is minted. The id is echoed back so
 * a client can quote it in a bug report.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound =
      firstHeaderValue(req.headers[CORRELATION_ID_HEADER]) ??
      firstHeaderValue(req.headers[REQUEST_ID_HEADER]);

    const correlationId = inbound ?? newId("request");

    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    requestContext.run({ correlationId }, () => next());
  }
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  // Reject absurdly long values so a header cannot be used to bloat every log line.
  return value && value.length <= 200 ? value : undefined;
}
