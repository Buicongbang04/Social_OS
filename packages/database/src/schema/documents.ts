import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { documentStatusEnum } from "./_enums";
import {
  auditColumns,
  idColumn,
  idRef,
  metadataColumn,
  softDeleteColumns,
} from "./_shared";
import { users } from "./users";
import { workspaces } from "./workspaces";

/**
 * A file a workspace uploaded, per docs/data/06_OBJECT_STORAGE.md ("Metadata
 * lưu trong PostgreSQL") and docs/data/08_VECTOR_DATABASE.md.
 *
 * The bytes live in object storage and the vectors live in Qdrant; this row is
 * the only place that records both exist and belong together. That makes it
 * the thing to read when the two disagree — a document marked READY whose
 * chunks are missing is a bug you can see from here and from nowhere else.
 */
export const documents = pgTable(
  "documents",
  {
    id: idColumn(),
    workspaceId: idRef("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Null when the runtime produced the file rather than a person. */
    uploadedBy: idRef("uploaded_by").references(() => users.id),

    title: varchar("title", { length: 300 }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    /**
     * bigint would be the safe type for a file size, but Drizzle maps it to a
     * JS string by default and every caller would parse it back. integer caps
     * at 2 GB, which is far above the upload limit the API enforces.
     */
    sizeBytes: integer("size_bytes").notNull(),
    /** SHA-256, hex — 64 characters. */
    checksum: varchar("checksum", { length: 64 }).notNull(),
    storageKey: varchar("storage_key", { length: 500 }).notNull(),

    status: documentStatusEnum("status").notNull().default("PENDING"),
    failureReason: text("failure_reason"),
    chunkCount: integer("chunk_count").notNull().default(0),
    /**
     * Which model produced the vectors currently in the index.
     *
     * Kept because a collection belongs to exactly one embedding model: when
     * the configured model changes, this column is what says which documents
     * still need re-indexing rather than every search silently missing them.
     */
    embeddingModel: varchar("embedding_model", { length: 120 }),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),

    ...auditColumns,
    ...softDeleteColumns,
    ...metadataColumn,
  },
  (table) => [
    // The list query: this workspace's documents, newest first.
    index("documents_workspace_idx").on(table.workspaceId, table.createdAt),
    index("documents_status_idx").on(table.workspaceId, table.status),
    /**
     * One row per (workspace, checksum), so uploading the same file twice
     * returns the existing document instead of paying to embed it again.
     * Scoped to the workspace on purpose: two tenants uploading identical
     * bytes must still get two independent documents, or deleting one would
     * take the other's away.
     */
    uniqueIndex("documents_checksum_key").on(table.workspaceId, table.checksum),
  ],
);
