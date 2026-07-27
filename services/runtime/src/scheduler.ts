import { createLogger, withCorrelation } from "@repo/logger";
import type { SchedulerLock } from "@repo/runtime";
import type { EngineEvent, ExecutionEngine, TaskQueue } from "@repo/runtime";
import type { EventPublisher } from "@repo/event";
import { createEvent, isRuntimeEventType, redactPayload } from "@repo/event";
import type { ExecutionId, TaskId, WorkspaceId } from "@repo/core";

const logger = createLogger("runtime-scheduler");

export type SchedulerOptions = {
  /** How many tasks one tick may claim. Caps the blast radius of a slow tick. */
  batchSize?: number;
  /** Pause between ticks when there was nothing to do. */
  idleDelayMs?: number;
  /** How often to sweep for lapsed reservations. */
  recoverIntervalMs?: number;
  /** Lock TTL — must exceed a tick, or two nodes could overlap. */
  lockTtlMs?: number;
};

const DEFAULTS = {
  batchSize: 10,
  idleDelayMs: 250,
  recoverIntervalMs: 10_000,
  lockTtlMs: 30_000,
} as const;

const DISPATCH_LOCK = "dispatch";

/**
 * The runtime loop: claim due tasks, run them, publish what happened.
 *
 * Dispatch is wrapped in a distributed lock so that with several runtime nodes
 * only one claims at a time (docs/kernel/10_RUNTIME_SCHEDULER.md). The queue's
 * own reservation is the second line of defence — the lock reduces contention,
 * the reservation is what actually guarantees single delivery.
 */
export class Scheduler {
  private readonly options: Required<SchedulerOptions>;
  private running = false;
  private lastRecoverAt = 0;

  constructor(
    private readonly engine: ExecutionEngine,
    private readonly queue: TaskQueue,
    private readonly lock: SchedulerLock,
    private readonly events: EventPublisher,
    options: SchedulerOptions = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Runs until `stop()`. */
  async start(): Promise<void> {
    this.running = true;
    logger.info({ batchSize: this.options.batchSize }, "scheduler started");

    while (this.running) {
      try {
        const worked = await this.tick();
        if (!worked) await sleep(this.options.idleDelayMs);
      } catch (error) {
        // A failing tick must not kill the loop — otherwise one bad task
        // silently stops the entire runtime.
        logger.error({ err: error }, "scheduler tick failed");
        await sleep(this.options.idleDelayMs);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  /** One pass. Returns true when it did something, so the caller can idle. */
  async tick(): Promise<boolean> {
    await this.recoverExpiredReservations();

    const claimed = await this.lock.acquire(
      DISPATCH_LOCK,
      this.options.lockTtlMs,
    );
    if (!claimed) return false;

    let tasks: readonly {
      taskId: TaskId;
      executionId: ExecutionId;
      workspaceId: WorkspaceId;
    }[];
    try {
      tasks = await this.queue.reserve(this.options.batchSize);
    } finally {
      // Release as soon as the claim is made: running the tasks does not need
      // the lock, and holding it would serialise all execution across nodes.
      await this.lock.release(DISPATCH_LOCK);
    }

    if (tasks.length === 0) return false;

    for (const queued of tasks) {
      await this.runOne(queued.taskId, queued.executionId, queued.workspaceId);
    }

    return true;
  }

  private async runOne(
    taskId: TaskId,
    executionId: ExecutionId,
    workspaceId: WorkspaceId,
  ): Promise<void> {
    const { events, settled } = await this.engine.runTask(taskId);

    // Only ack a task the engine finished with. A failed-but-retryable task was
    // already released back onto the queue with its backoff.
    if (settled) await this.queue.ack(taskId);

    const settleEvents = await this.engine.settleExecution(executionId);
    await this.publish([...events, ...settleEvents], workspaceId, executionId);
  }

  private async recoverExpiredReservations(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRecoverAt < this.options.recoverIntervalMs) return;
    this.lastRecoverAt = now;

    const recovered = await this.queue.recoverExpired();
    if (recovered > 0) {
      logger.warn({ recovered }, "returned tasks whose reservation lapsed");
    }
  }

  private async publish(
    events: readonly EngineEvent[],
    workspaceId: WorkspaceId,
    executionId: ExecutionId,
  ): Promise<void> {
    for (const event of events) {
      if (!isRuntimeEventType(event.type)) {
        // Catch a typo at the boundary rather than emitting something no
        // consumer is subscribed to.
        logger.warn(
          { type: event.type },
          "unknown runtime event type, not published",
        );
        continue;
      }

      await this.events.publish(
        createEvent({
          type: event.type,
          source: "scheduler",
          workspaceId,
          correlationId: executionId,
          executionId: event.executionId,
          taskId: event.taskId ?? null,
          payload: redactPayload(event.payload),
        }),
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { withCorrelation };
