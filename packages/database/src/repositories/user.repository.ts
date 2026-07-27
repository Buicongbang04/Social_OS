import { and, eq, isNull, sql } from "drizzle-orm";
import type { UserId } from "@repo/core";
import { newId } from "@repo/core";
import type {
  AuthProvider,
  CreateUserInput,
  User,
  UserIdentity,
  UserProfile,
  UserRepository,
  UserStatus,
} from "@repo/domain";
import type { DatabaseClient } from "../client";
import { userIdentities, userProfiles, users } from "../schema";

type UserRow = typeof users.$inferSelect;

function toEntity(row: UserRow): User {
  return {
    id: row.id as UserId,
    email: row.email,
    username: row.username,
    fullName: row.fullName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    emailVerifiedAt: row.emailVerifiedAt,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: UserId): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = lower(${email})`,
          isNull(users.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async findIdentity(
    userId: UserId,
    provider: AuthProvider,
  ): Promise<UserIdentity | null> {
    const rows = await this.db
      .select()
      .from(userIdentities)
      .where(
        and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, provider),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId as UserId,
      provider: row.provider,
      providerAccountId: row.providerAccountId,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findProfile(userId: UserId): Promise<UserProfile | null> {
    const rows = await this.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      userId: row.userId as UserId,
      displayName: row.displayName,
      jobTitle: row.jobTitle,
      department: row.department,
      language: row.language,
      timeZone: row.timeZone,
      country: row.country,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * User + profile + local identity are created in one transaction. All three
   * belong to the same domain, so this stays within the "one transaction, one
   * domain" rule from docs/data/04_TRANSACTION_MODEL.md.
   */
  async createWithLocalIdentity(input: CreateUserInput): Promise<User> {
    return this.db.transaction(async (tx) => {
      const userId = newId("user");

      const rows = await tx
        .insert(users)
        .values({
          id: userId,
          email: input.email,
          username: input.username ?? null,
          fullName: input.fullName ?? null,
          status: "REGISTERED",
          metadata: input.metadata ?? {},
          createdBy: userId,
          updatedBy: userId,
        })
        .returning();

      const row = rows[0];
      if (!row) throw new Error("Insert returned no row");

      await tx.insert(userProfiles).values({
        userId,
        displayName: input.fullName ?? null,
      });

      await tx.insert(userIdentities).values({
        id: newId("user"),
        userId,
        provider: "LOCAL",
        providerAccountId: input.email.toLowerCase(),
        passwordHash: input.passwordHash,
      });

      return toEntity(row);
    });
  }

  async updateStatus(
    id: UserId,
    status: UserStatus,
    actorId: UserId,
  ): Promise<User | null> {
    const rows = await this.db
      .update(users)
      .set({
        status,
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${users.version} + 1`,
      })
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async updatePasswordHash(
    userId: UserId,
    passwordHash: string,
  ): Promise<void> {
    await this.db
      .update(userIdentities)
      .set({ passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.provider, "LOCAL"),
        ),
      );
  }
}
