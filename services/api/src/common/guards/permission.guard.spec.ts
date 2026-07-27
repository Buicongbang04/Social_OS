import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import type { OrganizationId, UserId, WorkspaceId } from "@repo/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@repo/core";
import type { PermissionKey } from "@repo/domain";
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
} from "../decorators/public.decorator";
import { REQUIRED_PERMISSION_KEY } from "../decorators/require-permission.decorator";
import { PermissionGuard } from "./permission.guard";
import type { PermissionService } from "../../modules/authorization/permission.service";

const USER = "usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as UserId;
const WORKSPACE = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as WorkspaceId;
const ORGANIZATION = "org_01HX8ZQ7P9K2M4N6R8T0V2W4C3" as OrganizationId;

type RequestShape = {
  user?: { userId: UserId };
  params?: Record<string, string>;
  headers?: Record<string, string>;
};

function buildContext(request: RequestShape): ExecutionContext {
  const req = {
    ...request,
    header: (name: string) => request.headers?.[name.toLowerCase()],
  };

  return {
    getType: () => "http",
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function buildGuard(options: {
  metadata?: Record<string, unknown>;
  workspaceAllowed?: boolean;
  organizationAllowed?: boolean;
  workspaceMember?: boolean;
  organizationMember?: boolean;
}) {
  const reflector = new Reflector();
  vi.spyOn(reflector, "getAllAndOverride").mockImplementation(
    (key: unknown) => options.metadata?.[String(key)] as never,
  );

  const outcome = (allowed: boolean | undefined, isMember: boolean) =>
    allowed ? "ALLOWED" : isMember ? "MISSING_PERMISSION" : "NOT_A_MEMBER";

  const permissions = {
    authorizeWorkspace: vi.fn(async () =>
      outcome(options.workspaceAllowed, options.workspaceMember ?? true),
    ),
    authorizeOrganization: vi.fn(async () =>
      outcome(options.organizationAllowed, options.organizationMember ?? true),
    ),
  } as unknown as PermissionService;

  return { guard: new PermissionGuard(reflector, permissions), permissions };
}

describe("PermissionGuard", () => {
  it("allows a @Public() route without any check", async () => {
    const { guard, permissions } = buildGuard({
      metadata: { [IS_PUBLIC_KEY]: true },
    });

    await expect(guard.canActivate(buildContext({}))).resolves.toBe(true);
    expect(permissions.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("allows an @AuthenticatedOnly() route without a permission check", async () => {
    const { guard, permissions } = buildGuard({
      metadata: { [AUTHENTICATED_ONLY_KEY]: true },
    });

    await expect(
      guard.canActivate(buildContext({ user: { userId: USER } })),
    ).resolves.toBe(true);
    expect(permissions.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("fails closed when a route declares no policy at all", async () => {
    // The important property: forgetting to annotate an endpoint denies it,
    // rather than silently exposing it.
    const { guard } = buildGuard({ metadata: {} });

    await expect(
      guard.canActivate(buildContext({ user: { userId: USER } })),
    ).rejects.toThrow(ForbiddenError);
  });

  it("grants when the user holds the required workspace permission", async () => {
    const { guard, permissions } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]:
          "workspace.workflow.execute" as PermissionKey,
      },
      workspaceAllowed: true,
    });

    const context = buildContext({
      user: { userId: USER },
      params: { workspaceId: WORKSPACE },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(permissions.authorizeWorkspace).toHaveBeenCalledWith(
      WORKSPACE,
      USER,
      "workspace.workflow.execute",
    );
  });

  it("denies when the user lacks the permission", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.secret.manage" as PermissionKey,
      },
      workspaceAllowed: false,
    });

    const context = buildContext({
      user: { userId: USER },
      params: { workspaceId: WORKSPACE },
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      /Missing required permission/,
    );
  });

  it("answers 404 for a non-member, so a foreign workspace's existence stays hidden", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.workspace.read" as PermissionKey,
      },
      workspaceAllowed: false,
      workspaceMember: false,
    });

    const context = buildContext({
      user: { userId: USER },
      params: { id: WORKSPACE },
    });
    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundError);
  });

  it("answers 403 for a member who lacks the permission — nothing left to hide", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.secret.manage" as PermissionKey,
      },
      workspaceAllowed: false,
      workspaceMember: true,
    });

    const context = buildContext({
      user: { userId: USER },
      params: { id: WORKSPACE },
    });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenError);
  });

  it("checks against the workspace in the request, never another one", async () => {
    const { guard, permissions } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.workspace.read" as PermissionKey,
      },
      workspaceAllowed: true,
    });

    const other = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4B2" as WorkspaceId;
    await guard.canActivate(
      buildContext({ user: { userId: USER }, params: { id: other } }),
    );

    // The id from the request wins — the guard never substitutes a workspace
    // the user happens to belong to.
    expect(permissions.authorizeWorkspace).toHaveBeenCalledWith(
      other,
      USER,
      "workspace.workspace.read",
    );
  });

  it("accepts the workspace id from a header when the route has no param", async () => {
    const { guard, permissions } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.workspace.read" as PermissionKey,
      },
      workspaceAllowed: true,
    });

    await guard.canActivate(
      buildContext({
        user: { userId: USER },
        headers: { "x-workspace-id": WORKSPACE },
      }),
    );

    expect(permissions.authorizeWorkspace).toHaveBeenCalledWith(
      WORKSPACE,
      USER,
      "workspace.workspace.read",
    );
  });

  it("rejects a missing or malformed workspace id instead of guessing", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.workspace.read" as PermissionKey,
      },
      workspaceAllowed: true,
    });

    await expect(
      guard.canActivate(buildContext({ user: { userId: USER } })),
    ).rejects.toThrow(ValidationError);

    await expect(
      guard.canActivate(
        buildContext({ user: { userId: USER }, params: { id: "not-an-id" } }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses an organization id where a workspace id is required", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.workspace.read" as PermissionKey,
      },
      workspaceAllowed: true,
    });

    // Branded ids make this a compile-time error in app code; the guard also
    // enforces it at runtime for untrusted route params.
    await expect(
      guard.canActivate(
        buildContext({ user: { userId: USER }, params: { id: ORGANIZATION } }),
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("routes organization-scoped permissions to the organization check", async () => {
    const { guard, permissions } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]:
          "organization.organization.read" as PermissionKey,
      },
      organizationAllowed: true,
    });

    await guard.canActivate(
      buildContext({ user: { userId: USER }, params: { id: ORGANIZATION } }),
    );

    expect(permissions.authorizeOrganization).toHaveBeenCalledWith(
      ORGANIZATION,
      USER,
      "organization.organization.read",
    );
    expect(permissions.authorizeWorkspace).not.toHaveBeenCalled();
  });

  it("denies platform-scoped permissions, which no membership can grant", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "platform.billing.manage" as PermissionKey,
      },
      workspaceAllowed: true,
      organizationAllowed: true,
    });

    await expect(
      guard.canActivate(
        buildContext({ user: { userId: USER }, params: { id: WORKSPACE } }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("denies when no principal was established", async () => {
    const { guard } = buildGuard({
      metadata: {
        [REQUIRED_PERMISSION_KEY]: "workspace.workspace.read" as PermissionKey,
      },
    });

    await expect(
      guard.canActivate(buildContext({ params: { id: WORKSPACE } })),
    ).rejects.toThrow(ForbiddenError);
  });
});
