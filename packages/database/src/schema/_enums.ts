import { pgEnum } from "drizzle-orm/pg-core";
import {
  AUTH_PROVIDERS,
  ENTITY_STATUSES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PERMISSION_SCOPES,
  USER_STATUSES,
  WORKSPACE_ROLES,
} from "@repo/domain";

/**
 * Postgres enums are generated from the domain constants, so the database can
 * never drift from @repo/domain without a migration diff showing up.
 */
export const entityStatusEnum = pgEnum("entity_status", ENTITY_STATUSES);
export const userStatusEnum = pgEnum("user_status", USER_STATUSES);
export const membershipStatusEnum = pgEnum(
  "membership_status",
  MEMBERSHIP_STATUSES,
);
export const workspaceRoleEnum = pgEnum("workspace_role", WORKSPACE_ROLES);
export const organizationRoleEnum = pgEnum(
  "organization_role",
  ORGANIZATION_ROLES,
);
export const authProviderEnum = pgEnum("auth_provider", AUTH_PROVIDERS);
export const permissionScopeEnum = pgEnum(
  "permission_scope",
  PERMISSION_SCOPES,
);
export const permissionResourceEnum = pgEnum(
  "permission_resource",
  PERMISSION_RESOURCES,
);
export const permissionActionEnum = pgEnum(
  "permission_action",
  PERMISSION_ACTIONS,
);
