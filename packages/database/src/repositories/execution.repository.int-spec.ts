import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { newId, type UserId, type WorkspaceId } from "@repo/core";
import type { Execution } from "@repo/runtime";
import { closeDbClient, createDbClient, type DatabaseClient } from "../client";
import { truncateTenantData } from "../testing/reset";
import {
  organizations,
  users,
  workspaceMemberships,
  workspaces,
} from "../schema";
import { DrizzleExecutionRepository } from "./execution.repository";
import { DrizzleGoalRepository } from "./goal.repository";
import { DrizzleTaskRepository } from "./task.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("runtime repositories (integration)", () => {
  let db: DatabaseClient;
  let goals: DrizzleGoalRepository;
  let executions: DrizzleExecutionRepository;
  let tasks: DrizzleTaskRepository;

  let workspaceId: WorkspaceId;
  let otherWorkspaceId: WorkspaceId;
  let userId: UserId;
  let outsiderId: UserId;

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
    goals = new DrizzleGoalRepository(db);
    executions = new DrizzleExecutionRepository(db);
    tasks = new DrizzleTaskRepository(db);

    await truncateTenantData(db);

    // Two tenants, and a user who belongs to only the first.
    const organizationId = newId("organization");
    userId = newId("user");
    outsiderId = newId("user");
    workspaceId = newId("workspace");
    otherWorkspaceId = newId("workspace");

    await db.insert(users).values([
      { id: userId, email: "member@test.local", status: "ACTIVE" },
      { id: outsiderId, email: "outsider@test.local", status: "ACTIVE" },
    ]);
    await db.insert(organizations).values({
      id: organizationId,
      name: "Test Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(workspaces).values([
      {
        id: workspaceId,
        organizationId,
        name: "A",
        slug: `a-${workspaceId.slice(-8).toLowerCase()}`,
      },
      {
        id: otherWorkspaceId,
        organizationId,
        name: "B",
        slug: `b-${otherWorkspaceId.slice(-8).toLowerCase()}`,
      },
    ]);
    await db.insert(workspaceMemberships).values([
      {
        id: newId("membership"),
        workspaceId,
        userId,
        role: "OWNER",
        status: "ACTIVE",
      },
      {
        id: newId("membership"),
        workspaceId: otherWorkspaceId,
        userId: outsiderId,
        role: "OWNER",
        status: "ACTIVE",
      },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await truncateTenantData(db);
      await closeDbClient(db);
    }
  });

  async function seedExecution(
    target = workspaceId,
    owner = userId,
  ): Promise<Execution> {
    const goal = await goals.create({
      workspaceId: target,
      ownerId: owner,
      title: "Test goal",
      objective: "Viết bài và đăng lên facebook",
    });

    return executions.create({
      id: newId("execution"),
      goalId: goal.id,
      workspaceId: target,
      ownerId: owner,
      trigger: "MANUAL",
      status: "CREATED",
      priority: "NORMAL",
      plan: null,
      outputs: null,
      failureReason: null,
      correlationId: newId("request"),
      startedAt: null,
      finishedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: owner,
      updatedBy: null,
      version: 1,
    });
  }

  it("round-trips a goal", async () => {
    const created = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Daily posts",
      objective: "Mỗi sáng viết bài và đăng lên facebook",
      constraints: { language: "vi", retry: 5 },
      schedule: { cron: "0 8 * * *", timezone: "Asia/Ho_Chi_Minh" },
    });

    const found = await goals.findByIdForUser(created.id, userId);

    expect(found?.objective).toBe("Mỗi sáng viết bài và đăng lên facebook");
    expect(found?.constraints).toEqual({ language: "vi", retry: 5 });
    expect(found?.schedule).toEqual({
      cron: "0 8 * * *",
      timezone: "Asia/Ho_Chi_Minh",
    });
    expect(found?.status).toBe("CREATED");
  });

  it("stops a recurring goal from ever firing again", async () => {
    // The gap this closes: a Goal set to "every morning at 8" could be created
    // and never turned off. The verification script's every-minute Goal made
    // that visible by leaving one running on every machine it touched.
    const created = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Daily posts",
      objective: "Mỗi sáng viết bài",
      schedule: { cron: "* * * * *", timezone: "UTC" },
    });
    await goals.setNextRunAt(created.id, new Date(Date.now() - 1_000));

    expect(
      (await goals.listDueSchedules(new Date(), 10)).map((g) => g.id),
    ).toContain(created.id);

    const archived = await goals.archive(created.id, userId);

    expect(archived?.status).toBe("ARCHIVED");
    expect(archived?.nextRunAt).toBeNull();
    expect(
      (await goals.listDueSchedules(new Date(), 10)).map((g) => g.id),
    ).not.toContain(created.id);
  });

  it("clears the schedule even when the status cannot move yet", async () => {
    // A Goal in the middle of a run cannot become ARCHIVED — the state machine
    // forbids it and the in-flight Execution has to finish. "Stop this" still
    // has to mean stopped, so the schedule is cleared regardless.
    const created = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Đang chạy",
      objective: "Mỗi phút viết bài",
      schedule: { cron: "* * * * *", timezone: "UTC" },
    });
    await goals.setNextRunAt(created.id, new Date(Date.now() - 1_000));
    const validated = await goals.updateStatus(created.id, "VALIDATED", 1);
    const planned = await goals.updateStatus(
      created.id,
      "PLANNED",
      validated!.version,
    );
    await goals.updateStatus(created.id, "EXECUTING", planned!.version);

    const archived = await goals.archive(created.id, userId);

    expect(archived?.status).toBe("EXECUTING");
    expect(archived?.nextRunAt).toBeNull();
    expect(
      (await goals.listDueSchedules(new Date(), 10)).map((g) => g.id),
    ).not.toContain(created.id);
  });

  it("will not let an outsider archive a goal", async () => {
    const created = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Riêng tư",
      objective: "Mỗi sáng viết bài",
      schedule: { cron: "* * * * *", timezone: "UTC" },
    });

    expect(await goals.archive(created.id, outsiderId)).toBeNull();
    expect((await goals.findById(created.id))?.status).toBe("CREATED");
  });

  it("hides another tenant's goal", async () => {
    const created = await goals.create({
      workspaceId,
      ownerId: userId,
      title: "Private",
      objective: "Viết bài",
    });

    expect(await goals.findByIdForUser(created.id, outsiderId)).toBeNull();
  });

  it("hides another tenant's execution", async () => {
    const execution = await seedExecution();
    expect(
      await executions.findByIdForUser(execution.id, outsiderId),
    ).toBeNull();
    // But the scheduler, which acts as the runtime rather than a user, sees it.
    expect(await executions.findById(execution.id)).not.toBeNull();
  });

  it("lists only the caller's workspace", async () => {
    await seedExecution(workspaceId, userId);
    await seedExecution(otherWorkspaceId, outsiderId);

    const page = await executions.listForUser(workspaceId, userId, {
      limit: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.workspaceId).toBe(workspaceId);
  });

  it("advances an execution only when version and status both still match", async () => {
    const execution = await seedExecution();

    const moved = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "CREATED",
      status: "VALIDATING",
    });

    expect(moved?.status).toBe("VALIDATING");
    expect(moved?.version).toBe(execution.version + 1);
  });

  it("refuses a transition from a stale version", async () => {
    const execution = await seedExecution();
    await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "CREATED",
      status: "VALIDATING",
    });

    // A second node still holding the old version must lose.
    const stale = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "CREATED",
      status: "PLANNING",
    });

    expect(stale).toBeNull();
  });

  it("refuses a transition when the status already moved on", async () => {
    // This is what stops two runtime nodes both driving the same Execution:
    // the loser's expected status no longer matches.
    const execution = await seedExecution();
    await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version,
      expectedStatus: "CREATED",
      status: "VALIDATING",
    });

    const wrongStatus = await executions.transitionStatus({
      id: execution.id,
      expectedVersion: execution.version + 1,
      expectedStatus: "CREATED",
      status: "PLANNING",
    });

    expect(wrongStatus).toBeNull();
  });

  it("stores and returns the plan", async () => {
    const execution = await seedExecution();
    const plan = {
      id: newId("event"),
      executionId: execution.id,
      tasks: [],
      dependencyGraph: {},
      estimatedDurationMs: 1000,
      estimatedCostUsd: 0,
      metadata: { planner: "template" },
    };

    const withPlan = await executions.attachPlan(
      execution.id,
      plan,
      execution.version,
    );
    expect(withPlan?.plan?.estimatedDurationMs).toBe(1000);

    const reloaded = await executions.findById(execution.id);
    expect(reloaded?.plan?.metadata).toEqual({ planner: "template" });
  });

  it("lists executions the scheduler still has work on", async () => {
    const active = await seedExecution();
    const finished = await seedExecution();

    await executions.transitionStatus({
      id: finished.id,
      expectedVersion: finished.version,
      expectedStatus: "CREATED",
      status: "VALIDATING",
    });
    // Drive it to a terminal state the scheduler should ignore.
    await executions.transitionStatus({
      id: finished.id,
      expectedVersion: finished.version + 1,
      expectedStatus: "VALIDATING",
      status: "FAILED",
    });

    const activeIds = (await executions.listActive(50)).map((e) => e.id);

    expect(activeIds).toContain(active.id);
    expect(activeIds).not.toContain(finished.id);
  });

  it("persists tasks with their dependencies and retry policy", async () => {
    const execution = await seedExecution();
    const first = newId("task");
    const second = newId("task");

    await tasks.createMany([
      {
        id: first,
        executionId: execution.id,
        workspaceId,
        capability: "content.generate",
        workerId: null,
        inputs: { objective: "Viết bài" },
        outputs: null,
        dependencies: [],
        timeoutMs: 60_000,
        retryPolicy: {
          maxAttempts: 3,
          backoff: "EXPONENTIAL",
          initialDelayMs: 1000,
          maxDelayMs: 60_000,
        },
        priority: "NORMAL",
        status: "PENDING",
        attempt: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        metadata: {},
      },
      {
        id: second,
        executionId: execution.id,
        workspaceId,
        capability: "social.publish",
        workerId: null,
        inputs: {},
        outputs: null,
        dependencies: [first],
        timeoutMs: 60_000,
        retryPolicy: {
          maxAttempts: 3,
          backoff: "EXPONENTIAL",
          initialDelayMs: 1000,
          maxDelayMs: 60_000,
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

    const stored = await tasks.listByExecution(execution.id);
    const publish = stored.find((task) => task.capability === "social.publish");

    expect(stored).toHaveLength(2);
    expect(publish?.dependencies).toEqual([first]);
    expect(publish?.retryPolicy.maxAttempts).toBe(3);
  });

  it("lets only the first claimant transition a task", async () => {
    const execution = await seedExecution();
    const taskId = newId("task");

    await tasks.createMany([
      {
        id: taskId,
        executionId: execution.id,
        workspaceId,
        capability: "content.generate",
        workerId: null,
        inputs: {},
        outputs: null,
        dependencies: [],
        timeoutMs: 60_000,
        retryPolicy: {
          maxAttempts: 3,
          backoff: "EXPONENTIAL",
          initialDelayMs: 1000,
          maxDelayMs: 60_000,
        },
        priority: "NORMAL",
        status: "READY",
        attempt: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        metadata: {},
      },
    ]);

    const winner = await tasks.transitionStatus({
      id: taskId,
      expectedStatus: "READY",
      status: "RUNNING",
      workerId: "worker-1",
    });
    // A second dispatcher that also reserved it must not run it again.
    const loser = await tasks.transitionStatus({
      id: taskId,
      expectedStatus: "READY",
      status: "RUNNING",
      workerId: "worker-2",
    });

    expect(winner?.workerId).toBe("worker-1");
    expect(loser).toBeNull();
  });
});
