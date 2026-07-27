import { newId, type WorkspaceId } from "@repo/core";
import { RuntimeError } from "@repo/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryVectorStore } from "./memory-store";
import {
  collectionNameFor,
  cosineSimilarity,
  type VectorCollection,
  type VectorPoint,
} from "./types";

const SPEC = { model: "text-embedding-3-small", dimensions: 3 };

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

describe("InMemoryVectorStore", () => {
  let collection: VectorCollection;

  beforeEach(async () => {
    collection = await new InMemoryVectorStore().collection(SPEC);
  });

  it("returns the same collection for the same model", async () => {
    const store = new InMemoryVectorStore();
    const first = await store.collection(SPEC);
    const second = await store.collection(SPEC);

    expect(second).toBe(first);
    expect(store.collectionNames).toEqual([collectionNameFor(SPEC.model)]);
  });

  it("keeps a separate collection per embedding model", async () => {
    // Vectors from two models share no coordinate system, so a collection
    // holding both would return scores that mean nothing.
    const store = new InMemoryVectorStore();
    await store.collection(SPEC);
    await store.collection({ model: "nomic-embed-text", dimensions: 768 });

    expect(store.collectionNames).toHaveLength(2);
  });

  it("ranks the closest vector first", async () => {
    const near = point(WS_A, [1, 0, 0], { text: "gần" });
    const far = point(WS_A, [0, 0, 1], { text: "xa" });
    await collection.upsert([far, near]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 10,
    });

    expect(hits.map((hit) => hit.text)).toEqual(["gần", "xa"]);
    expect(hits[0]?.score).toBeCloseTo(1);
  });

  it("never returns another workspace's chunks", async () => {
    // The one failure this whole layer exists to prevent. Identical vectors,
    // so ranking cannot be what excludes the other tenant.
    await collection.upsert([
      point(WS_A, [1, 0, 0], { text: "của A" }),
      point(WS_B, [1, 0, 0], { text: "của B" }),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 10,
    });

    expect(hits.map((hit) => hit.text)).toEqual(["của A"]);
  });

  it("fills the limit from this workspace, not from what is left after filtering", async () => {
    // A store that takes the top-k first and filters afterwards returns fewer
    // rows than asked for whenever another tenant outranks you — the answer
    // gets quietly thinner the more neighbours you have.
    await collection.upsert([
      ...Array.from({ length: 5 }, () => point(WS_B, [1, 0, 0])),
      ...Array.from({ length: 3 }, (_, i) =>
        point(WS_A, [0.9, 0.1, 0], { text: `A${i}` }),
      ),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 3,
    });

    expect(hits).toHaveLength(3);
  });

  it("drops hits below the score floor", async () => {
    await collection.upsert([
      point(WS_A, [1, 0, 0], { text: "liên quan" }),
      point(WS_A, [0, 1, 0], { text: "không liên quan" }),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 10,
      minScore: 0.5,
    });

    expect(hits.map((hit) => hit.text)).toEqual(["liên quan"]);
  });

  it("narrows to the requested documents", async () => {
    const wanted = newId("document");
    await collection.upsert([
      point(WS_A, [1, 0, 0], { documentId: wanted, text: "trong phạm vi" }),
      point(WS_A, [1, 0, 0], { text: "ngoài phạm vi" }),
    ]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 10,
      documentIds: [wanted],
    });

    expect(hits.map((hit) => hit.text)).toEqual(["trong phạm vi"]);
  });

  it("treats an empty document filter as no filter", async () => {
    await collection.upsert([point(WS_A, [1, 0, 0], { text: "vẫn thấy" })]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 10,
      documentIds: [],
    });

    expect(hits).toHaveLength(1);
  });

  it("replaces a chunk written twice under the same id", async () => {
    const original = point(WS_A, [1, 0, 0], { text: "bản cũ" });
    await collection.upsert([original]);
    await collection.upsert([{ ...original, payload: { ...original.payload, text: "bản mới" } }]);

    const hits = await collection.search({
      workspaceId: WS_A,
      vector: [1, 0, 0],
      limit: 10,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toBe("bản mới");
  });

  it("removes every chunk of a deleted document", async () => {
    const documentId = newId("document");
    await collection.upsert([
      point(WS_A, [1, 0, 0], { documentId, chunkIndex: 0 }),
      point(WS_A, [0, 1, 0], { documentId, chunkIndex: 1 }),
      point(WS_A, [0, 0, 1], { text: "tài liệu khác" }),
    ]);

    const removed = await collection.deleteDocument(WS_A, documentId);

    expect(removed).toBe(2);
    const left = await collection.search({
      workspaceId: WS_A,
      vector: [0, 0, 1],
      limit: 10,
    });
    expect(left.map((hit) => hit.text)).toEqual(["tài liệu khác"]);
  });

  it("will not let one workspace delete another's document", async () => {
    const documentId = newId("document");
    await collection.upsert([point(WS_B, [1, 0, 0], { documentId })]);

    expect(await collection.deleteDocument(WS_A, documentId)).toBe(0);
  });

  it("refuses a vector of the wrong length", async () => {
    // Means something embedded by a different model reached this collection.
    // Accepting it would corrupt every later comparison, invisibly.
    await expect(collection.upsert([point(WS_A, [1, 0])])).rejects.toThrow(
      RuntimeError,
    );
    await expect(
      collection.search({ workspaceId: WS_A, vector: [1, 0], limit: 1 }),
    ).rejects.toThrow(/3-dimension/);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical directions and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 rather than NaN for a zero vector", () => {
    // A NaN score sorts unpredictably and compares false against every
    // threshold, so one degenerate embedding would corrupt whole result sets.
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("collectionNameFor", () => {
  it("keeps the model recognisable and safe to use as a name", () => {
    const name = collectionNameFor("qwen3:0.6b");

    expect(name).toMatch(/^knowledge__qwen3_0_6b__[0-9a-f]{8}$/);
  });

  it("is stable for the same model", () => {
    expect(collectionNameFor("text-embedding-3-small")).toBe(
      collectionNameFor("text-embedding-3-small"),
    );
  });

  it("does not collide between models that sanitise to the same string", () => {
    // Real pairs: OpenRouter separates with "/", Ollama with ":". Both become
    // "_" once unsafe characters are stripped, and the two models would then
    // share one collection — mixed coordinate systems, meaningless scores.
    expect(collectionNameFor("a/b")).not.toBe(collectionNameFor("a:b"));
    expect(collectionNameFor("meta-llama/Llama-3")).not.toBe(
      collectionNameFor("meta-llama:Llama-3"),
    );
  });
});
