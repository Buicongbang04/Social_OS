import { describe, expect, it } from "vitest";
import { isDefined, isNil, isNonEmptyString } from "./guards";

describe("guards", () => {
  it("isNil detects null/undefined only", () => {
    expect(isNil(null)).toBe(true);
    expect(isNil(undefined)).toBe(true);
    expect(isNil(0)).toBe(false);
    expect(isNil("")).toBe(false);
  });

  it("isDefined is the inverse of isNil", () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined(undefined)).toBe(false);
  });

  it("isNonEmptyString rejects blank/whitespace-only strings", () => {
    expect(isNonEmptyString("hello")).toBe(true);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString(123)).toBe(false);
  });
});
