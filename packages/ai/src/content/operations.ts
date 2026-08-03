import { z } from "zod";
import { createDefaultPromptRegistry } from "../prompt/builtin";
import type { RenderedPrompt } from "../prompt/registry";
import type { ProviderGateway } from "../provider/gateway";
import { structured } from "../provider/structured";
import type { StructuredSchema } from "../provider/types";

/**
 * The content operations a marketing team actually performs.
 *
 * Four verbs rather than one, because they fail differently and want different
 * things guarded. Writing invents; rewriting must not. Translating must keep
 * every number; SEO must not invent a keyword the piece does not earn. One
 * "make me some content" call cannot enforce four different contracts, which is
 * why the previous single capability could only ever be a first draft.
 *
 * Deliberately plain functions over the Gateway. They are called from a runtime
 * capability, from an HTTP route, and from tests, and a class holding a
 * gateway would make each of those construct one.
 */

const PROMPTS = createDefaultPromptRegistry();

/** Where a piece is going. Length and voice follow from it. */
export const CONTENT_CHANNELS = [
  "facebook",
  "tiktok",
  "threads",
  "blog",
  "email",
] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export const CONTENT_TONES = [
  "than-thien",
  "chuyen-nghiep",
  "hai-huoc",
  "khan-truong",
  "gan-gui",
] as const;
export type ContentTone = (typeof CONTENT_TONES)[number];

export const CONTENT_LENGTHS = ["ngan", "vua", "dai"] as const;
export type ContentLength = (typeof CONTENT_LENGTHS)[number];

/**
 * How long each length is, in words, said to the model in its own terms.
 *
 * A number rather than an adjective: "ngắn" means something different to a
 * model asked for a TikTok caption than to one asked for a blog post, and the
 * result was drafts that had to be rewritten for length alone.
 */
const LENGTH_WORDS: Record<ContentLength, string> = {
  ngan: "khoảng 40–80 từ",
  vua: "khoảng 120–200 từ",
  dai: "khoảng 350–500 từ",
};

export type WriteInput = {
  brief: string;
  channel: ContentChannel;
  tone: ContentTone;
  length: ContentLength;
  /** Free text: "tiếng Việt", "English". Not an enum — the world has more. */
  language: string;
  /**
   * What the workspace has asked to be remembered: brand voice, forbidden
   * claims, who the audience is.
   *
   * Passed in rather than read here, because this package does not know what a
   * workspace is — and the caller that does already has them in hand.
   */
  memory?: readonly { key: string; value: string }[];
};

export type RewriteInput = {
  original: string;
  /** What to change. "Ngắn hơn một nửa", "giọng vui hơn". */
  instruction: string;
  language?: string;
};

export type TranslateInput = {
  original: string;
  targetLanguage: string;
};

export type SeoInput = {
  content: string;
};

const writeSchema = structured(
  "written_content",
  z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(8_000),
    hashtags: z.array(z.string().max(40)).max(12),
  }),
  "Bài viết hoàn chỉnh.",
);

const rewriteSchema = structured(
  "rewritten_content",
  z.object({
    body: z.string().min(1).max(8_000),
    /**
     * Where the instruction could not be followed without changing a fact.
     *
     * A field rather than silence: a rewrite that quietly drops a delivery
     * time to hit a word count is worse than one that says it could not.
     */
    notes: z.array(z.string().max(300)).max(5),
  }),
  "Bài đã viết lại, kèm ghi chú nếu có chỗ không làm được.",
);

const translateSchema = structured(
  "translated_content",
  z.object({
    body: z.string().min(1).max(8_000),
    notes: z.array(z.string().max(300)).max(5),
  }),
  "Bản dịch, kèm ghi chú ở chỗ không dịch trọn ý.",
);

const seoSchema = structured(
  "seo_suggestions",
  z.object({
    titles: z.array(z.string().min(1).max(80)).min(1).max(5),
    metaDescription: z.string().min(1).max(200),
    keywords: z.array(z.string().min(1).max(60)).min(1).max(15),
  }),
  "Tiêu đề gợi ý, mô tả meta và từ khoá.",
);

