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
 * Generic JSON cache port. The concrete Redis implementation lives in
 * services/api so this package stays free of an ioredis dependency and remains
 * unit-testable.
 */
export interface PermissionCachePort {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export type PermissionEvaluatorOptions = {
  cache?: PermissionCachePort;
  cacheTtlSeconds?: number;
};

export const DEFAULT_PERMISSION_CACHE_TTL_SECONDS = 300;

/**
 * The outcome of resolving one membership.
 *
 * `isMember` is kept distinct from an empty permission set because the two
 * warrant different HTTP responses: a non-member must get 404 (revealing that
 * the resource exists would leak another tenant's data), while a member who
 * lacks one permission gets 403 — there is nothing left to hide from them.
 */
export type MembershipAuthorization = {
  isMember: boolean;
  permissions: ReadonlySet<PermissionKey>;
};

/** Cache-friendly shape; Sets do not survive JSON.stringify. */
type CachedAuthorization = { isMember: boolean; permissions: PermissionKey[] };

const NOT_A_MEMBER: MembershipAuthorization = Object.freeze({
  isMember: false,
  permissions: new Set<PermissionKey>(),
});

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

  /** Membership and effective permissions for a user in one workspace. */
  async authorizeWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<MembershipAuthorization> {
    const cacheKey = PermissionEvaluator.workspaceCacheKey(workspaceId, userId);

    const cached = await this.cache?.get<CachedAuthorization>(cacheKey);
    if (cached) {
      return {
        isMember: cached.isMember,
        permissions: new Set(cached.permissions),
      };
    }

    const membership = await this.workspaceMemberships.findForUserInWorkspace(
      workspaceId,
      userId,
    );

    // No membership, or one that is suspended, means no access at all.
    if (!membership || membership.status !== "ACTIVE") {
      await this.cacheAuthorization(cacheKey, NOT_A_MEMBER);
      return NOT_A_MEMBER;
    }

    const permissions = resolveWorkspacePermissions(membership.role, {
      grants: membership.permissionGrants,
      denies: membership.permissionDenies,
    });

    const authorization: MembershipAuthorization = {
      isMember: true,
      permissions,
    };
    await this.cacheAuthorization(cacheKey, authorization);
    return authorization;
  }

  async authorizeOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<MembershipAuthorization> {
    const cacheKey = PermissionEvaluator.organizationCacheKey(
      organizationId,
      userId,
    );

    const cached = await this.cache?.get<CachedAuthorization>(cacheKey);
    if (cached) {
      return {
        isMember: cached.isMember,
        permissions: new Set(cached.permissions),
      };
    }

    const membership =
      await this.organizationMemberships.findForUserInOrganization(
        organizationId,
        userId,
      );

    if (!membership || membership.status !== "ACTIVE") {
      await this.cacheAuthorization(cacheKey, NOT_A_MEMBER);
      return NOT_A_MEMBER;
    }

    const permissions = resolveOrganizationPermissions(membership.role, {
      grants: membership.permissionGrants,
      denies: membership.permissionDenies,
    });

    const authorization: MembershipAuthorization = {
      isMember: true,
      permissions,
    };
    await this.cacheAuthorization(cacheKey, authorization);
    return authorization;
  }

  /** Effective permissions only; empty for a non-member. */
  async forWorkspace(
    workspaceId: WorkspaceId,
    userId: UserId,
  ): Promise<ReadonlySet<PermissionKey>> {
    return (await this.authorizeWorkspace(workspaceId, userId)).permissions;
  }

  async forOrganization(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<ReadonlySet<PermissionKey>> {
    return (await this.authorizeOrganization(organizationId, userId))
      .permissions;
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

  private async cacheAuthorization(
    key: string,
    authorization: MembershipAuthorization,
  ): Promise<void> {
    const serializable: CachedAuthorization = {
      isMember: authorization.isMember,
      permissions: [...authorization.permissions],
    };
    await this.cache?.set(key, serializable, this.cacheTtlSeconds);
  }
}
