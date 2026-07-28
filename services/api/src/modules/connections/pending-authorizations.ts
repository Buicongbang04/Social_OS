import { Inject, Injectable } from "@nestjs/common";
import type { PendingAuthorization } from "@repo/connectors";
import type Redis from "ioredis";
import { REDIS_CLIENT } from "../../infra/redis/redis.module";

/**
 * How long a half-finished authorization is honoured.
 *
 * Long enough for someone to read a permissions screen and think about it,
 * short enough that a state captured from a browser history or a proxy log is
 * useless by the time anyone finds it.
 */
const TTL_SECONDS = 15 * 60;

const key = (state: string) => `oauth:pending:${state}`;

/**
 * The half-finished connections, held between sending someone to a platform and
 * their coming back.
 *
 * In Redis rather than memory because the callback is a fresh request that may
 * well land on a different API instance than the one that started the flow —
 * an in-memory map would make connecting fail at random once there is more than
 * one instance, and work perfectly in every test.
 */
@Injectable()
export class PendingAuthorizations {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async put(pending: PendingAuthorization): Promise<void> {
    await this.redis.set(
      key(pending.state),
      JSON.stringify(pending),
      "EX",
      TTL_SECONDS,
    );
  }

  /**
   * Read a pending authorization and consume it in the same breath.
   *
   * Single use, and atomically so. A state that could be redeemed twice is a
   * code that can be replayed — and `GETDEL` rather than get-then-delete
   * because two callbacks arriving together would otherwise both find it.
   */
  async take(state: string): Promise<PendingAuthorization | null> {
    const raw = await this.redis.getdel(key(state));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingAuthorization;
    return { ...parsed, createdAt: new Date(parsed.createdAt) };
  }
}
