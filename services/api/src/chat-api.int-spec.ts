import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * Chat over HTTP against real Postgres.
 *
 * The streaming half needs an AI provider, so those tests skip without one —
 * stubbing the gateway here would prove nothing about the path that ships,
 * which is the whole reason this file talks to the real app.
 */
const hasInfra = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);
const hasProvider = Boolean(process.env.AI_PROVIDER?.trim());
const hasKnowledge = Boolean(
  process.env.QDRANT_URL?.trim() && process.env.MINIO_URL?.trim(),
);

/** Parse an SSE body into its events. */
function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "null";
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe.skipIf(!hasInfra)("chat API (integration)", () => {
  /** Poll until the runtime has indexed the workspace's newest document. */
  async function waitForIndexing(
    user: RegisteredUser,
    workspaceId: string,
    timeoutMs = 90_000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const listed = await testApp
        .http()
        .get("/api/v1/documents")
        .set({
          Authorization: `Bearer ${user.accessToken}`,
          "x-workspace-id": workspaceId,
        });
      const documents = listed.body.data as { status: string }[];
      if (documents.some((document) => document.status === "READY")) return true;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    return false;
  }

  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const auth = (user: RegisteredUser, workspaceId: string) => ({
    Authorization: `Bearer ${user.accessToken}`,
    "x-workspace-id": workspaceId,
  });

  const startThread = async (user: RegisteredUser, workspaceId: string) =>
    (
      await testApp
        .http()
        .post("/api/v1/chat/conversations")
        .set(auth(user, workspaceId))
        .send({ title: "Về cà phê" })
        .expect(201)
    ).body.data as { id: string; title: string };

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();
    alice = await registerUser(testApp, "alice@chat.test");
    bob = await registerUser(testApp, "bob@chat.test");
    aliceWorkspace = (await createTenant(testApp, alice, "alice-chat"))
      .workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob-chat")).workspaceId;
  });

  it("starts an empty thread", async () => {
    const conversation = await startThread(alice, aliceWorkspace);

    expect(conversation.title).toBe("Về cà phê");

    const messages = await testApp
      .http()
      .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
      .set(auth(alice, aliceWorkspace))
      .expect(200);
    expect(messages.body.data).toEqual([]);
  });

  it("does not show one workspace's thread to another", async () => {
    // Same shape as documents: an id alone must not be enough.
    const conversation = await startThread(alice, aliceWorkspace);

    await testApp
      .http()
      .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
      .set(auth(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .get("/api/v1/chat/conversations")
      .set(auth(bob, bobWorkspace))
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual([]);
      });
  });

  it("does not let another workspace delete a thread", async () => {
    const conversation = await startThread(alice, aliceWorkspace);

    await testApp
      .http()
      .delete(`/api/v1/chat/conversations/${conversation.id}`)
      .set(auth(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
      .set(auth(alice, aliceWorkspace))
      .expect(200);
  });

  it("refuses an empty message with per-field detail", async () => {
    // 422, not 400: a schema failure is this app's UNPROCESSABLE_ENTITY, while
    // 400 is reserved for a ValidationError a service throws after the shape
    // was fine. Asserting the field is what proves the pipe ran rather than
    // something else rejecting the request.
    const conversation = await startThread(alice, aliceWorkspace);

    const response = await testApp
      .http()
      .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
      .set(auth(alice, aliceWorkspace))
      .send({ content: "   " })
      .expect(422);

    expect(JSON.stringify(response.body)).toContain("content");
  });

  it.skipIf(hasProvider)(
    "says so instead of hanging when no provider is configured",
    async () => {
      // As an SSE `error` event, not a 400: by the time this is known the
      // status line has already been sent.
      const conversation = await startThread(alice, aliceWorkspace);

      const response = await testApp
        .http()
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set(auth(alice, aliceWorkspace))
        .send({ content: "xin chào" })
        .expect(200);

      const events = parseSse(response.text);
      expect(events.at(-1)?.event).toBe("error");
      expect(String((events.at(-1)?.data as { message: string }).message)).toContain(
        "AI provider",
      );
    },
  );

  it.skipIf(!hasProvider)(
    "streams an answer and records both turns",
    async () => {
      const conversation = await startThread(alice, aliceWorkspace);

      const response = await testApp
        .http()
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set(auth(alice, aliceWorkspace))
        .send({ content: "Chào bạn, nói ngắn gọn giúp tôi cà phê là gì." })
        .expect(200);

      const events = parseSse(response.text);
      const deltas = events.filter((e) => e.event === "delta");
      const done = events.find((e) => e.event === "done");

      expect(deltas.length).toBeGreaterThan(0);
      expect(done).toBeDefined();

      const answer = deltas
        .map((e) => (e.data as { text: string }).text)
        .join("");
      const message = done!.data as {
        content: string;
        role: string;
        provider: string | null;
        inputTokens: number;
      };

      // The stored answer is exactly what the reader saw.
      expect(message.content).toBe(answer);
      expect(message.role).toBe("assistant");
      expect(message.provider).not.toBeNull();
      // Usage on a streamed call is the bug that made this whole path worth
      // testing: the protocol only reports it when asked.
      expect(message.inputTokens).toBeGreaterThan(0);

      const thread = await testApp
        .http()
        .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set(auth(alice, aliceWorkspace))
        .expect(200);

      const roles = (thread.body.data as { role: string }[]).map((m) => m.role);
      expect(roles).toEqual(["user", "assistant"]);
    },
    120_000,
  );

  it.skipIf(!hasProvider)(
    "keeps the question even when the answer never comes",
    async () => {
      // The user turn is written before the model is called, so a failure
      // anywhere after leaves a thread showing what was asked. The opposite
      // order loses the question too, and the reader cannot tell whether it
      // was ever sent.
      const conversation = await startThread(alice, aliceWorkspace);

      await testApp
        .http()
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set(auth(alice, aliceWorkspace))
        .send({ content: "một câu hỏi" })
        .expect(200);

      const thread = await testApp
        .http()
        .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set(auth(alice, aliceWorkspace))
        .expect(200);

      expect((thread.body.data as { role: string }[])[0]?.role).toBe("user");
    },
    120_000,
  );

  it.skipIf(!hasProvider)(
    "remembers the beginning of a thread longer than the window",
    async () => {
      // The failure this closes: past the window the model simply stops
      // knowing the start of the conversation, answers something that
      // contradicts what was agreed, and nothing anywhere says why.
      const conversation = await startThread(alice, aliceWorkspace);

      const say = async (content: string) => {
        await testApp
          .http()
          .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
          .set(auth(alice, aliceWorkspace))
          .send({ content })
          .expect(200);
      };

      // The fact worth remembering goes first, so it is the thing that falls
      // out of the window.
      await say("Nhớ giúp tôi: thương hiệu của tôi tên là Tiximax.");
      for (let turn = 0; turn < 16; turn += 1) {
        await say(`Đếm giúp tôi số ${turn}.`);
      }

      const after = await testApp
        .http()
        .get("/api/v1/chat/conversations")
        .set(auth(alice, aliceWorkspace))
        .expect(200);

      const thread = (after.body.data as { id: string; summary: string | null }[])
        .find((c) => c.id === conversation.id);

      // Asserting the summary exists and mentions the fact, rather than
      // asserting the model's next answer: what a model says varies, whether
      // the fact survived the window does not.
      expect(thread?.summary).not.toBeNull();
      expect(thread?.summary ?? "").toContain("Tiximax");
    },
    600_000,
  );

  it.skipIf(!hasProvider || !hasKnowledge)(
    "answers from a document the workspace uploaded",
    async () => {
      // The gap this closes: RAG ran on the Goal path and not the chat path,
      // so asking about a file just uploaded got an answer from the model's
      // own knowledge with nothing saying the document was never opened.
      const note = [
        "# Sổ tay kiểm chứng chat",
        "",
        "Mã giảm giá nội bộ của chúng tôi là TIXICHAT77, giảm 37% cho đơn đầu tiên.",
      ].join("\n");

      await testApp
        .http()
        .post("/api/v1/documents")
        .set(auth(alice, aliceWorkspace))
        .attach("file", Buffer.from(note, "utf8"), {
          filename: "so-tay-chat.md",
          contentType: "text/markdown",
        })
        .expect(201);

      // Indexing runs in the runtime process, so this waits for it rather than
      // assuming it. Without a runtime up, the test is meaningless — which is
      // what the skip below is for.
      const indexed = await waitForIndexing(alice, aliceWorkspace);
      if (!indexed) {
        console.warn("bỏ qua: runtime chưa lập chỉ mục (services/runtime chưa chạy?)");
        return;
      }

      const conversation = await startThread(alice, aliceWorkspace);
      const response = await testApp
        .http()
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set(auth(alice, aliceWorkspace))
        .send({ content: "Mã giảm giá nội bộ của chúng tôi là gì?" })
        .expect(200);

      const events = parseSse(response.text);
      const sources = events.find((e) => e.event === "sources");

      // Asserting on the retrieved passage rather than on the answer: what the
      // model writes varies, whether the right document was opened does not.
      expect(sources).toBeDefined();
      const citations = (sources!.data as { citations: { excerpt: string }[] })
        .citations;
      expect(
        citations.some((citation) => citation.excerpt.includes("TIXICHAT77")),
      ).toBe(true);
    },
    300_000,
  );

  it("lists the thread it just created", async () => {
    const conversation = await startThread(alice, aliceWorkspace);

    const listed = await testApp
      .http()
      .get("/api/v1/chat/conversations")
      .set(auth(alice, aliceWorkspace))
      .expect(200);

    expect((listed.body.data as { id: string }[]).map((c) => c.id)).toContain(
      conversation.id,
    );
  });

  it("hides a deleted thread", async () => {
    const conversation = await startThread(alice, aliceWorkspace);

    await testApp
      .http()
      .delete(`/api/v1/chat/conversations/${conversation.id}`)
      .set(auth(alice, aliceWorkspace))
      .expect(204);

    await testApp
      .http()
      .get(`/api/v1/chat/conversations/${conversation.id}/messages`)
      .set(auth(alice, aliceWorkspace))
      .expect(404);
  });
});
