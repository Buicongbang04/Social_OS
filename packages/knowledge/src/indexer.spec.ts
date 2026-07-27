import {
  DEFAULT_GATEWAY_CONFIG,
  ProviderGateway,
  ProviderRegistry,
  StubProviderAdapter,
  describeProvider,
} from "@repo/ai";
import { newId, type DocumentId, type WorkspaceId } from "@repo/core";
import {
  canTransitionDocument,
  type CreateDocumentInput,
  type Document,
  type DocumentRepository,
  type UpdateDocumentIndexInput,
} from "@repo/domain";
import { InMemoryObjectStore } from "@repo/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { DocumentIndexer } from "./indexer";
import { KnowledgeService } from "./service";
import { InMemoryVectorStore } from "./store/memory-store";

const NOTE = [
  "Cà phê Việt Nam chủ yếu là robusta, trồng nhiều ở Tây Nguyên.",
  "Đắk Lắk là tỉnh có sản lượng cà phê lớn nhất cả nước.",
  "Trà xanh được trồng nhiều ở Thái Nguyên và Lâm Đồng.",
].join("\n\n");

const SMALL_CHUNKS = { size: 90, overlap: 0 };

/**
 * The repository, in a map.
 *
 * Not a stub that returns whatever is asked for: it enforces the same version
 * compare-and-swap and the same transition whitelist as the Drizzle one, which
 * is what makes it able to catch a claim or a completion using the wrong
 * version. A repository fake that always succeeds would let exactly that bug
 * through.
 */
class FakeDocumentRepository implements DocumentRepository {
  readonly rows = new Map<DocumentId, Document>();

  add(overrides: Partial<Document> = {}): Document {
    const id = newId("document");
    const document: Document = {
      id,
      workspaceId: newId("workspace"),
      uploadedBy: null,
      title: "Nông sản",
      fileName: "nong-san.txt",
      mimeType: "text/plain",
      sizeBytes: NOTE.length,
      checksum: `sum-${id}`,
      storageKey: "documents/x/y",
      status: "PENDING",
      failureReason: null,
      chunkCount: 0,
      embeddingModel: null,
      indexedAt: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: null,
      updatedBy: null,
      version: 1,
      deletedAt: null,
      deletedBy: null,
      ...overrides,
    };
    this.rows.set(document.id, document);
    return document;
  }

  async findById(workspaceId: WorkspaceId, id: DocumentId) {
    const row = this.rows.get(id);
    return row && row.workspaceId === workspaceId ? row : null;
  }

  async list(workspaceId: WorkspaceId) {
    return [...this.rows.values()].filter(
      (row) => row.workspaceId === workspaceId,
    );
  }

  async findByChecksum(workspaceId: WorkspaceId, checksum: string) {
    return (
      [...this.rows.values()].find(
        (row) => row.workspaceId === workspaceId && row.checksum === checksum,
      ) ?? null
    );
  }

  async listPendingForIndexing(limit: number) {
    return [...this.rows.values()]
      .filter((row) => row.status === "PENDING")
      .slice(0, limit);
  }

  async create(_input: CreateDocumentInput): Promise<Document> {
    throw new Error("not used");
  }

  async updateIndexState(
    workspaceId: WorkspaceId,
    id: DocumentId,
    input: UpdateDocumentIndexInput,
    expectedVersion: number,
  ) {
    const row = this.rows.get(id);
    if (
      !row ||
      row.workspaceId !== workspaceId ||
      row.version !== expectedVersion ||
      !canTransitionDocument(row.status, input.status)
    ) {
      return null;
    }

    const next: Document = {
      ...row,
      status: input.status,
      failureReason: input.failureReason ?? null,
      chunkCount: input.chunkCount ?? row.chunkCount,
      embeddingModel: input.embeddingModel ?? row.embeddingModel,
      indexedAt: input.indexedAt ?? row.indexedAt,
      version: row.version + 1,
    };
    this.rows.set(id, next);
    return next;
  }

  async softDelete() {
    return true;
  }
}

function build() {
  const registry = new ProviderRegistry(() => Date.now());
  const stub = new StubProviderAdapter({
    provider: "openai",
    embeddingDimensions: 16,
  });
  registry.register(stub, describeProvider("openai"));

  const gateway = new ProviderGateway(registry, {
    ...DEFAULT_GATEWAY_CONFIG,
    default: "openai",
  });
  const vectors = new InMemoryVectorStore();
  const knowledge = new KnowledgeService({
    gateway,
    store: vectors,
    chunking: SMALL_CHUNKS,
  });
  const storage = new InMemoryObjectStore();
  const documents = new FakeDocumentRepository();
  const errors: unknown[] = [];

  const indexer = new DocumentIndexer({
    documents,
    storage,
    knowledge,
    onError: (error) => errors.push(error),
  });

  return { indexer, documents, storage, knowledge, vectors, stub, errors };
}

async function store(
  storage: InMemoryObjectStore,
  document: Document,
  text = NOTE,
) {
  await storage.put({
    workspaceId: document.workspaceId,
    folder: "documents",
    name: document.checksum,
    body: new TextEncoder().encode(text),
    contentType: "text/plain",
  });
}

