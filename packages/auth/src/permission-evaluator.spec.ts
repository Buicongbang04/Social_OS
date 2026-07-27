import { describe, expect, it, vi } from "vitest";
import type { OrganizationId, UserId, WorkspaceId } from "@repo/core";
import type {
  OrganizationMembership,
  OrganizationMembershipRepository,
  WorkspaceMembership,
  WorkspaceMembershipRepository,
  WorkspaceRole,
} from "@repo/domain";
import {
  PermissionEvaluator,
  type PermissionCachePort,
} from "./permission-evaluator";

const USER = "usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as UserId;
const WORKSPACE_A = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as WorkspaceId;
const WORKSPACE_B = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4B2" as WorkspaceId;
const ORGANIZATION = "org_01HX8ZQ7P9K2M4N6R8T0V2W4C3" as OrganizationId;

function membership(
  workspaceId: WorkspaceId,
  role: WorkspaceRole,
  overrides: Partial<WorkspaceMembership> = {},
): WorkspaceMembership {
  return {
    id: "mbr_01HX8ZQ7P9K2M4N6R8T0V2W4D4" as WorkspaceMembership["id"],
    workspaceId,
    userId: USER,
    role,
    permissionGrants: [],
    permissionDenies: [],
    status: "ACTIVE",
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    version: 1,
    metadata: {},
    ...overrides,
  };
}

/** Backed by a map keyed exactly as production keys it. */
function fakeCache(): PermissionCachePort & { store: Map<string, string[]> } {
  const store = new Map<string, string[]>();
  return {
    store,
    get: vi.fn(async (key: string) => (store.get(key) as never) ?? null),
    set: vi.fn(async (key: string, permissions: string[]) => {
      store.set(key, permissions);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function buildEvaluator(
  memberships: Partial<Record<WorkspaceId, WorkspaceMembership | null>>,
  cache?: PermissionCachePort,
) {
  const workspaceRepo = {
    findForUserInWorkspace: vi.fn(async (workspaceId: WorkspaceId) => {
      return memberships[workspaceId] ?? null;
    }),
  } as unknown as WorkspaceMembershipRepository;

  const organizationRepo = {
    findForUserInOrganization: vi.fn(
      async () => null as OrganizationMembership | null,
    ),
  } as unknown as OrganizationMembershipRepository;

  return {
    evaluator: new PermissionEvaluator(workspaceRepo, organizationRepo, {
      cache,
    }),
    workspaceRepo,
    organizationRepo,
  };
}

describe("PermissionEvaluator", () => {
  it("resolves an ACTIVE membership through the role matrix", async () => {
    const { evaluator } = buildEvaluator({
      [WORKSPACE_A]: membership(WORKSPACE_A, "DEVELOPER"),
    });

    const permissions = await evaluator.forWorkspace(WORKSPACE_A, USER);

    expect(permissions.has("workspace.workflow.create")).toBe(true);
    expect(permissions.has("workspace.secret.manage")).toBe(false);
  });

  it("denies everything when the user has no membership", async () => {
    const { evaluator } = buildEvaluator({});
    const permissions = await evaluator.forWorkspace(WORKSPACE_A, USER);
    expect(permissions.size).toBe(0);
  });

  it("denies everything when the membership is not ACTIVE", async () => {
    const { evaluator } = buildEvaluator({
      [WORKSPACE_A]: membership(WORKSPACE_A, "OWNER", { status: "SUSPENDED" }),
    });

    const permissions = await evaluator.forWorkspace(WORKSPACE_A, USER);
    expect(permissions.size).toBe(0);
  });

  it("never leaks permissions from another workspace", async () => {
    // OWNER of A, VIEWER of B — the classic accumulation bug.
    const { evaluator } = buildEvaluator({
      [WORKSPACE_A]: membership(WORKSPACE_A, "OWNER"),
      [WORKSPACE_B]: membership(WORKSPACE_B, "VIEWER"),
    });

    const inA = await evaluator.forWorkspace(WORKSPACE_A, USER);
    const inB = await evaluator.forWorkspace(WORKSPACE_B, USER);

    expect(inA.has("workspace.member.delete")).toBe(true);
    expect(inB.has("workspace.member.delete")).toBe(false);
    expect(inB.has("workspace.secret.manage")).toBe(false);
  });

  it("keys the cache per workspace, so A's entry cannot answer for B", async () => {
    const cache = fakeCache();
    const { evaluator } = buildEvaluator(
      {
        [WORKSPACE_A]: membership(WORKSPACE_A, "OWNER"),
        [WORKSPACE_B]: membership(WORKSPACE_B, "VIEWER"),
      },
      cache,
    );

    await evaluator.forWorkspace(WORKSPACE_A, USER);
    await evaluator.forWorkspace(WORKSPACE_B, USER);

    expect([...cache.store.keys()]).toEqual([
      `perm:ws:${WORKSPACE_A}:user:${USER}`,
      `perm:ws:${WORKSPACE_B}:user:${USER}`,
    ]);
    // Both keys contain the workspace id — that is what prevents cross-answers.
    for (const key of cache.store.keys()) {
      expect(key).toContain("perm:ws:");
    }
  });

  it("serves a repeat check from cache instead of hitting the database", async () => {
    const cache = fakeCache();
    const { evaluator, workspaceRepo } = buildEvaluator(
      { [WORKSPACE_A]: membership(WORKSPACE_A, "ADMIN") },
      cache,
    );

    await evaluator.forWorkspace(WORKSPACE_A, USER);
    await evaluator.forWorkspace(WORKSPACE_A, USER);

    expect(workspaceRepo.findForUserInWorkspace).toHaveBeenCalledTimes(1);
  });

  it("caches the empty result too, so a non-member does not hammer the database", async () => {
    const cache = fakeCache();
    const { evaluator, workspaceRepo } = buildEvaluator({}, cache);

    await evaluator.forWorkspace(WORKSPACE_A, USER);
    await evaluator.forWorkspace(WORKSPACE_A, USER);

    expect(workspaceRepo.findForUserInWorkspace).toHaveBeenCalledTimes(1);
  });

  it("re-reads after invalidation", async () => {
    const cache = fakeCache();
    const { evaluator, workspaceRepo } = buildEvaluator(
      { [WORKSPACE_A]: membership(WORKSPACE_A, "VIEWER") },
      cache,
    );

    await evaluator.forWorkspace(WORKSPACE_A, USER);
    await evaluator.invalidateWorkspace(WORKSPACE_A, USER);
    await evaluator.forWorkspace(WORKSPACE_A, USER);

    expect(workspaceRepo.findForUserInWorkspace).toHaveBeenCalledTimes(2);
  });

  it("applies per-membership grants and denies", async () => {
    const { evaluator } = buildEvaluator({
      [WORKSPACE_A]: membership(WORKSPACE_A, "VIEWER", {
        permissionGrants: ["workspace.workflow.execute"],
        permissionDenies: ["workspace.file.read"],
      }),
    });

    const permissions = await evaluator.forWorkspace(WORKSPACE_A, USER);

    expect(permissions.has("workspace.workflow.execute")).toBe(true);
    expect(permissions.has("workspace.file.read")).toBe(false);
  });

  it("resolves organization scope independently of workspace scope", async () => {
    const { evaluator } = buildEvaluator({
      [WORKSPACE_A]: membership(WORKSPACE_A, "OWNER"),
    });

    // No organization membership stubbed → empty, despite being workspace OWNER.
    const orgPermissions = await evaluator.forOrganization(ORGANIZATION, USER);
    expect(orgPermissions.size).toBe(0);
  });
});
