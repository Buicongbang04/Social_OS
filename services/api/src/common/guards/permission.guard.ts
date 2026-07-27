import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  isId,
} from "@repo/core";
import type { OrganizationId, WorkspaceId } from "@repo/core";
import { scopeOf, type PermissionKey } from "@repo/domain";
import { PermissionService } from "../../modules/authorization/permission.service";
import type { AuthorizationOutcome } from "../../modules/authorization/permission.service";
import type { AuthenticatedUser } from "../decorators/public.decorator";
import {
  AUTHENTICATED_ONLY_KEY,
  IS_PUBLIC_KEY,
} from "../decorators/public.decorator";
import { REQUIRED_PERMISSION_KEY } from "../decorators/require-permission.decorator";

export const WORKSPACE_ID_HEADER = "x-workspace-id";
export const ORGANIZATION_ID_HEADER = "x-organization-id";

/**
 * Authorization guard. Runs after JwtAuthGuard has established the principal.
 *
 * Deny by default (docs/platform/07_AUTHORIZATION.md): a route with no
 * authorization decorator at all is rejected rather than allowed, so
 * forgetting to annotate a new endpoint fails closed. `@Public()` and
 * `@AuthenticatedOnly()` are the two explicit ways to opt out of a permission
 * check — both are deliberate, neither is the default.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Only guard HTTP; leave other transports to their own guards.
    if (context.getType() !== "http") return true;

    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets))
      return true;
    if (
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets)
    )
      return true;

    const required = this.reflector.getAllAndOverride<PermissionKey>(
      REQUIRED_PERMISSION_KEY,
      targets,
    );

    if (!required) {
      // Fail closed: an unannotated route is a bug, not an open endpoint.
      throw new ForbiddenError(
        "This endpoint has no authorization policy.",
        "AUTHORIZATION_POLICY_MISSING",
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenError("Authentication required.", "FORBIDDEN");
    }

    const scope = scopeOf(required);

    if (scope === "workspace") {
      const workspaceId = resolveWorkspaceId(request);
      const outcome = await this.permissions.authorizeWorkspace(
        workspaceId,
        user.userId,
        required,
      );
      return decide(
        outcome,
        required,
        "Workspace not found.",
        "WORKSPACE_NOT_FOUND",
      );
    }

    if (scope === "organization") {
      const organizationId = resolveOrganizationId(request);
      const outcome = await this.permissions.authorizeOrganization(
        organizationId,
        user.userId,
        required,
      );
      return decide(
        outcome,
        required,
        "Organization not found.",
        "ORGANIZATION_NOT_FOUND",
      );
    }

    // platform.* — reserved for system administration, not granted to anyone
    // through workspace or organization membership.
    throw deniedError(required);
  }
}

/**
 * A non-member gets 404, not 403: answering 403 would confirm that a resource
 * with that id exists, which leaks the existence of another tenant's data.
 * 403 is reserved for someone who *is* a member but lacks this one permission
 * — they already know the resource exists, so there is nothing left to hide.
 */
function decide(
  outcome: AuthorizationOutcome,
  required: PermissionKey,
  notFoundMessage: string,
  notFoundCode: string,
): true {
  if (outcome === "ALLOWED") return true;
  if (outcome === "NOT_A_MEMBER")
    throw new NotFoundError(notFoundMessage, notFoundCode);
  throw deniedError(required);
}

function deniedError(required: PermissionKey): ForbiddenError {
  // The required permission is safe to disclose: it tells a legitimate user
  // what to ask an admin for, and reveals nothing about other tenants' data.
  return new ForbiddenError(
    `Missing required permission: ${required}`,
    "PERMISSION_DENIED",
  );
}

/**
 * Workspace context comes from the route param when the resource is addressed
 * by id, otherwise from an explicit header. It is never inferred from the
 * user's memberships — that would let a request act on whichever workspace
 * happened to be found first.
 */
function resolveWorkspaceId(request: Request): WorkspaceId {
  // `:id` is only the workspace on workspace routes; on /goals/:id it is a
  // goal. Taking the first candidate that actually parses as a workspace id
  // lets both shapes work without the guard knowing the route.
  const candidates = [
    paramValue(request, "workspaceId"),
    paramValue(request, "id"),
    request.header(WORKSPACE_ID_HEADER),
  ];

  for (const candidate of candidates) {
    if (candidate && isId("workspace", candidate)) return candidate;
  }

  throw new ValidationError(
    `A workspace id is required, via the route or the ${WORKSPACE_ID_HEADER} header.`,
  );
}

function resolveOrganizationId(request: Request): OrganizationId {
  const candidates = [
    paramValue(request, "organizationId"),
    paramValue(request, "id"),
    request.header(ORGANIZATION_ID_HEADER),
  ];

  for (const candidate of candidates) {
    if (candidate && isId("organization", candidate)) return candidate;
  }

  throw new ValidationError(
    `An organization id is required, via the route or the ${ORGANIZATION_ID_HEADER} header.`,
  );
}

function paramValue(request: Request, name: string): string | undefined {
  const params = request.params as
    Record<string, string | undefined> | undefined;
  return params?.[name];
}
