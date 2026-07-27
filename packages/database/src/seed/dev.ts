import type { OrganizationId, UserId } from "@repo/core";
import { newId } from "@repo/core";
import type { DatabaseClient } from "../client";
import {
  organizationMemberships,
  organizations,
  userProfiles,
  users,
  workspaceMemberships,
  workspaces,
} from "../schema";

export type DevSeedResult = {
  adminUserId: UserId;
  organizationId: OrganizationId;
  workspaceId: string;
};

type DevTenant = {
  email: string;
  fullName: string;
  organizationName: string;
  organizationSlug: string;
  workspaceName: string;
  workspaceSlug: string;
};

/**
 * Two independent tenants, not one. The second exists so isolation tests have
 * a real neighbouring workspace to be denied access to, rather than asserting
 * against an empty database.
 */
const DEV_TENANTS: readonly DevTenant[] = [
  {
    email: "admin@ai-social-os.local",
    fullName: "Dev Admin",
    organizationName: "Dev Organization",
    organizationSlug: "dev-org",
    workspaceName: "Dev Workspace",
    workspaceSlug: "dev-workspace",
  },
  {
    email: "neighbour@ai-social-os.local",
    fullName: "Neighbour Admin",
    organizationName: "Neighbour Organization",
    organizationSlug: "neighbour-org",
    workspaceName: "Neighbour Workspace",
    workspaceSlug: "neighbour-workspace",
  },
];

/**
 * Development fixtures. Never runs in production, and never invents a
 * password — the caller supplies an already-hashed one so this package stays
 * free of a crypto dependency.
 */
export async function seedDevData(
  db: DatabaseClient,
  passwordHash: string,
): Promise<DevSeedResult[]> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedDevData must never run against production.");
  }

  const results: DevSeedResult[] = [];

  for (const tenant of DEV_TENANTS) {
    const result = await db.transaction(async (tx) => {
      const userId = newId("user");
      const organizationId = newId("organization");
      const workspaceId = newId("workspace");

      const insertedUsers = await tx
        .insert(users)
        .values({
          id: userId,
          email: tenant.email,
          username: tenant.email.split("@")[0] ?? null,
          fullName: tenant.fullName,
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          createdBy: userId,
          updatedBy: userId,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });

      // Already seeded on a previous run — skip this tenant entirely.
      if (insertedUsers.length === 0) return null;

      await tx
        .insert(userProfiles)
        .values({ userId, displayName: tenant.fullName });

      await tx.insert(organizations).values({
        id: organizationId,
        name: tenant.organizationName,
        slug: tenant.organizationSlug,
        ownerId: userId,
        status: "ACTIVE",
        createdBy: userId,
        updatedBy: userId,
      });

      await tx.insert(organizationMemberships).values({
        id: newId("membership"),
        organizationId,
        userId,
        role: "OWNER",
        status: "ACTIVE",
        createdBy: userId,
        updatedBy: userId,
      });

      await tx.insert(workspaces).values({
        id: workspaceId,
        name: tenant.workspaceName,
        slug: tenant.workspaceSlug,
        organizationId,
        status: "ACTIVE",
        createdBy: userId,
        updatedBy: userId,
      });

      await tx.insert(workspaceMemberships).values({
        id: newId("membership"),
        workspaceId,
        userId,
        role: "OWNER",
        status: "ACTIVE",
        createdBy: userId,
        updatedBy: userId,
      });

      return { adminUserId: userId, organizationId, workspaceId };
    });

    if (result) results.push(result);
  }

  // The password hash is written outside the loop so the identity table stays
  // the single place credentials live.
  await writeLocalIdentities(db, results, passwordHash);

  return results;
}

async function writeLocalIdentities(
  db: DatabaseClient,
  seeded: readonly DevSeedResult[],
  passwordHash: string,
): Promise<void> {
  if (seeded.length === 0) return;

  const { userIdentities } = await import("../schema");
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users);
  const byId = new Map(rows.map((row) => [row.id, row.email]));

  await db
    .insert(userIdentities)
    .values(
      seeded.map((entry) => ({
        id: newId("user"),
        userId: entry.adminUserId,
        provider: "LOCAL" as const,
        providerAccountId: (byId.get(entry.adminUserId) ?? "").toLowerCase(),
        passwordHash,
      })),
    )
    .onConflictDoNothing();
}
