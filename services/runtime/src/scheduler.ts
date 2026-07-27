import { createLogger, withCorrelation } from "@repo/logger";
import type { SchedulerLock } from "@repo/runtime";
import { newExecutionFor, nextRunAfterFiring } from "@repo/runtime";
import type {
  EngineEvent,
  ExecutionEngine,
  ExecutionRepository,
  GoalRepository,
  TaskQueue,
} from "@repo/runtime";
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
  /** How often to look for recurring Goals that have come due. */
  scheduleIntervalMs?: number;
  /** How many due Goals one sweep may fire. */
  scheduleBatchSize?: number;
  /** Lock TTL — must exceed a tick, or two nodes could overlap. */
  lockTtlMs?: number;
};

const DEFAULTS = {
  batchSize: 10,
  idleDelayMs: 250,
  recoverIntervalMs: 10_000,
  lockTtlMs: 30_000,
  // Cron granularity is one minute, so checking every five seconds is already
  // far tighter than any schedule can express.
  scheduleIntervalMs: 5_000,
  scheduleBatchSize: 20,
} as const;

const DISPATCH_LOCK = "dispatch";
const SCHEDULE_LOCK = "schedule";

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
  private lastScheduleSweepAt = 0;

  constructor(
    private readonly engine: ExecutionEngine,
    private readonly queue: TaskQueue,
    private readonly lock: SchedulerLock,
    private readonly events: EventPublisher,
    options: SchedulerOptions = {},
    /**
     * Optional so the engine can be driven manually in tests. In production
     * these are supplied so the scheduler also picks up newly submitted
     * Executions.
     */
    private readonly preparation?: {
      executions: ExecutionRepository;
      goals: GoalRepository;
    },
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

    // Fire recurring Goals that have come due, so their new Executions are
    // waiting for the preparation step below.
    const fired = await this.fireDueSchedules();

    // Plan anything the API submitted since the last tick, so queued work
    // exists to claim below.
    const prepared = await this.prepareNewExecutions();

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

    if (tasks.length === 0) return prepared || fired;

    for (const queued of tasks) {
      await this.runOne(queued.taskId, queued.executionId, queued.workspaceId);
    }

    return true;
  }

  /**
   * Create a fresh Execution for every recurring Goal that has come due.
   *
   * A cron fire always makes a NEW Execution and never reuses the previous
   * one, per docs/kernel/02_EXECUTION_MODEL.md — yesterday's run keeps its own
   * history, its own cost, and its own outcome.
   */
  private async fireDueSchedules(): Promise<boolean> {
    if (!this.preparation) return false;

    const now = Date.now();
    if (now - this.lastScheduleSweepAt < this.options.scheduleIntervalMs) {
      return false;
    }
    this.lastScheduleSweepAt = now;

    // The lock only reduces contention; claimSchedule's compare-and-swap is
    // what actually prevents two nodes firing the same occurrence.
    const claimed = await this.lock.acquire(
      SCHEDULE_LOCK,
      this.options.lockTtlMs,
    );
    if (!claimed) return false;

    let due: readonly {
      id: string;
      schedule: unknown;
      nextRunAt: Date | null;
    }[];
    try {
      due = await this.preparation.goals.listDueSchedules(
        new Date(now),
        this.options.scheduleBatchSize,
      );
    } finally {
      await this.lock.release(SCHEDULE_LOCK);
    }

    let firedAny = false;
    for (const goal of due) {
      if (await this.fireOne(goal.id)) firedAny = true;
    }

    return firedAny;
  }

  private async fireOne(goalId: string): Promise<boolean> {
    if (!this.preparation) return false;

    const goal = await this.preparation.goals.findById(goalId as never);
    if (!goal?.schedule || !goal.nextRunAt) return false;

    const firedAt = new Date();
    let next: Date | null;
    try {
      next = nextRunAfterFiring(goal.schedule, firedAt);
    } catch (error) {
      // An unschedulable expression would otherwise be retried every sweep
      // forever. Clearing nextRunAt stops the loop and leaves the schedule on
      // the Goal so it is visible and fixable.
      logger.error(
        { err: error, goalId, cron: goal.schedule.cron },
        "goal has an invalid schedule; disabling it",
      );
      await this.preparation.goals.setNextRunAt(goal.id, null);
      return false;
    }

    const claimedGoal = await this.preparation.goals.claimSchedule({
      id: goal.id,
      dueAt: firedAt,
      nextRunAt: next,
      firedAt,
    });
    // Another node claimed this occurrence first.
    if (!claimedGoal) return false;

    const execution = await this.preparation.executions.create(
      newExecutionFor(goal, `cron_${goal.id}_${goal.nextRunAt.getTime()}`),
    );

    logger.info(
      { goalId: goal.id, executionId: execution.id, nextRunAt: next },
      "fired scheduled goal",
    );
    return true;
  }

  /**
   * Turn newly submitted Executions into queued work.
   *
   * The API writes a CREATED row and returns immediately; planning happens
   * here because from Phase 2 it involves an LLM call, and an HTTP request
   * must not block on that.
   */
  private async prepareNewExecutions(): Promise<boolean> {
    if (!this.preparation) return false;

    const pending = await this.preparation.executions.listPendingPreparation(
      this.options.batchSize,
    );
    if (pending.length === 0) return false;

    for (const execution of pending) {
      const goal = await this.preparation.goals.findByIdForUser(
        execution.goalId,
        execution.ownerId,
      );

      if (!goal) {
        logger.error(
          { executionId: execution.id, goalId: execution.goalId },
          "execution references a goal that no longer exists",
        );
        continue;
      }

      const events = await this.engine.prepare(execution, goal);
      await this.publish(events, execution.workspaceId, execution.id);
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
