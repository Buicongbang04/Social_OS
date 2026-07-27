import { Global, Module } from "@nestjs/common";
import { PermissionEvaluator, type PermissionCachePort } from "@repo/auth";
import type {
  OrganizationMembershipRepository,
  WorkspaceMembershipRepository,
} from "@repo/domain";
import { AppConfig } from "../../config/app.config";
import {
  ORGANIZATION_MEMBERSHIP_REPOSITORY,
  WORKSPACE_MEMBERSHIP_REPOSITORY,
} from "../../infra/database/database.module";
import { PERMISSION_CACHE } from "../../infra/redis/redis.module";
import { PERMISSION_EVALUATOR } from "./authorization.tokens";
import { PermissionService } from "./permission.service";

/**
 * Global so PermissionGuard — registered as an APP_GUARD in AppModule — can
 * inject PermissionService without every feature module re-importing this.
 */
@Global()
@Module({
  providers: [
    {
      provide: PERMISSION_EVALUATOR,
      inject: [
        WORKSPACE_MEMBERSHIP_REPOSITORY,
        ORGANIZATION_MEMBERSHIP_REPOSITORY,
        PERMISSION_CACHE,
        AppConfig,
      ],
      useFactory: (
        workspaceMemberships: WorkspaceMembershipRepository,
        organizationMemberships: OrganizationMembershipRepository,
        cache: PermissionCachePort,
        config: AppConfig,
      ) =>
        new PermissionEvaluator(workspaceMemberships, organizationMemberships, {
          cache,
          cacheTtlSeconds: config.permissionCacheTtlSeconds,
        }),
    },
    PermissionService,
  ],
  exports: [PermissionService, PERMISSION_EVALUATOR],
})
export class AuthorizationModule {}
