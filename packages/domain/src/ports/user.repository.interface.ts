import type { UserId } from "@repo/core";
import type {
  AuthProvider,
  CreateUserInput,
  User,
  UserIdentity,
  UserProfile,
} from "../entities/user.entity";
import type { UserStatus } from "../shared/status";

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;

  findByEmail(email: string): Promise<User | null>;

  /** Credential lookup for the login flow; returns the identity holding the hash. */
  findIdentity(
    userId: UserId,
    provider: AuthProvider,
  ): Promise<UserIdentity | null>;

  findProfile(userId: UserId): Promise<UserProfile | null>;

  /** Creates user + profile + local identity atomically (one domain, one transaction). */
  createWithLocalIdentity(input: CreateUserInput): Promise<User>;

  updateStatus(
    id: UserId,
    status: UserStatus,
    actorId: UserId,
  ): Promise<User | null>;

  /** Replace a stale argon2 hash after a successful login (params upgraded). */
  updatePasswordHash(userId: UserId, passwordHash: string): Promise<void>;
}
