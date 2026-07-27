/**
 * Minimal env access for the database CLI scripts (migrate/seed). The API
 * service does its own validated config loading; this exists so the scripts
 * can run standalone via `pnpm --filter @repo/database db:migrate`.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env at the repo root, then re-run.",
    );
  }
  return url;
}
