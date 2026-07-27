import {
  DEFAULT_GATEWAY_CONFIG,
  ProviderGateway,
  ProviderRegistry,
  StubProviderAdapter,
  describeProvider,
} from "@repo/ai";
import { newId } from "@repo/core";
import { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { InMemoryVectorStore } from "./store/memory-store";
import { KnowledgeService } from "./service";
import { chunkText } from "./chunking/chunk";

const WS_A = newId("workspace");
const WS_B = newId("workspace");

/**
 * Chunks small enough that the four-paragraph article below becomes four
 * chunks. With the production default of 1000 characters the whole article is
 * a single chunk, and a ranking test over one chunk asserts nothing.
 */
const SMALL_CHUNKS = { size: 90, overlap: 0 };

function build(options: { dimensions?: number } = {}) {
  const registry = new ProviderRegistry(() => Date.now());
  const stub = new StubProviderAdapter({
    provider: "openai",
    embeddingDimensions: options.dimensions ?? 32,
  });
  registry.register(stub, describeProvider("openai"));

  const gateway = new ProviderGateway(registry, {
    ...DEFAULT_GATEWAY_CONFIG,
    default: "openai",
  });
  const store = new InMemoryVectorStore();
  const service = new KnowledgeService({
    gateway,
    store,
    chunking: SMALL_CHUNKS,
  });

  return { service, store, stub, gateway };
}

const ARTICLE = [
  "Cà phê Việt Nam chủ yếu là robusta, trồng nhiều ở Tây Nguyên.",
  "Đắk Lắk là tỉnh có sản lượng cà phê lớn nhất cả nước.",
  "Trà xanh được trồng nhiều ở Thái Nguyên và Lâm Đồng.",
  "Xuất khẩu cà phê mang về hàng tỷ đô la mỗi năm cho Việt Nam.",
].join("\n\n");

describe("KnowledgeService.index", () => {
  it("chunks, embeds and stores a document", async () => {
    const { service } = build();

    const result = await service.index({
      workspaceId: WS_A,
      documentId: newId("document"),
      title: "Nông sản Việt Nam",
      text: ARTICLE,
      });

    expect(result.chunks).toBeGreaterThan(0);
    expect(result.dimensions).toBe(32);
    expect(result.collection).toContain("knowledge__");
  });

  it("embeds every chunk, not just the first batch", async () => {
    // With a batch size of 64, a document of 200 chunks needs four calls; a
    // loop that stopped after one would still return a plausible result and
    // leave most of the document unsearchable.
    const { service, stub } = build();
    const long = Array.from(
      { length: 200 },
      (_, i) => `Đoạn văn số ${i} nói về một chủ đề riêng biệt.`,
    ).join("\n\n");
    // Each paragraph is its own chunk here, so this is 200 chunks and four
    // provider calls — enough for a loop that stops after the first to show.

    const result = await service.index({
      workspaceId: WS_A,
      documentId: newId("document"),
      title: "Tài liệu dài",
      text: long,
    });

    // Against `chunkText`, not against `result.chunks`: a loop that stops
    // after the first batch reports a smaller count too, so the two agree
    // with each other while both understate the document.
    const expected = chunkText(long, SMALL_CHUNKS).length;
    expect(expected).toBeGreaterThan(64);
    expect(result.chunks).toBe(expected);
    expect(stub.embedded).toHaveLength(expected);
  });

  it("refuses a document with no text to index", async () => {
    const { service } = build();

    await expect(
      service.index({
        workspaceId: WS_A,
        documentId: newId("document"),
        title: "Rỗng",
        text: "   \n\n  ",
      }),
    ).rejects.toThrow(RuntimeError);
  });

  it("replaces the previous version instead of adding to it", async () => {
    // A re-index that only upserts leaves the removed paragraphs searchable,
    // so the document keeps answering with text it no longer contains.
    const { service } = build();
    const documentId = newId("document");

    await service.index({
      workspaceId: WS_A,
      documentId,
      title: "Bản 1",
      text: ARTICLE,
    });
    const second = await service.index({
      workspaceId: WS_A,
      documentId,
      title: "Bản 2",
      text: "Chỉ còn một câu duy nhất về cà phê.",
    });

    expect(second.replaced).toBeGreaterThan(0);
    expect(second.chunks).toBe(1);

    const hits = await service.search({
      workspaceId: WS_A,
      query: "cà phê",
      limit: 20,
      minScore: -1,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe("Bản 2");
  });
});

describe("KnowledgeService.search", () => {
  it("finds the passage that is actually about the question", async () => {
    const { service } = build();
    await service.index({
      workspaceId: WS_A,
      documentId: newId("document"),
      title: "Nông sản",
      text: ARTICLE,
    });

    const hits = await service.search({
      workspaceId: WS_A,
      query: "Đắk Lắk là tỉnh có sản lượng cà phê lớn nhất cả nước.",
      limit: 1,
      minScore: -1,
    });

    expect(hits[0]?.text).toContain("Đắk Lắk");
  });

  it("returns nothing to a workspace that indexed nothing", async () => {
    const { service } = build();
    await service.index({
      workspaceId: WS_A,
      documentId: newId("document"),
      title: "Của A",
      text: ARTICLE,
    });

    const hits = await service.search({
      workspaceId: WS_B,
      query: "cà phê",
      minScore: -1,
    });

    expect(hits).toEqual([]);
  });

  it("does not call the provider for an empty question", async () => {
    // Embedding whitespace costs money and, on OpenAI, returns a 400.
    const { service, stub } = build();

    expect(await service.search({ workspaceId: WS_A, query: "   " })).toEqual(
      [],
    );
    expect(stub.embedded).toEqual([]);
  });

  it("carries the citation back with each hit", async () => {
    const { service } = build();
    const documentId = newId("document");
    await service.index({
      workspaceId: WS_A,
      documentId,
      title: "Nông sản",
      text: ARTICLE,
    });

    const hit = (
      await service.search({
        workspaceId: WS_A,
        query: "cà phê",
        limit: 1,
        minScore: -1,
      })
    )[0]!;

    expect(hit.documentId).toBe(documentId);
    expect(hit.title).toBe("Nông sản");
    expect(ARTICLE.slice(hit.startOffset, hit.endOffset)).toBe(hit.text);
  });

  it("keeps out hits below the score floor", async () => {
    const { service } = build();
    await service.index({
      workspaceId: WS_A,
      documentId: newId("document"),
      title: "Nông sản",
      text: ARTICLE,
    });

    const hits = await service.search({
      workspaceId: WS_A,
      query: "cà phê",
      minScore: 1.1,
    });

    expect(hits).toEqual([]);
  });
});

describe("KnowledgeService.remove", () => {
  it("removes the document from every collection, not just the current model", async () => {
    // After an embedding-model change the old chunks are unsearchable but very
    // much still stored. "Delete my document" has to reach those too.
    const registry = new ProviderRegistry(() => Date.now());
    registry.register(
      new StubProviderAdapter({ provider: "openai", embeddingDimensions: 8 }),
      describeProvider("openai"),
    );
    const gateway = new ProviderGateway(registry, {
      ...DEFAULT_GATEWAY_CONFIG,
      default: "openai",
    });
    const store = new InMemoryVectorStore();
    const documentId = newId("document");

    await new KnowledgeService({
      gateway,
      store,
      model: "model-cũ",
      chunking: SMALL_CHUNKS,
    }).index({
      workspaceId: WS_A,
      documentId,
      title: "Cũ",
      text: ARTICLE,
    });
    const current = new KnowledgeService({
      gateway,
      store,
      model: "model-mới",
      chunking: SMALL_CHUNKS,
    });
    await current.index({
      workspaceId: WS_A,
      documentId,
      title: "Mới",
      text: ARTICLE,
    });

    expect(store.collectionNames).toHaveLength(2);
    const removed = await current.remove(WS_A, documentId);

    expect(removed).toBeGreaterThan(0);
    for (const collection of await store.collections()) {
      expect(
        await collection.deleteDocument(WS_A, documentId),
      ).toBe(0);
    }
  });

  it("will not remove another workspace's document", async () => {
    const { service } = build();
    const documentId = newId("document");
    await service.index({
      workspaceId: WS_A,
      documentId,
      title: "Của A",
      text: ARTICLE,
    });

    expect(await service.remove(WS_B, documentId)).toBe(0);
    expect(
      await service.search({
        workspaceId: WS_A,
        query: "cà phê",
        minScore: -1,
      }),
    ).not.toEqual([]);
  });
});
