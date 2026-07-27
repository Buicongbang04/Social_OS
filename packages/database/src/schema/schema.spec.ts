import { describe, expect, it } from "vitest";
import {
  ENTITY_STATUSES,
  MEMBERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  PERMISSION_ACTIONS,
  USER_STATUSES,
  WORKSPACE_ROLES,
} from "@repo/domain";
import {
  entityStatusEnum,
  membershipStatusEnum,
  organizationRoleEnum,
  permissionActionEnum,
  userStatusEnum,
  workspaceRoleEnum,
} from "./_enums";
import { auditColumns, softDeleteColumns } from "./_shared";
import { organizations, users, workspaces } from "./index";
import { workspaceMemberships } from "./memberships";

describe("schema", () => {
  it("derives Postgres enums from the domain constants", () => {
    // If these ever diverge, authorization decisions in the DB and in code
    // would disagree — so assert they are literally the same lists.
    expect(entityStatusEnum.enumValues).toEqual([...ENTITY_STATUSES]);
    expect(userStatusEnum.enumValues).toEqual([...USER_STATUSES]);
    expect(membershipStatusEnum.enumValues).toEqual([...MEMBERSHIP_STATUSES]);
    expect(workspaceRoleEnum.enumValues).toEqual([...WORKSPACE_ROLES]);
    expect(organizationRoleEnum.enumValues).toEqual([...ORGANIZATION_ROLES]);
    expect(permissionActionEnum.enumValues).toEqual([...PERMISSION_ACTIONS]);
  });

  it("puts the universal audit metadata on every business table", () => {
    const required = Object.keys(auditColumns);
    for (const table of [
      users,
      organizations,
      workspaces,
      workspaceMemberships,
    ]) {
      for (const column of required) {
        expect(Object.keys(table)).toContain(column);
      }
    }
  });

  it("makes business tables soft-deletable", () => {
    const required = Object.keys(softDeleteColumns);
    for (const table of [
      users,
      organizations,
      workspaces,
      workspaceMemberships,
    ]) {
      for (const column of required) {
        expect(Object.keys(table)).toContain(column);
      }
    }
  });

  it("defaults version to 1 so optimistic locking starts from a known value", () => {
    expect(users.version.default).toBe(1);
    expect(workspaces.version.default).toBe(1);
    expect(organizations.version.default).toBe(1);
  });

  it("scopes a workspace membership to exactly one workspace", () => {
    // The no-cross-workspace-accumulation rule is structural: a membership row
    // cannot reference more than one workspace.
    expect(workspaceMemberships.workspaceId.notNull).toBe(true);
    expect(workspaceMemberships.userId.notNull).toBe(true);
  });
});
