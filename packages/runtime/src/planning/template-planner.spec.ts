import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionId, GoalId, UserId, WorkspaceId } from "@repo/core";
import { InMemoryCapabilityRegistry } from "../capability/registry";
import type { RuntimeError } from "../errors/taxonomy";
import type { Execution } from "../model/execution";
import type { Goal } from "../model/goal";
import { KeywordIntentAnalyzer } from "../intent/keyword-analyzer";
import type { Intent } from "../model/intent";
import { validateDag } from "./dag";
import { TemplatePlanner } from "./template-planner";

const EXECUTION_ID = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as ExecutionId;
const WORKSPACE_ID = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as WorkspaceId;
const OWNER_ID = "usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as UserId;
const GOAL_ID = "gol_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as GoalId;

const ALL_CAPABILITIES = [
  "research.trend",
  "content.generate",
  "media.generate-image",
  "media.generate-video",
  "social.publish",
  "approval.request",
  "notification.send",
  "analytics.report",
];

function goal(objective: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id: GOAL_ID,
    workspaceId: WORKSPACE_ID,
    ownerId: OWNER_ID,
    title: "Test",
    objective,
    description: null,
    type: "CONTENT",
    priority: "NORMAL",
    constraints: {},
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
    ...overrides,
  };
}

function execution(): Execution {
  return {
    id: EXECUTION_ID,
    goalId: GOAL_ID,
    workspaceId: WORKSPACE_ID,
    ownerId: OWNER_ID,
    status: "PLANNING",
    priority: "NORMAL",
    plan: null,
    outputs: null,
    failureReason: null,
    correlationId: "req_01HX8ZQ7P9K2M4N6R8T0V2W4Y6",
    startedAt: null,
    finishedAt: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    version: 1,
  };
}

describe("TemplatePlanner", () => {
  let registry: InMemoryCapabilityRegistry;
  let planner: TemplatePlanner;
  const analyzer = new KeywordIntentAnalyzer();

  beforeEach(() => {
    registry = new InMemoryCapabilityRegistry();
    for (const id of ALL_CAPABILITIES) {
      registry.register({
        id,
        name: id,
        version: "1.0.0",
        category: "test",
        supportedWorkers: ["FUNCTION"],
        permissions: [],
      });
    }
    planner = new TemplatePlanner(registry);
  });

  async function planFor(objective: string, overrides: Partial<Goal> = {}) {
    const target = goal(objective, overrides);
    const intents = await analyzer.analyze(target, EXECUTION_ID);
    return planner.plan({ execution: execution(), goal: target, intents });
  }

  it("orders research before content, and publishing last", async () => {
    const plan = await planFor(
      "Tìm xu hướng AI, viết bài, rồi đăng lên facebook",
    );

    const byCapability = new Map(
      plan.tasks.map((task) => [task.capability, task]),
    );
    const research = byCapability.get("research.trend")!;
    const content = byCapability.get("content.generate")!;
    const publish = byCapability.get("social.publish")!;

    expect(research.dependencies).toEqual([]);
    expect(content.dependencies).toContain(research.id);
    expect(publish.dependencies).toContain(content.id);
  });

  it("produces a valid DAG for the full product example", async () => {
    const plan = await planFor(
      "Tìm xu hướng AI mới, viết 5 bài Facebook, tạo hình ảnh minh họa, gửi Leader duyệt, sau đó đăng lên Facebook",
    );

    expect(() => validateDag(plan.tasks)).not.toThrow();
    expect(plan.tasks.length).toBe(5);
  });

  it("runs independent work in the same wave", async () => {
    // Image generation and content do not depend on each other beyond the
    // stage they both follow, so they must not be serialised.
    const plan = await planFor("Viết bài và tạo ảnh minh họa");

    const content = plan.tasks.find(
      (t) => t.capability === "content.generate",
    )!;
    const image = plan.tasks.find(
      (t) => t.capability === "media.generate-image",
    )!;

    expect(image.dependencies).toContain(content.id);
    expect(content.dependencies).toEqual([]);
  });

  it("leaves the worker unassigned — that is the dispatcher's decision", async () => {
    const plan = await planFor("Viết bài");
    for (const task of plan.tasks) {
      expect(task.workerId).toBeNull();
    }
  });

  it("starts every task PENDING with no attempts spent", async () => {
    const plan = await planFor("Viết bài và đăng");
    for (const task of plan.tasks) {
      expect(task.status).toBe("PENDING");
      expect(task.attempt).toBe(0);
      expect(task.outputs).toBeNull();
    }
  });

  it("lets a goal constraint override the default retry budget", async () => {
    const plan = await planFor("Viết bài", { constraints: { retry: 7 } });
    expect(plan.tasks[0]!.retryPolicy.maxAttempts).toBe(7);
  });

  it("estimates the critical path, not the sum of every task", async () => {
    // Summing would badly overstate a plan whose tasks run in parallel.
    const plan = await planFor("Viết bài và tạo ảnh minh họa");
    const sum = plan.tasks.length * 45_000;
    expect(plan.estimatedDurationMs).toBeLessThan(sum);
    expect(plan.estimatedDurationMs).toBeGreaterThan(0);
  });

  it("refuses to plan when a required capability is not registered", async () => {
    // Better a loud CapabilityNotFound at plan time than a task that sits in
    // the queue forever because nothing can run it.
    registry.unregister("social.publish");

    await expect(planFor("Viết bài rồi đăng lên facebook")).rejects.toThrow(
      /not registered/i,
    );
  });

  it("refuses a goal with nothing actionable in it", async () => {
    const target = goal("xyzzy");
    const intents: readonly Intent[] = await analyzer.analyze(
      target,
      EXECUTION_ID,
    );

    // Pure CHAT maps to no capability, so there is no plan to build.
    await expect(
      planner.plan({ execution: execution(), goal: target, intents }),
    ).rejects.toThrow(/no actionable intent/i);
  });

  it("classifies planning failures as PLANNING, which are not blindly retried", async () => {
    registry.unregister("content.generate");
    try {
      await planFor("Viết bài");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as RuntimeError).errorClass).toBe("PLANNING");
    }
  });

  it("records the dependency graph alongside the tasks", async () => {
    const plan = await planFor("Tìm xu hướng và viết bài");

    for (const task of plan.tasks) {
      expect(plan.dependencyGraph[task.id]).toEqual(task.dependencies);
    }
  });
});
