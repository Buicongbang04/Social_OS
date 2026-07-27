import type { Metadata } from "@repo/core";
import {
  RuntimeError,
  type CapabilityContext,
  type CapabilityImplementation,
} from "@repo/runtime";
import { z } from "zod";
import type { ProviderGateway } from "../provider/gateway";
import { structured } from "../provider/structured";
import type { StructuredSchema } from "../provider/types";
import {
  recordUsageSafely,
  usageRecordFrom,
  type AiUsageRecord,
  type AiUsageRecorder,
} from "../usage/recorder";
import { PROMPT_VERSION } from "./prompts";

export type AiCapabilityOptions = {
  gateway: ProviderGateway;
  recorder: AiUsageRecorder;
  model?: string;
  onUsageError?: (error: unknown, record: AiUsageRecord) => void;
};

const contentSchema = structured(
  "generated_content",
  z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
    hashtags: z.array(z.string().max(40)).max(12),
  }),
  "Bài đăng đã viết xong.",
);

const researchSchema = structured(
  "research_findings",
  z.object({
    trends: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          why: z.string().min(1).max(400),
        }),
      )
      .min(1)
      .max(8),
    summary: z.string().min(1).max(2_000),
  }),
  "Các xu hướng tìm được và lý do chúng đáng chú ý.",
);

/**
 * Capabilities that actually call a model.
 *
 * These replace the deterministic Phase 1 stubs. They live here rather than in
 * services/runtime so the gateway, the schemas and the metering stay in one
 * package, and so @repo/runtime keeps knowing nothing about any AI SDK.
 *
 * Every call is metered against the task that made it, which is the piece the
 * Intent and Planner engines could not provide: planning is charged once per
 * run, but execution is charged per step, and a workspace's bill is mostly the
 * latter.
 */
export function createAiCapabilities(
  options: AiCapabilityOptions,
): readonly CapabilityImplementation[] {
  return [researchTrend(options), contentGenerate(options)];
}

function researchTrend(options: AiCapabilityOptions): CapabilityImplementation {
  return {
    descriptor: {
      id: "research.trend",
      name: "Research Trend",
      version: "1.0.0",
      category: "Research",
      supportedWorkers: ["FUNCTION"],
      permissions: ["workspace.workflow.execute"],
      // Generous: a model reasoning over a research prompt is slower than the
      // 60s default, and a timeout here throws away a call we already paid for.
      timeoutMs: 120_000,
    },
    handler: async (context) => {
      const topic =
        text(context.inputs.topic) ?? text(context.inputs.objective);

      const response = await call(options, context, "research.trend", {
        schema: researchSchema,
        system: `Bạn là nhà nghiên cứu xu hướng cho một đội marketing.

Nêu các xu hướng thật sự đáng chú ý về chủ đề được hỏi, mỗi cái kèm lý do ngắn gọn vì sao nó quan trọng lúc này.

QUAN TRỌNG: bạn không có quyền truy cập internet, nên chỉ được dựa vào kiến thức sẵn có của mình. Đừng bịa số liệu, đừng bịa nguồn, đừng khẳng định điều gì là "mới trong tuần này" khi bạn không thể biết. Nếu chủ đề đòi hỏi thông tin thời gian thực, hãy nói rõ giới hạn đó trong summary.`,
        user: `Chủ đề: ${topic ?? "(không rõ)"}\n\nNgữ cảnh: ${JSON.stringify(context.inputs)}`,
      });

      return {
        trends: response.object.trends.map((trend) => trend.name),
        details: response.object.trends,
        summary: response.object.summary,
        // Said in the output, not just in a doc: a downstream step — or a
        // person reading the result — must not mistake recalled knowledge for
        // a live search.
        source: "model-knowledge",
        realtime: false,
        model: `${response.provider}/${response.model}`,
      };
    },
  };
}

