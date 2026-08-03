import { newId, type UserId, type WorkspaceId } from "@repo/core";
import { describe, expect, it } from "vitest";
import { ContentService } from "./content.service";

const WORKSPACE = newId("workspace") as WorkspaceId;
const USER = newId("user") as UserId;

/** What reached the gateway, so the test can assert on the prompt. */
type Seen = { user?: string };

function serviceWith(
  facts: { key: string; value: string }[],
  seen: Seen = {},
  recorded: unknown[] = [],
) {
  const gateway = {
    generateObject: async (request: Record<string, unknown>) => {
      const messages = request.messages as { role: string; content: string }[];
      seen.user = messages.find((m) => m.role === "user")?.content;
      return {
        object: { title: "t", body: "b", hashtags: [] },
        provider: "ollama",
        model: "qwen2.5:7b",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cost: { totalUsd: 0 },
      };
    },
  };

  return new ContentService(
    { forWorkspace: async () => gateway } as never,
    { list: async () => facts } as never,
    { record: async (row: unknown) => void recorded.push(row) } as never,
  );
}

describe("ContentService", () => {
  it("passes the workspace's remembered voice to the model", async () => {
    // The screen does not send this — the server applies it, so a client
    // cannot forget to. Nothing else asserts that the read actually happens.
    const seen: Seen = {};
    const service = serviceWith(
      [{ key: "giọng văn", value: "thân mật, không tiếng lóng" }],
      seen,
    );

    await service.write(WORKSPACE, USER, {
      brief: "Khuyến mãi tháng 8",
      channel: "facebook",
      tone: "than-thien",
      length: "vua",
      language: "tiếng Việt",
    });

    expect(seen.user).toContain("GHI NHỚ VỀ WORKSPACE:");
    expect(seen.user).toContain("thân mật, không tiếng lóng");
  });

  it("writes a usage row for every call", async () => {
    // A studio that spends without leaving a row is one nobody can budget for.
    const recorded: unknown[] = [];
    const service = serviceWith([], {}, recorded);

    await service.write(WORKSPACE, USER, {
      brief: "b",
      channel: "facebook",
      tone: "than-thien",
      length: "vua",
      language: "tiếng Việt",
    });

    expect(recorded).toHaveLength(1);
    expect((recorded[0] as { operation: string }).operation).toBe(
      "content.write",
    );
    expect((recorded[0] as { workspaceId: string }).workspaceId).toBe(
      WORKSPACE,
    );
  });

  it("still returns the draft when the ledger write fails", async () => {
    // The provider has already answered and we have already been charged, so
    // throwing here would lose the work and the money both.
    const service = new ContentService(
      {
        forWorkspace: async () => ({
          generateObject: async () => ({
            object: { title: "t", body: "b", hashtags: [] },
            provider: "ollama",
            model: "m",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            cost: { totalUsd: 0 },
          }),
        }),
      } as never,
      { list: async () => [] } as never,
      {
        record: async () => {
          throw new Error("cơ sở dữ liệu hỏng");
        },
      } as never,
    );

    const result = await service.write(WORKSPACE, USER, {
      brief: "b",
      channel: "facebook",
      tone: "than-thien",
      length: "vua",
      language: "tiếng Việt",
    });

    expect(result.object.body).toBe("b");
  });

  it("refuses when the workspace has no provider at all", async () => {
    const service = new ContentService(
      { forWorkspace: async () => null } as never,
      { list: async () => [] } as never,
      { record: async () => undefined } as never,
    );

    await expect(
      service.seo(WORKSPACE, USER, { content: "c" }),
    ).rejects.toThrow(/AI provider/);
  });
});
