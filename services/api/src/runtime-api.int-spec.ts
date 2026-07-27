import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

  it("rejects a malformed id rather than treating it as not found", async () => {
    await testApp
      .http()
      .get("/api/v1/executions/not-a-real-id")
      .set(auth(alice, aliceWorkspace))
      .expect(400);
  });
});