function contentGenerate(
  options: AiCapabilityOptions,
): CapabilityImplementation {
  return {
    descriptor: {
      id: "content.generate",
      name: "Generate Content",
      version: "1.0.0",
      category: "AI",
      supportedWorkers: ["FUNCTION"],
      permissions: ["workspace.workflow.execute"],
      timeoutMs: 120_000,
    },
    handler: async (context) => {
      const research = context.previous["research.trend"];
      const language = text(context.inputs.language) ?? "vi";
      const platform =
        text(context.inputs.platform) ??
        first(context.inputs.platforms) ??
        "mạng xã hội";

      const response = await call(options, context, "content.generate", {
        schema: contentSchema,
        system: `Bạn là người viết nội dung mạng xã hội.

Viết một bài đăng hoàn chỉnh, đúng giọng của nền tảng được nêu, bằng ngôn ngữ được yêu cầu.

- Viết nội dung thật, không viết mẫu điền chỗ trống, không để lại dấu ngoặc vuông chờ điền.
- Nếu có kết quả nghiên cứu ở phần ngữ cảnh, hãy dùng nó. Đừng thêm số liệu hay trích dẫn mà nghiên cứu không đưa ra.
- hashtags không kèm dấu #.`,
        user: [
          `Nền tảng: ${platform}`,
          `Ngôn ngữ: ${language}`,
          `Yêu cầu: ${text(context.inputs.objective) ?? ""}`,
          context.inputs.topic ? `Chủ đề: ${String(context.inputs.topic)}` : "",
          context.inputs.tone
            ? `Giọng văn: ${String(context.inputs.tone)}`
            : "",
          research
            ? `\nKết quả nghiên cứu từ bước trước:\n${briefResearch(research)}`
            : "\n(Không có bước nghiên cứu nào chạy trước.)",
        ]
          .filter(Boolean)
          .join("\n"),
      });

      return {
        title: response.object.title,
        body: response.object.body,
        hashtags: response.object.hashtags,
        // Proves the dependency actually delivered data rather than merely
        // running first — the same property the Phase 1 stub was built to show.
        usedResearch: research !== undefined,
        model: `${response.provider}/${response.model}`,
      };
    },
  };
}

/** One model call, metered against the task, with failures classified. */
async function call<T>(
  options: AiCapabilityOptions,
  context: CapabilityContext,
  operation: string,
  prompt: { schema: StructuredSchema<T>; system: string; user: string },
): Promise<{ object: T; provider: string; model: string }> {
  const response = await options.gateway
    .generateObject(
      {
        ...(options.model === undefined ? {} : { model: options.model }),
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        metadata: { operation, promptVersion: PROMPT_VERSION },
      },
      prompt.schema,
    )
    .catch((error: unknown) => {
      // WORKER, not PROVIDER: the gateway has already retried and exhausted
      // its fallback chain, so what the engine is being told is "this step
      // failed", and the retry policy that applies is the task's own.
      throw new RuntimeError(
        "WORKER",
        `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          retryable: true,
          context: { operation, taskId: context.taskId },
          cause: error,
        },
      );
    });

  await recordUsageSafely(
    options.recorder,
    usageRecordFrom(response, {
      workspaceId: context.workspaceId,
      userId: context.ownerId,
      executionId: context.executionId,
      taskId: context.taskId,
      correlationId: context.correlationId,
      operation,
    }),
    options.onUsageError,
  );

  return {
    object: response.object,
    provider: response.provider,
    model: response.model,
  };
}

/**
 * Condense the research step's output for the writer's prompt.
 *
 * Not `JSON.stringify(research)`. The research step returns the trend names,
 * a summary, *and* a per-trend rationale written for a human — and pasting all
 * of it in was enough to crash a local 7B model's runner outright, and on a
 * paid model would bill for tokens the writer never needed. The writer needs
 * what the trends are and the gist; the reasoning behind them is for whoever
 * reads the research output, not for the prompt.
 *
 * Falls back to a truncated dump for a shape this does not recognise, so an
 * unfamiliar upstream capability degrades rather than silently contributing
 * nothing.
 */
export function briefResearch(research: Metadata): string {
  const trends = Array.isArray(research.trends)
    ? research.trends.filter((t): t is string => typeof t === "string")
    : [];
  const summary = text(research.summary);

  if (trends.length === 0 && !summary) {
    return JSON.stringify(research).slice(0, 800);
  }

  return [
    trends.length > 0 ? `Xu hướng: ${trends.join(", ")}` : "",
    summary ? `Tóm tắt: ${summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function first(value: unknown): string | undefined {
  return Array.isArray(value) ? text(value[0]) : undefined;
}
