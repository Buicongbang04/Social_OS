import { newId, type Metadata, type TaskId } from "@repo/core";
import {
  DEFAULT_RETRY_POLICY,
  DEFAULT_TASK_TIMEOUT_MS,
  RuntimeError,
  parallelGroups,
  validateDag,
  type CapabilityRegistry,
  type Execution,
  type ExecutionPlan,
  type Goal,
  type Intent,
  type Planner,
  type Task,
} from "@repo/runtime";
import { z } from "zod";
import type { ProviderGateway } from "../provider/gateway";
import { structured } from "../provider/structured";
import {
  recordUsageSafely,
  usageRecordFrom,
  type AiUsageRecord,
  type AiUsageRecorder,
} from "../usage/recorder";
import { enforceDataFlow } from "./data-flow";
import { createDefaultPromptRegistry } from "../prompt/builtin";
import { planUserPrompt } from "./prompts";

/** Rendered once: a system prompt has no variables. See the intent analyzer. */
const PLAN_PROMPT = createDefaultPromptRegistry().render("plan.system");


const planSchema = z.object({
  steps: z
    .array(
      z.object({
        capability: z.string().min(1).max(80),
        description: z.string().max(300),
        inputs: z.record(
          z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
        ),
        /**
         * Indices into this same array, and only ever pointing backwards.
         *
         * That single constraint is what makes a cycle structurally
         * impossible rather than merely detected afterwards: a graph whose
         * every edge points to a lower index cannot contain one. `validateDag`
         * still runs as a second check, but this is the reason a model can be
         * trusted to emit dependencies at all.
         */
        dependsOn: z.array(z.number().int().min(0)).max(12),
      }),
    )
    .min(1)
    .max(20),
});

export type LlmPlannerOptions = {
  gateway: ProviderGateway;
  capabilities: CapabilityRegistry;
  recorder: AiUsageRecorder;
  model?: string;
  temperature?: number;
  onUsageError?: (error: unknown, record: AiUsageRecord) => void;
};

/**
 * Planning Engine backed by a model.
 *
 * The model chooses which capabilities to run, in what order, and with what
 * inputs. What it is not allowed to do is invent a capability, point a
 * dependency forward, or produce a graph the scheduler cannot finish — each of
 * those is rejected here rather than discovered by a worker at 3am.
 *
 * Compared with TemplatePlanner this buys two things a fixed stage table
 * cannot: task inputs specific to the request rather than a copy of the
 * objective, and an ordering that fits the actual goal instead of one
 * hard-coded ordering for all goals.
 */
export class LlmPlanner implements Planner {
  private static readonly schema = structured(
    "execution_plan",
    planSchema,
    "Các bước thực thi và quan hệ phụ thuộc giữa chúng.",
  );

  constructor(private readonly options: LlmPlannerOptions) {}

