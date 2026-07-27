import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DatabaseClient = ReturnType<typeof createDbClient>;
export type DatabaseSchema = typeof schema;

export type CreateDbClientOptions = {
  /** Max pool connections. Keep low for CLI/scripts, higher for the API. */
  maxConnections?: number;
  /** Log every statement — development only. */
  debug?: boolean;
};

/**
 * Build a Drizzle client over a postgres-js pool.
 *
 * `casing: "snake_case"` makes the camelCase TypeScript fields map to
 * snake_case columns automatically, so the naming rule in
 * docs/data/02_DATA_MODEL.md is mechanical rather than a review checklist.
 */
export function createDbClient(
  connectionString: string,
  options: CreateDbClientOptions = {},
) {
  const { maxConnections = 10, debug = false } = options;

  const sql = postgres(connectionString, {
    max: maxConnections,
    // Prefer explicit Date objects over strings for timestamptz.
    transform: { undefined: null },
  });

  return drizzle(sql, { schema, casing: "snake_case", logger: debug });
}

/** Close the underlying pool — call on graceful shutdown and in test teardown. */
export async function closeDbClient(db: DatabaseClient): Promise<void> {
  await (db.$client as unknown as { end: () => Promise<void> }).end();
}

export { schema };
