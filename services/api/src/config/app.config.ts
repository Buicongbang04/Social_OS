import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "./env.schema";

/**
 * Typed wrapper over ConfigService so the rest of the app never reaches for a
 * string key and never touches process.env directly.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env["NODE_ENV"] {
    return this.get("NODE_ENV");
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get port(): number {
    return this.get("API_PORT");
  }

  get apiPrefix(): string {
    return this.get("API_PREFIX");
  }

  get databaseUrl(): string {
    return this.get("DATABASE_URL");
  }

  get redisUrl(): string {
    return this.get("REDIS_URL");
  }

  get authSecret(): string {
    return this.get("AUTH_SECRET");
  }

  get accessTokenTtlSeconds(): number {
    return this.get("AUTH_ACCESS_TOKEN_TTL_SECONDS");
  }

  get refreshTokenTtlSeconds(): number {
    return this.get("AUTH_REFRESH_TOKEN_TTL_SECONDS");
  }

  get argon2MemoryCost(): number {
    return this.get("AUTH_ARGON2_MEMORY_COST");
  }

  get argon2TimeCost(): number {
    return this.get("AUTH_ARGON2_TIME_COST");
  }

  /** Parsed allowlist. Empty entries are dropped so a trailing comma is harmless. */
  get corsOrigins(): string[] {
    return this.get("CORS_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get rateLimitUserPerMinute(): number {
    return this.get("RATE_LIMIT_USER_PER_MINUTE");
  }

  get rateLimitWorkspacePerHour(): number {
    return this.get("RATE_LIMIT_WORKSPACE_PER_HOUR");
  }

  get permissionCacheTtlSeconds(): number {
    return this.get("PERMISSION_CACHE_TTL_SECONDS");
  }

  /** Null when object storage is not configured; uploads are then refused. */
  get storage(): {
    url: string;
    /** Where a browser reaches storage. Same as `url` unless configured. */
    publicUrl: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  } | null {
    const url = this.config.get("MINIO_URL", { infer: true });
    const accessKeyId = this.config.get("MINIO_ROOT_USER", { infer: true });
    const secretAccessKey = this.config.get("MINIO_ROOT_PASSWORD", {
      infer: true,
    });

    // All three or none. Half-configured storage fails at the first upload
    // with an authentication error that reads as a broken deployment rather
    // than a missing setting.
    if (!url || !accessKeyId || !secretAccessKey) return null;

    return {
      url,
      publicUrl: this.config.get("MINIO_PUBLIC_URL", { infer: true }) ?? url,
      region: this.config.get("MINIO_REGION", { infer: true }),
      bucket: this.config.get("MINIO_BUCKET", { infer: true }),
      accessKeyId,
      secretAccessKey,
    };
  }

  get uploadMaxBytes(): number {
    return this.config.get("UPLOAD_MAX_MB", { infer: true }) * 1024 * 1024;
  }
}
