import { RuntimeError } from "@repo/runtime";
import type { DocumentId, WorkspaceId } from "@repo/core";
import {
  collectionNameFor,
  cosineSimilarity,
  type CollectionSpec,
  type SearchHit,
  type SearchQuery,
  type VectorCollection,
  type VectorPoint,
  type VectorStore,
} from "./types";

/**
 * A vector store that lives in one process.
 *
 * Not a mock: it runs the same isolation filter, the same dimension check and
 * the same similarity function as the real thing, so a test that passes here
 * has exercised the logic rather than a stand-in for it. What it does not have
 * is Qdrant's approximate index — it scans everything, which is exact and
 * therefore also the reference the Qdrant implementation is checked against.
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly byName = new Map<string, InMemoryCollection>();

  async collection(spec: CollectionSpec): Promise<VectorCollection> {
    const name = collectionNameFor(spec.model);
    const existing = this.byName.get(name);
    if (existing) return existing;

    const created = new InMemoryCollection(name, spec.dimensions);
    this.byName.set(name, created);
    return created;
  }

  async collections(): Promise<VectorCollection[]> {
    return [...this.byName.values()];
  }

  /** Test helper: which collections were actually created. */
  get collectionNames(): string[] {
    return [...this.byName.keys()];
  }
}

class InMemoryCollection implements VectorCollection {
  private readonly points = new Map<string, VectorPoint>();

  constructor(
    readonly name: string,
    readonly dimensions: number,
  ) {}

  async upsert(points: readonly VectorPoint[]): Promise<void> {
    for (const point of points) {
      assertDimensions(this.name, this.dimensions, point.vector.length);
      this.points.set(point.id, point);
    }
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    assertDimensions(this.name, this.dimensions, query.vector.length);

    const wanted =
      query.documentIds && query.documentIds.length > 0
        ? new Set<string>(query.documentIds)
        : null;

    return [...this.points.values()]
      .filter(
        (point) =>
          // The isolation filter, applied before scoring rather than after —
          // a top-k taken across tenants and filtered afterwards silently
          // returns fewer results than asked for, and the shortfall is the
          // only evidence that other tenants' data was ever considered.
          point.payload.workspaceId === query.workspaceId &&
          (wanted === null || wanted.has(point.payload.documentId)),
      )
      .map((point) => ({
        ...point.payload,
        id: point.id,
        score: cosineSimilarity(query.vector, point.vector),
      }))
      .filter((hit) => hit.score >= (query.minScore ?? -1))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit);
  }

  async deleteDocument(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<number> {
    let removed = 0;

    for (const [id, point] of this.points) {
      // Scoped by workspace as well as document: an ID from one tenant must
      // not be able to delete another's data even if it were guessed.
      if (
        point.payload.workspaceId === workspaceId &&
        point.payload.documentId === documentId
      ) {
        this.points.delete(id);
        removed += 1;
      }
    }

    return removed;
  }
}

/**
 * A vector of the wrong length is a bug upstream, not bad input.
 *
 * It means something embedded with a different model reached a collection
 * built for this one. Storing it would make every later comparison in that
 * collection meaningless, and nothing downstream could tell.
 */
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
