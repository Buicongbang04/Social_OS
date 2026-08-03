import { describe, expect, it } from "vitest";
import type { WorkspaceId } from "@repo/core";
import { S3ObjectStore } from "./s3-store";

const WHERE = {
  workspaceId: "wsp_01HX000000000000000000000A" as WorkspaceId,
  folder: "documents" as const,
  name: "bao-cao.txt",
};

describe("presigned URLs and the public host", () => {
  const base = {
    region: "us-east-1",
    bucket: "documents",
    accessKeyId: "key",
    secretAccessKey: "secret",
    forcePathStyle: true,
  };

  it("signs for the public host when it differs from the internal one", async () => {
    // The failure this exists for: in Docker the API reaches MinIO at
    // `http://minio:9000`, and a URL signed for that host is one no browser can
    // resolve. Found by running the cluster, not by any test that existed.
    const store = new S3ObjectStore({
      ...base,
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9010",
    });

    const url = await store.presignGet(WHERE);

    expect(url.startsWith("http://localhost:9010/")).toBe(true);
    expect(url).not.toContain("minio:9000");
    // The signature covers the host, so this cannot be a string replacement
    // done afterwards — it has to be signed for the host that will be used.
    expect(url).toContain("X-Amz-Signature=");
  });

  it("uses the one endpoint when no public host is given", async () => {
    const store = new S3ObjectStore({
      ...base,
      endpoint: "http://localhost:9000",
    });

    expect(await store.presignGet(WHERE)).toContain("localhost:9000");
  });
});
