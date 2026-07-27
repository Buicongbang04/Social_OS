import {
  LlmIntentAnalyzer,
  LlmPlanner,
  ProviderGateway,
  ProviderRegistry,
  StubProviderAdapter,
  describeProvider,
} from "@repo/ai";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import {
  DrizzleAiUsageRepository,
  DrizzleExecutionRepository,
  DrizzleGoalRepository,
  DrizzleTaskRepository,
  closeDbClient,
  createDbClient,
  schemaTables,
  truncateTenantData,
  type DatabaseClient,
} from "@repo/database";
import { InMemoryEventBus } from "@repo/event";
import { RedisSchedulerLock, RedisTaskQueue } from "@repo/queue";
import {
  BudgetPolicy,
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
  newExecutionFor,
  type Goal,
} from "@repo/runtime";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { Scheduler } from "./scheduler";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const hasInfra = Boolean(DATABASE_URL && REDIS_URL);

/**
 * Budget enforcement against real Postgres and Redis.
 *
 * The unit tests prove the policy's arithmetic; this proves the wiring — that
 * the spend written by one task is the spend the next task is judged against.
 * A budget that is correct in isolation and never consulted is exactly the
 * failure this was built to fix.
 */
describe.skipIf(!hasInfra)("budget enforcement (integration)", () => {
  let db: DatabaseClient;
  let redis: Redis;
  let engine: ExecutionEngine;
  let scheduler: Scheduler;
  let queue: RedisTaskQueue;
  let goals: DrizzleGoalRepository;
  let executions: DrizzleExecutionRepository;
  let usage: DrizzleAiUsageRepository;

  let workspaceId: WorkspaceId;
  let userId: UserId;

  const INTENTS = {
    intents: [
      {
        type: "RESEARCH",
        action: "research_trend",
        entities: {},
        confidence: 0.9,
      },
      {
        type: "GENERATE_CONTENT",
        action: "generate_content",
        entities: {},
        confidence: 0.9,
      },
    ],
  };

  const PLAN = {
    steps: [
      {
        capability: "research.trend",
        description: "",
        inputs: {},
        dependsOn: [],
      },
      {
        capability: "content.generate",
        description: "",
        inputs: {},
        dependsOn: [0],
      },
    ],
  };

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 5 });
    redis ??= new Redis(REDIS_URL!);

    await truncateTenantData(db);

    queue = new RedisTaskQueue(redis, {
      keyPrefix: "test:budget",
      visibilityTimeoutMs: 5_000,
    });
    await queue.clear();

    const capabilities = new InMemoryCapabilityRegistry();
    const capabilityExecutor = new CapabilityExecutor();
    for (const capability of BUILTIN_CAPABILITIES) {
      capabilities.register(capability.descriptor);
      capabilityExecutor.register(capability);
    }

    // Priced so planning alone spends $3: claude-sonnet-5 is $3 per million
    // input tokens, and the stub reports exactly that many.
    const stub = new StubProviderAdapter({
      provider: "anthropic",
      defaultModel: "claude-sonnet-5",
      replies: [
        { when: "Intent Engine", reply: { text: "", object: INTENTS } },
        { when: "Planning Engine", reply: { text: "", object: PLAN } },
      ],
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    const providers = new ProviderRegistry();
    providers.register(stub, describeProvider("anthropic"));
    const gateway = new ProviderGateway(providers, {
      default: "anthropic",
      fallback: [],
      timeoutMs: 5_000,
      attempts: 1,
    });

    goals = new DrizzleGoalRepository(db);
    executions = new DrizzleExecutionRepository(db);
    usage = new DrizzleAiUsageRepository(db);

    engine = new ExecutionEngine({
      goals,
      executions,
      tasks: new DrizzleTaskRepository(db),
      queue,
      intentAnalyzer: new LlmIntentAnalyzer({ gateway, recorder: usage }),
      planner: new LlmPlanner({ gateway, capabilities, recorder: usage }),
      capabilities,
      capabilityExecutor,
      policy: new BudgetPolicy({ spend: usage }),
    });

    scheduler = new Scheduler(
      engine,
      queue,
      new RedisSchedulerLock(redis, "test:budget:lock"),
      new InMemoryEventBus(),
      { batchSize: 10, recoverIntervalMs: 50 },
    );

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");

    await db
      .insert(schemaTables.users)
      .values({ id: userId, email: "budget@test.local", status: "ACTIVE" });
    await db.insert(schemaTables.organizations).values({
      id: organizationId,
      name: "Budget Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(schemaTables.workspaces).values({
      id: workspaceId,
      organizationId,
      name: "Budget WS",
      slug: `ws-${workspaceId.slice(-8).toLowerCase()}`,
    });
    await db.insert(schemaTables.workspaceMemberships).values({
      id: newId("membership"),
      workspaceId,
      userId,
      role: "OWNER",
      status: "ACTIVE",
    });
  });

  afterAll(async () => {
    if (queue) await queue.clear();
    if (db) {
      await truncateTenantData(db);
      await closeDbClient(db);
    }
    if (redis) await redis.quit();
  });

  async function submit(constraints: Goal["constraints"]) {
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Budget test",
      objective: "Tìm xu hướng rồi viết bài",
      constraints,
    });
    const execution = await executions.create(
      newExecutionFor(goal, newId("request")),
    );
    await engine.prepare(execution, goal);
    return execution;
  }

  async function drain(maxTicks = 40): Promise<void> {
    for (let ticks = 0; ticks < maxTicks; ticks++) {
      const worked = await scheduler.tick();
      if (!worked && (await queue.size()) === 0) break;
      if (!worked) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it("runs to completion when the budget is ample", async () => {
    const execution = await submit({ maxCostUsd: 100 });
    await drain();

    expect((await executions.findById(execution.id))?.status).toBe("COMPLETED");
  });

  it("stops the run once its budget is spent", async () => {
    // Planning alone costs $6 here, so a $1 budget is already blown before the
    // first task runs. Nothing further should be attempted.
    const execution = await submit({ maxCostUsd: 1 });
    await drain();

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("FAILED");
    expect(finished?.failureReason).toMatch(/budget/i);
  });

  it("judges the run against spend recorded by earlier steps, not an estimate", async () => {
    // The wiring this exists to prove: what the planner actually spent has to
    // be visible to the check that runs before the next task.
    const execution = await submit({ maxCostUsd: 1 });
    await drain();

    expect(await usage.spentUsd(execution.id)).toBeGreaterThan(1);
  });

  it("leaves a run with no stated budget alone", async () => {
    const execution = await submit({});
    await drain();

    expect((await executions.findById(execution.id))?.status).toBe("COMPLETED");
  });
});
