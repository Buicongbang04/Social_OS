import { createHash } from "node:crypto";
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

type Entry = {
  body: Uint8Array;
  contentType: string;
  checksum: string;
  lastModified: Date;
};

/**
 * Object storage in a map.
 *
 * Builds keys with the same `keyFor`, so a test that proves one workspace
 * cannot reach another's object is testing the real key layout rather than a
 * stand-in for it. What it does not model is the network, which is exactly
 * what the integration suite against MinIO is for.
 */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Entry>();

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = keyFor(input);
    const checksum = createHash("sha256").update(input.body).digest("hex");

    this.objects.set(key, {
      // Copied: the caller may reuse or mutate its buffer, and storage that
      // changed after the fact would be a very confusing bug.
      body: Uint8Array.from(input.body),
      contentType: input.contentType,
      checksum,
      lastModified: new Date(),
    });

    return {
      key,
      size: input.body.byteLength,
      contentType: input.contentType,
      checksum,
    };
  }

  async get(location: ObjectLocation): Promise<Uint8Array> {
    const key = keyFor(location);
    const entry = this.objects.get(key);

    if (!entry) {
      throw new RuntimeError("RESOURCE", `No object at ${key}.`, {
        retryable: false,
        context: { key },
      });
    }

    return Uint8Array.from(entry.body);
  }

  async head(location: ObjectLocation): Promise<ObjectMetadata | null> {
    const key = keyFor(location);
    const entry = this.objects.get(key);
    if (!entry) return null;

    return {
      key,
      size: entry.body.byteLength,
      contentType: entry.contentType,
      lastModified: entry.lastModified,
    };
  }

  async delete(location: ObjectLocation): Promise<void> {
    this.objects.delete(keyFor(location));
  }

  async presignGet(
    location: ObjectLocation,
    expiresInSeconds = DEFAULT_PRESIGN_SECONDS,
  ): Promise<string> {
    return `memory://${keyFor(location)}?expires=${expiresInSeconds}`;
  }

  /** Test helper: every key currently stored. */
  get keys(): string[] {
    return [...this.objects.keys()];
  }
}
