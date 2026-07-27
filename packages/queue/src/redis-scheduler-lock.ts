import type Redis from "ioredis";
import type { SchedulerLock } from "@repo/runtime";

/**
 * Redis distributed lock, per docs/kernel/10_RUNTIME_SCHEDULER.md
 * ("Chỉ một Scheduler được phép lấy một Task").
 *
 * Two properties matter:
 *
 * 1. `SET key token NX PX ttl` — only one holder wins, and the TTL means a
 *    scheduler that dies holding the lock does not block the others forever.
 * 2. Release compares a per-acquisition token before deleting. Without that,
 *    a slow holder whose lock had already expired could delete the lock a
 *    *different* scheduler now legitimately owns — and then two schedulers
 *    would dispatch the same task.
 */
export class RedisSchedulerLock implements SchedulerLock {
  private readonly tokens = new Map<string, string>();

  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = "runtime:lock",
  ) {}

  private key(name: string): string {
    return `${this.keyPrefix}:${name}`;
  }

  async acquire(key: string, ttlMs: number): Promise<boolean> {
    // Unique per acquisition, so release can prove ownership.
    const token = `${process.pid}-${Date.now()}-${Math.trunc(Math.random() * 1e9)}`;
    const result = await this.redis.set(
      this.key(key),
      token,
      "PX",
      ttlMs,
      "NX",
    );

    if (result !== "OK") return false;

    this.tokens.set(key, token);
    return true;
  }

  async release(key: string): Promise<void> {
    const token = this.tokens.get(key);
    if (!token) return;

    this.tokens.delete(key);

    // Compare-and-delete must be atomic: checking then deleting from the
    // client leaves a window where the lock expires and is re-acquired
    // between the two calls.
    await this.redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       else
         return 0
       end`,
      1,
      this.key(key),
      token,
    );
  }

  /** Run `fn` only if the lock is free; returns null when it is already held. */
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    if (!(await this.acquire(key, ttlMs))) return null;

    try {
      return await fn();
    } finally {
      await this.release(key);
    }
  }
}
