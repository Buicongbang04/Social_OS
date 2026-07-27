import type { WorkspaceId } from "@repo/core";

/**
 * Where an object lives, expressed as the two things a caller may choose.
 *
 * The workspace is not one of them by accident: `keyFor` builds the real key
 * and puts the workspace at the front, so one tenant's key can never address
 * another's object. A caller that could pass a whole key would be one
 * `../` away from reading someone else's documents.
 */
export type ObjectLocation = {
  workspaceId: WorkspaceId;
  /** Top-level grouping, per the doc's bucket structure: documents, avatars… */
  folder: ObjectFolder;
  /** Unique within the folder. Usually the ID of the row that owns the file. */
  name: string;
};

export const OBJECT_FOLDERS = [
  "documents",
  "avatars",
  "posts",
  "videos",
  "exports",
] as const;
export type ObjectFolder = (typeof OBJECT_FOLDERS)[number];

export type PutObjectInput = ObjectLocation & {
  body: Uint8Array;
  contentType: string;
  /** Original file name, shown to the user on download. */
  fileName?: string;
};

export type StoredObject = {
  key: string;
  size: number;
  contentType: string;
  /** SHA-256 of the bytes, hex. Lets a re-upload be recognised as identical. */
  checksum: string;
};

export type ObjectMetadata = {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
};

/**
 * Object storage, as the rest of the platform sees it.
 *
 * A port rather than an S3 client passed around: the API and Runtime should not
 * know whether the bytes are in MinIO, S3 or a map in memory, and the in-memory
 * implementation is what lets their tests run without a container.
 */
export interface ObjectStore {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(location: ObjectLocation): Promise<Uint8Array>;
  head(location: ObjectLocation): Promise<ObjectMetadata | null>;
  delete(location: ObjectLocation): Promise<void>;
  /**
   * A time-limited URL the browser can download from directly.
   *
   * Direct rather than streaming through the API because a 200 MB video should
   * not occupy a Node process for the length of the download. Time-limited
   * because the URL is a bearer credential: anyone holding it can read the
   * object, so it has to stop working.
   */
  presignGet(location: ObjectLocation, expiresInSeconds?: number): Promise<string>;
}

/** Default lifetime of a presigned URL: long enough to click, short enough to leak safely. */
export const DEFAULT_PRESIGN_SECONDS = 300;

/**
 * The storage key for a location.
 *
 * Shape: `documents/wsp_01HX…/doc_01HX…`. The workspace segment comes second so
 * that listing a prefix lists exactly one tenant, and it is written here rather
 * than accepted from the caller so that it cannot be forged.
 */
export function keyFor(location: ObjectLocation): string {
  return `${location.folder}/${location.workspaceId}/${sanitizeName(location.name)}`;
}

/**
 * Strip everything from a name that could change which object a key addresses.
 *
 * Not cosmetic. `..` walks up a prefix; a leading `/` re-roots the key; a NUL
 * truncates it in some S3 implementations; and a raw newline breaks the
 * signature calculation for presigned URLs. What is left is the set of
 * characters that mean only themselves.
 */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, "_")
    // Any run of dots collapses to one: "..", "...." and "a..b" all lose the
    // ability to traverse, while "report.pdf" is untouched.
    .replaceAll(/\.{2,}/g, ".")
    .replace(/^[._-]+/, "")
    .slice(0, 200);

  return cleaned === "" ? "unnamed" : cleaned;
}
