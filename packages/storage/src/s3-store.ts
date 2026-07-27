import { createHash } from "node:crypto";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { RuntimeError } from "@repo/runtime";
import {
  DEFAULT_PRESIGN_SECONDS,
  keyFor,
  type ObjectLocation,
  type ObjectMetadata,
  type ObjectStore,
  type PutObjectInput,
  type StoredObject,
} from "./types";

export type S3StoreOptions = {
  /** e.g. http://localhost:9000 for MinIO. Omit for real AWS S3. */
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Put the bucket in the path rather than the hostname.
   *
   * Required for MinIO on localhost: virtual-host style would resolve
   * `bucket.localhost`, which does not exist. Real S3 prefers the default.
   */
  forcePathStyle?: boolean;
};

/**
 * S3-compatible object storage.
 *
 * One implementation for MinIO in development and S3 or R2 in production —
 * that is the whole reason for using the AWS SDK rather than MinIO's own
 * client. What differs between them is configuration, not code.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private ensured: Promise<void> | null = null;

  constructor(private readonly options: S3StoreOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
    });
  }

  /**
   * Create the bucket if it is not there.
   *
   * Called before the first write rather than in the constructor: constructing
   * a store must not do I/O, or every process that merely wires dependencies
   * fails to start when storage is briefly unreachable.
   */
  async ensureBucket(): Promise<void> {
    this.ensured ??= this.createBucket().catch((error: unknown) => {
      // Cleared so a transient failure does not poison every later call with
      // the same rejected promise.
      this.ensured = null;
      throw error;
    });
    return this.ensured;
  }

  private async createBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // Falls through to create. A HeadBucket failure is "absent or not
      // visible to these credentials", and both are answered by trying.
    }

    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      // Two processes starting together both create; the loser must not die.
      if (!isAlreadyOwned(error)) throw storageError("create bucket", error);
    }
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    await this.ensureBucket();

    const key = keyFor(input);
    const checksum = createHash("sha256").update(input.body).digest("hex");

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.body,
          ContentType: input.contentType,
          // Sent back on download, so the browser saves the name the user
          // uploaded rather than the opaque ID the key is built from.
          ContentDisposition: contentDisposition(input.fileName),
          Metadata: { checksum },
        }),
      );
    } catch (error: unknown) {
      throw storageError("upload", error);
    }

    return {
      key,
      size: input.body.byteLength,
      contentType: input.contentType,
      checksum,
    };
  }

  async get(location: ObjectLocation): Promise<Uint8Array> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: keyFor(location) }),
      );

      if (!response.Body) {
        throw new RuntimeError("RESOURCE", "Object has no body.", {
          retryable: false,
          context: { key: keyFor(location) },
        });
      }

      return await response.Body.transformToByteArray();
    } catch (error: unknown) {
      if (error instanceof RuntimeError) throw error;
      throw storageError("download", error);
    }
  }

  async head(location: ObjectLocation): Promise<ObjectMetadata | null> {
    const key = keyFor(location);

    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        key,
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "application/octet-stream",
        lastModified: response.LastModified ?? new Date(0),
      };
    } catch (error: unknown) {
      // Absent is an answer, not a failure — the caller asked whether it is
      // there. Anything else is a real problem and must not be flattened into
      // "no", which would read as "the file was never uploaded".
      if (isNotFound(error)) return null;
      throw storageError("stat", error);
    }
  }

  async delete(location: ObjectLocation): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: keyFor(location) }),
      );
    } catch (error: unknown) {
      throw storageError("delete", error);
    }
  }

  async presignGet(
    location: ObjectLocation,
    expiresInSeconds = DEFAULT_PRESIGN_SECONDS,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: keyFor(location) }),
      { expiresIn: expiresInSeconds },
    );
  }
}

/**
 * A Content-Disposition header that survives both signing and Vietnamese.
 *
 * SigV4 signs header values byte for byte, and a non-ASCII byte in one makes
 * the signature the client computes differ from the one the server computes —
 * so `filename="báo cáo.txt"` fails the whole upload with
 * `SignatureDoesNotMatch`, an error that says nothing about file names. RFC
 * 6266 already answers this: an ASCII `filename` for old clients, plus
 * `filename*` carrying the real name percent-encoded as UTF-8.
 */
function contentDisposition(fileName?: string): string | undefined {
  if (!fileName) return undefined;

  const ascii = fileName.replaceAll(/[^\x20-\x7E]/g, "_").replaceAll('"', "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}

function isAlreadyOwned(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  return (
    name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists"
  );
}

/**
 * Wrap an SDK error without letting its object graph into a log line.
 *
 * The same lesson as `formatError` in @repo/ai: an S3 error holds the client,
 * the request and the whole response, and inspecting it can be expensive
 * enough to take the process down.
 */
function storageError(action: string, error: unknown): RuntimeError {
  const name = (error as { name?: string }).name ?? "Error";
  const message = (error as { message?: string }).message ?? "";
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;

  return new RuntimeError(
    "RESOURCE",
    `Object storage failed to ${action}: ${name}${message ? ` — ${message}` : ""}`,
    {
      // Storage outages are transient far more often than not; a permission
      // problem shows up as a 403 and is filtered out here.
      retryable: status === undefined || status >= 500 || status === 429,
      context: { action, name, status: status ?? null },
    },
  );
}
