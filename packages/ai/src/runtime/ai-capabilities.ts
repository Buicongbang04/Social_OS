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
import { createDefaultPromptRegistry } from "../prompt/builtin";
import type { RenderedPrompt } from "../prompt/registry";

/** Rendered once: these have no variables. See the intent analyzer. */
const PROMPTS = createDefaultPromptRegistry();
const RESEARCH_PROMPT = PROMPTS.render("research.trend.system");
const CONTENT_PROMPT = PROMPTS.render("content.generate.system");


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
      description:
        "Hỏi model về xu hướng chung của một chủ đề, dựa trên kiến thức sẵn có của nó. KHÔNG tra internet và KHÔNG đọc tài liệu của workspace — muốn dùng tài liệu nội bộ thì dùng knowledge.search.",
      version: "1.0.0",
      category: "Research",
      supportedWorkers: ["FUNCTION"],
      permissions: ["workspace.workflow.execute"],
      // Generous: a model reasoning over a research prompt is slower than the
      // 60s default, and a timeout here throws away a call we already paid for.
      timeoutMs: 120_000,
      // Nominal, and deliberately not tiny: the budget check uses it to refuse
      // a step that will not fit in what is left, and under-declaring would let
      // a run start a call it cannot afford and be charged for it anyway.
      estimatedCostUsd: 0.02,
    },
    handler: async (context) => {
      const topic =
        text(context.inputs.topic) ?? text(context.inputs.objective);

      const response = await call(options, context, "research.trend", {
        schema: researchSchema,
        system: RESEARCH_PROMPT,
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
      description:
        "Viết bài đăng hoàn chỉnh cho một nền tảng mạng xã hội. Dùng kết quả của các bước đứng trước (nghiên cứu, tra tài liệu) làm căn cứ nếu có.",
      version: "1.0.0",
      category: "AI",
      supportedWorkers: ["FUNCTION"],
      permissions: ["workspace.workflow.execute"],
      timeoutMs: 120_000,
      estimatedCostUsd: 0.02,
    },
    handler: async (context) => {
      const research = context.previous["research.trend"];
      // The workspace's own documents, when a knowledge.search step ran first.
      // Grounding on these is the entire point of having uploaded them: a
      // pipeline that retrieves the passage and then writes from the model's
      // imagination has done the expensive half of RAG and skipped the useful
      // half, and the output looks equally confident either way.
      const passages = passagesFrom(context.previous["knowledge.search"]);
      const language = text(context.inputs.language) ?? "vi";
      const platform =
        text(context.inputs.platform) ??
        first(context.inputs.platforms) ??
        "mạng xã hội";

      const response = await call(options, context, "content.generate", {
        schema: contentSchema,
        system: CONTENT_PROMPT,
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
            : "",
          passages.length > 0
            ? `\nTRÍCH ĐOẠN TÀI LIỆU NỘI BỘ (nguồn có thẩm quyền — bám sát):\n${passages}`
            : "",
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
        // Said in the output so a reader can tell a grounded post from an
        // invented one without re-reading the plan.
        usedKnowledge: passages.length > 0,
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
  // The rendered prompt, not just its text, so the usage record carries the
  // version of the prompt that actually ran rather than a release-wide string
  // that changes when some other prompt is edited.
  prompt: { schema: StructuredSchema<T>; system: RenderedPrompt; user: string },
): Promise<{ object: T; provider: string; model: string }> {
  const response = await options.gateway
    .generateObject(
      {
        ...(options.model === undefined ? {} : { model: options.model }),
        messages: [
          { role: "system", content: prompt.system.text },
          { role: "user", content: prompt.user },
        ],
        metadata: { operation, promptVersion: prompt.system.version },
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

/**
 * The retrieved passages, formatted for a prompt.
 *
 * Returns "" when the step did not run or found nothing, so the caller can
 * tell "no documents matched" from "documents matched and were used" — the
 * two must not both read as a confident answer.
 */
function passagesFrom(previous: Metadata | undefined): string {
  const raw = previous?.passages;
  if (!Array.isArray(raw)) return "";

  return raw
    .slice(0, 8)
    .map((entry, index) => {
      const passage = entry as Record<string, unknown>;
      const title = String(passage.title ?? "tài liệu");
      return `[${index + 1}] ${title}: ${String(passage.text ?? "")}`;
    })
    .join("\n\n");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function first(value: unknown): string | undefined {
  return Array.isArray(value) ? text(value[0]) : undefined;
}
