import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTenant,
  createTestApp,
  registerUser,
  type RegisteredUser,
  type TestApp,
} from "./testing/test-app";

/**
 * The upload path, end to end over HTTP against real Postgres and real MinIO.
 *
 * Not stubbed, because the two failures that matter here are both invisible to
 * a stub: whether a file name with Vietnamese characters survives multipart
 * decoding and S3 request signing, and whether a document ID from one
 * workspace can reach another workspace's file.
 */
const hasInfra = Boolean(
  process.env.DATABASE_URL && process.env.REDIS_URL && process.env.MINIO_URL,
);

const NOTE = [
  "Cà phê Việt Nam chủ yếu là robusta, trồng nhiều ở Tây Nguyên.",
  "Đắk Lắk là tỉnh có sản lượng cà phê lớn nhất cả nước.",
].join("\n\n");

describe.skipIf(!hasInfra)("documents API (integration)", () => {
  let testApp: TestApp;
  let alice: RegisteredUser;
  let bob: RegisteredUser;
  let aliceWorkspace: string;
  let bobWorkspace: string;

  const headers = (user: RegisteredUser, workspaceId: string) => ({
    Authorization: `Bearer ${user.accessToken}`,
    "x-workspace-id": workspaceId,
  });

  const upload = (
    user: RegisteredUser,
    workspaceId: string,
    options: { name?: string; body?: string; type?: string } = {},
  ) =>
    testApp
      .http()
      .post("/api/v1/documents")
      .set(headers(user, workspaceId))
      .attach("file", Buffer.from(options.body ?? NOTE, "utf8"), {
        filename: options.name ?? "ghi-chu.txt",
        contentType: options.type ?? "text/plain",
      });

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    if (testApp) await testApp.close();
  });

  beforeEach(async () => {
    await testApp.reset();
    alice = await registerUser(testApp, "alice@documents.test");
    bob = await registerUser(testApp, "bob@documents.test");
    aliceWorkspace = (await createTenant(testApp, alice, "alice-docs"))
      .workspaceId;
    bobWorkspace = (await createTenant(testApp, bob, "bob-docs")).workspaceId;
  });

  it("stores an upload as a PENDING document", async () => {
    const response = await upload(alice, aliceWorkspace).expect(201);

    expect(response.body.data.status).toBe("PENDING");
    expect(response.body.data.sizeBytes).toBe(Buffer.byteLength(NOTE, "utf8"));
    expect(response.body.data.chunkCount).toBe(0);
    expect(response.body.data.duplicate).toBe(false);
  });

  it("keeps a Vietnamese file name intact", async () => {
    // Multer decodes the multipart filename as latin1, so without re-reading
    // those bytes as UTF-8 the name arrives mojibaked — and the same bytes
    // then go into an S3 header, where a non-ASCII byte breaks the request
    // signature outright.
    const response = await upload(alice, aliceWorkspace, {
      name: "báo cáo quý 2.txt",
    }).expect(201);

    expect(response.body.data.fileName).toBe("báo cáo quý 2.txt");
  });

  it("recognises the same file uploaded twice", async () => {
    const first = await upload(alice, aliceWorkspace).expect(201);
    const second = await upload(alice, aliceWorkspace).expect(201);

    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.duplicate).toBe(true);

    const list = await testApp
      .http()
      .get("/api/v1/documents")
      .set(headers(alice, aliceWorkspace))
      .expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it("lets two workspaces upload identical bytes", async () => {
    await upload(alice, aliceWorkspace).expect(201);
    const other = await upload(bob, bobWorkspace).expect(201);

    expect(other.body.data.duplicate).toBe(false);
  });

  it("accepts a .md file the browser could not identify", async () => {
    // Browsers send application/octet-stream for anything unfamiliar, and .md
    // is one of those — rejecting on the header alone turns away the most
    // obvious thing someone would upload.
    const response = await upload(alice, aliceWorkspace, {
      name: "ghi-chu.md",
      type: "application/octet-stream",
    }).expect(201);

    expect(response.body.data.mimeType).toBe("text/plain");
  });

  it("refuses a format nothing can index yet", async () => {
    // Storing a PDF today would leave it at PENDING forever, which reads as a
    // bug rather than a missing feature.
    const response = await upload(alice, aliceWorkspace, {
      name: "tai-lieu.pdf",
      type: "application/pdf",
    }).expect(400);

    expect(response.body.message).toContain("pdf");
  });

  it("refuses an empty file", async () => {
    await upload(alice, aliceWorkspace, { body: "" }).expect(400);
  });

  it("does not show one workspace's document to another", async () => {
    // Same user in both cases would still pass RBAC, so this proves the
    // workspace scoping rather than the permission check.
    const created = await upload(alice, aliceWorkspace).expect(201);
    const id = created.body.data.id;

    await testApp
      .http()
      .get(`/api/v1/documents/${id}`)
      .set(headers(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .get("/api/v1/documents")
      .set(headers(bob, bobWorkspace))
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toEqual([]);
      });
  });

  it("does not let another workspace delete a document", async () => {
    const created = await upload(alice, aliceWorkspace).expect(201);
    const id = created.body.data.id;

    await testApp
      .http()
      .delete(`/api/v1/documents/${id}`)
      .set(headers(bob, bobWorkspace))
      .expect(404);

    await testApp
      .http()
      .get(`/api/v1/documents/${id}`)
      .set(headers(alice, aliceWorkspace))
      .expect(200);
  });

  it("issues a download URL that works with no credentials", async () => {
    const created = await upload(alice, aliceWorkspace).expect(201);

    const response = await testApp
      .http()
      .get(`/api/v1/documents/${created.body.data.id}/download-url`)
      .set(headers(alice, aliceWorkspace))
      .expect(200);

    const downloaded = await fetch(response.body.data.url);

    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe(NOTE);
  });

  it("does not issue a download URL across workspaces", async () => {
    // The URL is a bearer credential. Handing one out to the wrong tenant is
    // worse than leaking the metadata, because it keeps working afterwards.
    const created = await upload(alice, aliceWorkspace).expect(201);

    await testApp
      .http()
      .get(`/api/v1/documents/${created.body.data.id}/download-url`)
      .set(headers(bob, bobWorkspace))
      .expect(404);
  });

  it("hides a deleted document and stops serving its bytes", async () => {
    const created = await upload(alice, aliceWorkspace).expect(201);
    const id = created.body.data.id;
    const url = (
      await testApp
        .http()
        .get(`/api/v1/documents/${id}/download-url`)
        .set(headers(alice, aliceWorkspace))
        .expect(200)
    ).body.data.url;

    await testApp
      .http()
      .delete(`/api/v1/documents/${id}`)
      .set(headers(alice, aliceWorkspace))
      .expect(204);

    await testApp
      .http()
      .get(`/api/v1/documents/${id}`)
      .set(headers(alice, aliceWorkspace))
      .expect(404);

    // The presigned URL was valid before the delete and must stop working —
    // a soft delete that leaves the object readable is not a delete.
    expect((await fetch(url)).status).toBe(404);
  });

  it("refuses a request with no workspace header, at the guard", async () => {
    // 400 rather than 403 on purpose, and it comes from PermissionGuard rather
    // than from the controller: with no workspace there is nothing to
    // authorise against, so this is a malformed request, not a denied one.
    // Asserting the guard's own message is what proves the check happens
    // before any handler code runs.
    const response = await testApp
      .http()
      .get("/api/v1/documents")
      .set({ Authorization: `Bearer ${alice.accessToken}` })
      .expect(400);

    expect(response.body.message).toContain("A workspace id is required");
  });
});
