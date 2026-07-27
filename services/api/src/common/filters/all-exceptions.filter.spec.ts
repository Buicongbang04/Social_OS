import { HttpException, HttpStatus, type ArgumentsHost } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConflictError, NotFoundError, UnauthorizedError } from "@repo/core";
import type { ErrorEnvelope } from "@repo/core";
import { AllExceptionsFilter } from "./all-exceptions.filter";

function captureResponse() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;

  return {
    host,
    result: () => ({
      status: status.mock.calls[0]?.[0] as number,
      body: json.mock.calls[0]?.[0] as ErrorEnvelope,
    }),
  };
}

const filter = new AllExceptionsFilter();

describe("AllExceptionsFilter", () => {
  it("maps a typed domain error to its status and code", () => {
    const { host, result } = captureResponse();
    filter.catch(new ConflictError("Slug taken", "SLUG_TAKEN"), host);

    const { status, body } = result();
    expect(status).toBe(409);
    expect(body.code).toBe("SLUG_TAKEN");
    expect(body.message).toBe("Slug taken");
  });

  it("always emits the documented envelope shape", () => {
    const { host, result } = captureResponse();
    filter.catch(new NotFoundError(), host);

    const { body } = result();
    expect(Object.keys(body).sort()).toEqual([
      "code",
      "message",
      "requestId",
      "timestamp",
    ]);
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it("turns a ZodError into 422 with per-field details", () => {
    const schema = z.object({ email: z.string().email(), age: z.number() });
    const parsed = schema.safeParse({ email: "nope", age: "x" });
    expect(parsed.success).toBe(false);

    const { host, result } = captureResponse();
    filter.catch(
      parsed.success ? new Error("unreachable") : parsed.error,
      host,
    );

    const { status, body } = result();
    expect(status).toBe(422);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.details?.map((d) => d.field).sort()).toEqual(["age", "email"]);
  });

  it("never leaks an unknown error's message or stack to the client", () => {
    const { host, result } = captureResponse();
    filter.catch(
      new Error("connection string postgres://user:hunter2@db/prod"),
      host,
    );

    const { status, body } = result();
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("An unexpected error occurred.");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("maps Nest's built-in exceptions to a stable code", () => {
    const { host, result } = captureResponse();
    filter.catch(new HttpException("Nope", HttpStatus.FORBIDDEN), host);

    const { status, body } = result();
    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("preserves the specific auth failure code", () => {
    const { host, result } = captureResponse();
    filter.catch(
      new UnauthorizedError("Session has been revoked.", "SESSION_REVOKED"),
      host,
    );

    const { status, body } = result();
    expect(status).toBe(401);
    expect(body.code).toBe("SESSION_REVOKED");
  });
});
