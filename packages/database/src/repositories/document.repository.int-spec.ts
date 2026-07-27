import { newId, type DocumentId, type UserId, type WorkspaceId } from "@repo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbClient, type DatabaseClient } from "../client";
import { organizations, users, workspaces } from "../schema";
import { truncateTenantData } from "../testing/reset";
import { DrizzleDocumentRepository } from "./document.repository";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("DrizzleDocumentRepository (integration)", () => {
  let db: DatabaseClient;
  let repo: DrizzleDocumentRepository;
  let workspaceId: WorkspaceId;
  let otherWorkspaceId: WorkspaceId;
  let userId: UserId;

  const upload = (overrides: Record<string, unknown> = {}) => ({
    workspaceId,
    title: "Nông sản Việt Nam",
    fileName: "bao-cao.txt",
    mimeType: "text/plain",
    sizeBytes: 1_234,
    checksum: "a".repeat(64),
    storageKey: `documents/${workspaceId}/doc`,
    ...overrides,
  });

  beforeEach(async () => {
    db ??= createDbClient(DATABASE_URL!, { maxConnections: 3 });
    repo = new DrizzleDocumentRepository(db);
    await truncateTenantData(db);

    const organizationId = newId("organization");
    userId = newId("user");
    workspaceId = newId("workspace");
    otherWorkspaceId = newId("workspace");

    await db
      .insert(users)
      .values({ id: userId, email: "owner@test.local", status: "ACTIVE" });
    await db.insert(organizations).values({
      id: organizationId,
      name: "Test Org",
      slug: `org-${organizationId.slice(-8).toLowerCase()}`,
      ownerId: userId,
    });
    await db.insert(workspaces).values([
      {
        id: workspaceId,
        organizationId,
        name: "A",
        slug: `a-${workspaceId.slice(-8).toLowerCase()}`,
      },
      {
        id: otherWorkspaceId,
        organizationId,
        name: "B",
        slug: `b-${otherWorkspaceId.slice(-8).toLowerCase()}`,
      },
    ]);
  });

  it("stores an upload as PENDING with nothing indexed yet", async () => {
    const document = await repo.create(upload(), userId);

    expect(document.status).toBe("PENDING");
    expect(document.chunkCount).toBe(0);
    expect(document.embeddingModel).toBeNull();
    expect(document.indexedAt).toBeNull();
    expect(document.version).toBe(1);
  });

  it("does not return a document to another workspace", async () => {
    // The failure this scoping exists for: an ID is enough to read a file if
    // the query does not also check who owns it, and the read looks legitimate
    // in every log.
    const document = await repo.create(upload(), userId);

    expect(await repo.findById(otherWorkspaceId, document.id)).toBeNull();
    expect(await repo.findById(workspaceId, document.id)).not.toBeNull();
  });

  it("lists only this workspace's documents, newest first", async () => {
    await repo.create(upload({ title: "Cũ" }), userId);
    await repo.create(
      upload({ title: "Mới", checksum: "b".repeat(64) }),
      userId,
    );
    await repo.create(
      upload({
        workspaceId: otherWorkspaceId,
        title: "Của B",
        storageKey: `documents/${otherWorkspaceId}/doc`,
      }),
      userId,
    );

    const listed = await repo.list(workspaceId);

    expect(listed.map((d) => d.title)).toEqual(["Mới", "Cũ"]);
  });

  it("recognises a re-upload of the same bytes", async () => {
    const first = await repo.create(upload(), userId);

    expect((await repo.findByChecksum(workspaceId, "a".repeat(64)))?.id).toBe(
      first.id,
    );
  });

  it("lets two workspaces upload identical bytes independently", async () => {
    // Sharing one row would mean deleting one tenant's document removed the
    // other's, which is worse than paying to embed the file twice.
    await repo.create(upload(), userId);

    await expect(
      repo.create(
        upload({
          workspaceId: otherWorkspaceId,
          storageKey: `documents/${otherWorkspaceId}/doc`,
        }),
        userId,
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a second upload of the same bytes in the same workspace", async () => {
    await repo.create(upload(), userId);

    await expect(
      repo.create(upload({ title: "Bản sao" }), userId),
    ).rejects.toThrow();
  });

  it("walks a document through indexing", async () => {
    const created = await repo.create(upload(), userId);

    const indexing = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "INDEXING" },
      created.version,
    );
    expect(indexing?.status).toBe("INDEXING");

    const ready = await repo.updateIndexState(
      workspaceId,
      created.id,
      {
        status: "READY",
        chunkCount: 12,
        embeddingModel: "text-embedding-3-small",
        indexedAt: new Date(),
      },
      indexing!.version,
    );

    expect(ready?.status).toBe("READY");
    expect(ready?.chunkCount).toBe(12);
    expect(ready?.version).toBe(3);
  });

  it("refuses a jump from PENDING straight to READY", async () => {
    // A document that skipped indexing has no chunks, and the only symptom
    // would be search finding nothing while the UI says it is ready.
    const created = await repo.create(upload(), userId);

    expect(
      await repo.updateIndexState(
        workspaceId,
        created.id,
        { status: "READY", chunkCount: 12 },
        created.version,
      ),
    ).toBeNull();
    expect((await repo.findById(workspaceId, created.id))?.status).toBe(
      "PENDING",
    );
  });

  it("stops a worker from an abandoned run finishing on top of a newer one", async () => {
    // The one case the transition whitelist cannot catch. A worker reads the
    // document as INDEXING; its run stalls and is marked FAILED; a retry puts
    // the document back into INDEXING. The stale worker now writes READY —
    // legal from INDEXING, so the whitelist waves it through — and the newer
    // run's result is replaced by the abandoned one's. Only the version says
    // that this worker is looking at a document that has since moved on.
    const created = await repo.create(upload(), userId);
    const stale = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "INDEXING" },
      created.version,
    );

    const failed = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "FAILED", failureReason: "provider timeout" },
      stale!.version,
    );
    const retried = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "INDEXING" },
      failed!.version,
    );
    // The abandoned worker returns while the retry is still running. Its
    // target is legal from where the document is, so only the version can
    // tell that it is looking at a document that has since moved on.
    const late = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "READY", chunkCount: 99 },
      stale!.version,
    );

    expect(late).toBeNull();
    const now = await repo.findById(workspaceId, created.id);
    expect(now?.status).toBe("INDEXING");
    expect(now?.version).toBe(retried!.version);
  });

  it("records why indexing failed", async () => {
    const created = await repo.create(upload(), userId);
    const failed = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "FAILED", failureReason: "provider hết hạn mức" },
      created.version,
    );

    expect(failed?.status).toBe("FAILED");
    expect(failed?.failureReason).toBe("provider hết hạn mức");
  });

  it("keeps the chunk count when a later update does not mention it", async () => {
    // Otherwise a retry that only sets the status silently zeroes the count,
    // and the document reads as indexed-but-empty.
    const created = await repo.create(upload(), userId);
    const indexing = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "INDEXING" },
      created.version,
    );
    const ready = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "READY", chunkCount: 7 },
      indexing!.version,
    );
    const again = await repo.updateIndexState(
      workspaceId,
      created.id,
      { status: "INDEXING" },
      ready!.version,
    );

    expect(again?.chunkCount).toBe(7);
  });

  it("will not let another workspace change or delete a document", async () => {
    const created = await repo.create(upload(), userId);

    expect(
      await repo.updateIndexState(
        otherWorkspaceId,
        created.id,
        { status: "INDEXING" },
        created.version,
      ),
    ).toBeNull();
    expect(await repo.softDelete(otherWorkspaceId, created.id, userId)).toBe(
      false,
    );
    expect(await repo.findById(workspaceId, created.id)).not.toBeNull();
  });

  it("hides a soft-deleted document from every read", async () => {
    const created = await repo.create(upload(), userId);

    expect(await repo.softDelete(workspaceId, created.id, userId)).toBe(true);
    expect(await repo.findById(workspaceId, created.id)).toBeNull();
    expect(await repo.list(workspaceId)).toEqual([]);
    expect(await repo.findByChecksum(workspaceId, "a".repeat(64))).toBeNull();
  });

  it("reports a second delete as nothing to do", async () => {
    const created = await repo.create(upload(), userId);
    await repo.softDelete(workspaceId, created.id, userId);

    expect(await repo.softDelete(workspaceId, created.id, userId)).toBe(false);
  });

  it("returns null for a document that never existed", async () => {
    expect(
      await repo.findById(workspaceId, newId("document") as DocumentId),
    ).toBeNull();
  });
});