describe("DocumentIndexer", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build();
  });

  it("indexes a pending document and marks it READY", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document);

    const result = await harness.indexer.runOnce();

    expect(result).toMatchObject({ claimed: 1, indexed: 1, failed: 0 });
    expect(result.chunks).toBeGreaterThan(0);

    const after = harness.documents.rows.get(document.id)!;
    expect(after.status).toBe("READY");
    expect(after.chunkCount).toBe(result.chunks);
    expect(after.embeddingModel).not.toBeNull();
    expect(after.indexedAt).not.toBeNull();
  });

  it("completes with the version the claim produced", async () => {
    // The claim bumps the version. Marking READY with anything else fails the
    // compare-and-swap, and updateIndexState returns null rather than
    // throwing — so the document would sit at INDEXING for ever with every
    // embedding call in the run already paid for.
    const document = harness.documents.add();
    await store(harness.storage, document);

    await harness.indexer.runOnce();

    expect(harness.documents.rows.get(document.id)?.status).toBe("READY");
  });

  it("makes the document searchable", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document);
    await harness.indexer.runOnce();

    const hits = await harness.knowledge.search({
      workspaceId: document.workspaceId,
      query: "Đắk Lắk là tỉnh có sản lượng cà phê lớn nhất cả nước.",
      minScore: -1,
      limit: 1,
    });

    expect(hits[0]?.text).toContain("Đắk Lắk");
    expect(hits[0]?.documentId).toBe(document.id);
    expect(hits[0]?.title).toBe("Nông sản");
  });

  it("leaves an already-indexed document alone", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document);
    await harness.indexer.runOnce();

    const second = await harness.indexer.runOnce();

    expect(second.claimed).toBe(0);
    expect(harness.stub.embedded.length).toBeGreaterThan(0);
  });

  it("marks a document FAILED and says why when its bytes are missing", async () => {
    // No `store` call: the row exists and the object does not. The run must
    // record that rather than retrying for ever or crashing the batch.
    const document = harness.documents.add();

    const result = await harness.indexer.runOnce();

    expect(result).toMatchObject({ claimed: 1, indexed: 0, failed: 1 });
    const after = harness.documents.rows.get(document.id)!;
    expect(after.status).toBe("FAILED");
    expect(after.failureReason).toContain("No object at");
  });

  it("keeps going after one document fails", async () => {
    // A batch that aborted on the first bad document would let one corrupt
    // upload block every other tenant's file behind it.
    harness.documents.add({ title: "Hỏng" });
    const good = harness.documents.add({ title: "Tốt" });
    await store(harness.storage, good);

    const result = await harness.indexer.runOnce();

    expect(result).toMatchObject({ claimed: 2, indexed: 1, failed: 1 });
    expect(harness.documents.rows.get(good.id)?.status).toBe("READY");
  });

  it("lets only one of two nodes index the same document", async () => {
    // Both read the row while it is still PENDING, so the query filter cannot
    // separate them — only the compare-and-swap can. Without it both nodes
    // embed the same file, and the workspace pays twice for one upload.
    const document = harness.documents.add();
    await store(harness.storage, document);

    const other = new DocumentIndexer({
      documents: harness.documents,
      storage: harness.storage,
      knowledge: harness.knowledge,
    });

    const [first, second] = await Promise.all([
      harness.indexer.runOnce(),
      other.runOnce(),
    ]);

    expect(first.claimed + second.claimed).toBe(1);
    expect(first.indexed + second.indexed).toBe(1);
    expect(harness.documents.rows.get(document.id)?.status).toBe("READY");
  });

  it("does not pick up a document that is already being indexed", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document);
    await harness.documents.updateIndexState(
      document.workspaceId,
      document.id,
      { status: "INDEXING" },
      document.version,
    );

    const result = await harness.indexer.runOnce();

    expect(result.claimed).toBe(0);
    expect(harness.stub.embedded).toEqual([]);
  });

  it("refuses a document with nothing to index", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document, "   \n\n  ");

    const result = await harness.indexer.runOnce();

    expect(result.failed).toBe(1);
    expect(harness.documents.rows.get(document.id)?.status).toBe("FAILED");
  });

  it("respects the batch size", async () => {
    const indexer = new DocumentIndexer({
      documents: harness.documents,
      storage: harness.storage,
      knowledge: harness.knowledge,
      batchSize: 2,
    });
    for (let i = 0; i < 5; i += 1) {
      await store(harness.storage, harness.documents.add());
    }

    expect((await indexer.runOnce()).claimed).toBe(2);
  });

  it("re-indexes a document that has been marked pending again", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document);
    await harness.indexer.runOnce();

    const ready = harness.documents.rows.get(document.id)!;
    await harness.documents.updateIndexState(
      ready.workspaceId,
      ready.id,
      { status: "INDEXING" },
      ready.version,
    );
    const reclaimed = harness.documents.rows.get(document.id)!;
    harness.documents.rows.set(document.id, {
      ...reclaimed,
      status: "PENDING",
    });

    const second = await harness.indexer.runOnce();

    expect(second.indexed).toBe(1);
  });

  it("forgets a removed document's chunks", async () => {
    const document = harness.documents.add();
    await store(harness.storage, document);
    await harness.indexer.runOnce();

    const removed = await harness.indexer.forget(
      document.workspaceId,
      document.id,
    );

    expect(removed).toBeGreaterThan(0);
    expect(
      await harness.knowledge.search({
        workspaceId: document.workspaceId,
        query: "cà phê",
        minScore: -1,
      }),
    ).toEqual([]);
  });

  it("hands the error to the caller as well as recording it", async () => {
    harness.documents.add();

    await harness.indexer.runOnce();

    expect(harness.errors).toHaveLength(1);
  });
});
