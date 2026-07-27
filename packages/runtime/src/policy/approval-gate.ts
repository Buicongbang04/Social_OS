import type { ExecutionId, TaskId } from "@repo/core";
import { enqueueReadyTasks, type QueueEvent } from "../engine/enqueue";
import type { TaskQueue } from "../ports";
import type {
  ExecutionRepository,
  TaskRepository,
} from "../ports/repositories";
import type { ApprovalDecision } from "./approval";

export type ApprovalGateDeps = {
  executions: ExecutionRepository;
  tasks: TaskRepository;
  queue: TaskQueue;
  now?: () => Date;
};

/**
 * Records a person's decision on a run that is waiting for one.
 *
 * Separate from ExecutionEngine because the decision arrives over HTTP, and
 * services/api has repositories and a queue but no capability executor,
 * planner or intent analyzer. Building a whole engine there just to reach one
 * method would mean wiring dependencies that must never be used — and the day
 * one of them is used by accident, the API starts planning.
 */
export class ApprovalGate {
  private readonly now: () => Date;

  constructor(private readonly deps: ApprovalGateDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Approving completes the waiting task so its dependents become ready.
   * Rejecting cancels the run outright: "do not publish this" has to mean the
   * steps after it do not happen either.
   */
  async decide(input: {
    executionId: ExecutionId;
    decision: ApprovalDecision;
    /** Who decided. Recorded on the task so the trail names a person. */
    actorId: string;
    note?: string;
  }): Promise<QueueEvent[]> {
    const events: QueueEvent[] = [];
    const execution = await this.deps.executions.findById(input.executionId);

    // Not WAITING: either nothing is pending, or someone else already decided.
    // Silently doing nothing beats double-applying a decision.
    if (!execution || execution.status !== "WAITING") return events;

    const tasks = await this.deps.tasks.listByExecution(input.executionId);
    const waiting = tasks.filter((task) => task.status === "WAITING");
    if (waiting.length === 0) return events;

    return input.decision === "REJECTED"
      ? this.reject(execution.id, execution.version, waiting, input)
      : this.approve(execution.id, execution.version, waiting, input);
  }

  private async reject(
    executionId: ExecutionId,
    version: number,
    waiting: { id: TaskId }[],
    input: { actorId: string; note?: string },
  ): Promise<QueueEvent[]> {
    for (const task of waiting) {
      await this.deps.tasks.transitionStatus({
        id: task.id,
        expectedStatus: "WAITING",
        status: "CANCELLED",
        lastError: input.note ?? "Rejected by approver.",
      });
    }

    const cancelling = await this.deps.executions.transitionStatus({
      id: executionId,
      expectedVersion: version,
      expectedStatus: "WAITING",
      status: "CANCELLING",
    });

    if (cancelling) {
      await this.deps.executions.transitionStatus({
        id: cancelling.id,
        expectedVersion: cancelling.version,
        expectedStatus: "CANCELLING",
        status: "CANCELLED",
        finishedAt: this.now(),
      });
    }

    return [
      {
        type: "ApprovalRejected",
        executionId,
        payload: { actorId: input.actorId, note: input.note ?? null },
      },
    ];
  }

  private async approve(
    executionId: ExecutionId,
    version: number,
    waiting: { id: TaskId }[],
    input: { actorId: string; note?: string },
  ): Promise<QueueEvent[]> {
    for (const task of waiting) {
      // Back through RUNNING: WAITING has no direct edge to SUCCESS, and
      // widening the state machine to add one would let a task reach SUCCESS
      // without ever having run.
      const resumed = await this.deps.tasks.transitionStatus({
        id: task.id,
        expectedStatus: "WAITING",
        status: "RUNNING",
      });
      if (!resumed) continue;

      const success = await this.deps.tasks.transitionStatus({
        id: task.id,
        expectedStatus: "RUNNING",
        status: "SUCCESS",
        outputs: {
          approved: true,
          approvedBy: input.actorId,
          note: input.note ?? null,
        },
      });
      if (!success) continue;

      await this.deps.tasks.transitionStatus({
        id: task.id,
        expectedStatus: "SUCCESS",
        status: "COMPLETED",
        finishedAt: this.now(),
      });
    }

    const running = await this.deps.executions.transitionStatus({
      id: executionId,
      expectedVersion: version,
      expectedStatus: "WAITING",
      status: "RUNNING",
    });
    if (!running) return [];

    return [
      {
        type: "ApprovalGranted",
        executionId,
        payload: { actorId: input.actorId },
      },
      ...(await enqueueReadyTasks(this.deps, executionId)),
    ];
  }
}
