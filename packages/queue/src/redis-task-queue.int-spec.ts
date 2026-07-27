import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { newId, type ExecutionId, type WorkspaceId } from "@repo/core";
import type { QueuedTask } from "@repo/runtime";
import { QueueOverflowError, RedisTaskQueue } from "./redis-task-queue";

const REDIS_URL = process.env.REDIS_URL;

const EXECUTION_ID = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as ExecutionId;
const WORKSPACE_ID = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as WorkspaceId;

function queued(overrides: Partial<QueuedTask> = {}): QueuedTask {
  return {
    taskId: newId("task"),
    executionId: EXECUTION_ID,
    workspaceId: WORKSPACE_ID,
    capability: "content.generate",
    priority: "NORMAL",
    notBefore: Date.now(),
    attempt: 0,
    ...overrides,
  };
}

describe.skipIf(!REDIS_URL)("RedisTaskQueue (integration)", () => {
  const redis = new Redis(REDIS_URL!);
  const queue = new RedisTaskQueue(redis, {
    keyPrefix: "test:queue",
    visibilityTimeoutMs: 500,
  });

  beforeEach(async () => {
    await queue.clear();
  });

  afterAll(async () => {
    await queue.clear();
    await redis.quit();
  });

  it("hands back what was enqueued", async () => {
    const task = queued();
    await queue.enqueue(task);

    const reserved = await queue.reserve(10);
    expect(reserved.map((t) => t.taskId)).toEqual([task.taskId]);
    expect(reserved[0]!.capability).toBe("content.generate");
  });

  it("never hands the same task to two consumers", async () => {
    // The property the whole reservation model exists for: two schedulers
    // polling concurrently must not both run the same task.
    await queue.enqueue(queued());

    const [first, second] = await Promise.all([
      queue.reserve(10),
      queue.reserve(10),
    ]);
    expect(first.length + second.length).toBe(1);
  });

  it("does not release a task before its notBefore", async () => {
    await queue.enqueue(queued({ notBefore: Date.now() + 60_000 }));
    expect(await queue.reserve(10)).toEqual([]);
  });

  it("serves higher priority first among tasks that are all due", async () => {
    const low = queued({ priority: "LOW" });
    const critical = queued({ priority: "CRITICAL" });
    const normal = queued({ priority: "NORMAL" });

    // Enqueued worst-first, so FIFO alone would get this wrong.
    await queue.enqueue(low);
    await queue.enqueue(normal);
    await queue.enqueue(critical);

    const reserved = await queue.reserve(3);
    expect(reserved.map((t) => t.priority)).toEqual([
      "CRITICAL",
      "NORMAL",
      "LOW",
    ]);
  });

  it("removes a task permanently on ack", async () => {
    const task = queued();
    await queue.enqueue(task);
    await queue.reserve(10);
    await queue.ack(task.taskId);

    expect(await queue.size()).toBe(0);
    expect(await queue.reserve(10)).toEqual([]);
  });

  it("returns a released task after its backoff, with the attempt counted", async () => {
    const task = queued();
    await queue.enqueue(task);
    await queue.reserve(10);

    await queue.release(task.taskId, 300);
    // Still inside the backoff window.
    expect(await queue.reserve(10)).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 350));
    const retried = await queue.reserve(10);

    expect(retried).toHaveLength(1);
    expect(retried[0]!.attempt).toBe(1);
  });

  it("recovers a reservation whose holder died without acking", async () => {
    // This is what makes a worker crash survivable — the task must not be lost.
    const task = queued();
    await queue.enqueue(task);
    await queue.reserve(10);

    // Simulate the consumer dying: never ack, never release.
    expect(await queue.reserve(10)).toEqual([]);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await queue.recoverExpired()).toBe(1);

    const recovered = await queue.reserve(10);
    expect(recovered.map((t) => t.taskId)).toEqual([task.taskId]);
  });

  it("does not recover a reservation that is still within its timeout", async () => {
    await queue.enqueue(queued());
    await queue.reserve(10);

    expect(await queue.recoverExpired()).toBe(0);
  });

  it("parks a dead-lettered task for inspection instead of dropping it", async () => {
    const task = queued();
    await queue.enqueue(task);
    await queue.reserve(10);
    await queue.deadLetter(task.taskId, "retries exhausted");

    expect(await queue.size()).toBe(0);
    expect(await queue.reserve(10)).toEqual([]);

    const dead = await queue.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0]!.taskId).toBe(task.taskId);
    expect(dead[0]!.reason).toBe("retries exhausted");
  });

  it("counts both ready and reserved tasks in size", async () => {
    await queue.enqueue(queued());
    await queue.enqueue(queued());
    expect(await queue.size()).toBe(2);

    await queue.reserve(1);
    // A reserved task is still outstanding work, so it still counts.
    expect(await queue.size()).toBe(2);
  });

  it("refuses to accept work beyond the configured limit", async () => {
    // Silently growing an unbounded queue turns into an outage later.
    const small = new RedisTaskQueue(redis, {
      keyPrefix: "test:queue:small",
      maxQueueLength: 2,
    });
    await small.clear();

    await small.enqueue(queued());
    await small.enqueue(queued());

    await expect(small.enqueue(queued())).rejects.toThrow(QueueOverflowError);
    await small.clear();
  });

  it("respects the reserve limit", async () => {
    for (let i = 0; i < 5; i++) await queue.enqueue(queued());
    expect(await queue.reserve(2)).toHaveLength(2);
  });

  it("returns nothing for a non-positive limit", async () => {
    await queue.enqueue(queued());
    expect(await queue.reserve(0)).toEqual([]);
  });

  it("ignores a release for a task that was already acked", async () => {
    const task = queued();
    await queue.enqueue(task);
    await queue.reserve(10);
    await queue.ack(task.taskId);

    await expect(queue.release(task.taskId, 0)).resolves.toBeUndefined();
    expect(await queue.size()).toBe(0);
  });
});
