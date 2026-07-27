/**
 * Lifecycle status enums and their legal transitions.
 *
 * Organization/Workspace share the lifecycle documented in
 * docs/platform/03_WORKSPACE_MANAGEMENT.md and docs/platform/05_ORGANIZATION.md:
 *   Created → Active → Suspended → Active | Active → Archived → Deleted
 */

export const ENTITY_STATUSES = [
  "CREATED",
  "ACTIVE",
  "SUSPENDED",
  "ARCHIVED",
  "DELETED",
] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

const ENTITY_TRANSITIONS: Readonly<
  Record<EntityStatus, readonly EntityStatus[]>
> = Object.freeze({
  CREATED: ["ACTIVE", "DELETED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: ["DELETED"],
  DELETED: [],
});

/** User status, per docs/platform/04_USER_MANAGEMENT.md. */
export const USER_STATUSES = [
  "INVITED",
  "REGISTERED",
  "ACTIVE",
  "SUSPENDED",
  "DISABLED",
  "DELETED",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const USER_TRANSITIONS: Readonly<Record<UserStatus, readonly UserStatus[]>> =
  Object.freeze({
    INVITED: ["REGISTERED", "DELETED"],
    REGISTERED: ["ACTIVE", "DISABLED", "DELETED"],
    ACTIVE: ["SUSPENDED", "DISABLED"],
    SUSPENDED: ["ACTIVE", "DISABLED"],
    DISABLED: ["DELETED"],
    DELETED: [],
  });

/** Membership status — not enumerated in the docs; kept minimal and explicit. */
export const MEMBERSHIP_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function canTransitionEntityStatus(
  from: EntityStatus,
  to: EntityStatus,
): boolean {
  return ENTITY_TRANSITIONS[from].includes(to);
}

export function canTransitionUserStatus(
  from: UserStatus,
  to: UserStatus,
): boolean {
  return USER_TRANSITIONS[from].includes(to);
}

/**
 * An active Workspace/Organization may not be deleted directly — it must be
 * archived first (docs/platform/03_WORKSPACE_MANAGEMENT.md).
 */
export function canDelete(status: EntityStatus): boolean {
  return canTransitionEntityStatus(status, "DELETED");
}
