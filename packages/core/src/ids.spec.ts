import { describe, expect, it } from "vitest";
import { assertId, ID_PREFIXES, isId, newId, parseId } from "./ids";

describe("ids", () => {
  it("newId produces a prefixed ULID", () => {
    const id = newId("workspace");
    expect(id).toMatch(/^wsp_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("newId is unique across calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId("user")));
    expect(ids.size).toBe(500);
  });

  it("parseId round-trips a generated id", () => {
    const id = newId("organization");
    const parsed = parseId(id);
    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe(ID_PREFIXES.organization);
    expect(`${parsed?.prefix}_${parsed?.value}`).toBe(id);
  });

  it("parseId rejects malformed input", () => {
    expect(parseId("")).toBeNull();
    expect(parseId("nosep")).toBeNull();
    expect(parseId("_01HX8ZQ7P9K2M4N6R8T0V2W4Y6")).toBeNull();
    expect(parseId("xyz_01HX8ZQ7P9K2M4N6R8T0V2W4Y6")).toBeNull();
    expect(parseId("usr_not-a-ulid")).toBeNull();
    // ULID excludes I, L, O and U to avoid transcription errors.
    expect(parseId("usr_01HX8ZQ7P9K2M4N6R8T0V2W4YI")).toBeNull();
  });

  it("isId distinguishes entity types", () => {
    const workspaceId = newId("workspace");
    expect(isId("workspace", workspaceId)).toBe(true);
    expect(isId("user", workspaceId)).toBe(false);
  });

  it("assertId throws when the prefix belongs to another entity", () => {
    const workspaceId = newId("workspace");
    expect(() => assertId("workspace", workspaceId)).not.toThrow();
    expect(() => assertId("user", workspaceId)).toThrow(/Invalid user id/);
  });
});
