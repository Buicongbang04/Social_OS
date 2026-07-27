import type { OrganizationId, UserId, WorkspaceId } from "@repo/core";
import type {
  OrganizationMembershipRepository,
  PermissionKey,
  WorkspaceMembershipRepository,
} from "@repo/domain";
import {
  resolveOrganizationPermissions,
  resolveWorkspacePermissions,
} from "@repo/domain";

/**
 * Cache port. The concrete Redis implementation lives in services/api so this
 * package stays free of an ioredis dependency and remains unit-testable.
 */
export interface PermissionCachePort {
  get(key: string): Promise<PermissionKey[] | null>;
  set(
    key: string,
    permissions: PermissionKey[],
    ttlSeconds: number,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export type PermissionEvaluatorOptions = {
  cache?: PermissionCachePort;
  cacheTtlSeconds?: number;
};

export const DEFAULT_PERMISSION_CACHE_TTL_SECONDS = 300;

/**
 * Resolves what a user may do inside ONE workspace (or ONE organization).
 *
 * The workspaceId is part of both the repository query and the cache key, so
 * an OWNER membership in workspace A can never surface while evaluating
 * workspace B — the "permissions do not accumulate across workspaces" rule
 * from docs/platform/08_PERMISSION_MODEL.md is structural here, not a
 * convention someone has to remember.
 */
export class PermissionEvaluator {
  private readonly cache?: PermissionCachePort;
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly workspaceMemberships: WorkspaceMembershipRepository,
    private readonly organizationMemberships: OrganizationMembershipRepository,
    options: PermissionEvaluatorOptions = {},
  ) {
    this.cache = options.cache;
    this.cacheTtlSeconds =
      options.cacheTtlSeconds ?? DEFAULT_PERMISSION_CACHE_TTL_SECONDS;
  }

  static workspaceCacheKey(workspaceId: WorkspaceId, userId: UserId): string {
    return `perm:ws:${workspaceId}:user:${userId}`;
  }

  static organizationCacheKey(
    organizationId: OrganizationId,
    userId: UserId,
  ): string {
    return `perm:org:${organizationId}:user:${userId}`;
  }

  /** Effective permissions for a user in one workspace; empty when not a member. */
  async forWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<ReadonlySet<PermissionKey>> {
    const cacheKey = PermissionEvaluator.workspaceCacheKey(workspaceId, userId);

    const cached = await this.cache?.get(cacheKey);
    if (cached) return new Set(cached);

    const membership = await this.workspaceMemberships.findForUserInWorkspace(
      workspaceId,
      userId,
    );

    // Not a member, or membership suspended → deny everything.
    if (!membership || membership.status !== "ACTIVE") {
      await this.cache?.set(cacheKey, [], this.cacheTtlSeconds);
      return new Set();
    }

    const effective = resolveWorkspacePermissions(membership.role, {
      grants: membership.permissionGrants,
      denies: membership.permissionDenies,
    });

    await this.cache?.set(cacheKey, [...effective], this.cacheTtlSeconds);
    return effective;
  }

  async forOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<ReadonlySet<PermissionKey>> {
    const cacheKey = PermissionEvaluator.organizationCacheKey(
      organizationId,
      userId,
    );

    const cached = await this.cache?.get(cacheKey);
    if (cached) return new Set(cached);

    const membership =
      await this.organizationMemberships.findForUserInOrganization(
        organizationId,
        userId,
      );

    if (!membership || membership.status !== "ACTIVE") {
      await this.cache?.set(cacheKey, [], this.cacheTtlSeconds);
      return new Set();
    }

    const effective = resolveOrganizationPermissions(membership.role, {
      grants: membership.permissionGrants,
      denies: membership.permissionDenies,
    });

    await this.cache?.set(cacheKey, [...effective], this.cacheTtlSeconds);
    return effective;
  }

  /** Call whenever a membership or role changes, so the next check re-reads. */
  async invalidateWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<void> {
    await this.cache?.delete(
      PermissionEvaluator.workspaceCacheKey(workspaceId, userId),
    );
  }

  async invalidateOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<void> {
    await this.cache?.delete(
      PermissionEvaluator.organizationCacheKey(organizationId, userId),
    );
  }
}
