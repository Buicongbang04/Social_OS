import type { ExecutionId, GoalId, UserId, WorkspaceId } from "@repo/core";
import {
  InMemoryCapabilityRegistry,
  RuntimeError,
  type Execution,
  type Goal,
  type Intent,
} from "@repo/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import {
  StubProviderAdapter,
  type StubAdapterOptions,
} from "../adapters/stub-adapter";
import { describeProvider } from "../provider/catalog";
import { ProviderGateway } from "../provider/gateway";
import { ProviderRegistry } from "../provider/registry";
import { InMemoryUsageRecorder } from "../usage/recorder";
import { LlmIntentAnalyzer } from "./llm-intent-analyzer";
import { LlmPlanner } from "./llm-planner";

const WORKSPACE = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as WorkspaceId;
const OWNER = "usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y7" as UserId;
const GOAL_ID = "gol_01HX8ZQ7P9K2M4N6R8T0V2W4Y8" as GoalId;
const EXECUTION_ID = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y9" as ExecutionId;

const goal: Goal = {
  id: GOAL_ID,
  workspaceId: WORKSPACE,
  ownerId: OWNER,
  title: "Bài về xu hướng AI",
  objective: "Tìm xu hướng AI mới, viết bài, rồi đăng lên facebook",
  description: null,
  type: "MULTI_STEP",
  priority: "NORMAL",
  constraints: { language: "vi" },
  inputs: {},
  outputs: [],
  schedule: null,
  nextRunAt: null,
  lastRunAt: null,
  status: "CREATED",
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  version: 1,
};

const execution: Execution = {
  id: EXECUTION_ID,
  goalId: GOAL_ID,
  workspaceId: WORKSPACE,
  ownerId: OWNER,
  trigger: "MANUAL",
  status: "PLANNING",
  priority: "NORMAL",
  plan: null,
  outputs: null,
  failureReason: null,
  correlationId: "req_test",
  startedAt: null,
  finishedAt: null,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  version: 1,
};

function gatewayWith(options: StubAdapterOptions) {
  const registry = new ProviderRegistry();
  const stub = new StubProviderAdapter({ ...options, provider: "anthropic" });
  registry.register(stub, describeProvider("anthropic"));
  return {
    stub,
    gateway: new ProviderGateway(
      registry,
      {
        default: "anthropic",
        fallback: [],
        timeoutMs: 1_000,
        attempts: 1,
      },
      { sleep: async () => {} },
    ),
  };
}

const THREE_INTENTS = {
  intents: [
    {
      type: "RESEARCH",
      action: "research_trend",
      entities: { topic: "AI" },
      confidence: 0.9,
    },
    {
      type: "GENERATE_CONTENT",
      action: "generate_content",
      entities: { topic: "AI", language: "vi" },
      confidence: 0.95,
    },
    {
      type: "PUBLISH",
      action: "publish_post",
      entities: { platforms: ["facebook"] },
      confidence: 0.9,
    },
  ],
};

describe("LlmIntentAnalyzer", () => {
  let recorder: InMemoryUsageRecorder;

  beforeEach(() => {
    recorder = new InMemoryUsageRecorder();
  });

  it("turns a natural-language objective into structured intents", async () => {
    const { gateway } = gatewayWith({
      fallbackReply: { text: "", object: THREE_INTENTS },
    });

    const intents = await new LlmIntentAnalyzer({ gateway, recorder }).analyze(
      goal,
      EXECUTION_ID,
    );

    expect(intents.map((i) => i.type)).toEqual([
      "RESEARCH",
      "GENERATE_CONTENT",
      "PUBLISH",
    ]);
    expect(intents[0]?.executionId).toBe(EXECUTION_ID);
    expect(intents[1]?.entities.topic).toBe("AI");
    // Goal constraints ride along so the planner does not have to re-read them.
    expect(intents[0]?.constraints.language).toBe("vi");
    expect(intents[0]?.metadata.analyzer).toBe("llm");
  });

  it("meters the call, including tokens and cost", async () => {
    const { gateway } = gatewayWith({
      defaultModel: "claude-sonnet-5",
      fallbackReply: { text: "", object: THREE_INTENTS },
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    await new LlmIntentAnalyzer({ gateway, recorder }).analyze(
      goal,
      EXECUTION_ID,
    );

    expect(recorder.records).toHaveLength(1);
    const record = recorder.records[0]!;
    expect(record.operation).toBe("intent.analyze");
    expect(record.workspaceId).toBe(WORKSPACE);
    expect(record.executionId).toBe(EXECUTION_ID);
    expect(record.usage.inputTokens).toBe(1_000_000);
    expect(record.cost.totalUsd).toBeCloseTo(3, 10);
    expect(record.id).toMatch(/^aiu_/);
  });

  it("rejects an intent type the runtime does not have", async () => {
    // A hallucinated type would flow into capabilityForIntent and produce
    // undefined, so it has to be caught at the boundary.
    const { gateway } = gatewayWith({
      fallbackReply: {
        text: "",
        object: {
          intents: [
            {
              type: "DANCE",
              action: "dance",
              entities: {},
              confidence: 0.9,
            },
          ],
        },
      },
    });

    await expect(
      new LlmIntentAnalyzer({ gateway, recorder }).analyze(goal, EXECUTION_ID),
    ).rejects.toBeInstanceOf(RuntimeError);
  });

  it("classifies an unusable answer as PLANNING and does not retry it blind", async () => {
    const { gateway } = gatewayWith({
      fallbackReply: { text: "", object: { intents: [] } },
    });

    const error = await new LlmIntentAnalyzer({ gateway, recorder })
      .analyze(goal, EXECUTION_ID)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).errorClass).toBe("PLANNING");
    // The gateway already retried and exhausted its fallbacks; repeating here
    // would just spend more money on the same failure.
    expect((error as RuntimeError).retryable).toBe(false);
  });

  it("does not fail the work when metering fails", async () => {
    // The provider has already answered and we have already been charged.
    // Losing a billing row must not also lose the user's result.
    const { gateway } = gatewayWith({
      fallbackReply: { text: "", object: THREE_INTENTS },
    });
    const errors: unknown[] = [];

    const intents = await new LlmIntentAnalyzer({
      gateway,
      recorder: {
        record: () => Promise.reject(new Error("database is down")),
      },
      onUsageError: (error) => errors.push(error),
    }).analyze(goal, EXECUTION_ID);

    expect(intents).toHaveLength(3);
    // Surfaced, not swallowed: an unrecorded call is unbilled revenue.
    expect(errors).toHaveLength(1);
  });
});

