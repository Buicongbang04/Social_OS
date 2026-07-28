import type {
  ExecutionId,
  Metadata,
  TaskId,
  UserId,
  WorkspaceId,
} from "@repo/core";
import { RuntimeError, type CapabilityContext } from "@repo/runtime";
import { beforeEach, describe, expect, it } from "vitest";
import {
  StubProviderAdapter,
  type StubAdapterOptions,
} from "../adapters/stub-adapter";
import { describeProvider } from "../provider/catalog";
import { ProviderGateway } from "../provider/gateway";
import { ProviderRegistry } from "../provider/registry";
import { InMemoryUsageRecorder } from "../usage/recorder";
import { briefResearch, createAiCapabilities } from "./ai-capabilities";

const WORKSPACE = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as WorkspaceId;
const OWNER = "usr_01HX8ZQ7P9K2M4N6R8T0V2W4Y7" as UserId;
const EXECUTION = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y8" as ExecutionId;
const TASK = "tsk_01HX8ZQ7P9K2M4N6R8T0V2W4Y9" as TaskId;

const RESEARCH_REPLY = {
  trends: [
    { name: "AI agents", why: "Đang được triển khai thật ở doanh nghiệp." },
    { name: "On-device inference", why: "Giảm chi phí và độ trễ." },
  ],
  summary: "Hai xu hướng đáng chú ý.",
};

const CONTENT_REPLY = {
  title: "Xu hướng AI đáng chú ý",
  body: "Nội dung bài viết đầy đủ về AI agents.",
  hashtags: ["ai", "congnghe"],
};

function context(
  overrides: Partial<CapabilityContext> = {},
): CapabilityContext {
  return {
    inputs: { objective: "Viết bài về AI", topic: "AI", language: "vi" },
    previous: {},
    attempt: 1,
    workspaceId: WORKSPACE,
    executionId: EXECUTION,
    taskId: TASK,
    ownerId: OWNER,
    trigger: "MANUAL",
    correlationId: "req_test",
    ...overrides,
  };
}

function build(options: StubAdapterOptions) {
  const registry = new ProviderRegistry();
  const stub = new StubProviderAdapter({
    ...options,
    provider: "anthropic",
    defaultModel: options.defaultModel ?? "claude-sonnet-5",
  });
  registry.register(stub, describeProvider("anthropic"));

  const gateway = new ProviderGateway(
    registry,
    { default: "anthropic", fallback: [], timeoutMs: 1_000, attempts: 1 },
    { sleep: async () => {} },
  );
  const recorder = new InMemoryUsageRecorder();
  const capabilities = createAiCapabilities({ gateway, recorder });

  const byId = new Map(capabilities.map((c) => [c.descriptor.id, c]));
  return { stub, recorder, byId };
}

const BOTH: StubAdapterOptions = {
  replies: [
    {
      when: "nhà nghiên cứu xu hướng",
      reply: { text: "", object: RESEARCH_REPLY },
    },
    {
      when: "viết nội dung mạng xã hội",
      reply: { text: "", object: CONTENT_REPLY },
    },
  ],
};

