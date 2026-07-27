import { describe, expect, it } from "vitest";
import {
  RUNTIME_ERROR_CLASSES,
  RuntimeError,
  classify,
  isRetryable,
  retryDispositionOf,
  severityOf,
} from "./taxonomy";

describe("runtime error taxonomy", () => {
  it("never retries a failure that retrying cannot fix", () => {
    // Retrying a denied permission or a malformed input burns quota and can
    // never succeed — the doc marks these Retry: No.
    for (const errorClass of [
      "VALIDATION",
      "POLICY",
      "SECURITY",
      "PLUGIN",
    ] as const) {
      expect(retryDispositionOf(errorClass)).toBe("NEVER");
      expect(new RuntimeError(errorClass, "nope").retryable).toBe(false);
    }
  });

  it("always retries transient infrastructure failures", () => {
    for (const errorClass of [
      "WORKER",
      "PROVIDER",
      "NETWORK",
      "RESOURCE",
    ] as const) {
      expect(retryDispositionOf(errorClass)).toBe("ALWAYS");
      expect(new RuntimeError(errorClass, "transient").retryable).toBe(true);
    }
  });

  it("defaults an ambiguous failure to NOT retrying", () => {
    // MAYBE classes cover side-effecting calls; a wrong retry there is how one
    // request becomes three published posts.
    for (const errorClass of ["CONNECTOR", "MCP", "PLANNING"] as const) {
      expect(retryDispositionOf(errorClass)).toBe("MAYBE");
      expect(new RuntimeError(errorClass, "ambiguous").retryable).toBe(false);
    }
  });

  it("lets an ambiguous failure declare itself retryable", () => {
    // e.g. a connector returning 429 is worth retrying; the same connector
    // rejecting a malformed payload is not.
    const rateLimited = new RuntimeError("CONNECTOR", "429 from Facebook", {
      retryable: true,
    });
    expect(rateLimited.retryable).toBe(true);
  });

  it("treats an unclassified throw as INTERNAL and does not retry it", () => {
    // We cannot reason about a failure we did not classify, and guessing risks
    // repeating a side effect.
    expect(classify(new Error("boom"))).toBe("INTERNAL");
    expect(isRetryable(new Error("boom"))).toBe(false);
    expect(isRetryable("a thrown string")).toBe(false);
  });

  it("assigns a severity to every class", () => {
    for (const errorClass of RUNTIME_ERROR_CLASSES) {
      expect(severityOf(errorClass)).toBeTruthy();
    }
    expect(severityOf("RESOURCE")).toBe("CRITICAL");
    expect(severityOf("VALIDATION")).toBe("WARNING");
  });

  it("keeps context and cause for debugging without leaking them to users", () => {
    const cause = new Error("socket hang up");
    const error = new RuntimeError("NETWORK", "Upstream unreachable", {
      cause,
      context: { host: "api.example.com" },
    });

    expect(error.context).toEqual({ host: "api.example.com" });
    expect(error.cause).toBe(cause);
    expect(error).toBeInstanceOf(Error);
  });

  it("freezes context so a handler cannot mutate the record after the fact", () => {
    const error = new RuntimeError("WORKER", "crashed", {
      context: { attempt: 1 },
    });
    expect(Object.isFrozen(error.context)).toBe(true);
  });

  it("has a disposition for every declared class", () => {
    // Guards against adding a class to the union but forgetting the table.
    for (const errorClass of RUNTIME_ERROR_CLASSES) {
      expect(["NEVER", "ALWAYS", "MAYBE"]).toContain(
        retryDispositionOf(errorClass),
      );
    }
  });
});
