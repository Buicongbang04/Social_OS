import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UnprocessableError,
  ValidationError,
  isAppError,
} from "./errors";

describe("errors", () => {
  it("maps each error class to its documented HTTP status", () => {
    expect(new ValidationError("bad").httpStatus).toBe(400);
    expect(new UnauthorizedError().httpStatus).toBe(401);
    expect(new ForbiddenError().httpStatus).toBe(403);
    expect(new NotFoundError().httpStatus).toBe(404);
    expect(new ConflictError("dup").httpStatus).toBe(409);
    expect(new UnprocessableError("nope").httpStatus).toBe(422);
    expect(new RateLimitError().httpStatus).toBe(429);
  });

  it("exposes a stable SCREAMING_SNAKE code", () => {
    expect(new ValidationError("bad").code).toBe("VALIDATION_FAILED");
    expect(new RateLimitError().code).toBe("RATE_LIMIT_EXCEEDED");
    expect(new ConflictError("stale", "VERSION_CONFLICT").code).toBe(
      "VERSION_CONFLICT",
    );
  });

  it("carries field-level details for 422 responses", () => {
    const error = new UnprocessableError(
      "Invalid payload",
      "UNPROCESSABLE_ENTITY",
      [{ field: "slug", message: "already taken" }],
    );
    expect(error.details).toEqual([
      { field: "slug", message: "already taken" },
    ]);
  });

  it("isAppError narrows only our own errors", () => {
    expect(isAppError(new NotFoundError())).toBe(true);
    expect(isAppError(new Error("generic"))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it("keeps the subclass name for logging", () => {
    expect(new NotFoundError().name).toBe("NotFoundError");
  });
});
