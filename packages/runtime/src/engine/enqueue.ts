import type { ExecutionId, Metadata, TaskId } from "@repo/core";
import type { TaskQueue } from "../ports";
import type { TaskRepository } from "../ports/repositories";

/** Emitted so the caller can publish; see ExecutionEngine for the rationale. */
export type QueueEvent = {
  type: string;
  executionId: ExecutionId;
  taskId?: TaskId;
  payload: Metadata;
};

export type EnqueueDeps = {
  tasks: TaskRepository;
  queue: TaskQueue;
};

/**
 * Move every task whose dependencies are satisfied onto the queue.
 *
 * A free function rather than a method because two callers need it and neither
 * should have to build the other's dependencies: the engine runs it after
 * planning and after each task, and the approval gate runs it after a person
 * says yes. Duplicating it would let the two drift, and "ready" drifting is how
 * a task runs before its input exists.
 */
export async function enqueueReadyTasks(
  deps: EnqueueDeps,
  executionId: ExecutionId,
): Promise<QueueEvent[]> {
  const events: QueueEvent[] = [];
  const tasks = await deps.tasks.listByExecution(executionId);
  const completed = new Set(
    tasks.filter((task) => task.status === "COMPLETED").map((task) => task.id),
  );

  for (const task of tasks) {
    if (task.status !== "PENDING") continue;
    // Dependencies must be COMPLETED, not merely SUCCESS — see task-state.ts.
    if (!task.dependencies.every((dependency) => completed.has(dependency)))
      continue;

    const ready = await deps.tasks.transitionStatus({
      id: task.id,
      expectedStatus: "PENDING",
      status: "READY",
    });
    if (!ready) continue; // Another engine got there first.

    await deps.queue.enqueue({
      taskId: task.id,
      executionId,
      workspaceId: task.workspaceId,
      capability: task.capability,
      priority: task.priority,
      notBefore: Date.now(),
      attempt: task.attempt,
    });

    events.push({
      type: "TaskQueued",
      executionId,
      taskId: task.id,
      payload: { capability: task.capability },
    });
  }

  return events;
}
