import {
  newId,
  type ExecutionId,
  type Metadata,
  type TaskId,
} from "@repo/core";
import { RuntimeError, classify, isRetryable } from "../errors/taxonomy";
import type { Execution } from "../model/execution";
import type { Goal } from "../model/goal";
import { canRetry, retryDelayMs, type Task } from "../model/task";
import type {
  CapabilityRegistry,
  IntentAnalyzer,
  Planner,
  PolicyEvaluator,
  TaskQueue,
} from "../ports";
import type {
  ExecutionRepository,
  GoalRepository,
  TaskRepository,
} from "../ports/repositories";
import { isApprovalRequired } from "../policy/approval";
import { canTransitionExecution } from "../state/execution-state";
import { enqueueReadyTasks } from "./enqueue";
import type { CapabilityExecutor } from "./capabilities";

/**
 * Emitted by the engine so the caller can publish them. The engine does not
 * depend on @repo/event: it reports what happened, and the service layer
 * decides where that goes.
 */
export type EngineEvent = {
  type: string;
  executionId: ExecutionId;
  taskId?: TaskId;
  payload: Metadata;
};

export type EngineDeps = {
  goals: GoalRepository;
  executions: ExecutionRepository;
  tasks: TaskRepository;
  queue: TaskQueue;
  intentAnalyzer: IntentAnalyzer;
  planner: Planner;
  capabilities: CapabilityRegistry;
  capabilityExecutor: CapabilityExecutor;
  policy?: PolicyEvaluator;
  now?: () => Date;
};

/**
 * Drives one Execution from CREATED to a terminal state.
 *
 * Every state change goes through the repository's compare-and-swap, so two
 * engine instances racing on the same Execution cannot both advance it — the
 * loser simply gets null and stops.
 */
export class ExecutionEngine {
  private readonly now: () => Date;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Validate → plan → enqueue. Turns a natural-language Goal into queued work.
   * Returns the events that occurred so the caller can publish them.
   */
  async prepare(execution: Execution, goal: Goal): Promise<EngineEvent[]> {
    const events: EngineEvent[] = [];

    const validating = await this.transition(
      execution,
      "CREATED",
      "VALIDATING",
    );
    if (!validating) return events;

    let planning: Execution | null;
    try {
      planning = await this.transition(validating, "VALIDATING", "PLANNING");
      if (!planning) return events;

      const intents = await this.deps.intentAnalyzer.analyze(
        goal,
        execution.id,
      );
      events.push({
        type: "IntentResolved",
        executionId: execution.id,
        payload: {
          count: intents.length,
          types: intents.map((intent) => intent.type),
        },
      });

      const plan = await this.deps.planner.plan({
        execution: planning,
        goal,
        intents,
      });

      // Policy is evaluated per capability before anything is queued, so a
      // denied run costs nothing and never half-executes.
      if (this.deps.policy) {
        for (const task of plan.tasks) {
          const decision = await this.deps.policy.evaluate({
            workspaceId: execution.workspaceId,
            execution: planning,
            goal,
            capabilityId: task.capability,
            estimatedCostUsd: plan.estimatedCostUsd,
          });

          if (decision.outcome === "DENY") {
            events.push({
              type: "PolicyDenied",
              executionId: execution.id,
              payload: { capability: task.capability, reason: decision.reason },
            });
            await this.fail(
              planning,
              `Policy denied ${task.capability}: ${decision.reason}`,
            );
            return events;
          }
        }
      }

      const withPlan = await this.deps.executions.attachPlan(
        execution.id,
        plan,
        planning.version,
      );
      if (!withPlan) return events;

      await this.deps.tasks.createMany(plan.tasks);

      events.push({
        type: "PlanningCompleted",
        executionId: execution.id,
        payload: {
          taskCount: plan.tasks.length,
          estimatedMs: plan.estimatedDurationMs,
        },
      });

      const ready = await this.transition(withPlan, "PLANNING", "READY");
      if (!ready) return events;

      const scheduled = await this.transition(ready, "READY", "SCHEDULED");
      if (!scheduled) return events;

      const running = await this.transition(scheduled, "SCHEDULED", "RUNNING", {
        startedAt: this.now(),
      });
      if (!running) return events;

      events.push({
        type: "ExecutionStarted",
        executionId: execution.id,
        payload: {},
      });
      events.push(...(await this.enqueueReadyTasks(execution.id)));
    } catch (error) {
      // Planning failures are terminal for this run: a plan that cannot be
      // built will not build itself on a retry of the same input.
      const message = error instanceof Error ? error.message : String(error);
      events.push({
        type: "PlanningFailed",
        executionId: execution.id,
        payload: { reason: message, errorClass: classify(error) },
      });

      const current = await this.deps.executions.findById(execution.id);
      if (current) await this.fail(current, message);
    }

    return events;
  }

