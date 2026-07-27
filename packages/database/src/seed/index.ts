import { createLogger } from "@repo/logger";
import { closeDbClient, createDbClient } from "../client";
import { requireDatabaseUrl } from "../env";
import { seedDevData } from "./dev";
import { seedSystemData } from "./system";

const logger = createLogger("db-seed");

/**
 * System data always runs and is idempotent. Dev fixtures only run when a
 * password hash is supplied, which keeps this package free of a password
 * hashing dependency — hashing belongs to @repo/auth.
 *
 *   SEED_ADMIN_PASSWORD_HASH="$argon2id$..." pnpm --filter @repo/database db:seed
 */
async function main(): Promise<void> {
  const db = createDbClient(requireDatabaseUrl(), { maxConnections: 1 });

  logger.info("seeding permission catalog and role matrix");
  await seedSystemData(db);
  logger.info("system data seeded");

  const passwordHash = process.env.SEED_ADMIN_PASSWORD_HASH;
  if (passwordHash) {
    const seeded = await seedDevData(db, passwordHash);
    logger.info({ tenants: seeded.length }, "dev fixtures seeded");
  } else {
    logger.info("SEED_ADMIN_PASSWORD_HASH not set — skipping dev fixtures");
  }

  await closeDbClient(db);
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "seed failed");
  process.exitCode = 1;
});
