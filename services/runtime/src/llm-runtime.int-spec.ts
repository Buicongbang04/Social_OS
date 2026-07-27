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
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
  newExecutionFor,
} from "@repo/runtime";
import { and, eq } from "drizzle-orm";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { Scheduler } from "./scheduler";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const hasInfra = Boolean(DATABASE_URL && REDIS_URL);

/**
 * Phase 2's exit criteria on real infrastructure: a natural-language Goal is
 * understood and planned by the LLM engines rather than the keyword rules,
 * runs to COMPLETED, and leaves an auditable metering row behind.
 *
 * The provider is StubProviderAdapter, so the model's answer is fixed — but
 * everything else is real: the gateway, the schema validation, the DAG checks,
 * Postgres, Redis, the state machine and the retry policy. Mocking the gateway
 * instead would prove nothing about the code that actually ships.
 */
describe.skipIf(!hasInfra)("LLM-driven runtime (integration)", () => {
  let db: DatabaseClient;
  let redis: Redis;
  let engine: ExecutionEngine;
  let scheduler: Scheduler;
  let queue: RedisTaskQueue;
  let goals: DrizzleGoalRepository;
  let executions: DrizzleExecutionRepository;
  let usage: DrizzleAiUsageRepository;
  let stub: StubProviderAdapter;

  let workspaceId: WorkspaceId;
  let userId: UserId;

  const OBJECTIVE = "Tìm xu hướng AI mới, viết bài, rồi đăng lên facebook";

  /** What the "model" answers. Fixed, so the assertions are about our code. */
  const INTENTS = {
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

  const PLAN = {
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
        description: "Đăng Facebook",
        inputs: { platform: "facebook" },
        dependsOn: [1],
      },
    ],
  };

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 5 });
    redis ??= new Redis(REDIS_URL!);

    await truncateTenantData(db);

    queue = new RedisTaskQueue(redis, {
      keyPrefix: "test:llm-runtime",
      visibilityTimeoutMs: 5_000,
    });
    await queue.clear();

    const capabilities = new InMemoryCapabilityRegistry();
    const capabilityExecutor = new CapabilityExecutor();
    for (const capability of BUILTIN_CAPABILITIES) {
      capabilities.register(capability.descriptor);
      capabilityExecutor.register(capability);
    }

    // The system prompt differs between the two calls, so the stub can answer
    // each one correctly from the same table.
    stub = new StubProviderAdapter({
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
    });

    scheduler = new Scheduler(
      engine,
      queue,
      new RedisSchedulerLock(redis, "test:llm-runtime:lock"),
      new InMemoryEventBus(),
      { batchSize: 10, recoverIntervalMs: 50 },
    );

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");

    await db
      .insert(schemaTables.users)
      .values({ id: userId, email: "llm@test.local", status: "ACTIVE" });
    await db.insert(schemaTables.organizations).values({
      id: organizationId,
      name: "LLM Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(schemaTables.workspaces).values({
      id: workspaceId,
      organizationId,
      name: "LLM WS",
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

  async function submit(objective = OBJECTIVE) {
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "LLM test",
      objective,
    });
    const execution = await executions.create(
      newExecutionFor(goal, newId("request")),
    );
    await engine.prepare(execution, goal);
    return { goal, execution };
  }

  async function drain(maxTicks = 60): Promise<void> {
    for (let ticks = 0; ticks < maxTicks; ticks++) {
      const worked = await scheduler.tick();
      if (!worked && (await queue.size()) === 0) break;
      if (!worked) await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }

  it("plans from the model's answer and runs the goal to completion", async () => {
    const { execution } = await submit();

    await drain();

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("COMPLETED");
    expect(finished?.plan?.tasks.map((t) => t.capability)).toEqual([
      "research.trend",
      "content.generate",
      "social.publish",
    ]);
    expect(finished?.plan?.metadata.planner).toBe("llm");
  });

  it("records one metered row per provider call, with tokens and cost", async () => {
    const { execution } = await submit();
    await drain();

    const rows = await db
      .select()
      .from(schemaTables.aiUsage)
      .where(eq(schemaTables.aiUsage.executionId, execution.id));

    expect(rows.map((r) => r.operation).sort()).toEqual([
      "intent.analyze",
      "plan.build",
    ]);
    for (const row of rows) {
      expect(row.provider).toBe("anthropic");
      expect(row.model).toBe("claude-sonnet-5");
      expect(row.inputTokens).toBe(1_000_000);
      // claude-sonnet-5 is $3 per million input tokens.
      expect(Number(row.costUsd)).toBeCloseTo(3, 6);
      expect(row.costPriced).toBe(true);
      expect(row.workspaceId).toBe(workspaceId);
    }
  });

  it("fills the organization in from the workspace rather than from the caller", async () => {
    // The Goal carries no organizationId, so the column is derived on insert.
    // If that ever regressed the row would violate its NOT NULL and the whole
    // call would fail, which is why this is asserted rather than assumed.
    const { execution } = await submit();
    await drain();

    const [row] = await db
      .select({
        organizationId: schemaTables.aiUsage.organizationId,
        workspaceOrg: schemaTables.workspaces.organizationId,
      })
      .from(schemaTables.aiUsage)
      .innerJoin(
        schemaTables.workspaces,
        eq(schemaTables.workspaces.id, schemaTables.aiUsage.workspaceId),
      )
      .where(eq(schemaTables.aiUsage.executionId, execution.id));

    expect(row?.organizationId).toBeTruthy();
    expect(row?.organizationId).toBe(row?.workspaceOrg);
  });

  it("sums a workspace's spend in SQL, so the total stays exact", async () => {
    await submit();
    await drain();

    const summary = await usage.summarise(
      workspaceId,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );

    expect(summary.calls).toBe(2);
    expect(summary.inputTokens).toBe(2_000_000);
    expect(Number(summary.costUsd)).toBeCloseTo(6, 6);
    expect(summary.unpricedCalls).toBe(0);
  });

  it("keeps one workspace's usage invisible to another", async () => {
    await submit();
    await drain();

    const otherWorkspace = newId("workspace");
    const summary = await usage.summarise(
      otherWorkspace,
      new Date(Date.now() - 60_000),
      new Date(Date.now() + 60_000),
    );

    expect(summary.calls).toBe(0);
    expect(Number(summary.costUsd)).toBe(0);
  });

  it("fails the execution when the model proposes a capability that does not exist", async () => {
    // The plan must never reach the scheduler: it would become a task no
    // worker can run, discovered only when it times out.
    stub = new StubProviderAdapter({
      provider: "anthropic",
      defaultModel: "claude-sonnet-5",
      replies: [
        { when: "Intent Engine", reply: { text: "", object: INTENTS } },
        {
          when: "Planning Engine",
          reply: {
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
        },
      ],
    });

    const providers = new ProviderRegistry();
    providers.register(stub, describeProvider("anthropic"));
    const capabilities = new InMemoryCapabilityRegistry();
    for (const capability of BUILTIN_CAPABILITIES) {
      capabilities.register(capability.descriptor);
    }

    const planner = new LlmPlanner({
      gateway: new ProviderGateway(providers, {
        default: "anthropic",
        fallback: [],
        timeoutMs: 5_000,
        attempts: 1,
      }),
      capabilities,
      recorder: usage,
    });

    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Bad plan",
      objective: OBJECTIVE,
    });
    const execution = await executions.create(
      newExecutionFor(goal, newId("request")),
    );

    await expect(
      planner.plan({ execution, goal, intents: [] }),
    ).rejects.toThrow(/magic.doEverything/);

    // The failed planning call is still metered — it cost real money.
    const rows = await db
      .select()
      .from(schemaTables.aiUsage)
      .where(
        and(
          eq(schemaTables.aiUsage.executionId, execution.id),
          eq(schemaTables.aiUsage.operation, "plan.build"),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
