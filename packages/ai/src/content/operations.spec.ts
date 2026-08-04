import { describe, expect, it } from "vitest";
import type { ProviderGateway } from "../provider/gateway";
import {
  rewriteContent,
  suggestSeo,
  translateContent,
  writeContent,
} from "./operations";

/** What the gateway was asked, so the tests can assert on the prompt. */
type Seen = {
  system?: string;
  user?: string;
  metadata?: Record<string, unknown>;
};

/**
 * A gateway that answers with whatever the test says.
 *
 * Not a model: what these tests are about is the instruction sent and the
 * result read back, and a real model would make every assertion a coin toss.
 * Whether the model obeys is a question for `verify:stack`, which runs one.
 */
function gatewayReturning(object: unknown, seen: Seen = {}): ProviderGateway {
  return {
    generateObject: async (request: Record<string, unknown>) => {
      const messages = request.messages as { role: string; content: string }[];
      seen.system = messages.find((m) => m.role === "system")?.content;
      seen.user = messages.find((m) => m.role === "user")?.content;
      seen.metadata = request.metadata as Record<string, unknown>;

      return {
        object,
        provider: "ollama",
        model: "qwen2.5:7b",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { totalUsd: 0 },
      };
    },
  } as unknown as ProviderGateway;
}

const WRITTEN = { title: "Tiêu đề", body: "Nội dung.", hashtags: ["muahang"] };

describe("writeContent", () => {
  it("tells the model the channel, tone, length and language", async () => {
    const seen: Seen = {};
    await writeContent(
      { gateway: gatewayReturning(WRITTEN, seen) },
      {
        brief: "Giới thiệu dịch vụ mua hộ hàng Nhật",
        channel: "facebook",
        tone: "than-thien",
        length: "vua",
        language: "tiếng Việt",
      },
    );

    expect(seen.user).toContain("Kênh: facebook");
    expect(seen.user).toContain("Giọng văn: than-thien");
    expect(seen.user).toContain("Ngôn ngữ: tiếng Việt");
    expect(seen.user).toContain("Giới thiệu dịch vụ mua hộ hàng Nhật");
  });

  it("says the length in words, not as an adjective", async () => {
    // "Ngắn" means one thing for a TikTok caption and another for a blog post.
    // Asking in words is what stopped every draft needing a second pass for
    // length alone.
    const seen: Seen = {};
    await writeContent(
      { gateway: gatewayReturning(WRITTEN, seen) },
      {
        brief: "b",
        channel: "facebook",
        tone: "hai-huoc",
        length: "ngan",
        language: "tiếng Việt",
      },
    );

    expect(seen.user).toContain("40–80 từ");
    expect(seen.user).not.toContain("Độ dài: ngan");
  });

  it("keeps the workspace's voice apart from what to write about", async () => {
    // Glued onto the brief, a brand voice produces a post *about* the brand
    // voice. It has to arrive labelled as instruction, not as subject.
    const seen: Seen = {};
    await writeContent(
      { gateway: gatewayReturning(WRITTEN, seen) },
      {
        brief: "Khuyến mãi tháng 8",
        channel: "facebook",
        tone: "than-thien",
        length: "vua",
        language: "tiếng Việt",
        memory: [
          { key: "giọng văn", value: "thân mật, không dùng tiếng lóng" },
        ],
      },
    );

    expect(seen.user).toContain("GHI NHỚ VỀ WORKSPACE:");
    expect(seen.user).toContain("giọng văn: thân mật");
    // The brief still reads as the brief.
    expect(seen.user?.indexOf("GHI NHỚ")).toBeLessThan(
      seen.user?.indexOf("BRIEF:") ?? 0,
    );
  });

  it("leaves the memory block out entirely when there is none", async () => {
    // An empty heading invites the model to fill it in.
    const seen: Seen = {};
    await writeContent(
      { gateway: gatewayReturning(WRITTEN, seen) },
      {
        brief: "b",
        channel: "blog",
        tone: "chuyen-nghiep",
        length: "dai",
        language: "English",
      },
    );

    expect(seen.user).not.toContain("GHI NHỚ");
  });

  it("leaves it out for an empty list too, not just a missing one", async () => {
    // A workspace that has remembered nothing yet sends `[]`, and a heading
    // with nothing under it is an invitation for the model to fill it in.
    const seen: Seen = {};
    await writeContent(
      { gateway: gatewayReturning(WRITTEN, seen) },
      {
        brief: "b",
        channel: "blog",
        tone: "chuyen-nghiep",
        length: "dai",
        language: "English",
        memory: [],
      },
    );

    expect(seen.user).not.toContain("GHI NHỚ");
  });

  it("stamps the prompt version onto the call", async () => {
    // So a bill and a quality comparison can both be read by prompt version,
    // rather than by a release string that moves when some other prompt is
    // edited.
    const seen: Seen = {};
    const result = await writeContent(
      { gateway: gatewayReturning(WRITTEN, seen) },
      {
        brief: "b",
        channel: "facebook",
        tone: "than-thien",
        length: "vua",
        language: "tiếng Việt",
      },
    );

    expect(seen.metadata?.operation).toBe("content.write");
    expect(seen.metadata?.promptVersion).toBe(result.promptVersion);
    expect(result.promptVersion).toBeTruthy();
  });

  it("reports what the call cost and which model ran it", async () => {
    const result = await writeContent(
      { gateway: gatewayReturning(WRITTEN) },
      {
        brief: "b",
        channel: "facebook",
        tone: "than-thien",
        length: "vua",
        language: "tiếng Việt",
      },
    );

    expect(result.model).toBe("qwen2.5:7b");
    expect(result.usage.totalTokens).toBe(150);
    expect(result.costUsd).toBe("0.00000000");
  });
});

