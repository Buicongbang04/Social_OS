import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * The isolation suite.
 *
 * This is the test the whole tenant model exists for: proving that a user who
 * owns workspace A cannot read, modify or administer workspace B, and that
 * being an OWNER somewhere does not confer any authority anywhere else
 * (docs/platform/08_PERMISSION_MODEL.md: "Không cộng dồn quyền giữa các Workspace").
 *
 * Runs against the real Postgres and Redis — nothing is stubbed, because a
 * mocked repository would prove nothing about isolation.
 */
const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!hasInfra)("workspace isolation (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;
  let bobOrganization: string;

  const auth = (user: RegisteredUser) => ({
    Authorization: `Bearer ${user.accessToken}`,
  });

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();

    alice = await registerUser(testApp, "alice@isolation.test");
    bob = await registerUser(testApp, "bob@isolation.test");

    const aliceTenant = await createTenant(testApp, alice, "alice");
    const bobTenant = await createTenant(testApp, bob, "bob");

    aliceWorkspace = aliceTenant.workspaceId;
    bobWorkspace = bobTenant.workspaceId;
    bobOrganization = bobTenant.organizationId;
  });

  it("lets an owner read their own workspace", async () => {
    const response = await testApp
      .http()
      .get(`/api/v1/workspaces/${aliceWorkspace}`)
      .set(auth(alice))
      .expect(200);

    expect(response.body.data.id).toBe(aliceWorkspace);
  });

  it("hides another tenant's workspace behind 404, not 403", async () => {
    // 403 would confirm the workspace exists. 404 reveals nothing.
    await testApp
      .http()
      .get(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(alice))
      .expect(404);
  });

  it("refuses to modify another tenant's workspace", async () => {
    await testApp
      .http()
      .patch(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(alice))
      .send({ version: 1, name: "Hijacked" })
      .expect(404);

    // And Bob's workspace is untouched.
    const bobView = await testApp
      .http()
      .get(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(bob))
      .expect(200);

    expect(bobView.body.data.name).not.toBe("Hijacked");
  });

  it("refuses to list or add members of another tenant's workspace", async () => {
    await testApp
      .http()
      .get(`/api/v1/workspaces/${bobWorkspace}/members`)
      .set(auth(alice))
      .expect(404);

    await testApp
      .http()
      .post(`/api/v1/workspaces/${bobWorkspace}/members`)
      .set(auth(alice))
      .send({ userId: alice.userId, role: "OWNER" })
      .expect(404);
  });

  it("lists only the caller's own workspaces", async () => {
    const response = await testApp
      .http()
      .get("/api/v1/workspaces")
      .set(auth(alice))
      .expect(200);

    const ids = response.body.data.map(
      (workspace: { id: string }) => workspace.id,
    );
    expect(ids).toEqual([aliceWorkspace]);
    expect(ids).not.toContain(bobWorkspace);
  });

  it("hides another tenant's organization too", async () => {
    await testApp
      .http()
      .get(`/api/v1/organizations/${bobOrganization}`)
      .set(auth(alice))
      .expect(404);
  });

  it("cannot create a workspace inside another tenant's organization", async () => {
    await testApp
      .http()
      .post("/api/v1/workspaces")
      .set(auth(alice))
      .send({
        name: "Intruder",
        slug: "intruder",
        organizationId: bobOrganization,
      })
      .expect(403);
  });

  /**
   * The non-accumulation proof: Alice is OWNER of her own workspace, and is
   * then given a VIEWER seat in Bob's. Her OWNER authority must not follow her.
   */
  it("does not carry OWNER authority into a workspace where the user is only a VIEWER", async () => {
    await testApp
      .http()
      .post(`/api/v1/workspaces/${bobWorkspace}/members`)
      .set(auth(bob))
      .send({ userId: alice.userId, role: "VIEWER" })
      .expect(201);

    // As a VIEWER she can now see it...
    await testApp
      .http()
      .get(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(alice))
      .expect(200);

    // ...but administering it is denied — 403 now, because she *is* a member,
    // so there is nothing left to hide.
    await testApp
      .http()
      .post(`/api/v1/workspaces/${bobWorkspace}/members`)
      .set(auth(alice))
      .send({ userId: bob.userId, role: "GUEST" })
      .expect(403);

    await testApp
      .http()
      .patch(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(alice))
      .send({ version: 1, name: "Renamed by a viewer" })
      .expect(403);

    // Meanwhile the same operations still succeed in her own workspace.
    await testApp
      .http()
      .patch(`/api/v1/workspaces/${aliceWorkspace}`)
      .set(auth(alice))
      .send({ version: 1, name: "Renamed by its owner" })
      .expect(200);
  });

  it("revokes access as soon as a membership is removed", async () => {
    await testApp
      .http()
      .post(`/api/v1/workspaces/${bobWorkspace}/members`)
      .set(auth(bob))
      .send({ userId: alice.userId, role: "VIEWER" })
      .expect(201);

    await testApp
      .http()
      .get(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(alice))
      .expect(200);

    await testApp
      .http()
      .delete(`/api/v1/workspaces/${bobWorkspace}/members/${alice.userId}`)
      .set(auth(bob))
      .expect(204);

    // Must take effect immediately: a stale permission cache entry here would
    // leave a removed member with access until the TTL expired.
    await testApp
      .http()
      .get(`/api/v1/workspaces/${bobWorkspace}`)
      .set(auth(alice))
      .expect(404);
  });

  it("rejects a stale version with 409 rather than clobbering a concurrent write", async () => {
    await testApp
      .http()
      .patch(`/api/v1/workspaces/${aliceWorkspace}`)
      .set(auth(alice))
      .send({ version: 1, name: "First write" })
      .expect(200);

    await testApp
      .http()
      .patch(`/api/v1/workspaces/${aliceWorkspace}`)
      .set(auth(alice))
      .send({ version: 1, name: "Second write from a stale client" })
      .expect(409);
  });

  it("refuses to delete an ACTIVE workspace before it is archived", async () => {
    const conflict = await testApp
      .http()
      .delete(`/api/v1/workspaces/${aliceWorkspace}?version=1`)
      .set(auth(alice))
      .expect(409);

    expect(conflict.body.code).toBe("WORKSPACE_NOT_ARCHIVED");

    await testApp
      .http()
      .patch(`/api/v1/workspaces/${aliceWorkspace}`)
      .set(auth(alice))
      .send({ version: 1, status: "ARCHIVED" })
      .expect(200);

    await testApp
      .http()
      .delete(`/api/v1/workspaces/${aliceWorkspace}?version=2`)
      .set(auth(alice))
      .expect(204);
  });

  it("refuses to remove the last owner", async () => {
    const conflict = await testApp
      .http()
      .delete(`/api/v1/workspaces/${aliceWorkspace}/members/${alice.userId}`)
      .set(auth(alice))
      .expect(409);

    expect(conflict.body.code).toBe("LAST_OWNER_CANNOT_BE_REMOVED");
  });

  it("rejects a request with no workspace context instead of guessing one", async () => {
    await testApp
      .http()
      .get("/api/v1/workspaces/not-a-valid-id")
      .set(auth(alice))
      .expect(400);
  });
});
