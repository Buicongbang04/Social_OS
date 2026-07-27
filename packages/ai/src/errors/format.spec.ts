import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { formatError } from "./format";

describe("formatError", () => {
  it("reads only the message, never the object graph", () => {
    // Why this matters: a live provider call threw something whose shape made
    // `console.error("failed:", error)` die inside util.inspect, taking the
    // real message with it. The fix is not to out-guess inspect but to stop
    // walking the object at all — so a property that explodes when touched
    // must not reach the output.
    const booby = new Error("the real problem");
    Object.defineProperty(booby, "landmine", {
      enumerable: true,
      get() {
        throw new Error("should never be read");
      },
    });

    expect(formatError(booby)).toContain("the real problem");
    expect(formatError(booby)).not.toContain("landmine");
  });

  it("keeps the vendor's own explanation, which is where the fix usually is", () => {
    const error = new APICallError({
      message: "Bad Request",
      url: "https://api.example.com/v1/messages",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: '{"error":"model not found: gpt-nope"}',
    });

    const formatted = formatError(error);

    expect(formatted).toContain("Bad Request");
    expect(formatted).toContain("HTTP 400");
    expect(formatted).toContain("model not found");
  });

  it("follows the cause chain", () => {
    const inner = new Error("connection reset");
    const outer = new Error("planning failed", { cause: inner });

    expect(formatError(outer)).toContain("connection reset");
  });

  it("stops following a cycle rather than recursing forever", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(() => formatError(a)).not.toThrow();
  });

  it("handles a thrown value that is not an Error at all", () => {
    expect(formatError("just a string")).toBe("just a string");
    expect(formatError({ code: 42 })).toContain("42");
    expect(formatError(undefined)).toBeTypeOf("string");
  });

  it("truncates a huge response body instead of flooding the log", () => {
    const error = new APICallError({
      message: "boom",
      url: "https://api.example.com",
      requestBodyValues: {},
      responseBody: "x".repeat(10_000),
    });

    expect(formatError(error).length).toBeLessThan(1_000);
  });
});