describe("rewriteContent", () => {
  const REWRITTEN = { body: "Ngắn hơn.", notes: [] };

  it("sends the original whole, and the instruction apart from it", async () => {
    const seen: Seen = {};
    await rewriteContent(
      { gateway: gatewayReturning(REWRITTEN, seen) },
      { original: "Bài dài ban đầu.", instruction: "Ngắn hơn một nửa" },
    );

    expect(seen.user).toContain("Yêu cầu: Ngắn hơn một nửa");
    expect(seen.user).toContain("BÀI GỐC:");
    expect(seen.user).toContain("Bài dài ban đầu.");
  });

  it("carries back the places the instruction could not be followed", async () => {
    // A rewrite that quietly drops a delivery time to hit a word count is
    // worse than one that says it could not.
    const result = await rewriteContent(
      {
        gateway: gatewayReturning({
          body: "x",
          notes: ["Không rút ngắn thêm được mà vẫn giữ đủ điều kiện bảo hành."],
        }),
      },
      { original: "o", instruction: "Ngắn hơn nữa" },
    );

    expect(result.object.notes).toHaveLength(1);
  });
});

describe("translateContent", () => {
  it("names the target language and sends the original", async () => {
    const seen: Seen = {};
    await translateContent(
      { gateway: gatewayReturning({ body: "Hello.", notes: [] }, seen) },
      { original: "Xin chào.", targetLanguage: "English" },
    );

    expect(seen.user).toContain("Dịch sang: English");
    expect(seen.user).toContain("Xin chào.");
  });

  it("tells the model to leave money alone", async () => {
    // Converting currency needs a rate, and a rate is not something a
    // translation prompt can know. A post promising the wrong price is worse
    // than one in the wrong currency.
    const seen: Seen = {};
    await translateContent(
      { gateway: gatewayReturning({ body: "b", notes: [] }, seen) },
      { original: "1.000.000đ", targetLanguage: "English" },
    );

    expect(seen.system).toContain("Không quy đổi tiền tệ");
  });
});

describe("suggestSeo", () => {
  it("asks over the content itself", async () => {
    const seen: Seen = {};
    await suggestSeo(
      {
        gateway: gatewayReturning(
          {
            titles: ["Mua hộ hàng Nhật giá rẻ"],
            metaDescription: "Dịch vụ mua hộ.",
            keywords: ["mua hộ hàng nhật"],
          },
          seen,
        ),
      },
      { content: "Bài viết về dịch vụ mua hộ hàng Nhật." },
    );

    expect(seen.user).toContain("Bài viết về dịch vụ mua hộ");
    // The constraint that keeps a title from being cut off in search results.
    expect(seen.system).toContain("60 ký tự");
  });

  it("tells the model not to invent keywords the piece does not earn", async () => {
    // Inventing them brings exactly the readers who leave immediately.
    const seen: Seen = {};
    await suggestSeo(
      {
        gateway: gatewayReturning(
          { titles: ["t"], metaDescription: "d", keywords: ["k"] },
          seen,
        ),
      },
      { content: "c" },
    );

    expect(seen.system).toContain("Đừng bịa từ khoá");
  });
});
