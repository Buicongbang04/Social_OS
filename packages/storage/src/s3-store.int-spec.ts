import { newId } from "@repo/core";
import { RuntimeError } from "@repo/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { S3ObjectStore } from "./s3-store";
import type { ObjectLocation } from "./types";

/**
 * Against a real MinIO, because the parts most likely to be wrong are the ones
 * the in-memory store cannot have: bucket creation, path-style addressing, how
 * a missing object is reported, and whether a presigned URL actually works.
 *
 *   docker compose up -d minio
 *   pnpm --filter @repo/storage test:int
 */
const ENDPOINT = process.env.MINIO_URL ?? "http://localhost:9000";
const BUCKET = `int-test-${Date.now()}`;

const WS_A = newId("workspace");
const WS_B = newId("workspace");

const at = (workspaceId: string, name: string): ObjectLocation => ({
  workspaceId: workspaceId as ObjectLocation["workspaceId"],
  folder: "documents",
  name,
});

const bytes = (text: string) => new TextEncoder().encode(text);

describe("S3ObjectStore against MinIO", () => {
  let store: S3ObjectStore;

  beforeAll(async () => {
    store = new S3ObjectStore({
      endpoint: ENDPOINT,
      region: process.env.MINIO_REGION ?? "us-east-1",
      bucket: BUCKET,
      accessKeyId: process.env.MINIO_ROOT_USER ?? "ai_social_os",
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? "ai_social_os_secret",
      forcePathStyle: true,
    });
    await store.ensureBucket();
  });

  afterAll(async () => {
    // Best effort: leaving one empty bucket behind beats failing the suite.
    await store.delete(at(WS_A, "round-trip"));
  });

  it("creates the bucket it was pointed at", async () => {
    // Nothing else in this suite can pass if this did not happen, but a
    // separate assertion says so rather than leaving it to be inferred.
    await expect(store.ensureBucket()).resolves.toBeUndefined();
  });

  it("stores bytes and gives them back unchanged", async () => {
    const content = "Cà phê Đắk Lắk — nội dung có dấu và ký tự UTF-8.";
    const stored = await store.put({
      ...at(WS_A, "round-trip"),
      body: bytes(content),
      contentType: "text/plain; charset=utf-8",
      fileName: "báo cáo.txt",
    });

    expect(stored.key).toBe(`documents/${WS_A}/round-trip`);
    expect(new TextDecoder().decode(await store.get(at(WS_A, "round-trip")))).toBe(
      content,
    );
  });

  it("hands a Vietnamese file name back to the browser intact", async () => {
    // Not just "the upload did not fail": the point of sending the header at
    // all is that the download saves under the name the user chose.
    await store.put({
      ...at(WS_A, "tên-tiếng-việt"),
      body: bytes("nội dung"),
      contentType: "text/plain",
      fileName: "báo cáo quý 2.txt",
    });

    const response = await fetch(
      await store.presignGet(at(WS_A, "tên-tiếng-việt"), 60),
    );
    const disposition = response.headers.get("content-disposition") ?? "";
    await response.arrayBuffer();

    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent("báo cáo quý 2.txt")}`,
    );
  });

  it("reports a missing object as absent rather than as a failure", async () => {
    // Flattening a real error into "not found" would read as "the file was
    // never uploaded", and the upload path would be blamed for an outage.
    expect(await store.head(at(WS_A, "chưa-từng-tồn-tại"))).toBeNull();
  });

  it("describes an object that is there", async () => {
    await store.put({
      ...at(WS_A, "head-me"),
      body: bytes("xin chào"),
      contentType: "text/plain",
    });

    const meta = await store.head(at(WS_A, "head-me"));

    expect(meta?.size).toBe(bytes("xin chào").byteLength);
    expect(meta?.contentType).toContain("text/plain");
  });

  it("keeps two workspaces' objects apart even under the same name", async () => {
    await store.put({
      ...at(WS_A, "cùng-tên"),
      body: bytes("của A"),
      contentType: "text/plain",
    });
    await store.put({
      ...at(WS_B, "cùng-tên"),
      body: bytes("của B"),
      contentType: "text/plain",
    });

    expect(new TextDecoder().decode(await store.get(at(WS_A, "cùng-tên")))).toBe(
      "của A",
    );
  });

  it("cannot be made to read another workspace's object through the name", async () => {
    await store.put({
      ...at(WS_B, "riêng-tư"),
      body: bytes("bí mật của B"),
      contentType: "text/plain",
    });

    await expect(
      store.get(at(WS_A, `../${WS_B}/riêng-tư`)),
    ).rejects.toThrow();
  });

  it("issues a presigned URL that actually downloads the object", async () => {
    // The point of presigning is that the browser fetches it directly, with no
    // credentials — so the only proof is fetching it with no credentials.
    const content = "tải trực tiếp";
    await store.put({
      ...at(WS_A, "presigned"),
      body: bytes(content),
      contentType: "text/plain",
    });

    const url = await store.presignGet(at(WS_A, "presigned"), 60);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(content);
  });

  it("throws a RuntimeError, not an SDK error, when the object is gone", async () => {
    await store.put({
      ...at(WS_A, "sẽ-xoá"),
      body: bytes("tạm"),
      contentType: "text/plain",
    });
    await store.delete(at(WS_A, "sẽ-xoá"));

    expect(await store.head(at(WS_A, "sẽ-xoá"))).toBeNull();
    await expect(store.get(at(WS_A, "sẽ-xoá"))).rejects.toThrow(RuntimeError);
  });

  it("treats deleting something absent as done", async () => {
    await expect(
      store.delete(at(WS_A, "không-có-gì")),
    ).resolves.toBeUndefined();
  });
});
