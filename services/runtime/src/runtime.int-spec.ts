import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import { InMemoryEventBus } from "@repo/event";
import {
  DrizzleExecutionRepository,
  DrizzleGoalRepository,
  DrizzleTaskRepository,
  closeDbClient,
  createDbClient,
  schemaTables,
  truncateTenantData,
  type DatabaseClient,
} from "@repo/database";
import { RedisSchedulerLock, RedisTaskQueue } from "@repo/queue";
import {
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
  KeywordIntentAnalyzer,
  TemplatePlanner,
  newExecutionFor,
  type Goal,
} from "@repo/runtime";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { Scheduler } from "./scheduler";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const hasInfra = Boolean(DATABASE_URL && REDIS_URL);

/**
 * The Phase 1 exit criteria, proven end to end on real Postgres and Redis:
 * a natural-language Goal is understood, planned, scheduled, executed in
 * dependency order, retried when a task fails transiently, and dead-lettered
 * when it cannot succeed.
 *
 * Nothing is mocked. The capabilities are deterministic stubs (no LLM until
 * Phase 2), but the state machine, queue, retry policy and persistence are the
 * real implementations.
 */
describe.skipIf(!hasInfra)("execution runtime (integration)", () => {
  let db: DatabaseClient;
  let redis: Redis;
  let engine: ExecutionEngine;
  let scheduler: Scheduler;
  let queue: RedisTaskQueue;
  let bus: InMemoryEventBus;
  let goals: DrizzleGoalRepository;
  let executions: DrizzleExecutionRepository;
  let tasks: DrizzleTaskRepository;

  let workspaceId: WorkspaceId;
  let userId: UserId;

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 5 });
    redis ??= new Redis(REDIS_URL!);

    await truncateTenantData(db);

    queue = new RedisTaskQueue(redis, {
      keyPrefix: "test:runtime",
      visibilityTimeoutMs: 5_000,
    });
    await queue.clear();

    const registry = new InMemoryCapabilityRegistry();
    const capabilityExecutor = new CapabilityExecutor();
    for (const capability of BUILTIN_CAPABILITIES) {
      registry.register(capability.descriptor);
      capabilityExecutor.register(capability);
    }

    goals = new DrizzleGoalRepository(db);
    executions = new DrizzleExecutionRepository(db);
    tasks = new DrizzleTaskRepository(db);
    bus = new InMemoryEventBus();

    engine = new ExecutionEngine({
      goals,
      executions,
      tasks,
      queue,
      intentAnalyzer: new KeywordIntentAnalyzer(),
      planner: new TemplatePlanner(registry),
      capabilities: registry,
      capabilityExecutor,
    });

    scheduler = new Scheduler(
      engine,
      queue,
      new RedisSchedulerLock(redis, "test:runtime:lock"),
      bus,
      {
        batchSize: 10,
        recoverIntervalMs: 50,
      },
    );

    // Minimal tenant so the FKs resolve.
    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");

    await db
      .insert(schemaTables.users)
      .values({ id: userId, email: "runtime@test.local", status: "ACTIVE" });
    await db.insert(schemaTables.organizations).values({
      id: organizationId,
      name: "Runtime Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(schemaTables.workspaces).values({
      id: workspaceId,
      organizationId,
      name: "Runtime WS",
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

  async function submit(
    objective: string,
    constraints: Goal["constraints"] = {},
  ) {
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Test",
      objective,
      constraints,
    });
    const execution = await executions.create(
      newExecutionFor(goal, newId("request")),
    );
    const events = await engine.prepare(execution, goal);
    return { goal, execution, events };
  }

  /** Drive the scheduler until nothing is left, with a hard bound. */
  async function drain(maxTicks = 60): Promise<number> {
    let ticks = 0;
    for (; ticks < maxTicks; ticks++) {
      const worked = await scheduler.tick();
      if (!worked && (await queue.size()) === 0) break;
      if (!worked) await new Promise((resolve) => setTimeout(resolve, 60));
    }
    return ticks;
  }

  it("runs a natural-language goal through to completion", async () => {
    // The example from docs/00_VISION.md, minus the parts needing Phase 2/3.
    const { execution } = await submit(
      "Tìm xu hướng AI mới, viết bài, tạo ảnh minh họa, rồi đăng lên facebook",
    );

    await drain();

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("COMPLETED");
    expect(finished?.finishedAt).not.toBeNull();

    const finishedTasks = await tasks.listByExecution(execution.id);
    expect(finishedTasks.length).toBeGreaterThanOrEqual(4);
    expect(finishedTasks.every((task) => task.status === "COMPLETED")).toBe(
      true,
    );
  });

  it("passes an upstream task's output to its dependant", async () => {
    // Proves dependency ordering actually delivered data, not just sequenced.
    const { execution } = await submit("Tìm xu hướng AI rồi viết bài");
    await drain();

    const all = await tasks.listByExecution(execution.id);
    const content = all.find((task) => task.capability === "content.generate");

    expect(content?.outputs?.usedResearch).toBe(true);
    expect(String(content?.outputs?.title)).toContain("ai-agents");
  });

  it("never starts a task before its dependencies completed", async () => {
    const { execution } = await submit(
      "Tìm xu hướng AI rồi viết bài rồi đăng lên facebook",
    );
    await drain();

    const all = await tasks.listByExecution(execution.id);
    const byCapability = new Map(all.map((task) => [task.capability, task]));

    const research = byCapability.get("research.trend")!;
    const content = byCapability.get("content.generate")!;
    const publish = byCapability.get("social.publish")!;

    expect(content.startedAt!.getTime()).toBeGreaterThanOrEqual(
      research.finishedAt!.getTime(),
    );
    expect(publish.startedAt!.getTime()).toBeGreaterThanOrEqual(
      content.finishedAt!.getTime(),
    );
  });

  it("emits execution and task events in order", async () => {
    const { execution } = await submit("Viết bài");
    await drain();

    const types = bus
      .history()
      .filter((event) => event.executionId === execution.id)
      .map((event) => event.type);

    expect(types).toContain("TaskStarted");
    expect(types).toContain("TaskCompleted");
    expect(types).toContain("ExecutionCompleted");
    // ExecutionCompleted must come last — it is the terminal fact.
    expect(types.at(-1)).toBe("ExecutionCompleted");
  });

  it("stamps every event of a run with the same correlation id", async () => {
    const { execution } = await submit("Viết bài");
    await drain();

    const correlationIds = new Set(
      bus
        .history()
        .filter((event) => event.executionId === execution.id)
        .map((e) => e.correlationId),
    );

    expect(correlationIds.size).toBe(1);
  });

  it("retries a transiently failing task and then succeeds", async () => {
    // Phase 1 exit criterion: "Retry hoạt động", proven against real state
    // and a real queue backoff rather than a unit test of the policy table.
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Flaky",
      objective: "chạy tác vụ chập chờn",
    });
    const execution = await executions.create(
      newExecutionFor(goal, newId("request")),
    );

    // Bypass the keyword planner: this capability exists only for the test.
    const taskId = newId("task");
    await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "CREATED",
      status: "VALIDATING",
    });
    const planning = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version + 1,
      expectedStatus: "VALIDATING",
      status: "PLANNING",
    });
    await tasks.createMany([
      {
        id: taskId,
        executionId: execution.id,
        workspaceId,
        capability: "test.flaky-once",
        workerId: null,
        inputs: {},
        outputs: null,
        dependencies: [],
        timeoutMs: 5_000,
        retryPolicy: {
          maxAttempts: 3,
          backoff: "FIXED",
          initialDelayMs: 50,
          maxDelayMs: 50,
        },
        priority: "NORMAL",
        status: "PENDING",
        attempt: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        metadata: {},
      },
    ]);
    const ready = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: planning!.version,
      expectedStatus: "PLANNING",
      status: "READY",
    });
    const scheduled = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: ready!.version,
      expectedStatus: "READY",
      status: "SCHEDULED",
    });
    await executions.transitionStatus({
      id: execution.id,
      expectedVersion: scheduled!.version,
      expectedStatus: "SCHEDULED",
      status: "RUNNING",
      startedAt: new Date(),
    });
    await engine.enqueueReadyTasks(execution.id);

    await drain();

    const task = await tasks.findById(taskId);
    expect(task?.status).toBe("COMPLETED");
    // It failed once, so the second attempt is the one that succeeded.
    expect(task?.attempt).toBe(1);
    expect(task?.outputs?.recovered).toBe(true);

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("COMPLETED");
  });

  it("dead-letters a task that exhausts its retries, and fails the execution", async () => {
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Doomed",
      objective: "chạy tác vụ luôn lỗi",
    });
    const execution = await executions.create(
      newExecutionFor(goal, newId("request")),
    );
    const taskId = newId("task");

    await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "CREATED",
      status: "VALIDATING",
    });
    const planning = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version + 1,
      expectedStatus: "VALIDATING",
      status: "PLANNING",
    });
    await tasks.createMany([
      {
        id: taskId,
        executionId: execution.id,
        workspaceId,
        capability: "test.always-fails",
        workerId: null,
        inputs: {},
        outputs: null,
        dependencies: [],
        timeoutMs: 5_000,
        retryPolicy: {
          maxAttempts: 2,
          backoff: "FIXED",
          initialDelayMs: 30,
          maxDelayMs: 30,
        },
        priority: "NORMAL",
        status: "PENDING",
        attempt: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        metadata: {},
      },
    ]);
    const ready = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: planning!.version,
      expectedStatus: "PLANNING",
      status: "READY",
    });
    const scheduled = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: ready!.version,
      expectedStatus: "READY",
      status: "SCHEDULED",
    });
    await executions.transitionStatus({
      id: execution.id,
      expectedVersion: scheduled!.version,
      expectedStatus: "SCHEDULED",
      status: "RUNNING",
      startedAt: new Date(),
    });
    await engine.enqueueReadyTasks(execution.id);

    await drain();

    const task = await tasks.findById(taskId);
    expect(task?.status).toBe("FAILED");
    // Bounded: it stopped at the policy limit rather than looping forever.
    expect(task?.attempt).toBe(2);

    const dead = await queue.deadLetters();
    expect(dead.map((entry) => entry.taskId)).toContain(taskId);

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("FAILED");
    expect(finished?.failureReason).toContain("always-fails");
  });

  it("fails planning loudly when the goal has nothing actionable", async () => {
    const { execution, events } = await submit("xyzzy plugh");

    expect(events.map((event) => event.type)).toContain("PlanningFailed");

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("FAILED");
    expect(finished?.failureReason).toMatch(/no actionable intent/i);
  });

  it("keeps one workspace's executions invisible to another user", async () => {
    const { execution } = await submit("Viết bài");
    const outsider = newId("user");
    await db
      .insert(schemaTables.users)
      .values({ id: outsider, email: "out@test.local", status: "ACTIVE" });

    expect(await executions.findByIdForUser(execution.id, outsider)).toBeNull();
    expect(
      await executions.findByIdForUser(execution.id, userId),
    ).not.toBeNull();
  });

  it("leaves the queue empty once a run settles", async () => {
    const { execution } = await submit("Tìm xu hướng và viết bài");
    await drain();

    expect(await executions.findById(execution.id).then((e) => e?.status)).toBe(
      "COMPLETED",
    );
    expect(await queue.size()).toBe(0);
  });
});
