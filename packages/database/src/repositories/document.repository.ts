import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type {
  DocumentId,
  Metadata,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { newId } from "@repo/core";
import type {
  CreateDocumentInput,
  Document,
  DocumentRepository,
  DocumentStatus,
  UpdateDocumentIndexInput,
} from "@repo/domain";
import { canTransitionDocument, DOCUMENT_STATUSES } from "@repo/domain";
import type { DatabaseClient } from "../client";
import { documents } from "../schema";

type DocumentRow = typeof documents.$inferSelect;

function toEntity(row: DocumentRow): Document {
  return {
    id: row.id as DocumentId,
    workspaceId: row.workspaceId as WorkspaceId,
    uploadedBy: row.uploadedBy as UserId | null,
    title: row.title,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    storageKey: row.storageKey,
    status: row.status,
    failureReason: row.failureReason,
    chunkCount: row.chunkCount,
    embeddingModel: row.embeddingModel,
    indexedAt: row.indexedAt,
    metadata: row.metadata as Metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

const DEFAULT_LIST_LIMIT = 50;

/**
 * Every query is scoped by workspace as well as by ID.
 *
 * Looking a document up by its ID alone would be enough for anyone who learns
 * or guesses an ID to read another tenant's file, and there would be no trace
 * of it — the row comes back, the API returns 200, and the audit log records a
 * successful read. Adding the workspace to the WHERE clause makes that
 * impossible here rather than relying on every caller to remember.
 */
export class DrizzleDocumentRepository implements DocumentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(
    workspaceId: WorkspaceId,
    id: DocumentId,
  ): Promise<Document | null> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, id),
          eq(documents.workspaceId, workspaceId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async list(
    workspaceId: WorkspaceId,
    limit = DEFAULT_LIST_LIMIT,
  ): Promise<Document[]> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.workspaceId, workspaceId),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows.map(toEntity);
  }

  async findByChecksum(
    workspaceId: WorkspaceId,
    checksum: string,
  ): Promise<Document | null> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.workspaceId, workspaceId),
          eq(documents.checksum, checksum),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1);

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async create(
    input: CreateDocumentInput,
    actorId: UserId | null,
  ): Promise<Document> {
    const rows = await this.db
      .insert(documents)
      .values({
        id: newId("document"),
        workspaceId: input.workspaceId,
        uploadedBy: input.uploadedBy ?? actorId,
        title: input.title,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
        storageKey: input.storageKey,
        status: "PENDING",
        metadata: input.metadata ?? {},
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error("Insert returned no document row.");
    return toEntity(row);
  }

  /**
   * Compare-and-swap on both `version` and the statuses the transition allows.
   *
   * Two conditions rather than one because they answer different questions.
   * The version says "nobody else has written since you read"; the status list
   * says "this change was legal from where the row actually is". A CAS on
   * version alone would happily let a retry of a stale INDEXING → READY land
   * on a document that had since been marked FAILED and re-queued.
   */
  async updateIndexState(
    workspaceId: WorkspaceId,
    id: DocumentId,
    input: UpdateDocumentIndexInput,
    expectedVersion: number,
  ): Promise<Document | null> {
    const allowedFrom = DOCUMENT_STATUSES.filter((from) =>
      canTransitionDocument(from, input.status),
    );
    if (allowedFrom.length === 0) return null;

    const rows = await this.db
      .update(documents)
      .set({
        status: input.status,
        failureReason: input.failureReason ?? null,
        ...(input.chunkCount === undefined
          ? {}
          : { chunkCount: input.chunkCount }),
        ...(input.embeddingModel === undefined
          ? {}
          : { embeddingModel: input.embeddingModel }),
        ...(input.indexedAt === undefined ? {} : { indexedAt: input.indexedAt }),
        updatedAt: new Date(),
        version: sql`${documents.version} + 1`,
      })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.workspaceId, workspaceId),
          eq(documents.version, expectedVersion),
          inArray(documents.status, allowedFrom as DocumentStatus[]),
          isNull(documents.deletedAt),
        ),
      )
      .returning();

    return rows[0] ? toEntity(rows[0]) : null;
  }

  async softDelete(
    workspaceId: WorkspaceId,
    id: DocumentId,
    actorId: UserId | null,
  ): Promise<boolean> {
    const rows = await this.db
      .update(documents)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        updatedAt: new Date(),
        updatedBy: actorId,
        version: sql`${documents.version} + 1`,
      })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.workspaceId, workspaceId),
          isNull(documents.deletedAt),
        ),
      )
      .returning({ id: documents.id });

    return rows.length > 0;
  }
}
