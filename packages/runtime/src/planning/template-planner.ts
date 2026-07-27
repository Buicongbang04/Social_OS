import { newId, type Metadata, type TaskId } from "@repo/core";
import { RuntimeError } from "../errors/taxonomy";
import type { Execution, ExecutionPlan } from "../model/execution";
import type { Goal } from "../model/goal";
import {
  capabilityForIntent,
  type Intent,
  type IntentType,
} from "../model/intent";
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_TASK_TIMEOUT_MS,
  type Task,
  type TaskPriority,
} from "../model/task";
import type { CapabilityRegistry, Planner } from "../ports";
import { parallelGroups, validateDag } from "./dag";

/**
 * Deterministic Planning Engine for Phase 1.
 *
 * Turns Intents into a DAG using a fixed ordering of stages rather than an LLM.
 * The ordering below is the doc's own worked example
 * (docs/kernel/06_PLANNING_ENGINE.md): research feeds content, content feeds
 * image and SEO, everything feeds approval, approval gates publishing.
 *
 * Because dependencies come from stage order rather than model output, a plan
 * is reproducible — the same Goal yields the same DAG every time, which is
 * what makes the scheduler testable.
 */

/**
 * Lower stage runs first. Intents in the same stage are independent of each
 * other and will be scheduled in parallel.
 */
const STAGE: Readonly<Record<IntentType, number>> = Object.freeze({
  RESEARCH: 0,
  KNOWLEDGE: 0,
  MEMORY: 0,
  GENERATE_CONTENT: 1,
  CHAT: 1,
  GENERATE_IMAGE: 2,
  GENERATE_VIDEO: 2,
  ANALYTICS: 2,
  APPROVAL: 3,
  PUBLISH: 4,
  NOTIFICATION: 5,
  AUTOMATION: 5,
  SCHEDULE: 5,
});

/** Rough per-capability estimates from the doc's duration table. */
const DURATION_MS: Readonly<Record<string, number>> = Object.freeze({
  "research.trend": 20_000,
  "content.generate": 35_000,
  "media.generate-image": 45_000,
  "media.generate-video": 120_000,
  "social.publish": 5_000,
  "approval.request": 0,
  "notification.send": 2_000,
  "analytics.report": 10_000,
});

const DEFAULT_DURATION_MS = 15_000;

export class TemplatePlanner implements Planner {
  constructor(private readonly capabilities: CapabilityRegistry) {}

  async plan(input: {
    execution: Execution;
    goal: Goal;
    intents: readonly Intent[];
  }): Promise<ExecutionPlan> {
    const { execution, goal, intents } = input;

    // CHAT maps to no capability; an all-CHAT goal produces no work to schedule.
    const actionable = intents.filter(
      (intent) => capabilityForIntent(intent.type) !== null,
    );

    if (actionable.length === 0) {
      throw new RuntimeError(
        "PLANNING",
        "No actionable intent was found in this goal — nothing to execute.",
        {
          context: { goalId: goal.id, intentTypes: intents.map((i) => i.type) },
        },
      );
    }

    const sorted = [...actionable].sort(
      (a, b) => STAGE[a.type] - STAGE[b.type],
    );

    const tasks: Task[] = [];
    // Ids produced by the previous stage, which the next stage depends on.
    let previousStageIds: TaskId[] = [];
    let currentStage = STAGE[sorted[0]!.type];
    let currentStageIds: TaskId[] = [];

    for (const intent of sorted) {
      const stage = STAGE[intent.type];

      // Crossing a stage boundary: everything from here depends on the stage
      // that just closed.
      if (stage !== currentStage) {
        previousStageIds = currentStageIds;
        currentStageIds = [];
        currentStage = stage;
      }

      const capabilityId = capabilityForIntent(intent.type)!;
      this.assertCapabilityAvailable(capabilityId, goal);

      const task = this.buildTask({
        execution,
        goal,
        intent,
        capabilityId,
        dependencies: previousStageIds,
      });

      tasks.push(task);
      currentStageIds.push(task.id);
    }

    // Fails loudly on a cycle or dangling dependency rather than handing the
    // scheduler a plan that can never finish.
    validateDag(tasks);

    return {
      id: newId("event"),
      executionId: execution.id,
      tasks,
      dependencyGraph: Object.fromEntries(
        tasks.map((task) => [task.id, task.dependencies]),
      ),
      estimatedDurationMs: estimateDuration(tasks),
      estimatedCostUsd: 0, // No metered provider until Phase 2.
      metadata: { planner: "template", intentCount: intents.length },
    };
  }

  private assertCapabilityAvailable(capabilityId: string, goal: Goal): void {
    if (this.capabilities.has(capabilityId)) return;

    // The doc's own failure mode: CapabilityNotFound, escalated rather than
    // silently dropped, so the user learns which step is unsupported.
    throw new RuntimeError(
      "PLANNING",
      `Capability "${capabilityId}" is not registered.`,
      {
        context: { capabilityId, goalId: goal.id },
      },
    );
  }

  private buildTask(input: {
    execution: Execution;
    goal: Goal;
    intent: Intent;
    capabilityId: string;
    dependencies: readonly TaskId[];
  }): Task {
    const { execution, goal, intent, capabilityId, dependencies } = input;
    const descriptor = this.capabilities.get(capabilityId);

    const inputs: Metadata = {
      objective: goal.objective,
      action: intent.action,
      ...intent.entities,
    };

    return {
      id: newId("task"),
      executionId: execution.id,
      capability: capabilityId,
      workerId: null, // The Worker Dispatcher decides this at dispatch time.
      inputs,
      outputs: null,
      dependencies,
      timeoutMs: descriptor?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
      retryPolicy: {
        ...DEFAULT_RETRY_POLICY,
        // A Goal-level retry constraint overrides the capability default.
        maxAttempts: goal.constraints.retry ?? DEFAULT_RETRY_POLICY.maxAttempts,
      },
      priority: toTaskPriority(goal.priority),
      status: "PENDING",
      attempt: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      metadata: { intentType: intent.type, confidence: intent.confidence },
    };
  }
}

function toTaskPriority(goalPriority: Goal["priority"]): TaskPriority {
  return goalPriority;
}

/**
 * Duration of the critical path, not the sum: tasks in the same wave run
 * concurrently, so summing everything would badly overestimate.
 */
function estimateDuration(tasks: readonly Task[]): number {
  return parallelGroups(tasks).reduce((total, wave) => {
    const slowest = Math.max(
      ...wave.map(
        (task) => DURATION_MS[task.capability] ?? DEFAULT_DURATION_MS,
      ),
    );
    return total + slowest;
  }, 0);
}
