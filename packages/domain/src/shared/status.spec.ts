import { describe, expect, it } from "vitest";
import {
  canDelete,
  canTransitionEntityStatus,
  canTransitionUserStatus,
} from "./status";

describe("lifecycle transitions", () => {
  it("follows the documented Workspace/Organization lifecycle", () => {
    // Created → Active → Suspended → Active | Active → Archived → Deleted
    expect(canTransitionEntityStatus("CREATED", "ACTIVE")).toBe(true);
    expect(canTransitionEntityStatus("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionEntityStatus("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionEntityStatus("ACTIVE", "ARCHIVED")).toBe(true);
    expect(canTransitionEntityStatus("ARCHIVED", "DELETED")).toBe(true);
  });

  it("forbids deleting an active workspace directly", () => {
    // docs/platform/03_WORKSPACE_MANAGEMENT.md: must archive first.
    expect(canDelete("ACTIVE")).toBe(false);
    expect(canDelete("SUSPENDED")).toBe(false);
    expect(canDelete("ARCHIVED")).toBe(true);
  });

  it("treats DELETED as terminal", () => {
    expect(canTransitionEntityStatus("DELETED", "ACTIVE")).toBe(false);
    expect(canTransitionEntityStatus("DELETED", "ARCHIVED")).toBe(false);
  });

  it("forbids un-archiving", () => {
    expect(canTransitionEntityStatus("ARCHIVED", "ACTIVE")).toBe(false);
  });

  it("follows the documented User lifecycle", () => {
    // Invited → Registered → Active → Suspended ↔ Active, Active → Disabled → Deleted
    expect(canTransitionUserStatus("INVITED", "REGISTERED")).toBe(true);
    expect(canTransitionUserStatus("REGISTERED", "ACTIVE")).toBe(true);
    expect(canTransitionUserStatus("ACTIVE", "SUSPENDED")).toBe(true);
    expect(canTransitionUserStatus("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionUserStatus("ACTIVE", "DISABLED")).toBe(true);
    expect(canTransitionUserStatus("DISABLED", "DELETED")).toBe(true);

    expect(canTransitionUserStatus("INVITED", "ACTIVE")).toBe(false);
    expect(canTransitionUserStatus("DELETED", "ACTIVE")).toBe(false);
  });
});
