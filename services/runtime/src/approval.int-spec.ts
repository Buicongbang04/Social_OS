import { newId, type UserId, type WorkspaceId } from "@repo/core";
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
import { InMemoryEventBus } from "@repo/event";
import { RedisSchedulerLock, RedisTaskQueue } from "@repo/queue";
import {
  ApprovalGate,
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
  KeywordIntentAnalyzer,
  TemplatePlanner,
  newExecutionFor,
} from "@repo/runtime";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { Scheduler } from "./scheduler";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const hasInfra = Boolean(DATABASE_URL && REDIS_URL);

/**
 * The approval gate, on real Postgres and Redis.
 *
 * What is actually being proven is a negative: that nothing downstream of the
 * gate runs until a person says so. The previous implementation returned
 * `{approved: true}` immediately, which passed every test that only checked
 * the run completed — so these assert on what has NOT happened as much as on
 * what has.
 */
describe.skipIf(!hasInfra)("approval gate (integration)", () => {
  let db: DatabaseClient;
  let redis: Redis;
  let engine: ExecutionEngine;
  let gate: ApprovalGate;
  let scheduler: Scheduler;
  let queue: RedisTaskQueue;
  let goals: DrizzleGoalRepository;
  let executions: DrizzleExecutionRepository;
  let tasks: DrizzleTaskRepository;

  let workspaceId: WorkspaceId;
  let userId: UserId;

  const OBJECTIVE = "Viết bài rồi duyệt rồi đăng lên facebook";

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 5 });
    redis ??= new Redis(REDIS_URL!);

    await truncateTenantData(db);

    queue = new RedisTaskQueue(redis, {
      keyPrefix: "test:approval",
      visibilityTimeoutMs: 5_000,
    });
    await queue.clear();

    const capabilities = new InMemoryCapabilityRegistry();
    const capabilityExecutor = new CapabilityExecutor();
    for (const capability of BUILTIN_CAPABILITIES) {
      capabilities.register(capability.descriptor);
      capabilityExecutor.register(capability);
    }

    goals = new DrizzleGoalRepository(db);
    executions = new DrizzleExecutionRepository(db);
    tasks = new DrizzleTaskRepository(db);

    engine = new ExecutionEngine({
      goals,
      executions,
      tasks,
      queue,
      intentAnalyzer: new KeywordIntentAnalyzer(),
      planner: new TemplatePlanner(capabilities),
      capabilities,
      capabilityExecutor,
    });
    gate = new ApprovalGate({ executions, tasks, queue });

    scheduler = new Scheduler(
      engine,
      queue,
      new RedisSchedulerLock(redis, "test:approval:lock"),
      new InMemoryEventBus(),
      { batchSize: 10, recoverIntervalMs: 50 },
    );

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");

    await db
      .insert(schemaTables.users)
      .values({ id: userId, email: "approval@test.local", status: "ACTIVE" });
    await db.insert(schemaTables.organizations).values({
      id: organizationId,
      name: "Approval Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(schemaTables.workspaces).values({
      id: workspaceId,
      organizationId,
      name: "Approval WS",
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

  async function submit() {
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Approval test",
      objective: OBJECTIVE,
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

  const statusOf = async (executionId: string, capability: string) =>
    (await tasks.listByExecution(executionId as never)).find(
      (task) => task.capability === capability,
    )?.status;

  it("stops and waits instead of approving itself", async () => {
    const execution = await submit();
    await drain();

    const current = await executions.findById(execution.id);
    expect(current?.status).toBe("WAITING");
    expect(await statusOf(execution.id, "approval.request")).toBe("WAITING");
  });

  it("publishes nothing while it is still waiting", async () => {
    // The assertion that matters. A gate that pauses but lets the next step
    // run anyway is decoration.
    const execution = await submit();
    await drain();

    expect(await statusOf(execution.id, "social.publish")).toBe("PENDING");
  });

  it("does not re-ask after a redelivery", async () => {
    // The waiting task is acked, so the queue must not hand it back and make
    // someone decide twice.
    const execution = await submit();
    await drain();
    await queue.recoverExpired();
    await drain();

    expect(await statusOf(execution.id, "approval.request")).toBe("WAITING");
  });

  it("shows the approver what is about to be published", async () => {
    // A prompt that says only "approve?" without showing what is being
    // approved trains people to click yes.
    const execution = await submit();
    await drain();

    const waiting = (await tasks.listByExecution(execution.id)).find(
      (task) => task.capability === "approval.request",
    );
    expect(waiting?.outputs?.awaitingApproval).toBe(true);
    expect(waiting?.outputs).toHaveProperty("title");
  });

  it("continues the run once a person approves", async () => {
    const execution = await submit();
    await drain();

    await gate.decide({
      executionId: execution.id,
      decision: "APPROVED",
      actorId: userId,
    });
    await drain();

    const finished = await executions.findById(execution.id);
    expect(finished?.status).toBe("COMPLETED");
    expect(await statusOf(execution.id, "social.publish")).toBe("COMPLETED");
  });

  it("records who approved, so the trail names a person", async () => {
    const execution = await submit();
    await drain();
    await gate.decide({
      executionId: execution.id,
      decision: "APPROVED",
      actorId: userId,
      note: "ok nhé",
    });

    const approval = (await tasks.listByExecution(execution.id)).find(
      (task) => task.capability === "approval.request",
    );
    expect(approval?.outputs?.approvedBy).toBe(userId);
    expect(approval?.outputs?.note).toBe("ok nhé");
  });

  it("cancels the whole run when rejected, not just the step", async () => {
    // "Do not publish this" has to mean the steps after it do not happen.
    const execution = await submit();
    await drain();

    await gate.decide({
      executionId: execution.id,
      decision: "REJECTED",
      actorId: userId,
      note: "chưa đạt",
    });
    await drain();

    expect((await executions.findById(execution.id))?.status).toBe("CANCELLED");
    expect(await statusOf(execution.id, "social.publish")).not.toBe(
      "COMPLETED",
    );
  });

  it("refuses to approve tasks on a run that is no longer waiting", async () => {
    // The distinct case the status precondition covers: a task left WAITING on
    // a run that has already been cancelled must not be resurrected by a late
    // approval. Without it, "reject" followed by a stale approve would publish.
    const execution = await submit();
    await drain();

    const cancelling = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: (await executions.findById(execution.id))!.version,
      expectedStatus: "WAITING",
      status: "CANCELLING",
    });
    await executions.transitionStatus({
      id: cancelling!.id,
      expectedVersion: cancelling!.version,
      expectedStatus: "CANCELLING",
      status: "CANCELLED",
    });

    const events = await gate.decide({
      executionId: execution.id,
      decision: "APPROVED",
      actorId: userId,
    });

    expect(events).toEqual([]);
    expect(await statusOf(execution.id, "approval.request")).toBe("WAITING");
    expect(await statusOf(execution.id, "social.publish")).toBe("PENDING");
  });

  it("ignores a second decision on a run that already moved on", async () => {
    const execution = await submit();
    await drain();
    await gate.decide({
      executionId: execution.id,
      decision: "APPROVED",
      actorId: userId,
    });

    const events = await gate.decide({
      executionId: execution.id,
      decision: "REJECTED",
      actorId: userId,
    });

    expect(events).toEqual([]);
  });
});
