import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PERMISSION_SCOPES,
  assertKnownPermissions,
  isKnownPermission,
  scopeOf,
} from "./catalog";

describe("permission catalog", () => {
  it("every key parses into a valid scope.resource.action triple", () => {
    for (const permission of PERMISSIONS) {
      const [scope, resource, action] = permission.key.split(".");
      expect(PERMISSION_SCOPES).toContain(scope);
      expect(PERMISSION_RESOURCES).toContain(resource);
      expect(PERMISSION_ACTIONS).toContain(action);
      // The denormalized columns must agree with the key itself.
      expect(permission.scope).toBe(scope);
      expect(permission.resource).toBe(resource);
      expect(permission.action).toBe(action);
    }
  });

  it("contains no duplicate keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the permission strings quoted verbatim in the docs", () => {
    // docs/platform/08_PERMISSION_MODEL.md
    for (const key of [
      "workspace.workflow.read",
      "workspace.workflow.execute",
      "workspace.agent.create",
      "workspace.agent.update",
      "workspace.secret.read",
      "organization.user.invite",
      "platform.billing.manage",
    ]) {
      expect(isKnownPermission(key)).toBe(true);
    }
  });

  it("rejects permissions outside the catalog", () => {
    expect(isKnownPermission("workspace.workflow.teleport")).toBe(false);
    expect(isKnownPermission("")).toBe(false);
    expect(() =>
      assertKnownPermissions(["workspace.workflow.read", "bogus.thing.do"]),
    ).toThrow(/Unknown permission\(s\): bogus.thing.do/);
    expect(() =>
      assertKnownPermissions(["workspace.workflow.read"]),
    ).not.toThrow();
  });

  it("scopeOf extracts the leading segment", () => {
    expect(scopeOf("workspace.workflow.read")).toBe("workspace");
    expect(scopeOf("organization.user.invite")).toBe("organization");
    expect(scopeOf("platform.billing.manage")).toBe("platform");
  });

  it("every permission carries a non-empty description", () => {
    for (const permission of PERMISSIONS) {
      expect(permission.description.trim().length).toBeGreaterThan(0);
    }
  });
});
