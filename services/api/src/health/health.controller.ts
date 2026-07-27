import { Controller, Get, Inject } from "@nestjs/common";
import Redis from "ioredis";
import { pingDatabase, type DatabaseClient } from "@repo/database";
import { Public } from "../common/decorators/public.decorator";
import { raw } from "../common/interceptors/response-envelope.interceptor";
import { DATABASE_CLIENT } from "../infra/database/database.module";
import { REDIS_CLIENT } from "../infra/redis/redis.module";

type DependencyStatus = "up" | "down";

/**
 * Liveness/readiness probe. Deliberately unwrapped by the response envelope
 * and unauthenticated, because orchestrators and load balancers cannot
 * present a token and expect a flat body.
 */
@Controller("health")
export class HealthController {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DatabaseClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check() {
    const [database, cache] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const healthy = database === "up" && cache === "up";

    return raw({
      status: healthy ? "ok" : "degraded",
      dependencies: { database, cache },
      timestamp: new Date().toISOString(),
    });
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    return (await pingDatabase(this.db)) ? "up" : "down";
  }

  private async checkRedis(): Promise<DependencyStatus> {
    try {
      await this.redis.ping();
      return "up";
    } catch {
      return "down";
    }
  }
}
