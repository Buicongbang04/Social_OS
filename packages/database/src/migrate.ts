import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createLogger } from "@repo/logger";
import { closeDbClient, createDbClient } from "./client";
import { requireDatabaseUrl } from "./env";

const logger = createLogger("db-migrate");

// CommonJS output, so __dirname is available (packages/config/tsconfig/library.json).
const migrationsFolder = resolve(__dirname, "../migrations");

async function main(): Promise<void> {
  const db = createDbClient(requireDatabaseUrl(), { maxConnections: 1 });

  logger.info({ migrationsFolder }, "applying migrations");
  await migrate(db, { migrationsFolder });
  logger.info("migrations applied");

  await closeDbClient(db);
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "migration failed");
  process.exitCode = 1;
});
