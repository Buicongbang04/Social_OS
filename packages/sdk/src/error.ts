import type { ApiErrorBody } from "./types";

/**
 * A non-2xx response, carrying the API's own error envelope.
 *
 * The envelope is preserved rather than flattened to a string because the two
 * things a UI needs are in it: `details` drives per-field messages on a form,
 * and `requestId` is what makes a user's report traceable in the server logs.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: readonly { field: string; message: string }[];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
    this.details = body.details ?? [];
  }

  /** The session is gone or was never established. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Signed in, but not allowed — distinct from 404, which hides existence. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isValidation(): boolean {
    return this.status === 422 || this.code === "VALIDATION_FAILED";
  }

  /** Field name → first message, for rendering next to an input. */
  fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const detail of this.details) {
      map[detail.field] ??= detail.message;
    }
    return map;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
