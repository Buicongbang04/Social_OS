import { pgEnum } from "drizzle-orm/pg-core";
import {
  AUTH_PROVIDERS,
  DOCUMENT_STATUSES,
  MEMORY_SOURCES,
  MESSAGE_ROLES,
  ENTITY_STATUSES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PERMISSION_SCOPES,
  USER_STATUSES,
  WORKSPACE_ROLES,
} from "@repo/domain";
import {
  EXECUTION_STATUSES,
  GOAL_PRIORITIES,
  GOAL_STATUSES,
  GOAL_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from "@repo/runtime";

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
export const documentStatusEnum = pgEnum("document_status", DOCUMENT_STATUSES);
export const messageRoleEnum = pgEnum("message_role", MESSAGE_ROLES);
export const memorySourceEnum = pgEnum("memory_source", MEMORY_SOURCES);
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

/** Runtime enums, generated from @repo/runtime for the same anti-drift reason. */
export const goalStatusEnum = pgEnum("goal_status", GOAL_STATUSES);
export const goalTypeEnum = pgEnum("goal_type", GOAL_TYPES);
export const goalPriorityEnum = pgEnum("goal_priority", GOAL_PRIORITIES);
export const executionStatusEnum = pgEnum(
  "execution_status",
  EXECUTION_STATUSES,
);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const taskPriorityEnum = pgEnum("task_priority", TASK_PRIORITIES);
