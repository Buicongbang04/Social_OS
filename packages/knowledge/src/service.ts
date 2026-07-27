import type { ProviderGateway, ProviderName } from "@repo/ai";
import { newId, type DocumentId, type WorkspaceId } from "@repo/core";
import { RuntimeError } from "@repo/runtime";
import { chunkText, type ChunkOptions } from "./chunking/chunk";
import type {
  SearchHit,
  VectorCollection,
  VectorPoint,
  VectorStore,
} from "./store/types";

/**
 * How many texts go to the provider in one call.
 *
 * OpenAI caps a batch at 2048 inputs and the whole request at a token budget;
 * Ollama processes a batch serially and a large one simply takes longer before
 * anything is durable. 64 keeps every request well inside both, and means a
 * failure loses one batch rather than a whole book.
 */
const EMBED_BATCH_SIZE = 64;

/** Below this, a hit is noise dressed up as evidence. */
export const DEFAULT_MIN_SCORE = 0.2;
export const DEFAULT_SEARCH_LIMIT = 5;

export type KnowledgeDeps = {
  gateway: ProviderGateway;
  store: VectorStore;
  /** Pin the embedding provider. Left out, the Gateway's chain decides. */
  provider?: ProviderName;
  /** Pin the embedding model. Left out, the provider's default is used. */
  model?: string;
  chunking?: ChunkOptions;
};

export type IndexInput = {
  workspaceId: WorkspaceId;
  documentId: DocumentId;
  /** Shown with each hit, so an answer can say where it came from. */
  title: string;
  text: string;
};

export type IndexResult = {
  documentId: DocumentId;
  chunks: number;
  /** How many chunks the previous version of this document had. */
  replaced: number;
  model: string;
  dimensions: number;
  totalUsd: number;
  collection: string;
};

export type SearchInput = {
  workspaceId: WorkspaceId;
  query: string;
  limit?: number;
  minScore?: number;
  documentIds?: readonly DocumentId[];
};

/**
 * Documents in, relevant passages out.
 *
 * Indexing and searching are one class on purpose. They must agree on the
 * embedding model — a query embedded by a different model than the documents
 * searches a collection those documents are not in, and the honest symptom is
 * zero results, while the dishonest one is a handful of unrelated paragraphs
 * scored as though they matched. Splitting them into two objects makes that
 * agreement a matter of wiring, which is exactly where it would eventually be
 * got wrong.
 */
export class KnowledgeService {
  constructor(private readonly deps: KnowledgeDeps) {}

  /**
   * Chunk, embed and store a document, replacing any previous version.
   *
   * The old chunks go first. A re-index that only upserts leaves behind every
   * chunk the new version no longer has — deleted paragraphs stay searchable,
   * and the document keeps answering questions with text it no longer contains.
   */
  async index(input: IndexInput): Promise<IndexResult> {
    const chunks = chunkText(input.text, this.deps.chunking);

    if (chunks.length === 0) {
      throw new RuntimeError(
        "VALIDATION",
        "Document has no indexable text.",
        {
          retryable: false,
          context: { documentId: input.documentId, length: input.text.length },
        },
      );
    }

    let model = "";
    let dimensions = 0;
    let totalUsd = 0;
    const points: VectorPoint[] = [];

    for (let start = 0; start < chunks.length; start += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBED_BATCH_SIZE);
      const embedding = await this.deps.gateway.embed({
        provider: this.deps.provider,
        model: this.deps.model,
        texts: batch.map((chunk) => chunk.text),
      });

      // A fallback between batches would put half the document in one model's
      // coordinate system and half in another's, inside one collection.
      if (model !== "" && embedding.model !== model) {
        throw new RuntimeError(
          "PROVIDER",
          `Embedding model changed mid-document: ${model} then ${embedding.model}.`,
          { retryable: true, context: { documentId: input.documentId } },
        );
      }

      model = embedding.model;
      dimensions = embedding.dimensions;
      totalUsd += embedding.cost.totalUsd;

      batch.forEach((chunk, offset) => {
        const vector = embedding.vectors[offset];
        if (!vector) {
          throw new RuntimeError(
            "PROVIDER",
            `Provider returned ${embedding.vectors.length} vectors for ${batch.length} texts.`,
            { retryable: true, context: { documentId: input.documentId } },
          );
        }

        points.push({
          id: newId("chunk"),
          vector,
          payload: {
            workspaceId: input.workspaceId,
            documentId: input.documentId,
            chunkIndex: chunk.index,
            text: chunk.text,
            startOffset: chunk.startOffset,
            endOffset: chunk.endOffset,
            title: input.title,
          },
        });
      });
    }

    const collection = await this.collectionFor(model, dimensions);
    const replaced = await collection.deleteDocument(
      input.workspaceId,
      input.documentId,
    );
    await collection.upsert(points);

    return {
      documentId: input.documentId,
      chunks: points.length,
      replaced,
      model,
      dimensions,
      totalUsd,
      collection: collection.name,
    };
  }

  async search(input: SearchInput): Promise<SearchHit[]> {
    const query = input.query.trim();
    if (query === "") return [];

    const embedding = await this.deps.gateway.embed({
      provider: this.deps.provider,
      model: this.deps.model,
      texts: [query],
    });

    const vector = embedding.vectors[0];
    if (!vector) return [];

    const collection = await this.collectionFor(
      embedding.model,
      embedding.dimensions,
    );

    return collection.search({
      workspaceId: input.workspaceId,
      vector,
      limit: input.limit ?? DEFAULT_SEARCH_LIMIT,
      minScore: input.minScore ?? DEFAULT_MIN_SCORE,
      documentIds: input.documentIds,
    });
  }

  /**
   * Forget a document entirely. Returns how many chunks were removed.
   *
   * Sweeps every collection rather than the current model's. A workspace that
   * re-indexed after an embedding-model change has chunks in the old
   * collection too, and those are invisible to search but very much still
   * stored — "delete my document" has to mean the copy nobody can currently
   * search as well.
   */
  async remove(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<number> {
    const collections = await this.deps.store.collections();
    let removed = 0;

    for (const collection of collections) {
      removed += await collection.deleteDocument(workspaceId, documentId);
    }

    return removed;
  }

  private async collectionFor(
    model: string,
    dimensions: number,
  ): Promise<VectorCollection> {
    return this.deps.store.collection({ model, dimensions });
  }
}
