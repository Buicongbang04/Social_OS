import { newId, type WorkspaceId } from "@repo/core";
import { describe, expect, it } from "vitest";
import { CampaignsService } from "./campaigns.service";

const WORKSPACE = newId("workspace") as WorkspaceId;

type Stored = {
  name: string;
  contentType: string;
  fileName: string;
  body: Buffer;
};

/** A store that remembers what it was handed, so the test can look. */
function serviceWith(stored: Stored[]) {
  const store = {
    put: async (input: Stored & { folder: string }) => {
      stored.push(input);
    },
    presignGet: async (location: { name: string }) =>
      `http://minio/posts/${location.name}`,
  };

  // Only the store and the pieces matter here; the rest is never reached by
  // an upload, and stubbing them for real would say this test needs them.
  return new CampaignsService(
    {} as never,
    {} as never,
    {} as never,
    store as never,
    {} as never,
  );
}

const file = (mimetype: string, name = "anh.png") => ({
  buffer: Buffer.from("giả vờ là ảnh"),
  mimetype,
  originalname: name,
});

describe("CampaignsService — ảnh tải lên", () => {
  it("keeps a picture and hands back a key and a link", async () => {
    const stored: Stored[] = [];

    const result = await serviceWith(stored).storeUploadedImage(
      WORKSPACE,
      file("image/png"),
    );

    expect(stored).toHaveLength(1);
    expect(result.key).toMatch(/^cnt_[0-9A-Z]+\.png$/);
    expect(result.url).toContain(result.key);
  });

  it("refuses anything that is not an image Facebook takes", async () => {
    // A PDF renamed to .png would be stored, attached to a post, and then
    // refused at publish time — a long way from the person who picked it.
    await expect(
      serviceWith([]).storeUploadedImage(
        WORKSPACE,
        file("application/pdf", "bao-gia.pdf"),
      ),
    ).rejects.toThrow(/Chỉ nhận ảnh/);
  });

  it("says what the file actually was, rather than just refusing", async () => {
    await expect(
      serviceWith([]).storeUploadedImage(WORKSPACE, file("video/mp4")),
    ).rejects.toThrow(/video\/mp4/);
  });

  it("never uses the uploader's own filename as the key", async () => {
    // Two people uploading "anh.png" would overwrite each other's post.
    const stored: Stored[] = [];

    const first = await serviceWith(stored).storeUploadedImage(
      WORKSPACE,
      file("image/png", "anh.png"),
    );
    const second = await serviceWith(stored).storeUploadedImage(
      WORKSPACE,
      file("image/png", "anh.png"),
    );

    expect(first.key).not.toBe(second.key);
    expect(first.key).not.toContain("anh.png");
  });

  it("keeps the extension the file's own type implies", async () => {
    // Stored as .png, a JPEG serves with the wrong content type to anything
    // that trusts the extension instead of the header.
    const stored: Stored[] = [];

    const result = await serviceWith(stored).storeUploadedImage(
      WORKSPACE,
      file("image/jpeg", "anh.jpeg"),
    );

    expect(result.key.endsWith(".jpg")).toBe(true);
    expect(stored[0]?.contentType).toBe("image/jpeg");
  });
});