describe("AI capabilities", () => {
  let harness: ReturnType<typeof build>;

  beforeEach(() => {
    harness = build(BOTH);
  });

  it("replaces the stub research with the model's findings", async () => {
    const outputs = await harness.byId
      .get("research.trend")!
      .handler(context());

    expect(outputs.trends).toEqual(["AI agents", "On-device inference"]);
    expect(outputs.summary).toBe("Hai xu hướng đáng chú ý.");
  });

  it("says in the output that research came from recall, not a live search", async () => {
    // A downstream step — or a person reading the result — must not mistake
    // the model's training data for something looked up today.
    const outputs = await harness.byId
      .get("research.trend")!
      .handler(context());

    expect(outputs.source).toBe("model-knowledge");
    expect(outputs.realtime).toBe(false);
  });

  it("writes real content rather than a template", async () => {
    const outputs = await harness.byId
      .get("content.generate")!
      .handler(context());

    expect(outputs.title).toBe("Xu hướng AI đáng chú ý");
    expect(outputs.body).toContain("AI agents");
    expect(outputs.hashtags).toEqual(["ai", "congnghe"]);
  });

  it("feeds the upstream research into the content prompt", async () => {
    // This is what proves dependency ordering delivered data rather than
    // merely running first.
    const research: Metadata = { trends: ["AI agents"], summary: "tóm tắt" };
    const outputs = await harness.byId
      .get("content.generate")!
      .handler(context({ previous: { "research.trend": research } }));

    expect(outputs.usedResearch).toBe(true);
    const prompt = harness.stub.calls
      .at(-1)!
      .messages.map((m) => m.content)
      .join("\n");
    expect(prompt).toContain("AI agents");
  });

  it("puts retrieved passages in the content prompt", async () => {
    // Retrieving a passage and then writing from the model's imagination does
    // the expensive half of RAG and skips the useful half — and the output
    // looks equally confident either way.
    const search: Metadata = {
      found: 1,
      grounded: true,
      passages: [
        {
          title: "Sổ tay nội bộ",
          text: "Khách được hoàn tiền trong vòng 14 ngày kể từ ngày nhận hàng.",
          documentId: "doc_x",
          chunkIndex: 0,
          score: 0.8,
        },
      ],
    };

    const outputs = await harness.byId
      .get("content.generate")!
      .handler(context({ previous: { "knowledge.search": search } }));

    expect(outputs.usedKnowledge).toBe(true);
    const prompt = harness.stub.calls
      .at(-1)!
      .messages.map((m) => m.content)
      .join("\n");
    expect(prompt).toContain("14 ngày");
    expect(prompt).toContain("Sổ tay nội bộ");
    // The instruction matters as much as the text: without it the model is
    // free to treat the quote as one input among many.
    expect(prompt).toContain("thẩm quyền");
  });

  it("says so when nothing was retrieved, rather than implying it was", async () => {
    const outputs = await harness.byId
      .get("content.generate")!
      .handler(
        context({
          previous: { "knowledge.search": { found: 0, passages: [] } },
        }),
      );

    expect(outputs.usedKnowledge).toBe(false);
  });

  it("says so when no research ran, instead of pretending there was some", async () => {
    const outputs = await harness.byId
      .get("content.generate")!
      .handler(context());

    expect(outputs.usedResearch).toBe(false);
  });

  it("meters each call against the task that made it", async () => {
    // Planning is charged once per run; execution is charged per step, and a
    // workspace's bill is mostly the latter. Without taskId the two cannot be
    // told apart in the ledger.
    await harness.byId.get("content.generate")!.handler(context());

    const record = harness.recorder.records[0]!;
    expect(record.operation).toBe("content.generate");
    expect(record.taskId).toBe(TASK);
    expect(record.executionId).toBe(EXECUTION);
    expect(record.workspaceId).toBe(WORKSPACE);
    expect(record.userId).toBe(OWNER);
    expect(record.correlationId).toBe("req_test");
  });

  it("classifies a provider failure as WORKER so the task's retry policy applies", async () => {
    // Not PROVIDER: by this point the gateway has already retried and
    // exhausted its fallback chain, so what the engine is being told is "this
    // step failed" — and the engine only retries WORKER-class failures.
    const failing = build({
      fallbackReply: { failWith: { statusCode: 503 } },
    });

    const error = await failing.byId
      .get("content.generate")!
      .handler(context())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).errorClass).toBe("WORKER");
    expect((error as RuntimeError).retryable).toBe(true);
  });

  it("rejects an answer that does not match the schema", async () => {
    const bad = build({
      fallbackReply: {
        text: "",
        object: { title: "", body: "", hashtags: [] },
      },
    });

    await expect(
      bad.byId.get("content.generate")!.handler(context()),
    ).rejects.toBeInstanceOf(RuntimeError);
  });

  it("allows longer than the default task timeout", async () => {
    // A model reasoning over a research prompt is slower than 60s, and a
    // timeout throws away a call already paid for.
    for (const id of ["research.trend", "content.generate"]) {
      expect(harness.byId.get(id)!.descriptor.timeoutMs).toBeGreaterThan(
        60_000,
      );
    }
  });

  it("keeps the capability ids the planner already schedules", async () => {
    // The planner picks capabilities by id from the registry. A renamed id
    // here would make every existing plan unrunnable.
    expect([...harness.byId.keys()].sort()).toEqual([
      "content.generate",
      "research.trend",
    ]);
  });
});

describe("briefResearch", () => {
  it("sends the trends and the gist, not the whole research object", async () => {
    // Found by running it: pasting the full research JSON — including a
    // per-trend rationale written for a human — into the writer's prompt was
    // enough to crash a local 7B model's runner, and on a paid model bills for
    // tokens the writer never needed.
    const harness = build(BOTH);
    const research: Metadata = {
      trends: ["AI agents", "On-device"],
      summary: "Hai xu hướng.",
      details: [
        { name: "AI agents", why: "x".repeat(400) },
        { name: "On-device", why: "y".repeat(400) },
      ],
    };

    await harness.byId
      .get("content.generate")!
      .handler(context({ previous: { "research.trend": research } }));

    const prompt = harness.stub.calls
      .at(-1)!
      .messages.map((m) => m.content)
      .join("\n");

    expect(prompt).toContain("AI agents");
    expect(prompt).toContain("Hai xu hướng.");
    expect(prompt).not.toContain("x".repeat(400));
    expect(prompt).not.toContain("details");
  });

  it("degrades to a truncated dump for a shape it does not recognise", () => {
    // An unfamiliar upstream capability should contribute something rather
    // than silently contributing nothing.
    const brief = briefResearch({ somethingElse: "z".repeat(2_000) });

    expect(brief.length).toBeLessThanOrEqual(800);
    expect(brief).toContain("z");
  });
});
