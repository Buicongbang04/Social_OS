import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { RedisSchedulerLock } from "./redis-scheduler-lock";

const REDIS_URL = process.env.REDIS_URL;
const PREFIX = "test:lock";

describe.skipIf(!REDIS_URL)("RedisSchedulerLock (integration)", () => {
  const redis = new Redis(REDIS_URL!);

  // Two independent instances stand in for two scheduler processes.
  const nodeA = new RedisSchedulerLock(redis, PREFIX);
  const nodeB = new RedisSchedulerLock(redis, PREFIX);

  beforeEach(async () => {
    const keys = await redis.keys(`${PREFIX}:*`);
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    const keys = await redis.keys(`${PREFIX}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it("lets only one node hold a lock", async () => {
    // The property the scheduler depends on: two nodes must not both dispatch
    // the same task.
    expect(await nodeA.acquire("dispatch", 5_000)).toBe(true);
    expect(await nodeB.acquire("dispatch", 5_000)).toBe(false);
  });

  it("frees the lock on release", async () => {
    await nodeA.acquire("dispatch", 5_000);
    await nodeA.release("dispatch");

    expect(await nodeB.acquire("dispatch", 5_000)).toBe(true);
  });

  it("expires the lock so a node that dies does not block the others forever", async () => {
    await nodeA.acquire("dispatch", 200);
    expect(await nodeB.acquire("dispatch", 5_000)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(await nodeB.acquire("dispatch", 5_000)).toBe(true);
  });

  it("does not let a stale holder release a lock someone else now owns", async () => {
    // The dangerous case: A's lock expires, B acquires it, then A finally
    // calls release. Without an ownership token A would delete B's lock and
    // both nodes would proceed — exactly the double-dispatch we are preventing.
    await nodeA.acquire("dispatch", 150);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await nodeB.acquire("dispatch", 5_000)).toBe(true);
    await nodeA.release("dispatch");

    // B must still hold it.
    const stillHeld = await nodeA.acquire("dispatch", 5_000);
    expect(stillHeld).toBe(false);
  });

  it("keeps separate keys independent", async () => {
    expect(await nodeA.acquire("dispatch", 5_000)).toBe(true);
    expect(await nodeB.acquire("recover", 5_000)).toBe(true);
  });

  it("ignores a release for a lock that was never acquired", async () => {
    await expect(nodeA.release("never-held")).resolves.toBeUndefined();
  });

  it("runs the critical section only for the winner, and frees it after", async () => {
    const ran: string[] = [];

    const [a, b] = await Promise.all([
      nodeA.withLock("dispatch", 5_000, async () => {
        ran.push("A");
        return "A";
      }),
      nodeB.withLock("dispatch", 5_000, async () => {
        ran.push("B");
        return "B";
      }),
    ]);

    expect(ran).toHaveLength(1);
    expect([a, b].filter((result) => result !== null)).toHaveLength(1);

    // Lock released, so a later caller can take it.
    expect(await nodeA.acquire("dispatch", 1_000)).toBe(true);
  });

  it("releases the lock even when the critical section throws", async () => {
    await expect(
      nodeA.withLock("dispatch", 5_000, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // A leaked lock here would stall the scheduler until the TTL expired.
    expect(await nodeB.acquire("dispatch", 1_000)).toBe(true);
  });
});
