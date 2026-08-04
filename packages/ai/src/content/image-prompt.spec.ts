import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "./image-prompt";

const POST = `5 MÓN HÀNG NHẬT NGƯỜI VIỆT ĐẶT NHIỀU NHẤT

💄 Mỹ phẩm và thực phẩm chức năng
🏠 Đồ gia dụng và điện tử`;

describe("buildImagePrompt", () => {
  it("forbids text in the picture, in the strongest terms available", async () => {
    // Image models write Vietnamese diacritics wrongly. A banner reading
    // "Mựa hộ hàng Nhật" is worse than one with no words at all.
    const prompt = buildImagePrompt({ body: POST });

    expect(prompt).toContain("ABSOLUTELY NO text");
    expect(prompt).toContain("watermarks");
  });

  it("forbids logos and brand marks", async () => {
    // A drawn logo is a fake logo, and a post carrying one claims a
    // relationship that does not exist.
    const prompt = buildImagePrompt({ body: POST });

    expect(prompt).toContain("No logos");
    expect(prompt).toContain("no real company names");
  });

  it("hands the model the post as subject matter, not as copy to typeset", async () => {
    const prompt = buildImagePrompt({ body: POST });

    expect(prompt).toContain("5 MÓN HÀNG NHẬT");
    expect(prompt).toContain("do not render any of it as text");
  });

  it("asks for the thing the post is about, not an abstract concept", async () => {
    // Left to itself the model draws a lone cardboard box on white for every
    // logistics post there has ever been.
    const prompt = buildImagePrompt({ body: POST });

    expect(prompt).toContain("Show the subject the post is actually about");
  });

  it("leaves somewhere for a headline to sit", async () => {
    const prompt = buildImagePrompt({ body: POST });

    expect(prompt).toContain("Leave one area calm");
  });

  it("frames it for the feed by default, and otherwise as asked", async () => {
    expect(buildImagePrompt({ body: POST })).toContain("landscape 1.91:1");
    expect(buildImagePrompt({ body: POST, shape: "story" })).toContain(
      "vertical 9:16",
    );
  });

  it("says what the business does when the workspace has said so", async () => {
    // Without it the model draws whatever the words suggest, which for a
    // logistics post is a stock photograph of a box.
    const prompt = buildImagePrompt({
      body: POST,
      brand: "Mua hộ và vận chuyển quốc tế",
    });

    expect(prompt).toContain("THE BUSINESS: Mua hộ và vận chuyển quốc tế");
  });

  it("leaves the business line out entirely when there is none", async () => {
    // An empty heading invites the model to fill it in.
    expect(buildImagePrompt({ body: POST })).not.toContain("THE BUSINESS");
  });

  it("cuts a very long post rather than sending the whole thing", async () => {
    // The prompt is billed as input tokens on every image.
    const prompt = buildImagePrompt({ body: "x".repeat(5_000) });

    expect(prompt).not.toContain("x".repeat(2_001));
  });
});