  /**
   * Move every task whose dependencies are satisfied onto the queue.
   * Called after planning and after each task completes.
   */
  async enqueueReadyTasks(executionId: ExecutionId): Promise<EngineEvent[]> {
    return enqueueReadyTasks(this.deps, executionId);
  }

  /**
   * Run one reserved task and record the outcome.
   *
   * Returns the events that occurred. The caller is responsible for acking or
   * releasing the queue entry based on `settled`.
   */
  async runTask(
    taskId: TaskId,
  ): Promise<{ events: EngineEvent[]; settled: boolean }> {
    const events: EngineEvent[] = [];
    const task = await this.deps.tasks.findById(taskId);

    if (!task) {
      // The task vanished (execution purged); ack it so the queue stops
      // handing back work that no longer exists.
      return { events, settled: true };
    }

    if (task.status === "COMPLETED" || task.status === "CANCELLED") {
      // At-least-once delivery means we can legitimately see this twice.
      return { events, settled: true };
    }

    // Re-check policy with what has actually been spent, not the plan-time
    // estimate. A plan approved when it was cheap can still drift past its
    // budget by the fifth task, and that is exactly when nobody is watching.
    const blocked = await this.checkPolicyBeforeRun(task);
    if (blocked) {
      events.push(blocked.event);
      return { events, settled: true };
    }

    const started = await this.deps.tasks.transitionStatus({
      id: task.id,
      expectedStatus: task.status === "RETRY" ? "RETRY" : "READY",
      status: "RUNNING",
      startedAt: this.now(),
    });

    if (!started) {
      // Lost the race to another worker — do not run it twice.
      return { events, settled: true };
    }

    events.push({
      type: "TaskStarted",
      executionId: task.executionId,
      taskId: task.id,
      payload: { capability: task.capability, attempt: started.attempt },
    });

    try {
      const previous = await this.collectDependencyOutputs(task);
      // One primary-key read, so a capability doing real work can attribute
      // what it does — an AI call has to be metered against a user and a
      // request, and both live on the Execution rather than the Task.
      const execution = await this.deps.executions.findById(task.executionId);

      const outputs = await this.deps.capabilityExecutor.execute(
        task.capability,
        {
          inputs: task.inputs,
          previous,
          attempt: started.attempt,
          workspaceId: task.workspaceId,
          executionId: task.executionId,
          taskId: task.id,
          ownerId: execution?.ownerId ?? null,
          correlationId: execution?.correlationId ?? "unknown",
        },
        task.timeoutMs,
      );

      // SUCCESS then COMPLETED: the split marks the window where the worker
      // returned but the result is not yet durable.
      const success = await this.deps.tasks.transitionStatus({
        id: task.id,
        expectedStatus: "RUNNING",
        status: "SUCCESS",
        outputs,
      });
      if (!success) return { events, settled: true };

      await this.deps.tasks.transitionStatus({
        id: task.id,
        expectedStatus: "SUCCESS",
        status: "COMPLETED",
        finishedAt: this.now(),
      });

      events.push({
        type: "TaskCompleted",
        executionId: task.executionId,
        taskId: task.id,
        payload: { capability: task.capability },
      });

      return { events, settled: true };
    } catch (error) {
      // A capability asking for a person is not a failure. Routing it through
      // the error path would retry it three times and dead-letter a task that
      // is behaving exactly as designed.
      if (isApprovalRequired(error)) {
        return {
          events: [
            ...events,
            ...(await this.suspendForApproval(
              started,
              error.summary,
              error.message,
            )),
          ],
          // Acked: the queue must not hand this back. It resumes only when a
          // person decides, and a redelivery would ask them twice.
          settled: true,
        };
      }

      return {
        events: [...events, ...(await this.handleTaskFailure(started, error))],
        settled: false,
      };
    }
  }

