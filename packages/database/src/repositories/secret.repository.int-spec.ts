import { newId, type SecretId, type UserId, type WorkspaceId } from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import { DrizzleSecretRepository } from "./secret.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("DrizzleSecretRepository (integration)", () => {
  let db: DatabaseClient;
  let repo: DrizzleSecretRepository;
  let workspaceId: WorkspaceId;
  let otherWorkspaceId: WorkspaceId;
  let userId: UserId;

  const sealed = (text: string) => ({
    keyId: "v1",
    iv: Buffer.alloc(12, 1).toString("base64"),
    tag: Buffer.alloc(16, 2).toString("base64"),
    ciphertext: Buffer.from(text).toString("base64"),
    hint: "••••••••abcd",
  });

  const put = (
    name: string,
    value: string,
    ws: WorkspaceId | null = workspaceId,
  ) =>
    repo.put(
      {
        workspaceId: ws,
        scope: ws === null ? "PLATFORM" : "WORKSPACE",
        name,
        value,
        ...sealed(value),
      },
      userId,
    );

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
    repo = new DrizzleSecretRepository(db);
    await truncateTenantData(db);

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");
    otherWorkspaceId = newId("workspace");

    await db
      .insert(users)
      .values({ id: userId, email: "vault@test.local", status: "ACTIVE" });
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
  });

  it("stores a secret without its value in the metadata row", async () => {
    // The doc is explicit: the value never appears in the metadata.
    const secret = await put("providers/anthropic", "sk-ant-thật");

    expect(secret.name).toBe("providers/anthropic");
    expect(secret.activeVersion).toBe(1);
    expect(JSON.stringify(secret)).not.toContain("sk-ant-thật");
  });

  it("writes a new version rather than overwriting", async () => {
    // A credential replaced here is still in flight elsewhere for a while.
    await put("providers/anthropic", "khoá cũ");
    const updated = await put("providers/anthropic", "khoá mới");

    expect(updated.activeVersion).toBe(2);
    expect(await repo.versions(updated.id)).toHaveLength(2);
  });

  it("resolves to the version currently marked active", async () => {
    await put("providers/anthropic", "khoá cũ");
    const secret = await put("providers/anthropic", "khoá mới");

    const active = await repo.activeVersion(secret.id);

    expect(active?.version).toBe(2);
    expect(Buffer.from(active!.ciphertext, "base64").toString()).toBe(
      "khoá mới",
    );
  });

  it("rolls back to an earlier version", async () => {
    // What versioning is for: a bad rotation becomes a rollback rather than an
    // outage.
    await put("providers/anthropic", "khoá tốt");
    const secret = await put("providers/anthropic", "khoá hỏng");

    const rolled = await repo.activate(secret.id, 1, userId);

    expect(rolled?.activeVersion).toBe(1);
    expect(
      Buffer.from(
        (await repo.activeVersion(secret.id))!.ciphertext,
        "base64",
      ).toString(),
    ).toBe("khoá tốt");
  });

  it("refuses to point at a version that does not exist", async () => {
    // The pointer is what resolution reads. Aiming it into space takes down
    // whatever was using the credential, with nothing to say why.
    const secret = await put("providers/anthropic", "khoá");

    expect(await repo.activate(secret.id, 99, userId)).toBeNull();
    expect(
      (await repo.findByName(workspaceId, "WORKSPACE", "providers/anthropic"))
        ?.activeVersion,
    ).toBe(1);
  });

  it("keeps two workspaces' secrets separate under one name", async () => {
    await put("providers/anthropic", "của A");
    await put("providers/anthropic", "của B", otherWorkspaceId);

    const a = await repo.findByName(
      workspaceId,
      "WORKSPACE",
      "providers/anthropic",
    );
    const b = await repo.findByName(
      otherWorkspaceId,
      "WORKSPACE",
      "providers/anthropic",
    );

    expect(a?.id).not.toBe(b?.id);
    expect(
      Buffer.from((await repo.activeVersion(a!.id))!.ciphertext, "base64").toString(),
    ).toBe("của A");
  });

  it("does not list one workspace's secrets to another", async () => {
    await put("providers/anthropic", "riêng tư");

    expect(await repo.list(otherWorkspaceId, "WORKSPACE")).toEqual([]);
    expect(await repo.list(workspaceId, "WORKSPACE")).toHaveLength(1);
  });

  it("will not let another workspace remove a secret", async () => {
    const secret = await put("providers/anthropic", "riêng tư");

    expect(await repo.remove(otherWorkspaceId, secret.id, userId)).toBe(false);
    expect(await repo.list(workspaceId, "WORKSPACE")).toHaveLength(1);
  });

  it("holds platform secrets, which belong to no workspace", async () => {
    // `eq(column, null)` is never true in SQL, so this is a genuinely
    // different predicate rather than a special case of the other one.
    const secret = await put("providers/openai", "khoá của nền tảng", null);

    expect(secret.workspaceId).toBeNull();
    expect(await repo.list(null, "PLATFORM")).toHaveLength(1);
    expect(
      (await repo.findByName(null, "PLATFORM", "providers/openai"))?.id,
    ).toBe(secret.id);
  });

  it("keeps one platform secret per name", async () => {
    // Postgres treats NULLs as distinct in a unique index, so the ordinary
    // index does not constrain platform secrets — a partial index does.
    await put("providers/openai", "một", null);
    await put("providers/openai", "hai", null);

    expect(await repo.list(null, "PLATFORM")).toHaveLength(1);
  });

  it("hides a removed secret and can take it back", async () => {
    const secret = await put("providers/anthropic", "khoá");

    expect(await repo.remove(workspaceId, secret.id, userId)).toBe(true);
    expect(await repo.list(workspaceId, "WORKSPACE")).toEqual([]);

    // The soft-deleted row still holds the unique name, so putting the value
    // back has to clear the flag or the save is a silent no-op.
    const again = await put("providers/anthropic", "khoá mới");
    expect(again.id).toBe(secret.id);
    expect(await repo.list(workspaceId, "WORKSPACE")).toHaveLength(1);
  });

  it("returns nothing for a secret that never existed", async () => {
    expect(
      await repo.activeVersion(newId("secret") as SecretId),
    ).toBeNull();
    expect(
      await repo.findByName(workspaceId, "WORKSPACE", "không/có"),
    ).toBeNull();
  });
});
