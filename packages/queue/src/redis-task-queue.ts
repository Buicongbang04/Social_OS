import type Redis from "ioredis";
import type { TaskId } from "@repo/core";
import type { QueuedTask, TaskQueue } from "@repo/runtime";

/**
 * Redis-backed task queue.
 *
 * Uses a sorted set keyed by dispatch time rather than a Redis Stream: the
 * queue must support *delayed* delivery (retry backoff, scheduled tasks), and
 * a sorted set scored by "not before" makes "what is due now" a single ranged
 * read. A Stream would need a separate timer to move delayed entries in.
 *
 * Reservation model (docs/runtime/09_RUNTIME_QUEUE.md): a reserved task moves
 * to a second sorted set scored by its reservation deadline. If the consumer
 * dies without acking, `recoverExpired` puts it back — so a crashed worker
 * loses no work, at the cost of at-least-once delivery, which the task
 * executor must be idempotent against.
 *
 * NOTE ON PRIORITY: the docs list five priority levels and rank by priority
 * first, then scheduled time. Encoding both into one score would make a
 * high-priority task jump ahead of a *due* low-priority one indefinitely, so
 * we sort strictly by due time in Redis and order the due batch by priority in
 * memory. That keeps priority meaningful without risking starvation.
 */
export type RedisTaskQueueOptions = {
  /** Namespace so several environments can share one Redis. */
  keyPrefix?: string;
  /** How long a reservation is held before it can be recovered. */
  visibilityTimeoutMs?: number;
  /** Refuse to enqueue beyond this, per docs `maxQueueLength`. */
  maxQueueLength?: number;
};

const DEFAULT_PREFIX = "runtime:queue";
/** docs/runtime/19_RUNTIME_CONFIGURATION.md — queue.visibilityTimeout: 60s. */
const DEFAULT_VISIBILITY_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_QUEUE_LENGTH = 100_000;

const PRIORITY_RANK: Readonly<Record<QueuedTask["priority"], number>> =
  Object.freeze({
    CRITICAL: 0,
    HIGH: 1,
    NORMAL: 2,
    LOW: 3,
    BACKGROUND: 4,
  });

export class QueueOverflowError extends Error {
  constructor(limit: number) {
    super(`Task queue is full (limit ${limit}).`);
    this.name = "QueueOverflowError";
  }
}

export class RedisTaskQueue implements TaskQueue {
  private readonly prefix: string;
  private readonly visibilityTimeoutMs: number;
  private readonly maxQueueLength: number;

  constructor(
    private readonly redis: Redis,
    options: RedisTaskQueueOptions = {},
  ) {
    this.prefix = options.keyPrefix ?? DEFAULT_PREFIX;
    this.visibilityTimeoutMs =
      options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
    this.maxQueueLength = options.maxQueueLength ?? DEFAULT_MAX_QUEUE_LENGTH;
  }

  /** Due tasks, scored by the epoch ms at which they become dispatchable. */
  private get readyKey(): string {
    return `${this.prefix}:ready`;
  }

  /** Reserved tasks, scored by the epoch ms at which the reservation lapses. */
  private get reservedKey(): string {
    return `${this.prefix}:reserved`;
  }

  private get deadLetterKey(): string {
    return `${this.prefix}:dead`;
  }

  /** taskId → serialised QueuedTask. One copy, referenced by every set. */
  private get payloadKey(): string {
    return `${this.prefix}:payload`;
  }

  async enqueue(task: QueuedTask): Promise<void> {
    const size = await this.size();
    if (size >= this.maxQueueLength) {
      // Refuse rather than accept work the runtime cannot drain — silently
      // growing an unbounded queue turns into an outage later.
      throw new QueueOverflowError(this.maxQueueLength);
    }

    await this.redis
      .multi()
      .hset(this.payloadKey, task.taskId, JSON.stringify(task))
      .zadd(this.readyKey, task.notBefore, task.taskId)
      // Re-enqueueing a task that was reserved (e.g. an explicit release)
      // must not leave a stale reservation behind.
      .zrem(this.reservedKey, task.taskId)
      .exec();
  }