  /** Park a task, and its Execution, until someone decides. */
  private async suspendForApproval(
    task: Task,
    summary: Metadata,
    reason: string,
  ): Promise<EngineEvent[]> {
    const events: EngineEvent[] = [];

    const waiting = await this.deps.tasks.transitionStatus({
      id: task.id,
      expectedStatus: "RUNNING",
      status: "WAITING",
      outputs: { ...summary, awaitingApproval: true, reason },
    });
    if (!waiting) return events;

    const execution = await this.deps.executions.findById(task.executionId);
    if (execution && canTransitionExecution(execution.status, "WAITING")) {
      await this.deps.executions.transitionStatus({
        id: execution.id,
        expectedVersion: execution.version,
        expectedStatus: execution.status,
        status: "WAITING",
      });
    }

    events.push({
      type: "ApprovalRequested",
      executionId: task.executionId,
      taskId: task.id,
      payload: { capability: task.capability, reason, ...summary },
    });

    return events;
  }

  private async handleTaskFailure(
    task: Task,
    error: unknown,
  ): Promise<EngineEvent[]> {
    const events: EngineEvent[] = [];
    const message = error instanceof Error ? error.message : String(error);
    const attempt = task.attempt + 1;

    const failed = await this.deps.tasks.transitionStatus({
      id: task.id,
      expectedStatus: "RUNNING",
      status: "FAILED",
      lastError: message,
      attempt,
      finishedAt: this.now(),
    });

    events.push({
      type: "TaskFailed",
      executionId: task.executionId,
      taskId: task.id,
      payload: { reason: message, attempt, errorClass: classify(error) },
    });

    if (!failed) return events;

    const retryable =
      isRetryable(error) &&
      canRetry({ attempt, retryPolicy: task.retryPolicy });

    if (!retryable) {
      // Out of attempts, or an error class that retrying cannot fix.
      await this.deps.queue.deadLetter(task.id, message);
      events.push({
        type: "DeadLetterCreated",
        executionId: task.executionId,
        taskId: task.id,
        payload: { reason: message, attempt },
      });

      const execution = await this.deps.executions.findById(task.executionId);
      if (execution)
        await this.fail(
          execution,
          `Task ${task.capability} failed: ${message}`,
        );

      return events;
    }

    const retried = await this.deps.tasks.transitionStatus({
      id: task.id,
      expectedStatus: "FAILED",
      status: "RETRY",
    });
    if (!retried) return events;

    const delay = retryDelayMs(task.retryPolicy, attempt);
    await this.deps.queue.release(task.id, delay);

    events.push({
      type: "TaskRetryScheduled",
      executionId: task.executionId,
      taskId: task.id,
      payload: { attempt, delayMs: delay },
    });

    return events;
  }