export type WrittenContent = {
  title: string;
  body: string;
  hashtags: string[];
};

/** A rewrite, with the places the instruction could not be followed. */
export type RewrittenContent = {
  body: string;
  notes: string[];
};

export type TranslatedContent = RewrittenContent;

export type SeoSuggestions = {
  titles: string[];
  metaDescription: string;
  keywords: string[];
};

export type ContentDeps = {
  gateway: ProviderGateway;
  model?: string;
  /** Carried onto the usage record so a bill can be read by operation. */
  workspaceId?: string;
};

/** What every operation returns, alongside its own payload. */
export type ContentResult<T> = {
  object: T;
  provider: string;
  model: string;
  promptVersion: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  costUsd: string;
};

export async function writeContent(
  deps: ContentDeps,
  input: WriteInput,
): Promise<ContentResult<WrittenContent>> {
  const prompt = PROMPTS.render("content.write.system");

  return run(deps, "content.write", writeSchema, prompt, [
    `Kênh: ${input.channel}`,
    `Giọng văn: ${input.tone}`,
    `Độ dài: ${LENGTH_WORDS[input.length]}`,
    `Ngôn ngữ: ${input.language}`,
    memoryBlock(input.memory),
    "",
    "BRIEF:",
    input.brief,
  ]);
}

export async function rewriteContent(
  deps: ContentDeps,
  input: RewriteInput,
): Promise<ContentResult<RewrittenContent>> {
  const prompt = PROMPTS.render("content.rewrite.system");

  return run(deps, "content.rewrite", rewriteSchema, prompt, [
    `Yêu cầu: ${input.instruction}`,
    ...(input.language ? [`Ngôn ngữ: ${input.language}`] : []),
    "",
    "BÀI GỐC:",
    input.original,
  ]);
}

export async function translateContent(
  deps: ContentDeps,
  input: TranslateInput,
): Promise<ContentResult<TranslatedContent>> {
  const prompt = PROMPTS.render("content.translate.system");

  return run(deps, "content.translate", translateSchema, prompt, [
    `Dịch sang: ${input.targetLanguage}`,
    "",
    "BÀI GỐC:",
    input.original,
  ]);
}

export async function suggestSeo(
  deps: ContentDeps,
  input: SeoInput,
): Promise<ContentResult<SeoSuggestions>> {
  const prompt = PROMPTS.render("content.seo.system");

  return run(deps, "content.seo", seoSchema, prompt, [
    "BÀI VIẾT:",
    input.content,
  ]);
}

/**
 * The workspace's remembered facts, as a block the model can follow.
 *
 * Labelled rather than merged into the brief: the model has to be able to tell
 * "this is how they want to be spoken for" from "this is what to write about",
 * and a brief with a brand voice glued onto the end produces a post about the
 * brand voice.
 */
function memoryBlock(
  memory: readonly { key: string; value: string }[] | undefined,
): string {
  if (!memory || memory.length === 0) return "";

  return [
    "",
    "GHI NHỚ VỀ WORKSPACE:",
    ...memory.map((fact) => `- ${fact.key}: ${fact.value}`),
  ].join("\n");
}

async function run<T>(
  deps: ContentDeps,
  operation: string,
  schema: StructuredSchema<T>,
  prompt: RenderedPrompt,
  userLines: string[],
): Promise<ContentResult<T>> {
  const response = await deps.gateway.generateObject(
    {
      ...(deps.model === undefined ? {} : { model: deps.model }),
      messages: [
        { role: "system", content: prompt.text },
        { role: "user", content: userLines.filter(Boolean).join("\n") },
      ],
      metadata: { operation, promptVersion: prompt.version },
    },
    schema,
  );

  return {
    object: response.object,
    provider: response.provider,
    model: response.model,
    promptVersion: prompt.version,
    usage: {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      totalTokens: response.usage.totalTokens,
    },
    costUsd: response.cost.totalUsd.toFixed(8),
  };
}
