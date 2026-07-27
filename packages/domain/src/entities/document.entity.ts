import type {
  DocumentId,
  Metadata,
  SoftDeletableEntity,
  UserId,
  WorkspaceId,
} from "@repo/core";

/**
 * A file a workspace uploaded, and how far it has got towards being findable.
 *
 * Two systems hold a piece of this and neither is the whole picture: the bytes
 * are in object storage and the vectors are in Qdrant. This row is the only
 * record that both exist and belong together — which is why the status is
 * stored rather than inferred, and why a failure records its reason instead of
 * quietly reverting to PENDING.
 */
export const DOCUMENT_STATUSES = [
  /** Stored, not yet indexed. Nothing can find it. */
  "PENDING",
  /** Chunking and embedding are under way. */
  "INDEXING",
  /** Searchable. */
  "READY",
  /** Indexing failed; `failureReason` says why. Bytes are still there. */
  "FAILED",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const TERMINAL_DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  "READY",
  "FAILED",
];

export type Document = SoftDeletableEntity<DocumentId> & {
  workspaceId: WorkspaceId;
  /** Null when the runtime uploaded it rather than a person. */
  uploadedBy: UserId | null;

  /** What the user called it. Shown with every search hit for citation. */
  title: string;
  /** The name of the uploaded file, as given. */
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** SHA-256 of the bytes, hex. Lets a duplicate upload be recognised. */
  checksum: string;
  /** Where the bytes are. Built by @repo/storage, never by a caller. */
  storageKey: string;

  status: DocumentStatus;
  failureReason: string | null;
  /** How many chunks the current index holds. 0 until indexing succeeds. */
  chunkCount: number;
  /** The embedding model the chunks were made with, for re-index decisions. */
  embeddingModel: string | null;
  indexedAt: Date | null;

  metadata: Metadata;
};

export type CreateDocumentInput = {
  workspaceId: WorkspaceId;
  uploadedBy?: UserId | null;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storageKey: string;
  metadata?: Metadata;
};

export type UpdateDocumentIndexInput = {
  status: DocumentStatus;
  failureReason?: string | null;
  chunkCount?: number;
  embeddingModel?: string | null;
  indexedAt?: Date | null;
};

/**
 * Which status changes are allowed.
 *
 * The same whitelist discipline as Execution and Task: a document that jumps
 * from PENDING straight to READY skipped indexing, and the only evidence would
 * be a search that finds nothing while the UI says the file is ready.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<DocumentStatus, readonly DocumentStatus[]>
> = Object.freeze({
  PENDING: ["INDEXING", "FAILED"],
  // Re-indexing an already-indexed document is normal — a new embedding model,
  // or a retry after a provider outage.
  INDEXING: ["READY", "FAILED"],
  READY: ["INDEXING"],
  FAILED: ["INDEXING"],
});

export function canTransitionDocument(
  from: DocumentStatus,
  to: DocumentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