  async reserve(limit: number): Promise<readonly QueuedTask[]> {
    if (limit <= 0) return [];

    const now = Date.now();

    // Only tasks whose notBefore has passed are eligible.
    // Over-fetch so priority ordering has a real batch to choose from, rather
    // than being handed only the oldest `limit` entries.
    const dueIds = await this.redis.zrangebyscore(
      this.readyKey,
      "-inf",
      now,
      "LIMIT",
      0,
      limit * 4,
    );

    if (dueIds.length === 0) return [];

    const payloads = await this.redis.hmget(this.payloadKey, ...dueIds);
    const candidates: QueuedTask[] = [];

    for (let i = 0; i < dueIds.length; i++) {
      const raw = payloads[i];
      if (!raw) {
        // Payload vanished (manual cleanup, or an ack that raced) — drop the
        // dangling index entry rather than handing out an unreadable task.
        await this.redis.zrem(this.readyKey, dueIds[i]!);
        continue;
      }
      candidates.push(JSON.parse(raw) as QueuedTask);
    }

    candidates.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.notBefore - b.notBefore,
    );

    const selected = candidates.slice(0, limit);
    if (selected.length === 0) return [];

    const deadline = now + this.visibilityTimeoutMs;
    const transaction = this.redis.multi();

    for (const task of selected) {
      // Atomically move ready → reserved so no second consumer can claim it.
      transaction.zrem(this.readyKey, task.taskId);
      transaction.zadd(this.reservedKey, deadline, task.taskId);
    }

    const results = await transaction.exec();

    // A zrem that removed nothing means another consumer won the race; drop
    // that task from this batch rather than processing it twice.
    const claimed: QueuedTask[] = [];
    for (let i = 0; i < selected.length; i++) {
      const removed = results?.[i * 2]?.[1];
      if (removed === 1) claimed.push(selected[i]!);
    }

    return claimed;
  }

  async ack(taskId: TaskId): Promise<void> {
    await this.redis
      .multi()
      .zrem(this.reservedKey, taskId)
      .zrem(this.readyKey, taskId)
      .hdel(this.payloadKey, taskId)
      .exec();
  }

  async release(taskId: TaskId, delayMs: number): Promise<void> {
    const raw = await this.redis.hget(this.payloadKey, taskId);
    if (!raw) return; // Already acked or dead-lettered; nothing to release.

    const task = JSON.parse(raw) as QueuedTask;
    const notBefore = Date.now() + Math.max(0, delayMs);
    const updated: QueuedTask = {
      ...task,
      notBefore,
      attempt: task.attempt + 1,
    };

    await this.redis
      .multi()
      .hset(this.payloadKey, taskId, JSON.stringify(updated))
      .zrem(this.reservedKey, taskId)
      .zadd(this.readyKey, notBefore, taskId)
      .exec();
  }

  async deadLetter(taskId: TaskId, reason: string): Promise<void> {
    const raw = await this.redis.hget(this.payloadKey, taskId);

    await this.redis
      .multi()
      .zrem(this.reservedKey, taskId)
      .zrem(this.readyKey, taskId)
      .hdel(this.payloadKey, taskId)
      // Kept, not dropped: an admin must be able to inspect and replay it
      // (docs/runtime/09_RUNTIME_QUEUE.md).
      .hset(
        this.deadLetterKey,
        taskId,
        JSON.stringify({
          task: raw ? JSON.parse(raw) : null,
          reason,
          at: Date.now(),
        }),
      )
      .exec();
  }

  /**
   * Return tasks whose reservation lapsed. This is what makes a worker crash
   * survivable: the task becomes claimable again instead of being lost.
   */
  async recoverExpired(): Promise<number> {
    const now = Date.now();
    const expired = await this.redis.zrangebyscore(
      this.reservedKey,
      "-inf",
      now,
    );
    if (expired.length === 0) return 0;

    const transaction = this.redis.multi();
    for (const taskId of expired) {
      transaction.zrem(this.reservedKey, taskId);
      // Due immediately — it already waited out its visibility timeout.
      transaction.zadd(this.readyKey, now, taskId);
    }
    await transaction.exec();

    return expired.length;
  }

  async size(): Promise<number> {
    const [ready, reserved] = await Promise.all([
      this.redis.zcard(this.readyKey),
      this.redis.zcard(this.reservedKey),
    ]);
    return ready + reserved;
  }

  /** Dead-lettered entries, for an admin view. */
  async deadLetters(): Promise<
    readonly { taskId: string; reason: string; at: number }[]
  > {
    const entries = await this.redis.hgetall(this.deadLetterKey);
    return Object.entries(entries).map(([taskId, raw]) => {
      const parsed = JSON.parse(raw) as { reason: string; at: number };
      return { taskId, reason: parsed.reason, at: parsed.at };
    });
  }

  /** Remove every key this queue owns. Test helper. */
  async clear(): Promise<void> {
    await this.redis.del(
      this.readyKey,
      this.reservedKey,
      this.payloadKey,
      this.deadLetterKey,
    );
  }
}
