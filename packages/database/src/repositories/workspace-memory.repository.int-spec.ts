import { newId, type UserId, type WorkspaceId } from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import { DrizzleWorkspaceMemoryRepository } from "./workspace-memory.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  "DrizzleWorkspaceMemoryRepository (integration)",
  () => {
    let db: DatabaseClient;
    let repo: DrizzleWorkspaceMemoryRepository;
    let workspaceId: WorkspaceId;
    let otherWorkspaceId: WorkspaceId;
    let userId: UserId;

    beforeEach(async () => {
      db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
      repo = new DrizzleWorkspaceMemoryRepository(db);
      await truncateTenantData(db);

      const organizationId = newId("organization");
      userId = newId("user");
      workspaceId = newId("workspace");
      otherWorkspaceId = newId("workspace");

      await db
        .insert(users)
        .values({ id: userId, email: "mem@test.local", status: "ACTIVE" });
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

    const remember = (key: string, value: string, ws = workspaceId) =>
      repo.remember({ workspaceId: ws, key, value }, userId);

    it("remembers a fact", async () => {
      const memory = await remember("giọng văn", "thân thiện, ngắn gọn");

      expect(memory.key).toBe("giọng văn");
      expect(memory.value).toBe("thân thiện, ngắn gọn");
      expect(memory.source).toBe("MANUAL");
    });

    it("replaces what was under that key rather than adding a second answer", async () => {
      // Two answers to "what is our brand voice" leaves the model to pick one,
      // silently.
      await remember("giọng văn", "trang trọng");
      await remember("giọng văn", "thân thiện");

      const all = await repo.list(workspaceId);
      expect(all).toHaveLength(1);
      expect(all[0]?.value).toBe("thân thiện");
    });

    it("does not error when two writers save the same key together", async () => {
      // Insert-then-check would have both see nothing there and both insert,
      // and the unique index would turn a routine save into an error the user
      // has to interpret.
      await Promise.all([
        remember("giọng văn", "A"),
        remember("giọng văn", "B"),
        remember("giọng văn", "C"),
      ]);

      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("lets two workspaces remember different things under one key", async () => {
      await remember("giọng văn", "của A");
      await remember("giọng văn", "của B", otherWorkspaceId);

      expect((await repo.list(workspaceId))[0]?.value).toBe("của A");
      expect((await repo.list(otherWorkspaceId))[0]?.value).toBe("của B");
    });

    it("does not show one workspace's memory to another", async () => {
      const memory = await remember("bí mật", "chỉ A biết");

      expect(await repo.findById(otherWorkspaceId, memory.id)).toBeNull();
      expect(await repo.list(otherWorkspaceId)).toEqual([]);
    });

    it("hides a forgotten fact", async () => {
      const memory = await remember("tạm thời", "xoá đi");

      expect(await repo.forget(workspaceId, memory.id, userId)).toBe(true);
      expect(await repo.list(workspaceId)).toEqual([]);
      expect(await repo.findById(workspaceId, memory.id)).toBeNull();
    });

    it("can remember something again after forgetting it", async () => {
      // The soft-deleted row still holds the unique key. Without clearing
      // deletedAt on conflict, the save would report success and change
      // nothing visible — the worst kind of no-op.
      const memory = await remember("giọng văn", "cũ");
      await repo.forget(workspaceId, memory.id, userId);

      const again = await remember("giọng văn", "mới");

      expect(again.value).toBe("mới");
      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("will not let another workspace forget a fact", async () => {
      const memory = await remember("của A", "riêng tư");

      expect(await repo.forget(otherWorkspaceId, memory.id, userId)).toBe(
        false,
      );
      expect(await repo.list(workspaceId)).toHaveLength(1);
    });

    it("returns the most recently changed first", async () => {
      await remember("một", "1");
      await remember("hai", "2");
      await remember("một", "1 đã sửa");

      expect((await repo.list(workspaceId)).map((m) => m.key)).toEqual([
        "một",
        "hai",
      ]);
    });

    it("bounds what one read returns", async () => {
      // Every one of these goes into a prompt.
      for (let i = 0; i < 8; i += 1) await remember(`khoá ${i}`, `giá trị ${i}`);

      expect(await repo.list(workspaceId, 3)).toHaveLength(3);
    });

    it("trims what it stores", async () => {
      const memory = await remember("  giọng văn  ", "  thân thiện  ");

      expect(memory.key).toBe("giọng văn");
      expect(memory.value).toBe("thân thiện");
    });
  },
);
