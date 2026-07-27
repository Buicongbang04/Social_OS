import { newId, type GoalId, type UserId, type WorkspaceId } from "@repo/core";
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
  CapabilityExecutor,
  ExecutionEngine,
  InMemoryCapabilityRegistry,
  KeywordIntentAnalyzer,
  TemplatePlanner,
} from "@repo/runtime";
import { eq, sql } from "drizzle-orm";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_CAPABILITIES } from "./capabilities/builtin";
import { Scheduler } from "./scheduler";

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const hasInfra = Boolean(DATABASE_URL && REDIS_URL);

/**
 * Recurring Goals, on real Postgres and Redis.
 *
 * `schedule.cron` was accepted by the API and stored for two phases without
 * anything ever firing it — a user asking for "every morning" got silence. The
 * assertion that matters most here is the negative one: exactly one Execution
 * per occurrence, never two.
 */
describe.skipIf(!hasInfra)("scheduled goals (integration)", () => {
  let db: DatabaseClient;
  let redis: Redis;
  let scheduler: Scheduler;
  let queue: RedisTaskQueue;
  let goals: DrizzleGoalRepository;
  let executions: DrizzleExecutionRepository;

  let workspaceId: WorkspaceId;
  let userId: UserId;

  const DAILY = { cron: "0 8 * * *", timezone: "Asia/Ho_Chi_Minh" };

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 5 });
    redis ??= new Redis(REDIS_URL!);

    await truncateTenantData(db);

    queue = new RedisTaskQueue(redis, {
      keyPrefix: "test:schedule",
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

    const engine = new ExecutionEngine({
      goals,
      executions,
      tasks: new DrizzleTaskRepository(db),
      queue,
      intentAnalyzer: new KeywordIntentAnalyzer(),
      planner: new TemplatePlanner(capabilities),
      capabilities,
      capabilityExecutor,
    });

    scheduler = new Scheduler(
      engine,
      queue,
      new RedisSchedulerLock(redis, "test:schedule:lock"),
      new InMemoryEventBus(),
      { batchSize: 10, recoverIntervalMs: 50, scheduleIntervalMs: 0 },
      { executions, goals },
    );

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");

    await db
      .insert(schemaTables.users)
      .values({ id: userId, email: "cron@test.local", status: "ACTIVE" });
    await db.insert(schemaTables.organizations).values({
      id: organizationId,
      name: "Cron Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(schemaTables.workspaces).values({
      id: workspaceId,
      organizationId,
      name: "Cron WS",
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

  async function createScheduled(schedule = DAILY) {
    return goals.create({
      workspaceId,
      ownerId: userId,
      title: "Mỗi sáng",
      objective: "Mỗi sáng viết bài rồi đăng lên facebook",
      schedule,
    });
  }

  /** Pull the next occurrence into the past so the sweep sees it. */
  async function makeDue(id: GoalId) {
    await db
      .update(schemaTables.goals)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(schemaTables.goals.id, id));
  }

  /**
   * Counted by goalId, not by status: a tick fires AND plans, so an execution
   * created here has already left CREATED by the time the tick returns.
   * Counting pending-preparation rows would report zero for work that exists.
   */
  const executionCount = async (goalId: GoalId) =>
    (
      await db
        .select()
        .from(schemaTables.executions)
        .where(eq(schemaTables.executions.goalId, goalId))
    ).length;

  it("sets the first occurrence when a recurring Goal is created", async () => {
    // A recurring Goal with no nextRunAt would simply never fire — the exact
    // silence this feature exists to remove.
    const goal = await createScheduled();

    expect(goal.nextRunAt).toBeInstanceOf(Date);
    expect(goal.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("leaves a one-off Goal with no next occurrence", async () => {
    const goal = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Một lần",
      objective: "Viết một bài",
    });

    expect(goal.nextRunAt).toBeNull();
  });

  it("creates an Execution once the occurrence has come", async () => {
    const goal = await createScheduled();
    await makeDue(goal.id);

    await scheduler.tick();

    expect(await executionCount(goal.id)).toBe(1);
  });

  it("fires exactly once per occurrence, however often it sweeps", async () => {
    // The assertion that matters. Firing twice means posting twice.
    const goal = await createScheduled();
    await makeDue(goal.id);

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    const created = await db
      .select()
      .from(schemaTables.executions)
      .where(eq(schemaTables.executions.goalId, goal.id));
    expect(created).toHaveLength(1);
  });

  it("survives two nodes sweeping the same occurrence at once", async () => {
    // The scheduler lock only reduces contention; the compare-and-swap on
    // nextRunAt is what makes this exactly-once. Claiming twice directly
    // bypasses the lock and proves the CAS on its own.
    const goal = await createScheduled();
    await makeDue(goal.id);
    const now = new Date();

    const [first, second] = await Promise.all([
      goals.claimSchedule({
        id: goal.id,
        dueAt: now,
        nextRunAt: new Date(Date.now() + 86_400_000),
        firedAt: now,
      }),
      goals.claimSchedule({
        id: goal.id,
        dueAt: now,
        nextRunAt: new Date(Date.now() + 86_400_000),
        firedAt: now,
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("still fires when the stored time has sub-millisecond precision", async () => {
    // The bug this replaced: Postgres keeps microseconds, a JavaScript Date
    // only milliseconds, so a compare-and-swap on equality could never match a
    // value written by now() — and the Goal stopped firing for ever, silently.
    const goal = await createScheduled();
    await db.execute(
      sql`update goals set next_run_at = now() - interval '1 minute' where id = ${goal.id}`,
    );

    await scheduler.tick();

    expect(await executionCount(goal.id)).toBe(1);
    const after = await goals.findById(goal.id);
    expect(after?.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("moves the schedule forward instead of staying due", async () => {
    const goal = await createScheduled();
    await makeDue(goal.id);

    await scheduler.tick();

    const after = await goals.findById(goal.id);
    expect(after?.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(after?.lastRunAt).toBeInstanceOf(Date);
  });

  it("does not fire a Goal whose occurrence is still in the future", async () => {
    const goal = await createScheduled();

    await scheduler.tick();

    expect(await executionCount(goal.id)).toBe(0);
  });

  it("disables a schedule it cannot parse rather than retrying it forever", async () => {
    // Left due, an unschedulable expression would be picked up on every sweep
    // for the life of the process.
    const goal = await createScheduled();
    await db
      .update(schemaTables.goals)
      .set({
        schedule: { cron: "không phải cron", timezone: "UTC" },
        nextRunAt: new Date(Date.now() - 60_000),
      })
      .where(eq(schemaTables.goals.id, goal.id));

    await scheduler.tick();

    const after = await goals.findById(goal.id);
    expect(after?.nextRunAt).toBeNull();
    expect(await executionCount(goal.id)).toBe(0);
    // The schedule stays on the Goal so it is visible and fixable.
    expect(after?.schedule).not.toBeNull();
  });

  it("gives each firing its own correlation id", async () => {
    // Yesterday's run keeps its own history and cost; a shared id would merge
    // them in every trace.
    const goal = await createScheduled();
    await makeDue(goal.id);
    await scheduler.tick();

    const [execution] = await db
      .select()
      .from(schemaTables.executions)
      .where(eq(schemaTables.executions.goalId, goal.id));

    expect(execution?.correlationId).toContain(goal.id);
  });
});
