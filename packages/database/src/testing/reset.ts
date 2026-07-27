import { sql } from "drizzle-orm";
import type { DatabaseClient } from "../client";

/**
 * Wipes tenant data between integration tests.
 *
 * Deliberately leaves `permissions`, `roles` and `role_permissions` alone:
 * those are seeded configuration mirrored from @repo/domain, not fixtures, and
 * re-seeding them on every test would be slow and pointless.
 *
 * Lives in @repo/database so consuming services need no drizzle-orm dependency
 * just to reset their test database.
 */
export async function truncateTenantData(db: DatabaseClient): Promise<void> {
  await db.execute(sql`
    truncate table
      sessions,
      workspace_memberships,
      organization_memberships,
      workspaces,
      organizations,
      user_identities,
      user_profiles,
      users,
      idempotency_keys
    restart identity cascade
  `);
}
