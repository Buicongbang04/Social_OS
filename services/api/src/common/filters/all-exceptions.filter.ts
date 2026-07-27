import {
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { isAppError, type ErrorEnvelope, type ErrorDetail } from "@repo/core";
import { createLogger } from "@repo/logger";
import { requestContext } from "../context/request-context";

const logger = createLogger("api");

/**
 * Single place where any thrown value becomes an HTTP response, so every error
 * leaves in the documented envelope (docs/api/02_API_DESIGN_GUIDELINES.md):
 *   { code, message, requestId, timestamp }
 *
 * Unknown errors never leak their message or stack to the client — those go to
 * the log with the correlation id, and the client gets a generic 500.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const correlationId = requestContext.correlationId();
    const timestamp = new Date().toISOString();

    const { status, body } = this.toEnvelope(
      exception,
      correlationId,
      timestamp,
    );

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      logger.error(
        { err: exception, correlationId, status },
        "unhandled error",
      );
    } else {
      logger.warn({ correlationId, status, code: body.code }, body.message);
    }

    response.status(status).json(body);
  }

  private toEnvelope(
    exception: unknown,
    requestId: string,
    timestamp: string,
  ): { status: number; body: ErrorEnvelope } {
    // Our own typed domain errors already carry a code and an HTTP status.
    if (isAppError(exception)) {
      return {
        status: exception.httpStatus,
        body: {
          code: exception.code,
          message: exception.message,
          requestId,
          timestamp,
          ...(exception.details ? { details: exception.details } : {}),
        },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: {
          code: "VALIDATION_FAILED",
          message: "Request payload is invalid.",
          requestId,
          timestamp,
          details: toErrorDetails(exception),
        },
      };
    }

    if (exception instanceof HttpException) {
      return {
        status: exception.getStatus(),
        body: {
          code: httpExceptionCode(exception),
          message: httpExceptionMessage(exception),
          requestId,
          timestamp,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId,
        timestamp,
      },
    };
  }
}

function toErrorDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/** Derive a stable SCREAMING_SNAKE code from Nest's built-in exceptions. */
function httpExceptionCode(exception: HttpException): string {
  const response = exception.getResponse();

  if (typeof response === "object" && response !== null && "code" in response) {
    const code = (response as { code: unknown }).code;
    if (typeof code === "string") return code;
  }

  return STATUS_CODES[exception.getStatus()] ?? "HTTP_ERROR";
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();

  if (typeof response === "string") return response;

  if (
    typeof response === "object" &&
    response !== null &&
    "message" in response
  ) {
    const message = (response as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join("; ");
  }

  return exception.message;
}

const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "UNPROCESSABLE_ENTITY",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMIT_EXCEEDED",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "INTERNAL_ERROR",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};
