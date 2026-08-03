import { z } from "zod";

/**
 * Environment contract. Validated once at boot so a misconfigured deployment
 * fails immediately and loudly, rather than at the first request that happens
 * to need the missing value.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  API_PORT: z.coerce.number().int().positive().default(3100),
  API_PREFIX: z.string().default("api/v1"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /**
   * Signing key for access tokens. 32 chars minimum — short secrets make HS256
   * brute-forceable. No default: a fallback secret in source is how staging
   * keys end up in production.
   */
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),

  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(900), // 15 minutes
  AUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30), // 30 days

  /** Lower these in CI; production should keep the OWASP-recommended defaults. */
  AUTH_ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19_456),
  AUTH_ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),

  /** docs/platform/09_API_GATEWAY.md: User 100/min, Workspace 10.000/hour. */
  RATE_LIMIT_USER_PER_MINUTE: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WORKSPACE_PER_HOUR: z.coerce
    .number()
    .int()
    .positive()
    .default(10_000),

  PERMISSION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * Browser origins allowed to call this API, comma-separated.
   *
   * Defaults to apps/web's dev port, which is 3200 rather than Next's usual
   * 3000 for the same reason Postgres is on 5433 and the API on 3100: this
   * stack has to coexist with whatever else is running locally, and silently
   * landing on a neighbour's port produces a CORS failure that reads as a bug
   * in the app.
   *
   * Set it explicitly in production — a wildcard would hand any site on the
   * internet an authenticated cross-origin surface.
   */
  CORS_ORIGINS: z.string().default("http://localhost:3200"),

  /**
   * Object storage for uploaded documents (docs/data/06_OBJECT_STORAGE.md).
   *
   * MinIO in development, S3 or R2 in production — the same code either way,
   * so only these values change. `MINIO_URL` unset means uploads are disabled
   * rather than that the API refuses to boot: everything else on this service
   * works without storage, and failing to start would be a worse trade.
   */
  MINIO_URL: z.string().url().optional(),
  /**
   * The storage host a browser can reach, when it is not the one this process
   * uses.
   *
   * They differ the moment storage is on an internal network — in Docker the
   * API talks to `http://minio:9000`, and a download link signed for that host
   * is one nobody outside can open. Unset means they are the same.
   */
  MINIO_PUBLIC_URL: z.string().url().optional(),
  MINIO_REGION: z.string().default("us-east-1"),
  MINIO_BUCKET: z.string().default("ai-social-os"),
  MINIO_ROOT_USER: z.string().optional(),
  MINIO_ROOT_PASSWORD: z.string().optional(),

  /**
   * Largest file the API will accept, in megabytes.
   *
   * Enforced before the body is read, because the point of a limit is to stop
   * a 5 GB upload from occupying memory and a connection, and a check after
   * buffering has already paid that cost. 25 MB is roughly a long PDF.
   */
  UPLOAD_MAX_MB: z.coerce.number().int().positive().max(500).default(25),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