describe("LlmPlanner", () => {
  let recorder: InMemoryUsageRecorder;
  let capabilities: InMemoryCapabilityRegistry;

  const intents: readonly Intent[] = THREE_INTENTS.intents.map(
    (intent, index) => ({
      id: `evt_0${index}`,
      executionId: EXECUTION_ID,
      type: intent.type as Intent["type"],
      action: intent.action,
      entities: intent.entities,
      constraints: {},
      confidence: intent.confidence,
      metadata: {},
      timestamp: new Date(),
    }),
  );

  const THREE_STEPS = {
    steps: [
      {
        capability: "research.trend",
        description: "Tìm xu hướng AI",
        inputs: { topic: "AI" },
        dependsOn: [],
      },
      {
        capability: "content.generate",
        description: "Viết bài",
        inputs: { topic: "AI", language: "vi" },
        dependsOn: [0],
      },
      {
        capability: "social.publish",
        description: "Đăng lên Facebook",
        inputs: { platform: "facebook" },
        dependsOn: [1],
      },
    ],
  };

  beforeEach(() => {
    recorder = new InMemoryUsageRecorder();
    capabilities = new InMemoryCapabilityRegistry();
    for (const id of [
      "research.trend",
      "content.generate",
      "social.publish",
      "knowledge.search",
    ]) {
      capabilities.register({
        id,
        name: id,
        version: "1.0.0",
        category: id.split(".")[0]!,
        supportedWorkers: ["FUNCTION"],
        permissions: [],
      });
    }
  });

  it("builds a DAG whose dependencies match what the model asked for", async () => {
    const { gateway } = gatewayWith({
      fallbackReply: { text: "", object: THREE_STEPS },
    });

    const plan = await new LlmPlanner({
      gateway,
      capabilities,
      recorder,
    }).plan({ execution, goal, intents });

    expect(plan.tasks.map((t) => t.capability)).toEqual([
      "research.trend",
      "content.generate",
      "social.publish",
    ]);
    expect(plan.tasks[0]?.dependencies).toEqual([]);
    expect(plan.tasks[1]?.dependencies).toEqual([plan.tasks[0]?.id]);
    expect(plan.tasks[2]?.dependencies).toEqual([plan.tasks[1]?.id]);
    expect(plan.metadata.planner).toBe("llm");
  });

  it("carries the model's per-step inputs onto the task", async () => {
    // This is the concrete gain over the template planner, which could only
    // copy the objective onto every task.
    const { gateway } = gatewayWith({
      fallbackReply: { text: "", object: THREE_STEPS },
    });

    const plan = await new LlmPlanner({
      gateway,
      capabilities,
      recorder,
    }).plan({ execution, goal, intents });

    expect(plan.tasks[2]?.inputs.platform).toBe("facebook");
    expect(plan.tasks[1]?.inputs.language).toBe("vi");
  });

  it("refuses a capability that is not registered", async () => {
    // A hallucinated capability reaching the scheduler would become a task no
    // worker can ever run, discovered only when it times out.
    const { gateway } = gatewayWith({
      fallbackReply: {
        text: "",
        object: {
          steps: [
            {
              capability: "magic.doEverything",
              description: "",
              inputs: {},
              dependsOn: [],
            },
          ],
        },
      },
    });

    const error = await new LlmPlanner({ gateway, capabilities, recorder })
      .plan({ execution, goal, intents })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).errorClass).toBe("PLANNING");
    expect((error as RuntimeError).message).toMatch(/magic.doEverything/);
  });

  it("refuses a dependency that points at a later step", async () => {
    // Backward-only indices are what make a cycle impossible by construction.
    const { gateway } = gatewayWith({
      fallbackReply: {
        text: "",
        object: {
          steps: [
            {
              capability: "research.trend",
              description: "",
              inputs: {},
              dependsOn: [1],
            },
            {
              capability: "content.generate",
              description: "",
              inputs: {},
              dependsOn: [],
            },
          ],
        },
      },
    });

    await expect(
      new LlmPlanner({ gateway, capabilities, recorder }).plan({
        execution,
        goal,
        intents,
      }),
    ).rejects.toThrow(/does not run before it/);
  });

  it("refuses a step that depends on itself", async () => {
    const { gateway } = gatewayWith({
      fallbackReply: {
        text: "",
        object: {
          steps: [
            {
              capability: "research.trend",
              description: "",
              inputs: {},
              dependsOn: [0],
            },
          ],
        },
      },
    });

    await expect(
      new LlmPlanner({ gateway, capabilities, recorder }).plan({
        execution,
        goal,
        intents,
      }),
    ).rejects.toThrow(/does not run before it/);
  });

  it("never offers an internal capability to the model", async () => {
    // These exist to exercise the runtime — a deliberately flaky step, a step
    // that always fails. They stay registered so a test can name one, and a
    // model given "Flaky Once" next to "Generate Content" will eventually pick
    // it. It did, in a real plan against a local model.
    capabilities.register({
      id: "test.flaky-once",
      name: "Flaky Once",
      internal: true,
      version: "0.1.0",
      category: "Automation",
      supportedWorkers: ["FUNCTION"],
      permissions: [],
    });

    const { gateway, stub } = gatewayWith({
      fallbackReply: {
        text: "",
        object: {
          steps: [
            {
              capability: "content.generate",
              description: "",
              inputs: {},
              dependsOn: [],
            },
          ],
        },
      },
    });

    await new LlmPlanner({
      gateway,
      recorder: new InMemoryUsageRecorder(),
      capabilities,
    }).plan({ execution, goal, intents });

    const prompt = stub.calls
      .at(-1)!
      .messages.map((message) => message.content)
      .join("\n");
    expect(prompt).toContain("content.generate");
    expect(prompt).not.toContain("test.flaky-once");
  });

  it("schedules genuinely independent steps to run in parallel", async () => {
    const { gateway } = gatewayWith({
      fallbackReply: {
        text: "",
        object: {
          steps: [
            // Two gathering steps. research.trend and content.generate would
            // NOT be independent — the writer reads the researcher's output,
            // and running those two in parallel is the bug enforceDataFlow
            // exists to prevent.
            {
              capability: "research.trend",
              description: "",
              inputs: {},
              dependsOn: [],
            },
            {
              capability: "knowledge.search",
              description: "",
              inputs: {},
              dependsOn: [],
            },
          ],
        },
      },
    });

    const plan = await new LlmPlanner({
      gateway,
      capabilities,
      recorder,
    }).plan({ execution, goal, intents });

    expect(plan.tasks[0]?.dependencies).toEqual([]);
    expect(plan.tasks[1]?.dependencies).toEqual([]);
  });

  it("meters planning and reports what planning itself cost", async () => {
    const { gateway } = gatewayWith({
      defaultModel: "claude-sonnet-5",
      fallbackReply: { text: "", object: THREE_STEPS },
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    const plan = await new LlmPlanner({
      gateway,
      capabilities,
      recorder,
    }).plan({ execution, goal, intents });

    expect(recorder.records[0]?.operation).toBe("plan.build");
    expect(recorder.records[0]?.correlationId).toBe("req_test");
    expect(plan.estimatedCostUsd).toBeCloseTo(3, 10);
  });

  it("refuses to plan when no capability is registered at all", async () => {
    const { gateway, stub } = gatewayWith({
      fallbackReply: { text: "", object: THREE_STEPS },
    });

    await expect(
      new LlmPlanner({
        gateway,
        capabilities: new InMemoryCapabilityRegistry(),
        recorder,
      }).plan({ execution, goal, intents }),
    ).rejects.toThrow(/no capabilities are registered/i);

    // Checked before calling out, so an unrunnable plan costs nothing.
    expect(stub.calls).toHaveLength(0);
  });
});
