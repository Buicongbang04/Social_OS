import type { DocumentId, UserId, WorkspaceId } from "@repo/core";
import type {
  CreateDocumentInput,
  Document,
  UpdateDocumentIndexInput,
} from "../entities/document.entity";

/**
 * Repository port for uploaded documents.
 *
 * Every read takes a `workspaceId` alongside the document's own ID. That looks
 * redundant — the ID already identifies the row — and it is the point: a
 * lookup by ID alone returns another tenant's document to anyone who learns or
 * guesses an ID, and nothing above this layer can tell that it happened.
 */
export interface DocumentRepository {
  findById(
    workspaceId: WorkspaceId,
    id: DocumentId,
  ): Promise<Document | null>;

  /** Most recently uploaded first. */
  list(workspaceId: WorkspaceId, limit?: number): Promise<Document[]>;

  /**
   * An existing document with the same bytes, if there is one.
   *
   * Uploading the same file twice should not pay to embed it twice.
   */
  findByChecksum(
    workspaceId: WorkspaceId,
    checksum: string,
  ): Promise<Document | null>;

  create(input: CreateDocumentInput, actorId: UserId | null): Promise<Document>;

  /**
   * Record the outcome of indexing.
   *
   * Returns null when the transition is not allowed or the row moved on — the
   * caller is expected to treat that as "someone else got there first", not as
   * an error to retry.
   */
  updateIndexState(
    workspaceId: WorkspaceId,
    id: DocumentId,
    input: UpdateDocumentIndexInput,
    expectedVersion: number,
  ): Promise<Document | null>;

  softDelete(
    workspaceId: WorkspaceId,
    id: DocumentId,
    actorId: UserId | null,
  ): Promise<boolean>;
}
