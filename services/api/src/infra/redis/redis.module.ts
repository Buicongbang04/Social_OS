import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import Redis from "ioredis";
import type { PermissionCachePort } from "@repo/auth";
import { AppConfig } from "../../config/app.config";

export const REDIS_CLIENT = Symbol("REDIS_CLIENT");
export const PERMISSION_CACHE = Symbol("PERMISSION_CACHE");

/**
 * Redis-backed implementation of the cache port declared in @repo/auth.
 *
 * A cache failure must never turn into a failed authorization *decision*, but
 * it must also never silently grant access: on error we fall through to the
 * database rather than serving a stale or empty permission set.
 */
@Injectable()
export class RedisPermissionCache implements PermissionCachePort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      // Treat an unreachable/corrupt cache as a miss — the caller re-reads the DB.
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // A cache write failure is not a request failure.
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      // Best effort: the TTL will expire the entry anyway.
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new Redis(config.redisUrl, {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        }),
    },
    {
      provide: PERMISSION_CACHE,
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => new RedisPermissionCache(redis),
    },
  ],
  exports: [REDIS_CLIENT, PERMISSION_CACHE],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