  async plan(input: {
    execution: Execution;
    goal: Goal;
    intents: readonly Intent[];
  }): Promise<ExecutionPlan> {
    const { execution, goal, intents } = input;
    // Internal capabilities are registered but never offered: they exist to
    // exercise the runtime, and a model given "Flaky Once" next to "Generate
    // Content" will eventually choose it — which it did, in a real plan.
    const available = this.options.capabilities
      .list()
      .filter((capability) => !capability.internal);

    if (available.length === 0) {
      throw new RuntimeError(
        "PLANNING",
        "No capabilities are registered, so no plan can be executed.",
        { retryable: false, context: { goalId: goal.id } },
      );
    }

    const response = await this.options.gateway
      .generateObject(
        {
          ...(this.options.model === undefined
            ? {}
            : { model: this.options.model }),
          temperature: this.options.temperature ?? 0.1,
          messages: [
            { role: "system", content: PLAN_PROMPT.text },
            {
              role: "user",
              content: planUserPrompt({
                objective: goal.objective,
                intents: intents.map((intent) => ({
                  type: intent.type,
                  action: intent.action,
                  entities: intent.entities,
                })),
                capabilities: available.map((c) => ({
                  id: c.id,
                  name: c.name,
                  category: c.category,
                  // Without this the model sees only an id and a two-word
                  // name and has to guess what each step does — and a wrong
                  // guess is a whole plan built around the wrong capability.
                  ...(c.description ? { description: c.description } : {}),
                })),
              }),
            },
          ],
          metadata: {
            operation: "plan.build",
            promptVersion: PLAN_PROMPT.version,
          },
        },
        LlmPlanner.schema,
      )
      .catch((error: unknown) => {
        throw new RuntimeError(
          "PLANNING",
          `Could not build a plan for this goal: ${error instanceof Error ? error.message : String(error)}`,
          {
            // Not retried blind: the gateway has already retried the call and
            // exhausted its fallbacks, so repeating it here would just spend
            // more money on the same failure.
            retryable: false,
            context: { goalId: goal.id, executionId: execution.id },
            cause: error,
          },
        );
      });

    await recordUsageSafely(
      this.options.recorder,
      usageRecordFrom(response, {
        workspaceId: goal.workspaceId,
        userId: goal.ownerId,
        executionId: execution.id,
        correlationId: execution.correlationId,
        operation: "plan.build",
      }),
      this.options.onUsageError,
    );

    const declared = response.object.steps.map((step) => ({
      ...step,
      dependsOn: step.dependsOn ?? [],
    }));

    // Checked against the order the MODEL produced, before any reordering. A
    // forward or self reference is a broken plan and has always been refused;
    // letting enforceDataFlow quietly drop it instead would turn a loud
    // failure into a silent one.
    declared.forEach((step, index) => {
      for (const dependency of step.dependsOn) {
        if (dependency >= index) {
          throw new RuntimeError(
            "PLANNING",
            `Step ${index + 1} depends on step ${dependency + 1}, which does not run before it.`,
            {
              retryable: false,
              context: { step: index, dependsOn: dependency },
            },
          );
        }
      }
    });

    // The model's plan, with the data flow imposed on it. See data-flow.ts:
    // a prompt instruction is not a guarantee, and a plan whose steps all have
    // an empty dependsOn runs everything in parallel — publishing before there
    // is anything to publish, and reporting COMPLETED.
    const flow = enforceDataFlow(declared);

    const tasks: Task[] = [];

    for (const [index, step] of flow.steps.entries()) {
      this.assertCapabilityAvailable(step.capability, goal, index);
      const dependencies = this.resolveDependencies(
        flow.dependsOn[index] ?? [],
        index,
        tasks,
      );

      tasks.push(
        this.buildTask({ execution, goal, step, dependencies, index }),
      );
    }

    // Belt and braces. Backward-only indices already rule out cycles, so this
    // catching anything means an assumption above has broken — better to fail
    // here than to hand the scheduler a plan that can never finish.
    validateDag(tasks);

    return {
      id: newId("event"),
      executionId: execution.id,
      tasks,
      dependencyGraph: Object.fromEntries(
        tasks.map((task) => [task.id, task.dependencies]),
      ),
      estimatedDurationMs: estimateDuration(tasks),
      // What planning itself cost. Running the plan costs more, but that is
      // not knowable until the capabilities have run.
      estimatedCostUsd: response.cost.totalUsd,
      metadata: {
        planner: "llm",
        provider: response.provider,
        model: response.model,
        promptVersion: PLAN_PROMPT.version,
        intentCount: intents.length,
        // Visible rather than silent: a high number here means the model is
        // not producing the dependencies it is asked for, which is worth
        // knowing before trusting its plans for anything subtler.
        addedDependencies: flow.addedEdges,
      },
    };
  }

  private assertCapabilityAvailable(
    capabilityId: string,
    goal: Goal,
    index: number,
  ): void {
    if (this.options.capabilities.has(capabilityId)) return;

    // A hallucinated capability must never reach the scheduler. Failing here
    // names the offending step, which is what makes the prompt fixable.
    throw new RuntimeError(
      "PLANNING",
      `The planner proposed capability "${capabilityId}" at step ${index + 1}, which is not registered.`,
      {
        retryable: false,
        context: {
          capabilityId,
          step: index,
          goalId: goal.id,
          registered: this.options.capabilities.list().map((c) => c.id),
        },
      },
    );
  }

  private resolveDependencies(
    dependsOn: readonly number[],
    index: number,
    built: readonly Task[],
  ): TaskId[] {
    return dependsOn.map((dependency) => {
      if (dependency >= index) {
        throw new RuntimeError(
          "PLANNING",
          `Step ${index + 1} depends on step ${dependency + 1}, which does not run before it.`,
          {
            retryable: false,
            context: { step: index, dependsOn: dependency },
          },
        );
      }
      // Guaranteed present: every lower index has already been pushed.
      return built[dependency]!.id;
    });
  }

  private buildTask(input: {
    execution: Execution;
    goal: Goal;
    step: z.infer<typeof planSchema>["steps"][number];
    dependencies: readonly TaskId[];
    index: number;
  }): Task {
    const { execution, goal, step, dependencies, index } = input;
    const descriptor = this.options.capabilities.get(step.capability);

    const inputs: Metadata = {
      objective: goal.objective,
      ...step.inputs,
    };

    return {
      id: newId("task"),
      executionId: execution.id,
      workspaceId: execution.workspaceId,
      capability: step.capability,
      workerId: null,
      inputs,
      outputs: null,
      dependencies,
      timeoutMs: descriptor?.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
      retryPolicy: {
        ...DEFAULT_RETRY_POLICY,
        maxAttempts: goal.constraints.retry ?? DEFAULT_RETRY_POLICY.maxAttempts,
      },
      priority: goal.priority,
      status: "PENDING",
      attempt: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      metadata: { step: index, description: step.description },
    };
  }
}

/**
 * Duration of the critical path, not the sum: tasks in the same wave run
 * concurrently, so adding everything up would badly overestimate.
 */
const DEFAULT_STEP_DURATION_MS = 15_000;

function estimateDuration(tasks: readonly Task[]): number {
  return parallelGroups(tasks).reduce(
    (total, wave) =>
      total +
      Math.max(
        ...wave.map((task) => task.timeoutMs || DEFAULT_STEP_DURATION_MS),
      ),
    0,
  );
}