  /**
   * Advance the Execution when its plan is finished. Called after each task
   * settles.
   */
  async settleExecution(executionId: ExecutionId): Promise<EngineEvent[]> {
    const events: EngineEvent[] = [];
    const execution = await this.deps.executions.findById(executionId);
    if (!execution || execution.status !== "RUNNING") return events;

    const tasks = await this.deps.tasks.listByExecution(executionId);
    const done = tasks.every(
      (task) => task.status === "COMPLETED" || task.status === "CANCELLED",
    );

    if (!done) {
      // More work may have become dispatchable now that a dependency finished.
      return this.enqueueReadyTasks(executionId);
    }

    const outputs = Object.fromEntries(
      tasks
        .filter((task) => task.outputs !== null)
        .map((task) => [task.capability, task.outputs as Metadata]),
    );

    const completed = await this.deps.executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "RUNNING",
      status: "COMPLETED",
      finishedAt: this.now(),
      outputs,
    });

    if (completed) {
      events.push({
        type: "ExecutionCompleted",
        executionId,
        payload: { taskCount: tasks.length },
      });
    }

    return events;
  }

  /** Outputs of a task's dependencies, keyed by capability for interpolation. */
  /**
   * Ask policy whether this task may still run.
   *
   * Returns the event to publish when it may not, and null when it may. The
   * whole execution is failed rather than only the task: a run that has
   * exhausted its budget should stop, not grind through the remaining steps
   * being denied one at a time.
   */
  private async checkPolicyBeforeRun(
    task: Task,
  ): Promise<{ event: EngineEvent } | null> {
    if (!this.deps.policy) return null;

    const execution = await this.deps.executions.findById(task.executionId);
    if (!execution) return null;

    const goal = await this.deps.goals.findById(execution.goalId);
    if (!goal) return null;

    const decision = await this.deps.policy.evaluate({
      workspaceId: task.workspaceId,
      execution,
      goal,
      capabilityId: task.capability,
      // What this one step is expected to cost, not the whole plan: the
      // question being asked is whether to take the next step. Unknown costs
      // count as zero, so the "already spent" check remains the real guard.
      estimatedCostUsd:
        this.deps.capabilities.get(task.capability)?.estimatedCostUsd ?? 0,
    });

    if (decision.outcome !== "DENY") return null;

    await this.deps.tasks.transitionStatus({
      id: task.id,
      expectedStatus: task.status,
      status: "CANCELLED",
      lastError: decision.reason,
    });
    await this.fail(
      execution,
      `Policy denied ${task.capability}: ${decision.reason}`,
    );

    return {
      event: {
        type: "PolicyDenied",
        executionId: execution.id,
        taskId: task.id,
        payload: {
          capability: task.capability,
          reason: decision.reason,
          code: decision.code,
        },
      },
    };
  }

  private async collectDependencyOutputs(
    task: Task,
  ): Promise<Record<string, Metadata>> {
    if (task.dependencies.length === 0) return {};

    const siblings = await this.deps.tasks.listByExecution(task.executionId);
    const byId = new Map(siblings.map((sibling) => [sibling.id, sibling]));

    const previous: Record<string, Metadata> = {};
    for (const dependencyId of task.dependencies) {
      const dependency = byId.get(dependencyId);
      if (dependency?.outputs)
        previous[dependency.capability] = dependency.outputs;
    }

    return previous;
  }

  private async transition(
    execution: Execution,
    from: Execution["status"],
    to: Execution["status"],
    extra: { startedAt?: Date; finishedAt?: Date } = {},
  ): Promise<Execution | null> {
    if (!canTransitionExecution(from, to)) {
      throw new RuntimeError(
        "EXECUTION",
        `Illegal execution transition ${from} → ${to}.`,
        {
          context: { executionId: execution.id, from, to },
        },
      );
    }

    return this.deps.executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: from,
      status: to,
      ...extra,
    });
  }

  private async fail(execution: Execution, reason: string): Promise<void> {
    if (!canTransitionExecution(execution.status, "FAILED")) return;

    await this.deps.executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: execution.status,
      status: "FAILED",
      failureReason: reason,
      finishedAt: this.now(),
    });
  }
}

/** Convenience for building an Execution row from a Goal. */
export function newExecutionFor(goal: Goal, correlationId: string): Execution {
  return {
    id: newId("execution"),
    goalId: goal.id,
    workspaceId: goal.workspaceId,
    ownerId: goal.ownerId,
    status: "CREATED",
    priority: goal.priority,
    plan: null,
    outputs: null,
    failureReason: null,
    correlationId,
    startedAt: null,
    finishedAt: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: goal.ownerId,
    updatedBy: null,
    version: 1,
  };
}
