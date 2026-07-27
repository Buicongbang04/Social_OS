import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  type DocumentId,
  type UserId,
  type WorkspaceId,
} from "@repo/core";
import type { Document, DocumentRepository } from "@repo/domain";
import type { ObjectStore } from "@repo/storage";
import { AppConfig } from "../../config/app.config";
import { DOCUMENT_REPOSITORY } from "../../infra/database/database.module";
import { OBJECT_STORE } from "../../infra/storage/storage.module";

export type UploadInput = {
  fileName: string;
  mimeType: string;
  body: Buffer;
  title?: string;
};

export type UploadResult = {
  document: Document;
  /** True when the same bytes were already in this workspace. */
  duplicate: boolean;
};

/**
 * Text types this API will accept.
 *
 * An allowlist, not a blocklist. Everything here can be read as text with no
 * parsing library, which is the honest boundary of what indexing can do today
 * — a PDF stored now would sit at PENDING forever and look like a bug rather
 * than a missing feature. PDF and DOCX extraction is its own piece of work.
 */
const ACCEPTED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

const ACCEPTED_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json"]);

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DOCUMENT_REPOSITORY)
    private readonly documents: DocumentRepository,
    @Inject(OBJECT_STORE) private readonly storage: ObjectStore | null,
    private readonly config: AppConfig,
  ) {}

  async upload(
    workspaceId: WorkspaceId,
    userId: UserId,
    input: UploadInput,
  ): Promise<UploadResult> {
    const store = this.requireStorage();

    if (input.body.byteLength === 0) {
      throw new ValidationError("File rỗng, không có gì để lưu.");
    }
    if (input.body.byteLength > this.config.uploadMaxBytes) {
      throw new ValidationError(
        `File vượt quá ${Math.round(this.config.uploadMaxBytes / 1024 / 1024)} MB.`,
      );
    }

    const mimeType = this.resolveMimeType(input);

    // Checksum before writing anything: a re-upload of bytes already here
    // should cost neither a storage write nor, later, an embedding bill.
    const checksum = createHash("sha256").update(input.body).digest("hex");
    const existing = await this.documents.findByChecksum(workspaceId, checksum);
    if (existing) return { document: existing, duplicate: true };

    // Bytes first, then the row. The key is the checksum, so this write is
    // idempotent — a retry after a failed insert lands on exactly the same
    // object rather than leaving a second copy nobody will ever look for. The
    // reverse order would need a second UPDATE to fill the key in, and there
    // is no legal PENDING → PENDING transition to carry it.
    const stored = await store.put({
      ...this.locate(workspaceId, checksum),
      body: input.body,
      contentType: mimeType,
      fileName: input.fileName,
    });

    const document = await this.documents.create(
      {
        workspaceId,
        uploadedBy: userId,
        title: (input.title ?? input.fileName).slice(0, 300),
        fileName: input.fileName.slice(0, 255),
        mimeType,
        sizeBytes: input.body.byteLength,
        checksum,
        storageKey: stored.key,
      },
      userId,
    );

    return { document, duplicate: false };
  }

  async list(workspaceId: WorkspaceId): Promise<Document[]> {
    return this.documents.list(workspaceId);
  }

  async get(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<Document> {
    const document = await this.documents.findById(workspaceId, documentId);
    if (!document) {
      // 404 rather than 403 for a document in another workspace: telling a
      // caller that an ID exists but is not theirs confirms the existence of
      // another tenant's data.
      throw new NotFoundError("Không tìm thấy tài liệu.");
    }
    return document;
  }

  async remove(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
    userId: UserId,
  ): Promise<void> {
    const document = await this.get(workspaceId, documentId);

    await this.documents.softDelete(workspaceId, documentId, userId);

    // The row goes first. If deleting the bytes fails, the document is already
    // invisible and the object is garbage a sweep can collect; the other order
    // can leave a visible document whose file is gone.
    if (this.storage) {
      await this.storage.delete(this.locate(workspaceId, document.checksum));
    }
  }

  async downloadUrl(
    workspaceId: WorkspaceId,
    documentId: DocumentId,
  ): Promise<string> {
    const store = this.requireStorage();
    const document = await this.get(workspaceId, documentId);

    return store.presignGet(this.locate(workspaceId, document.checksum));
  }

  /**
   * Where a document's bytes live: `documents/<workspace>/<sha256>`.
   *
   * Content-addressed rather than keyed by document ID, so the object can be
   * written before the row exists and a retry is a no-op rather than a second
   * copy. Safe because the unique index on (workspace, checksum) already means
   * one row per set of bytes per workspace.
   */
  private locate(workspaceId: WorkspaceId, checksum: string) {
    return { workspaceId, folder: "documents" as const, name: checksum };
  }

  private requireStorage(): ObjectStore {
    if (!this.storage) {
      throw new ValidationError(
        "Chưa cấu hình lưu trữ file. Đặt MINIO_URL, MINIO_ROOT_USER và MINIO_ROOT_PASSWORD.",
      );
    }
    return this.storage;
  }

  /**
   * What kind of file this is, deciding by extension when the browser's guess
   * is useless.
   *
   * Browsers send `application/octet-stream` for anything they do not
   * recognise, and a `.md` file is one of those — so trusting the header alone
   * rejects the most obvious thing a user would upload. The extension is not
   * trusted either: it only selects from the same allowlist.
   */
  private resolveMimeType(input: UploadInput): string {
    if (ACCEPTED_MIME_TYPES.has(input.mimeType)) return input.mimeType;

    const extension = input.fileName.split(".").pop()?.toLowerCase() ?? "";
    if (ACCEPTED_EXTENSIONS.has(extension)) {
      return extension === "json" ? "application/json" : "text/plain";
    }

    throw new ValidationError(
      `Chưa hỗ trợ định dạng này (${input.mimeType || "không rõ"}). Hiện chấp nhận: ${[...ACCEPTED_EXTENSIONS].join(", ")}.`,
    );
  }
}
