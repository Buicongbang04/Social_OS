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
  await refuseUnlessTestDatabase(db);

  await db.execute(sql`
    truncate table
      content_pieces,
      campaigns,
      social_accounts,
      secret_versions,
      secrets,
      workspace_memory,
      messages,
      conversations,
      documents,
      execution_events,
      tasks,
      executions,
      goals,
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

/**
 * Refuse to wipe anything that is not a database named for throwing away.
 *
 * This exists because it happened: `pnpm test:int` was run with the DATABASE_URL
 * out of `.env`, and the truncate above deleted the only real workspace on the
 * machine — account, brand memory, campaigns, the connected Page. The tests
 * passed. Nothing warned.
 *
 * The name is asked of the server rather than parsed out of a URL, so it is the
 * database actually connected to and not the one somebody meant to connect to.
 * There is deliberately no environment variable to override this: a flag that
 * turns the guard off is a flag that will be set in the shell that then runs
 * the wrong command.
 */
async function refuseUnlessTestDatabase(db: DatabaseClient): Promise<void> {
  const rows = (await db.execute(
    sql`select current_database() as name`,
  )) as unknown as { name: string }[];
  const name = rows[0]?.name ?? "";

  if (!name.endsWith("_test")) {
    throw new Error(
      `Sẽ không xoá dữ liệu của database "${name}": tên không kết thúc bằng _test. ` +
        `Integration test phải chạy trên database riêng, ví dụ ` +
        `DATABASE_URL=postgresql://…/ai_social_os_test pnpm test:int.`,
    );
  }
}
