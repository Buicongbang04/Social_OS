import { newId } from "@repo/core";
import { RuntimeError } from "@repo/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QdrantVectorStore } from "./qdrant-store";
import type { VectorCollection, VectorPoint } from "./types";
import type { WorkspaceId } from "@repo/core";

/**
 * Against a real Qdrant, because the parts most likely to be wrong are the
 * parts the in-memory store cannot have: the point ID format the server
 * accepts, the filter syntax, and whether a write is visible to the next read.
 *
 *   docker compose up -d qdrant
 *   pnpm --filter @repo/knowledge test:int
 */
const URL = process.env.QDRANT_URL ?? "http://localhost:6333";

// A model name unique to this run, so the collection is this test's alone and
// a failed run cannot leave rows that make the next one pass.
const MODEL = `int-test-${Date.now()}`;
const DIMENSIONS = 4;

const WS_A = newId("workspace");
const WS_B = newId("workspace");

function point(
  workspaceId: WorkspaceId,
  vector: readonly number[],
  overrides: Partial<VectorPoint["payload"]> = {},
): VectorPoint {
  return {
    id: newId("chunk"),
    vector,
    payload: {
      workspaceId,
      documentId: newId("document"),
      chunkIndex: 0,
      text: "nội dung",
      startOffset: 0,
      endOffset: 8,
      title: "tài liệu",
      ...overrides,
    },
  };
}

describe("QdrantVectorStore", () => {
  let store: QdrantVectorStore;
  let collection: VectorCollection;

  beforeAll(async () => {
    store = new QdrantVectorStore({ url: URL });
    collection = await store.collection({
      model: MODEL,
      dimensions: DIMENSIONS,
    });
  });

  afterAll(async () => {
    await fetch(`${URL}/collections/${collection.name}`, { method: "DELETE" });
  });

  it("accepts our branded chunk IDs", async () => {
    // Qdrant takes only unsigned integers and UUIDs as point IDs; the client's
    // type says `string`, so `chk_01HX…` compiles and fails at the server.
    await expect(
      collection.upsert([point(WS_A, [1, 0, 0, 0], { text: "id hợp lệ" })]),
    ).resolves.toBeUndefined();
  });

  it("makes a write visible to the very next search", async () => {
    // Without `wait: true` Qdrant acknowledges before indexing, so indexing a
    // document and immediately searching it finds nothing.
    const documentId = newId("document");
    await collection.upsert([
      point(WS_A, [0, 1, 0, 0], { documentId, text: "vừa ghi xong" }),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [0, 1, 0, 0],
      limit: 5,
      documentIds: [documentId],
    });

    expect(hits.map((hit) => hit.text)).toEqual(["vừa ghi xong"]);
  });

  it("returns the chunk ID the caller gave, not the point ID", async () => {
    const written = point(WS_A, [0, 0, 1, 0], { text: "kiểm tra id" });
    await collection.upsert([written]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [0, 0, 1, 0],
      limit: 1,
      documentIds: [written.payload.documentId],
    });

    expect(hits[0]?.id).toBe(written.id);
  });

  it("never returns another workspace's chunks", async () => {
    const documentId = newId("document");
    await collection.upsert([
      point(WS_A, [1, 1, 0, 0], { documentId, text: "của A" }),
      point(WS_B, [1, 1, 0, 0], { documentId, text: "của B" }),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 1, 0, 0],
      limit: 10,
      documentIds: [documentId],
    });

    expect(hits.map((hit) => hit.text)).toEqual(["của A"]);
  });

  it("applies the score floor server-side", async () => {
    const documentId = newId("document");
    await collection.upsert([
      point(WS_A, [1, 0, 0, 0], { documentId, text: "gần" }),
      point(WS_A, [0, 0, 0, 1], { documentId, text: "vuông góc" }),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0, 0],
      limit: 10,
      minScore: 0.5,
      documentIds: [documentId],
    });

    expect(hits.map((hit) => hit.text)).toEqual(["gần"]);
  });

  it("overwrites rather than duplicates when the same chunk is written twice", async () => {
    const original = point(WS_A, [0.5, 0.5, 0, 0], { text: "bản cũ" });
    await collection.upsert([original]);
    await collection.upsert([
      { ...original, payload: { ...original.payload, text: "bản mới" } },
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [0.5, 0.5, 0, 0],
      limit: 10,
      documentIds: [original.payload.documentId],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toBe("bản mới");
  });

  it("removes every chunk of a document and reports how many", async () => {
    const documentId = newId("document");
    await collection.upsert([
      point(WS_A, [1, 0, 0, 0], { documentId, chunkIndex: 0 }),
      point(WS_A, [0, 1, 0, 0], { documentId, chunkIndex: 1 }),
    ]);

    expect(await collection.deleteDocument(WS_A, documentId)).toBe(2);
    expect(
      await collection.search({
        workspaceId: WS_A,
        vector: [1, 0, 0, 0],
        limit: 10,
        documentIds: [documentId],
      }),
    ).toEqual([]);
  });

  it("will not let one workspace delete another's document", async () => {
    const documentId = newId("document");
    await collection.upsert([point(WS_B, [1, 0, 0, 0], { documentId })]);

    expect(await collection.deleteDocument(WS_A, documentId)).toBe(0);
    expect(
      await collection.search({
        workspaceId: WS_B,
        vector: [1, 0, 0, 0],
        limit: 10,
        documentIds: [documentId],
      }),
    ).toHaveLength(1);
  });

  it("refuses a vector of the wrong length before it reaches the server", async () => {
    await expect(collection.upsert([point(WS_A, [1, 0])])).rejects.toThrow(
      RuntimeError,
    );
  });

  it("lists its own collections and ignores everything else in the database", async () => {
    const listed = await store.collections();

    expect(listed.map((entry) => entry.name)).toContain(collection.name);
    expect(listed.every((entry) => entry.name.startsWith("knowledge__"))).toBe(
      true,
    );
    expect(
      listed.find((entry) => entry.name === collection.name)?.dimensions,
    ).toBe(DIMENSIONS);
  });

  it("returns the same handle for a second call rather than recreating", async () => {
    // createCollection is not idempotent — a second one answers 409.
    await expect(
      store.collection({ model: MODEL, dimensions: DIMENSIONS }),
    ).resolves.toBeDefined();
  });
});
