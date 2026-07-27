import { describe, expect, it } from "vitest";
import {
  hasPermission,
  resolveOrganizationPermissions,
  resolveWorkspacePermissions,
} from "./resolver";
import {
  ORGANIZATION_ROLE_PERMISSIONS,
  WORKSPACE_ROLE_PERMISSIONS,
} from "./roles";

describe("permission resolver", () => {
  it("denies by default: an unrelated permission is never implied", () => {
    const effective = resolveWorkspacePermissions("VIEWER");
    expect(hasPermission(effective, "workspace.workflow.delete")).toBe(false);
    expect(hasPermission(effective, "workspace.secret.read")).toBe(false);
  });

  it("resolves the documented role matrix rows", () => {
    // docs/platform/08_PERMISSION_MODEL.md permission matrix.
    const owner = resolveWorkspacePermissions("OWNER");
    const admin = resolveWorkspacePermissions("ADMIN");
    const developer = resolveWorkspacePermissions("DEVELOPER");
    const operator = resolveWorkspacePermissions("OPERATOR");
    const viewer = resolveWorkspacePermissions("VIEWER");

    // Create Workflow: ✓ ✓ ✓ ✗ ✗
    expect(
      [owner, admin, developer, operator, viewer].map((s) =>
        s.has("workspace.workflow.create"),
      ),
    ).toEqual([true, true, true, false, false]);

    // Execute Workflow: ✓ ✓ ✓ ✓ ✗
    expect(
      [owner, admin, developer, operator, viewer].map((s) =>
        s.has("workspace.workflow.execute"),
      ),
    ).toEqual([true, true, true, true, false]);

    // Delete Workflow: ✓ ✓ ✗ ✗ ✗
    expect(
      [owner, admin, developer, operator, viewer].map((s) =>
        s.has("workspace.workflow.delete"),
      ),
    ).toEqual([true, true, false, false, false]);

    // Manage Secrets: ✓ ✓ ✗ ✗ ✗
    expect(
      [owner, admin, developer, operator, viewer].map((s) =>
        s.has("workspace.secret.manage"),
      ),
    ).toEqual([true, true, false, false, false]);

    // Read Files: ✓ ✓ ✓ ✓ ✓
    expect(
      [owner, admin, developer, operator, viewer].map((s) =>
        s.has("workspace.file.read"),
      ),
    ).toEqual([true, true, true, true, true]);
  });

  it("Manage Billing is OWNER-only at organization scope", () => {
    // docs matrix: Manage Billing ✓ ✗ ✗ ✗ ✗
    expect(
      resolveOrganizationPermissions("OWNER").has(
        "organization.billing.manage",
      ),
    ).toBe(true);
    expect(
      resolveOrganizationPermissions("ADMIN").has(
        "organization.billing.manage",
      ),
    ).toBe(false);
    expect(
      resolveOrganizationPermissions("MEMBER").has(
        "organization.billing.manage",
      ),
    ).toBe(false);
  });

  it("applies per-membership grants on top of the role", () => {
    const effective = resolveWorkspacePermissions("VIEWER", {
      grants: ["workspace.workflow.execute"],
    });
    expect(hasPermission(effective, "workspace.workflow.execute")).toBe(true);
  });

  it("deny always wins over both role and explicit grant", () => {
    const overRole = resolveWorkspacePermissions("ADMIN", {
      denies: ["workspace.secret.manage"],
    });
    expect(hasPermission(overRole, "workspace.secret.manage")).toBe(false);

    const overGrant = resolveWorkspacePermissions("VIEWER", {
      grants: ["workspace.workflow.execute"],
      denies: ["workspace.workflow.execute"],
    });
    expect(hasPermission(overGrant, "workspace.workflow.execute")).toBe(false);
  });

  it("GUEST is strictly narrower than VIEWER", () => {
    const guest = resolveWorkspacePermissions("GUEST");
    const viewer = resolveWorkspacePermissions("VIEWER");
    expect(guest.size).toBeLessThan(viewer.size);
    for (const permission of guest) {
      expect(viewer.has(permission)).toBe(true);
    }
  });

  it("workspace roles escalate monotonically VIEWER ⊆ OPERATOR ⊆ DEVELOPER ⊆ ADMIN ⊆ OWNER", () => {
    const chain = [
      "VIEWER",
      "OPERATOR",
      "DEVELOPER",
      "ADMIN",
      "OWNER",
    ] as const;
    for (let i = 0; i < chain.length - 1; i++) {
      const narrower = new Set(WORKSPACE_ROLE_PERMISSIONS[chain[i]!]);
      const wider = new Set(WORKSPACE_ROLE_PERMISSIONS[chain[i + 1]!]);
      for (const permission of narrower) {
        expect(wider.has(permission)).toBe(true);
      }
    }
  });

  it("resolution is per-workspace: the resolver cannot merge two memberships", () => {
    // An OWNER membership in workspace A and a VIEWER membership in workspace B
    // are resolved independently — there is no code path that unions them.
    const inWorkspaceA = resolveWorkspacePermissions("OWNER");
    const inWorkspaceB = resolveWorkspacePermissions("VIEWER");

    expect(hasPermission(inWorkspaceA, "workspace.member.delete")).toBe(true);
    expect(hasPermission(inWorkspaceB, "workspace.member.delete")).toBe(false);
  });

  it("every permission in every role matrix exists in the catalog", async () => {
    const { isKnownPermission } = await import("./catalog");
    const all = [
      ...Object.values(WORKSPACE_ROLE_PERMISSIONS).flat(),
      ...Object.values(ORGANIZATION_ROLE_PERMISSIONS).flat(),
    ];
    const unknown = all.filter((key) => !isKnownPermission(key));
    expect(unknown).toEqual([]);
  });
});
