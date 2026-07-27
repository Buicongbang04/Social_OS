import type { Metadata, SoftDeletableEntity, UserId } from "@repo/core";
import type { UserStatus } from "../shared/status";

/**
 * Fields per docs/platform/04_USER_MANAGEMENT.md.
 *
 * User is platform-global (it can belong to several Organizations), so it
 * carries no tenantId — isolation happens through Membership instead.
 * Credentials live in UserIdentity, never here.
 */
export type User = SoftDeletableEntity<UserId> & {
  email: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  metadata: Metadata;
};

/** Authentication methods; only LOCAL is implemented in Phase 0. */
export const AUTH_PROVIDERS = [
  "LOCAL",
  "GOOGLE",
  "MICROSOFT",
  "GITHUB",
  "GITLAB",
  "OIDC",
  "SAML",
  "LDAP",
] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * Credential holder, kept separate from User so adding OAuth later is purely
 * additive (docs/platform/06_AUTHENTICATION.md: USER ||--|| IDENTITY ||--|| PROVIDER).
 * `passwordHash` is only populated for the LOCAL provider.
 */
export type UserIdentity = {
  id: string;
  userId: UserId;
  provider: AuthProvider;
  providerAccountId: string;
  passwordHash: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Profile explicitly holds no authentication data (docs/platform/04). */
export type UserProfile = {
  userId: UserId;
  displayName: string | null;
  jobTitle: string | null;
  department: string | null;
  language: string;
  timeZone: string;
  country: string | null;
  metadata: Metadata;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateUserInput = {
  email: string;
  username?: string | null;
  fullName?: string | null;
  passwordHash: string;
  metadata?: Metadata;
};

/** Safe projection: never leaks passwordHash to a transport layer. */
export type PublicUser = Pick<
  User,
  | "id"
  | "email"
  | "username"
  | "fullName"
  | "avatarUrl"
  | "status"
  | "createdAt"
>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    createdAt: user.createdAt,
  };
}
