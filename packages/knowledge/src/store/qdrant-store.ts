import { createHash } from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { ChunkId, DocumentId, WorkspaceId } from "@repo/core";
import { RuntimeError } from "@repo/runtime";
import {
  collectionNameFor,
  COLLECTION_PREFIX,
  type CollectionSpec,
  type SearchHit,
  type SearchQuery,
  type VectorCollection,
  type VectorPoint,
  type VectorStore,
} from "./types";

export type QdrantStoreOptions = {
  url: string;
  apiKey?: string;
  /**
   * Milliseconds, matching the rest of this repo.
   *
   * The Qdrant client mixes units and documents the wrong one: its constructor
   * `timeout` is milliseconds (default `300000`) while its JSDoc says "300
   * seconds", and the per-request `timeout` on search and query really is
   * seconds. Passing 30 for "30 seconds" aborts every call after 30ms, which
   * surfaces as a connection timeout against a server that answered instantly.
   */
  timeoutMs?: number;
};

/**
 * Qdrant-backed vector storage, per docs/data/08_VECTOR_DATABASE.md.
 *
 * Everything tenant-related is enforced server-side: the workspace filter goes
 * into the query Qdrant runs, so it constrains the approximate-nearest-neighbour
 * search itself rather than being applied to whatever it happened to return.
 */
export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  /** Collections already created this process, so setup runs once each. */
  private readonly ready = new Map<string, Promise<VectorCollection>>();

  constructor(options: QdrantStoreOptions) {
    this.client = new QdrantClient({
      url: options.url,
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 30_000,
      // The client warns loudly when its version differs from the server's.
      // Left on: a mismatch here changes wire behaviour, and finding out from
      // a log line beats finding out from a malformed filter.
      checkCompatibility: true,
    });
  }

  async collection(spec: CollectionSpec): Promise<VectorCollection> {
    const name = collectionNameFor(spec.model);
    const existing = this.ready.get(name);
    if (existing) return existing;

    // The promise is cached, not the result: two concurrent callers must not
    // both run createCollection, because the loser gets a 409 rather than the
    // idempotent no-op the name suggests.
    const creating = this.create(name, spec).catch((error: unknown) => {
      this.ready.delete(name);
      throw error;
    });
    this.ready.set(name, creating);
    return creating;
  }

  /**
   * Every knowledge collection on the server, whichever model made it.
   *
   * Read from Qdrant rather than from `ready`, which only knows what this
   * process happened to touch — a delete that swept only the collections this
   * instance had opened would miss the rest, and the miss would be invisible.
   */
  async collections(): Promise<VectorCollection[]> {
    const { collections } = await this.client.getCollections();
    const mine = collections.filter((entry) =>
      entry.name.startsWith(COLLECTION_PREFIX),
    );

    return Promise.all(
      mine.map(async (entry) => {
        const info = await this.client.getCollection(entry.name);
        const vectors = info.config?.params?.vectors;
        const size =
          typeof vectors === "object" && vectors !== null && "size" in vectors
            ? Number(vectors.size)
            : 0;
        return new QdrantCollection(this.client, entry.name, size);
      }),
    );
  }

  private async create(
    name: string,
    spec: CollectionSpec,
  ): Promise<VectorCollection> {
    const { exists } = await this.client.collectionExists(name);

    if (!exists) {
      await this.client.createCollection(name, {
        // Cosine because the embedding models here return normalised vectors
        // and cosine is what their training objective optimised.
        vectors: { size: spec.dimensions, distance: "Cosine" },
      });
    }

    // Without an index on the tenant field, Qdrant still filters correctly but
    // does it by scanning after the HNSW traversal — so a workspace with few
    // documents in a large collection gets slower as *other* tenants grow.
    // Created every time: it is idempotent, and a collection that predates
    // this line would otherwise never get it.
    for (const field of ["workspaceId", "documentId"] as const) {
      await this.client.createPayloadIndex(name, {
        field_name: field,
        field_schema: "keyword",
        wait: true,
      });
    }

    return new QdrantCollection(this.client, name, spec.dimensions);
  }
}

