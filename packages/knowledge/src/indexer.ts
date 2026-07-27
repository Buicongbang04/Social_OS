import type { WorkspaceId } from "@repo/core";
import type { Document, DocumentRepository } from "@repo/domain";
import type { ObjectStore } from "@repo/storage";
import type { KnowledgeService } from "./service";

export type DocumentIndexerDeps = {
  documents: DocumentRepository;
  storage: ObjectStore;
  knowledge: KnowledgeService;
  /** How many documents one pass claims. */
  batchSize?: number;
  onError?: (error: unknown, document: Document) => void;
};

export type IndexRunResult = {
  claimed: number;
  indexed: number;
  failed: number;
  chunks: number;
  totalUsd: number;
};

const DEFAULT_BATCH_SIZE = 5;

/**
 * Turns uploaded documents into searchable chunks.
 *
 * Runs in the background rather than in the upload request: embedding a long
 * document is many provider round trips, and a user watching an upload spinner
 * for two minutes would reasonably conclude it had hung. The cost is that a
 * document is briefly visible and unsearchable, which the status column says
 * out loud instead of hiding.
 */
export class DocumentIndexer {
  constructor(private readonly deps: DocumentIndexerDeps) {}

  /** One pass: claim what is pending, index it, record the outcome. */
  async runOnce(): Promise<IndexRunResult> {
    const pending = await this.deps.documents.listPendingForIndexing(
      this.deps.batchSize ?? DEFAULT_BATCH_SIZE,
    );

    const result: IndexRunResult = {
      claimed: 0,
      indexed: 0,
      failed: 0,
      chunks: 0,
      totalUsd: 0,
    };

    for (const document of pending) {
      // Claim by compare-and-swap. Two runtime nodes reading the same PENDING
      // row both get here; only one wins the transition, and the loser moving
      // on is correct rather than an error — the work is being done.
      const claimed = await this.deps.documents.updateIndexState(
        document.workspaceId,
        document.id,
        { status: "INDEXING" },
        document.version,
      );
      if (!claimed) continue;

      result.claimed += 1;

      try {
        const outcome = await this.index(claimed);
        result.indexed += 1;
        result.chunks += outcome.chunks;
        result.totalUsd += outcome.totalUsd;
      } catch (error: unknown) {
        result.failed += 1;
        this.deps.onError?.(error, claimed);
        await this.recordFailure(claimed, error);
      }
    }

    return result;
  }

  private async index(
    document: Document,
  ): Promise<{ chunks: number; totalUsd: number }> {
    const bytes = await this.deps.storage.get({
      workspaceId: document.workspaceId,
      folder: "documents",
      // Content-addressed, matching what the upload wrote.
      name: document.checksum,
    });

    const result = await this.deps.knowledge.index({
      workspaceId: document.workspaceId,
      documentId: document.id,
      title: document.title,
      text: new TextDecoder().decode(bytes),
    });

    // `document` here is the row the claim returned, so its version is already
    // the post-claim one. Adding to it — or reusing the pre-claim number —
    // fails the compare-and-swap silently: updateIndexState returns null
    // rather than throwing, so the document sits at INDEXING for ever after
    // every embedding call in the run has already been paid for.
    const finished = await this.deps.documents.updateIndexState(
      document.workspaceId,
      document.id,
      {
        status: "READY",
        failureReason: null,
        chunkCount: result.chunks,
        embeddingModel: result.model,
        indexedAt: new Date(),
      },
      document.version,
    );

    if (!finished) {
      throw new Error(
        `Could not mark ${document.id} READY: the row moved on during indexing.`,
      );
    }

    return { chunks: result.chunks, totalUsd: result.totalUsd };
  }

  /**
   * Write down why it failed.
   *
   * Best effort: if this write fails too, the document stays at INDEXING and
   * a later sweep can requeue it. Throwing here would abandon the rest of the
   * batch over one document's bookkeeping.
   */
  private async recordFailure(
    document: Document,
    error: unknown,
  ): Promise<void> {
    try {
      await this.deps.documents.updateIndexState(
        document.workspaceId,
        document.id,
        {
          status: "FAILED",
          failureReason: describe(error),
          chunkCount: 0,
        },
        document.version,
      );
    } catch {
      // Deliberately swallowed — see above.
    }
  }

  /** Forget a document's chunks. Called when the document itself is removed. */
  async forget(
    workspaceId: WorkspaceId,
    documentId: Document["id"],
  ): Promise<number> {
    return this.deps.knowledge.remove(workspaceId, documentId);
  }
}

/**
 * A message short enough for a column and safe enough for a log.
 *
 * Never the error object itself: a provider or S3 error holds the client, the
 * request and the whole response, and serialising that has already taken a
 * process down once in this repo.
 */
function describe(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  return message.slice(0, 500);
}
