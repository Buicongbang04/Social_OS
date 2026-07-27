import { createHash } from "node:crypto";
import type { ChunkId, DocumentId, WorkspaceId } from "@repo/core";

/**
 * What identifies a set of vectors that can be compared with each other.
 *
 * Similarity is only meaningful between vectors from the same embedding model:
 * two models place the same sentence in unrelated coordinate systems, and the
 * cosine between them is a number with no interpretation. Nothing at query time
 * can detect that — the search returns confident nonsense. So the model is part
 * of the collection's identity, and switching models means a new collection and
 * a re-index rather than a silent mixture.
 */
export type CollectionSpec = {
  /** The embedding model that produced every vector in this collection. */
  model: string;
  dimensions: number;
};

/**
 * What is stored alongside a vector.
 *
 * `workspaceId` is here rather than only in the caller's head because every
 * query filters on it — see SearchQuery.
 */
export type ChunkPayload = {
  workspaceId: WorkspaceId;
  documentId: DocumentId;
  /** Position within the document, so hits can be shown in reading order. */
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  /** Human-readable name of the source, for citation. */
  title: string;
};

export type VectorPoint = {
  id: ChunkId;
  vector: readonly number[];
  payload: ChunkPayload;
};

/**
 * A search, always scoped to one workspace.
 *
 * `workspaceId` is required, not optional. A vector database holding every
 * tenant's documents in one collection has exactly one catastrophic failure —
 * returning another company's private material — and it happens by omission,
 * which reviews and tests are bad at noticing. Making the field impossible to
 * leave out turns that omission into a compile error.
 */
export type SearchQuery = {
  workspaceId: WorkspaceId;
  vector: readonly number[];
  limit: number;
  /**
   * Hits below this similarity are dropped.
   *
   * Vector search always returns its `limit` best matches, however bad they
   * are; with no floor, a question about something the workspace has no
   * document on still comes back with the least-unrelated paragraphs, and the
   * model above treats them as evidence.
   */
  minScore?: number;
  /** Narrow to specific documents. Empty or absent means all of them. */
  documentIds?: readonly DocumentId[];
};

export type SearchHit = ChunkPayload & {
  id: ChunkId;
  /** Cosine similarity, in [-1, 1]. Higher is closer. */
  score: number;
};

export interface VectorCollection {
  readonly name: string;
  readonly dimensions: number;
  upsert(points: readonly VectorPoint[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  /** Removes every chunk of one document. Returns how many were removed. */
  deleteDocument(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<number>;
}

/**
 * Where vectors live.
 *
 * A port, so the Runtime never imports a vector database client: tests run
 * against the in-memory store with no container, and swapping Qdrant for
 * pgvector is one new file.
 */
export interface VectorStore {
  /** Creates the collection if it is not there, then returns a handle. */
  collection(spec: CollectionSpec): Promise<VectorCollection>;
  /**
   * Every collection this store holds, across all embedding models.
   *
   * Needed for deletion. Search only ever looks in the current model's
   * collection, but a workspace that has re-indexed under a different model
   * still has chunks sitting in the old one — and "forget this document" has
   * to mean all of them, not the ones the current configuration can see.
   */
  collections(): Promise<VectorCollection[]>;
}

/**
 * The collection name for a model.
 *
 * Two parts, and both are needed. The readable part lets an operator looking at
 * the database see which model an index belongs to without consulting the code
 * that wrote it. The digest is what actually makes the name unique: model names
 * come from vendors with incompatible conventions — `meta-llama/Llama-3` from
 * OpenRouter, `qwen3:0.6b` from Ollama — and replacing unsafe characters with
 * an underscore maps both of those to the same string. Two different models
 * sharing a collection is precisely the corruption CollectionSpec exists to
 * prevent, and it would show up as scores that look plausible and mean nothing.
 */
export const COLLECTION_PREFIX = "knowledge__";

export function collectionNameFor(model: string): string {
  const safe = model.replaceAll(/[^a-zA-Z0-9_-]+/g, "_");
  const digest = createHash("sha256").update(model).digest("hex").slice(0, 8);
  return `${COLLECTION_PREFIX}${safe}__${digest}`;
}

/**
 * Cosine similarity between two vectors.
 *
 * Returns 0 for a zero vector rather than NaN: an empty or degenerate
 * embedding should rank last, not poison every comparison it takes part in.
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
