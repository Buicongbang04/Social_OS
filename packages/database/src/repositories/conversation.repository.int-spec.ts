import {
  newId,
  type ConversationId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import { DrizzleConversationRepository } from "./conversation.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  "DrizzleConversationRepository (integration)",
  () => {
    let db: DatabaseClient;
    let repo: DrizzleConversationRepository;
    let workspaceId: WorkspaceId;
    let otherWorkspaceId: WorkspaceId;
    let userId: UserId;

    beforeEach(async () => {
      db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
      repo = new DrizzleConversationRepository(db);
      await truncateTenantData(db);

      const organizationId = newId("organization");
      userId = newId("user");
      workspaceId = newId("workspace");
      otherWorkspaceId = newId("workspace");

      await db
        .insert(users)
        .values({ id: userId, email: "chat@test.local", status: "ACTIVE" });
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

    const start = (title?: string) =>
      repo.create(
        { workspaceId, ...(title === undefined ? {} : { title }) },
        userId,
      );

    it("starts an empty thread", async () => {
      const conversation = await start("Về cà phê");

      expect(conversation.title).toBe("Về cà phê");
      expect(conversation.messageCount).toBe(0);
      expect(conversation.lastMessageAt).toBeNull();
    });

    it("does not show a thread to another workspace", async () => {
      const conversation = await start();

      expect(
        await repo.findById(otherWorkspaceId, conversation.id),
      ).toBeNull();
      expect(await repo.findById(workspaceId, conversation.id)).not.toBeNull();
    });

    it("records a turn and moves the conversation's clock", async () => {
      // One operation, not two: a message whose conversation still says it has
      // none sorts to the bottom of the list and looks empty.
      const conversation = await start();

      await repo.appendMessage({
        conversationId: conversation.id,
        workspaceId,
        role: "user",
        content: "Cà phê Việt Nam có gì đặc biệt?",
      });

      const after = await repo.findById(workspaceId, conversation.id);
      expect(after?.messageCount).toBe(1);
      expect(after?.lastMessageAt).not.toBeNull();
    });

    it("counts every turn even when two land together", async () => {
      // Read-then-write would have both turns read the same number, and the
      // count would drift low for ever.
      const conversation = await start();

      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          repo.appendMessage({
            conversationId: conversation.id,
            workspaceId,
            role: "user",
            content: `câu ${i}`,
          }),
        ),
      );

      expect((await repo.findById(workspaceId, conversation.id))?.messageCount).toBe(
        5,
      );
    });

    it("returns the thread oldest first", async () => {
      // The order a model has to read it in.
      const conversation = await start();
      for (const content of ["một", "hai", "ba"]) {
        await repo.appendMessage({
          conversationId: conversation.id,
          workspaceId,
          role: "user",
          content,
        });
      }

      const thread = await repo.listMessages(workspaceId, conversation.id);

      expect(thread.map((m) => m.content)).toEqual(["một", "hai", "ba"]);
    });

    it("keeps what an assistant turn cost", async () => {
      const conversation = await start();

      const message = await repo.appendMessage({
        conversationId: conversation.id,
        workspaceId,
        role: "assistant",
        content: "Robusta là chủ yếu.",
        provider: "ollama",
        model: "qwen2.5:7b",
        inputTokens: 44,
        outputTokens: 57,
        costUsd: "0.00012300",
        finishReason: "stop",
      });

      expect(message.provider).toBe("ollama");
      expect(message.inputTokens).toBe(44);
      // A string, never a float: this is money and it is summed across a month.
      expect(message.costUsd).toBe("0.00012300");
    });

    it("records a truncated answer rather than dropping it", async () => {
      // The reader already saw this text and the vendor already billed for it.
      const conversation = await start();

      const message = await repo.appendMessage({
        conversationId: conversation.id,
        workspaceId,
        role: "assistant",
        content: "Cà phê Việt Nam chủ y",
        truncated: true,
        finishReason: "error",
      });

      expect(message.truncated).toBe(true);
    });

    it("does not return another workspace's messages", async () => {
      const conversation = await start();
      await repo.appendMessage({
        conversationId: conversation.id,
        workspaceId,
        role: "user",
        content: "riêng tư",
      });

      expect(
        await repo.listMessages(otherWorkspaceId, conversation.id),
      ).toEqual([]);
    });

    it("lists the most recently active thread first", async () => {
      const older = await start("Cũ");
      const newer = await start("Mới");
      await repo.appendMessage({
        conversationId: newer.id,
        workspaceId,
        role: "user",
        content: "xin chào",
      });

      const listed = await repo.list(workspaceId);

      expect(listed[0]?.id).toBe(newer.id);
      expect(listed.map((c) => c.id)).toContain(older.id);
    });

    it("does not park an empty thread above an active one", async () => {
      // lastMessageAt is null until the first turn, and Postgres puts NULLs
      // FIRST on a DESC sort — so sorting on it directly makes every empty
      // thread outrank every conversation someone is actually using.
      const active = await start("Đang dùng");
      const empty = await start("Chưa nói gì");
      await repo.appendMessage({
        conversationId: active.id,
        workspaceId,
        role: "user",
        content: "xin chào",
      });

      const listed = await repo.list(workspaceId);

      expect(listed[0]?.id).toBe(active.id);
      // Still listed, just below: an empty thread is not hidden, only ranked
      // by when it was started.
      expect(listed.map((c) => c.id)).toContain(empty.id);
    });

    it("starts with no summary", async () => {
      const conversation = await start();

      expect(conversation.summary).toBeNull();
      expect(conversation.summarisedCount).toBe(0);
    });

    it("folds the overflow into the summary", async () => {
      const conversation = await start();

      const updated = await repo.updateSummary(
        workspaceId,
        conversation.id,
        "Người dùng bán cà phê ở Đắk Lắk, đã chốt giọng văn thân thiện.",
        12,
        0,
      );

      expect(updated?.summary).toContain("Đắk Lắk");
      expect(updated?.summarisedCount).toBe(12);
    });

    it("lets only one of two concurrent summaries land", async () => {
      // Both would otherwise start from the same point, and the second would
      // overwrite the first — losing everything the first had folded in.
      const conversation = await start();

      const [first, second] = await Promise.all([
        repo.updateSummary(workspaceId, conversation.id, "bản A", 12, 0),
        repo.updateSummary(workspaceId, conversation.id, "bản B", 12, 0),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it("refuses a summary computed from a stale starting point", async () => {
      const conversation = await start();
      await repo.updateSummary(workspaceId, conversation.id, "bản 1", 12, 0);

      // A second worker still holding summarisedCount 0.
      expect(
        await repo.updateSummary(workspaceId, conversation.id, "bản 2", 12, 0),
      ).toBeNull();
      expect(
        (await repo.findById(workspaceId, conversation.id))?.summary,
      ).toBe("bản 1");
    });

    it("will not let another workspace write a summary", async () => {
      const conversation = await start();

      expect(
        await repo.updateSummary(
          otherWorkspaceId,
          conversation.id,
          "của người khác",
          12,
          0,
        ),
      ).toBeNull();
    });

    it("renames a thread", async () => {
      const conversation = await start("Hội thoại mới");

      const renamed = await repo.rename(
        workspaceId,
        conversation.id,
        "Kế hoạch marketing quý 3",
        userId,
      );

      expect(renamed?.title).toBe("Kế hoạch marketing quý 3");
    });

    it("will not let another workspace rename or delete a thread", async () => {
      const conversation = await start();

      expect(
        await repo.rename(otherWorkspaceId, conversation.id, "Đổi tên", userId),
      ).toBeNull();
      expect(
        await repo.softDelete(otherWorkspaceId, conversation.id, userId),
      ).toBe(false);
      expect(await repo.findById(workspaceId, conversation.id)).not.toBeNull();
    });

    it("hides a deleted thread from every read", async () => {
      const conversation = await start();

      expect(await repo.softDelete(workspaceId, conversation.id, userId)).toBe(
        true,
      );
      expect(await repo.findById(workspaceId, conversation.id)).toBeNull();
      expect(await repo.list(workspaceId)).toEqual([]);
    });

    it("returns null for a thread that never existed", async () => {
      expect(
        await repo.findById(workspaceId, newId("conversation") as ConversationId),
      ).toBeNull();
    });
  },
);