class QdrantCollection implements VectorCollection {
  constructor(
    private readonly client: QdrantClient,
    readonly name: string,
    readonly dimensions: number,
  ) {}

  async upsert(points: readonly VectorPoint[]): Promise<void> {
    if (points.length === 0) return;

    for (const point of points) {
      assertDimensions(this.name, this.dimensions, point.vector.length);
    }

    await this.client.upsert(this.name, {
      // Without `wait`, Qdrant acknowledges before the write is searchable, so
      // indexing a document and immediately searching it can find nothing —
      // which looks exactly like a chunking bug. Note that the integration
      // suite does NOT demonstrate this: against a small single-node Qdrant
      // the write lands before the next request either way. It is here on the
      // strength of the documented semantics, and it is the collection size
      // and replication of a real deployment that make it matter.
      wait: true,
      points: points.map((point) => ({
        id: pointIdFor(point.id),
        vector: [...point.vector],
        // The real ID travels in the payload: `pointIdFor` is one-way, and the
        // caller asked about `chk_…`, not about a UUID it never saw.
        payload: { ...point.payload, chunkId: point.id },
      })),
    });
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    assertDimensions(this.name, this.dimensions, query.vector.length);

    const must: Record<string, unknown>[] = [
      { key: "workspaceId", match: { value: query.workspaceId } },
    ];
    if (query.documentIds && query.documentIds.length > 0) {
      must.push({
        key: "documentId",
        match: { any: [...query.documentIds] },
      });
    }

    const response = await this.client.query(this.name, {
      query: [...query.vector],
      limit: query.limit,
      filter: { must },
      score_threshold: query.minScore,
      with_payload: true,
    });

    return response.points.map((point) => toHit(point.payload, point.score));
  }

  async deleteDocument(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<number> {
    // By filter rather than by ID: the chunk IDs are not known here, and a
    // re-index may have produced a different number of them than last time.
    const before = await this.countDocument(workspaceId, documentId);

    await this.client.delete(this.name, {
      wait: true,
      filter: {
        must: [
          { key: "workspaceId", match: { value: workspaceId } },
          { key: "documentId", match: { value: documentId } },
        ],
      },
    });

    return before;
  }

  private async countDocument(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<number> {
    const { count } = await this.client.count(this.name, {
      exact: true,
      filter: {
        must: [
          { key: "workspaceId", match: { value: workspaceId } },
          { key: "documentId", match: { value: documentId } },
        ],
      },
    });
    return count;
  }
}

/**
 * A Qdrant point ID derived from a chunk ID.
 *
 * Qdrant accepts only unsigned integers and UUIDs as point IDs — the client's
 * TypeScript type says `number | string`, so `chk_01HX…` compiles and then
 * fails at the server with a 400 that mentions neither chunks nor IDs. This
 * maps the branded ID onto a UUID deterministically, so the same chunk always
 * lands on the same point and re-indexing overwrites rather than duplicates.
 */
export function pointIdFor(chunkId: ChunkId): string {
  const hex = createHash("sha256").update(chunkId).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function toHit(payload: unknown, score: number): SearchHit {
  const record = (payload ?? {}) as Record<string, unknown>;

  return {
    id: record.chunkId as ChunkId,
    workspaceId: record.workspaceId as WorkspaceId,
    documentId: record.documentId as DocumentId,
    chunkIndex: Number(record.chunkIndex ?? 0),
    text: String(record.text ?? ""),
    startOffset: Number(record.startOffset ?? 0),
    endOffset: Number(record.endOffset ?? 0),
    title: String(record.title ?? ""),
    score,
  };
}

function assertDimensions(
  collection: string,
  expected: number,
  actual: number,
): void {
  if (actual === expected) return;

  throw new RuntimeError(
    "VALIDATION",
    `Collection ${collection} holds ${expected}-dimension vectors, got ${actual}.`,
    { retryable: false, context: { collection, expected, actual } },
  );
}
