import { newId, type WorkspaceId } from "@repo/core";
import type { DrizzleAiUsageRepository } from "@repo/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AI_USAGE_REPOSITORY } from "./infra/database/database.module";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * The Runtime API surface.
 *
 * Covers what the HTTP layer is responsible for: validating a natural-language
 * Goal, accepting it for execution, exposing progress, and — most importantly —
 * refusing all of that across a workspace boundary. Actually *running* the
 * plan is proven in services/runtime's own integration suite; here the
 * Execution stays CREATED because no runtime process is attached.
 */
const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!hasInfra)("runtime API (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const auth = (user: RegisteredUser, workspaceId?: string) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${user.accessToken}`,
    };
    if (workspaceId) headers["x-workspace-id"] = workspaceId;
    return headers;
  };

  const OBJECTIVE = "Tìm xu hướng AI mới, viết bài, rồi đăng lên facebook";

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();

    alice = await registerUser(testApp, "alice@runtime-api.test");
    bob = await registerUser(testApp, "bob@runtime-api.test");

    aliceWorkspace = (await createTenant(testApp, alice, "alice")).workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob")).workspaceId;
  });

  async function createGoal(
    user: RegisteredUser,
    workspaceId: string,
    objective = OBJECTIVE,
  ) {
    const response = await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(user, workspaceId))
      .send({ title: "Test goal", objective })
      .expect(201);

    return response.body.data;
  }

  it("accepts a natural-language goal", async () => {
    const goal = await createGoal(alice, aliceWorkspace);

    expect(goal.id).toMatch(/^gol_/);
    expect(goal.objective).toBe(OBJECTIVE);
    expect(goal.status).toBe("CREATED");
  });

  it("stores constraints and a schedule", async () => {
    const response = await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(alice, aliceWorkspace))
      .send({
        title: "Daily",
        objective: "Mỗi sáng viết bài và đăng lên facebook",
        constraints: { language: "vi", retry: 5, approval: true },
        schedule: { cron: "0 8 * * *", timezone: "Asia/Ho_Chi_Minh" },
      })
      .expect(201);

    expect(response.body.data.constraints).toMatchObject({
      language: "vi",
      retry: 5,
    });
    expect(response.body.data.schedule.cron).toBe("0 8 * * *");
  });

  it("stops a recurring goal when it is archived", async () => {
    // A Goal that could be created and never turned off. Before this route
    // existed the only way to stop "post every morning" was to edit the
    // database by hand.
    const created = await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(alice, aliceWorkspace))
      .send({
        title: "Mỗi phút",
        objective: "Viết bài rồi đăng lên facebook",
        schedule: { cron: "* * * * *", timezone: "UTC" },
      })
      .expect(201);

    const archived = await testApp
      .http()
      .delete(`/api/v1/goals/${created.body.data.id}`)
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    // nextRunAt, not the status, is what proves it stopped: a Goal caught
    // mid-run keeps its status until that run finishes.
    expect(archived.body.data.nextRunAt).toBeNull();
    expect(archived.body.data.status).toBe("ARCHIVED");
  });

  it("does not let another workspace archive a goal", async () => {
    const created = await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(alice, aliceWorkspace))
      .send({ title: "Riêng tư", objective: OBJECTIVE })
      .expect(201);

    await testApp
      .http()
      .delete(`/api/v1/goals/${created.body.data.id}`)
      .set(auth(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .get(`/api/v1/goals/${created.body.data.id}`)
      .set(auth(alice, aliceWorkspace))
      .expect(200)
      .expect((response) => {
        expect(response.body.data.status).toBe("CREATED");
      });
  });

  it("rejects a malformed goal with per-field detail", async () => {
    const response = await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(alice, aliceWorkspace))
      .send({ title: "", objective: "hi" })
      .expect(422);

    expect(response.body.code).toBe("VALIDATION_FAILED");
    expect(
      response.body.details.map((d: { field: string }) => d.field).sort(),
    ).toEqual(["objective", "title"]);
  });

  it("rejects a cron schedule with no timezone", async () => {
    // A cron without a zone is ambiguous across DST and regions, so it is
    // required rather than defaulted to the server's clock.
    await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(alice, aliceWorkspace))
      .send({
        title: "Daily",
        objective: "Viết bài mỗi sáng",
        schedule: { cron: "0 8 * * *" },
      })
      .expect(422);
  });

  it("accepts a submission with 202, since the work is queued not finished", async () => {
    const goal = await createGoal(alice, aliceWorkspace);

    const response = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    expect(response.body.data.id).toMatch(/^exe_/);
    expect(response.body.data.goalId).toBe(goal.id);
    // The runtime process picks it up from here.
    expect(response.body.data.status).toBe("CREATED");
  });

  it("lists and reads back an execution", async () => {
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    const listed = await testApp
      .http()
      .get("/api/v1/executions")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect(listed.body.data.map((e: { id: string }) => e.id)).toContain(
      submitted.body.data.id,
    );

    const single = await testApp
      .http()
      .get(`/api/v1/executions/${submitted.body.data.id}`)
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect(single.body.data.correlationId).toBeTruthy();
  });

  it("hides another tenant's goal behind 404", async () => {
    const goal = await createGoal(alice, aliceWorkspace);

    // Bob asks with his own workspace header, so the guard lets him through —
    // the repository is what makes Alice's goal invisible.
    await testApp
      .http()
      .get(`/api/v1/goals/${goal.id}`)
      .set(auth(bob, bobWorkspace))
      .expect(404);
  });

  it("hides another tenant's execution behind 404", async () => {
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    await testApp
      .http()
      .get(`/api/v1/executions/${submitted.body.data.id}`)
      .set(auth(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .get(`/api/v1/executions/${submitted.body.data.id}/tasks`)
      .set(auth(bob, bobWorkspace))
      .expect(404);
  });

  it("refuses to act on a workspace the caller does not belong to", async () => {
    // Pointing the header at Bob's workspace must not grant Alice anything.
    await testApp
      .http()
      .post("/api/v1/goals")
      .set(auth(alice, bobWorkspace))
      .send({ title: "Intruder", objective: "Viết bài rồi đăng" })
      .expect(404);
  });

  it("lists only the caller's own workspace", async () => {
    await createGoal(alice, aliceWorkspace);
    await createGoal(bob, bobWorkspace, "Viết bài khác");

    const response = await testApp
      .http()
      .get("/api/v1/goals")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].objective).toBe(OBJECTIVE);
  });

  it("requires authentication", async () => {
    await testApp
      .http()
      .get("/api/v1/executions")
      .set({ "x-workspace-id": aliceWorkspace })
      .expect(401);
  });

  it("accepts a cancellation request with 202, not an immediate stop", async () => {
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    const cancelled = await testApp
      .http()
      .post(`/api/v1/executions/${submitted.body.data.id}/cancel`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    // CANCELLING, not CANCELLED: in-flight work still has to unwind.
    expect(cancelled.body.data.status).toBe("CANCELLING");
  });

  it("reports zero spend for a run that has not been planned yet", async () => {
    // No runtime process is attached here, so nothing has called a provider.
    // Zero is the honest answer; an empty body or a 404 would not be.
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    const usage = await testApp
      .http()
      .get(`/api/v1/executions/${submitted.body.data.id}/usage`)
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect(usage.body.data.calls).toEqual([]);
    expect(Number(usage.body.data.totalUsd)).toBe(0);
    expect(usage.body.data.unpricedCalls).toBe(0);
  });

  it("reports what the workspace has spent, and on what", async () => {
    // The ledger has been written since Phase 2 with no way out. No runtime is
    // attached here, so the honest answer is zeros — but zeros with the right
    // shape, since a blank where a number belongs is what the UI would render.
    const spend = await testApp
      .http()
      .get("/api/v1/usage")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect(Number(spend.body.data.total.costUsd)).toBe(0);
    expect(spend.body.data.total.calls).toBe(0);
    expect(spend.body.data.byModel).toEqual([]);
    expect(new Date(spend.body.data.from).getTime()).toBeLessThan(
      new Date(spend.body.data.to).getTime(),
    );
  });

  it("takes a window, and clamps one nobody thought about", async () => {
    // Somebody typing ?days=99999 wants everything. A year is more useful than
    // an error about a number they did not consider.
    const wide = await testApp
      .http()
      .get("/api/v1/usage?days=99999")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    const span =
      new Date(wide.body.data.to).getTime() -
      new Date(wide.body.data.from).getTime();
    expect(span).toBeLessThanOrEqual(366 * 24 * 60 * 60 * 1000);

    const narrow = await testApp
      .http()
      .get("/api/v1/usage?days=7")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    const week =
      new Date(narrow.body.data.to).getTime() -
      new Date(narrow.body.data.from).getTime();
    expect(Math.round(week / (24 * 60 * 60 * 1000))).toBe(7);
  });

  it("falls back to a sensible window rather than failing on nonsense", async () => {
    const nonsense = await testApp
      .http()
      .get("/api/v1/usage?days=không-phải-số")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    const span =
      new Date(nonsense.body.data.to).getTime() -
      new Date(nonsense.body.data.from).getTime();
    expect(Math.round(span / (24 * 60 * 60 * 1000))).toBe(30);
  });

  it("counts only the workspace the header names", async () => {
    // The guard stops another *person* reading this, and that is tested below.
    // This is the other half: that the figure returned belongs to the
    // workspace asked for. Without it, a service reading the wrong workspace
    // would hand one of Alice's own workspaces the other's costs, and every
    // authorisation test would still pass.
    const usage =
      testApp.app.get<DrizzleAiUsageRepository>(AI_USAGE_REPOSITORY);

    await usage.record({
      id: newId("aiUsage"),
      workspaceId: aliceWorkspace as WorkspaceId,
      userId: null,
      executionId: null,
      taskId: null,
      correlationId: null,
      provider: "anthropic",
      model: "claude-test",
      operation: "test.spend",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      cost: { inputUsd: 0.01, outputUsd: 0.02, totalUsd: 0.03, priced: true },
      latencyMs: 120,
      finishReason: "stop",
      metadata: {},
      timestamp: new Date(),
    });

    const mine = await testApp
      .http()
      .get("/api/v1/usage")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect(Number(mine.body.data.total.costUsd)).toBeCloseTo(0.03, 8);
    expect(mine.body.data.byModel[0].model).toBe("claude-test");

    // A second workspace of the same person: same guard, different figure.
    const second = (await createTenant(testApp, alice, "alice-second"))
      .workspaceId;
    const other = await testApp
      .http()
      .get("/api/v1/usage")
      .set(auth(alice, second))
      .expect(200);

    expect(Number(other.body.data.total.costUsd)).toBe(0);
    expect(other.body.data.byModel).toEqual([]);
  });

  it("does not show one workspace's spend to another", async () => {
    // Cost is commercially sensitive: what a competitor spends on AI is a
    // signal about their volume.
    await testApp
      .http()
      .get("/api/v1/usage")
      .set(auth(bob, aliceWorkspace))
      .expect(404);
  });

  it("hides another tenant's spend behind 404", async () => {
    // Cost is commercially sensitive: what a competitor spends on AI is a
    // signal about their volume. It has to be as unreachable as the run itself.
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    await testApp
      .http()
      .get(`/api/v1/executions/${submitted.body.data.id}/usage`)
      .set(auth(bob, bobWorkspace))
      .expect(404);
  });

  it("refuses to approve a run that is not waiting on anyone", async () => {
    // No runtime is attached here, so the execution never reaches WAITING.
    // Saying so beats pretending a decision was recorded.
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    const response = await testApp
      .http()
      .post(`/api/v1/executions/${submitted.body.data.id}/approval`)
      .set(auth(alice, aliceWorkspace))
      .send({ decision: "APPROVED" })
      .expect(409);

    expect(response.body.code).toBe("NOT_AWAITING_APPROVAL");
  });

  it("hides another tenant's pending approval behind 404", async () => {
    // Approving is authorising a side effect on someone's audience. It has to
    // be as unreachable across a workspace boundary as the run itself.
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    await testApp
      .http()
      .post(`/api/v1/executions/${submitted.body.data.id}/approval`)
      .set(auth(bob, bobWorkspace))
      .send({ decision: "APPROVED" })
      .expect(404);
  });

  it("rejects a decision that is neither approve nor reject", async () => {
    const goal = await createGoal(alice, aliceWorkspace);
    const submitted = await testApp
      .http()
      .post(`/api/v1/goals/${goal.id}/executions`)
      .set(auth(alice, aliceWorkspace))
      .expect(202);

    await testApp
      .http()
      .post(`/api/v1/executions/${submitted.body.data.id}/approval`)
      .set(auth(alice, aliceWorkspace))
      .send({ decision: "MAYBE" })
      .expect(422);
  });

  it("rejects a malformed id rather than treating it as not found", async () => {
    await testApp
      .http()
      .get("/api/v1/executions/not-a-real-id")
      .set(auth(alice, aliceWorkspace))
      .expect(400);
  });
});
