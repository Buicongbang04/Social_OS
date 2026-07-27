import { Inject, Injectable } from "@nestjs/common";
import { PermissionEvaluator } from "@repo/auth";
import type { OrganizationId, UserId, WorkspaceId } from "@repo/core";
import type { PermissionKey } from "@repo/domain";
import { hasPermission } from "@repo/domain";
import { PERMISSION_EVALUATOR } from "./authorization.tokens";

/**
 * `NOT_A_MEMBER` and `MISSING_PERMISSION` are separate outcomes because they
 * map to different HTTP responses — see `authorizeWorkspace`.
 */
export type AuthorizationOutcome =
  "ALLOWED" | "MISSING_PERMISSION" | "NOT_A_MEMBER";

/**
 * Thin NestJS-facing wrapper over the framework-agnostic PermissionEvaluator.
 *
 * Every method takes exactly one workspace (or organization) id: there is
 * deliberately no "does this user have X anywhere" query, because that is the
 * shape that leads to permissions leaking across tenants.
 */
@Injectable()
export class PermissionService {
  constructor(
    @Inject(PERMISSION_EVALUATOR)
    private readonly evaluator: PermissionEvaluator,
  ) {}

  async canInWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
    permission: PermissionKey,
  ): Promise<boolean> {
    const effective = await this.evaluator.forWorkspace(workspaceId, userId);
    return hasPermission(effective, permission);
  }

  async canInOrganization(
    organizationId: OrganizationId,
    userId: UserId,
    permission: PermissionKey,
  ): Promise<boolean> {
    const effective = await this.evaluator.forOrganization(
      organizationId,
      userId,
    );
    return hasPermission(effective, permission);
  }

  /**
   * Like `canInWorkspace`, but also reports whether the user is a member at
   * all. The caller needs the distinction to answer 404 (not a member — the
   * resource must appear not to exist) versus 403 (a member, but lacking this
   * one permission).
   */
  async authorizeWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
    permission: PermissionKey,
  ): Promise<AuthorizationOutcome> {
    const { isMember, permissions } = await this.evaluator.authorizeWorkspace(
      workspaceId,
      userId,
    );
    if (!isMember) return "NOT_A_MEMBER";
    return hasPermission(permissions, permission)
      ? "ALLOWED"
      : "MISSING_PERMISSION";
  }

  async authorizeOrganization(
    organizationId: OrganizationId,
    userId: UserId,
    permission: PermissionKey,
  ): Promise<AuthorizationOutcome> {
    const { isMember, permissions } =
      await this.evaluator.authorizeOrganization(organizationId, userId);
    if (!isMember) return "NOT_A_MEMBER";
    return hasPermission(permissions, permission)
      ? "ALLOWED"
      : "MISSING_PERMISSION";
  }

  async permissionsInWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<PermissionKey[]> {
    return [...(await this.evaluator.forWorkspace(workspaceId, userId))];
  }

  /**
   * Must be called whenever a membership, role or permission override changes,
   * otherwise a revoked user keeps their access until the cache TTL expires.
   */
  async invalidateWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<void> {
    await this.evaluator.invalidateWorkspace(workspaceId, userId);
  }

  async invalidateOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<void> {
    await this.evaluator.invalidateOrganization(organizationId, userId);
  }
}
