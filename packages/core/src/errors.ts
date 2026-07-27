/**
 * Typed application errors. Each carries a stable SCREAMING_SNAKE `code`
 * that goes into the API error envelope (docs/api/02_API_DESIGN_GUIDELINES.md)
 * and an HTTP status hint so the transport layer needs no error mapping table.
 *
 * Messages here are user-facing — never embed stack traces, SQL or secrets
 * (docs/kernel/14_ERROR_HANDLING.md).
 */
export type ErrorDetail = {
  field: string;
  message: string;
};

export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 — malformed request the client can fix. */
export class ValidationError extends AppError {
  readonly code = "VALIDATION_FAILED";
  readonly httpStatus = 400;
}

/** 401 — missing, expired or tampered credentials. */
export class UnauthorizedError extends AppError {
  readonly code: string;
  readonly httpStatus = 401;

  constructor(message = "Authentication required.", code = "UNAUTHORIZED") {
    super(message);
    this.code = code;
  }
}

/** 403 — authenticated, but the permission check denied the action. */
export class ForbiddenError extends AppError {
  readonly code: string;
  readonly httpStatus = 403;

  constructor(
    message = "You do not have permission to perform this action.",
    code = "FORBIDDEN",
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * 404 — also returned for resources in another tenant, so existence of
 * another workspace's data is never leaked.
 */
export class NotFoundError extends AppError {
  readonly code: string;
  readonly httpStatus = 404;

  constructor(message = "Resource not found.", code = "NOT_FOUND") {
    super(message);
    this.code = code;
  }
}

/** 409 — state conflict: duplicate slug, stale `version`, illegal transition. */
export class ConflictError extends AppError {
  readonly code: string;
  readonly httpStatus = 409;

  constructor(message: string, code = "CONFLICT") {
    super(message);
    this.code = code;
  }
}

/** 422 — syntactically valid but semantically rejected. */
export class UnprocessableError extends AppError {
  readonly code: string;
  readonly httpStatus = 422;

  constructor(
    message: string,
    code = "UNPROCESSABLE_ENTITY",
    details?: ErrorDetail[],
  ) {
    super(message, details);
    this.code = code;
  }
}

/** 429 — rate limit exceeded (docs/platform/09_API_GATEWAY.md). */
export class RateLimitError extends AppError {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly httpStatus = 429;

  constructor(message = "Too many requests. Please retry later.") {
    super(message);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
