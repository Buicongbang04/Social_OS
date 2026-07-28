import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  embedMany,
  generateObject,
  generateText,
  jsonSchema,
  streamText,
  tool,
  type EmbeddingModel,
  type JSONSchema7,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { DEFAULT_EMBEDDING_MODELS } from "../provider/catalog";
import type {
  AdapterResult,
  AdapterStreamChunk,
  EmbeddingRequest,
  EmbeddingResult,
  FinishReason,
  ProviderAdapter,
  ProviderMessage,
  ProviderName,
  ProviderRequest,
  ProviderTool,
  JsonSchema,
  ProviderToolCall,
  StructuredSchema,
  TokenUsage,
} from "../provider/types";

/**
 * How much of a JSON Schema the provider can actually be given.
 *
 * `full` sends the schema unchanged. `minimal` drops size constraints
 * (`maxLength`, `minItems`, …) before sending.
 *
 * The reason `minimal` exists, measured against Ollama running qwen2.5:7b:
 * a `maxLength` of 2000 is fine, and one of 4000 crashes the model runner
 * outright with "model runner has unexpectedly stopped". Grammar-constrained
 * decoding compiles those bounds into a grammar, and a large bound explodes
 * it. Nothing is lost by dropping them: the schema is a steer, and
 * `StructuredSchema.parse` is what actually enforces the shape on arrival.
 */
export type SchemaDialect = "full" | "minimal";

/** How to reach one vendor. */
export type VercelAdapterOptions = {
  provider: ProviderName;
  defaultModel: string;
  apiKey?: string;
  baseUrl?: string;
  /** Defaults to `minimal` for Ollama and `full` elsewhere. */
  schemaDialect?: SchemaDialect;
  /**
   * Replaces the SDK's HTTP client.
   *
   * A seam for tests, and specifically for asserting what actually goes on the
   * wire. Several of the bugs found in this file were invisible above the
   * request body — a schema the SDK dropped, a usage flag it did not send —
   * and the only honest way to test those is to look at the bytes.
   */
  fetch?: typeof globalThis.fetch;
};

/**
 * The single place in the codebase that knows the Vercel AI SDK exists.
 *
 * Everything above this file speaks ProviderRequest/ProviderResponse, so
 * replacing the SDK — or calling a vendor's own client directly — is a change
 * to this file and nothing else.
 */
export class VercelProviderAdapter implements ProviderAdapter {
  readonly provider: ProviderName;
  readonly defaultModel: string;
  private readonly resolve: (model: string) => LanguageModel;
  private readonly resolveEmbedding: ((model: string) => EmbeddingModel) | null;
  private readonly dialect: SchemaDialect;

  constructor(options: VercelAdapterOptions) {
    this.provider = options.provider;
    this.defaultModel = options.defaultModel;
    this.resolve = buildResolver(options);
    this.resolveEmbedding = buildEmbeddingResolver(options);
    this.dialect =
      options.schemaDialect ??
      (options.provider === "ollama" ? "minimal" : "full");
  }

  async generate(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): Promise<AdapterResult> {
    const model = request.model ?? this.defaultModel;
    const result = await generateText({
      model: this.resolve(model),
      ...toPrompt(request.messages),
      ...(request.tools?.length
        ? { tools: toToolSet(request.tools, this.dialect) }
        : {}),
      ...callSettings(request),
      ...(signal ? { abortSignal: signal } : {}),
    });

    return {
      model,
      text: result.text,
      toolCalls: result.toolCalls.map(toProviderToolCall),
      usage: toTokenUsage(result.usage),
      finishReason: toFinishReason(result.finishReason),
      metadata: { warnings: (result.warnings ?? []).length },
    };
  }

  /**
   * The same call as `generate`, delivered in pieces.
   *
   * Reads `result.stream` rather than `result.textStream` because tool calls
   * have to come through too, and `textStream` drops them silently — a caller
   * asking for a tool would see the model say nothing and finish.
   *
   * The `done` chunk is built from the promises the SDK resolves once the
   * stream ends, so the usage on it is the vendor's own count rather than
   * anything estimated here.
   */
  async *stream(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AdapterStreamChunk, void, undefined> {
    const model = request.model ?? this.defaultModel;
    const result = streamText({
      model: this.resolve(model),
      ...toPrompt(request.messages),
      ...(request.tools?.length
        ? { tools: toToolSet(request.tools, this.dialect) }
        : {}),
      ...callSettings(request),
      ...(signal ? { abortSignal: signal } : {}),
    });

    const toolCalls: ProviderToolCall[] = [];

    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        // Empty deltas happen and mean nothing; forwarding them would make a
        // consumer counting chunks measure the vendor's framing, not the text.
        if (part.text !== "") yield { type: "text", delta: part.text };
      } else if (part.type === "tool-call") {
        const call = toProviderToolCall(part);
        toolCalls.push(call);
        yield { type: "tool-call", call };
      }
      // Everything else — reasoning traces, sources, raw frames, step
      // boundaries — is dropped on purpose. See StreamChunk.
    }

    yield {
      type: "done",
      result: {
        model,
        text: await result.text,
        toolCalls,
        usage: toTokenUsage(await result.usage),
        finishReason: toFinishReason(await result.finishReason),
        metadata: { streamed: true },
      },
    };
  }

  async generateObject<T>(
    request: ProviderRequest,
    schema: StructuredSchema<T>,
    signal?: AbortSignal,
  ): Promise<AdapterResult & { object: T }> {
    const model = request.model ?? this.defaultModel;
    const result = await generateObject({
      model: this.resolve(model),
      output: "object",
      schema: jsonSchema<unknown>(
        forDialect(schema.jsonSchema, this.dialect) as JSONSchema7,
      ),
      schemaName: schema.name,
      ...(schema.description === undefined
        ? {}
        : { schemaDescription: schema.description }),
      ...toPrompt(request.messages),
      ...callSettings(request),
      ...(signal ? { abortSignal: signal } : {}),
    });

    // Validate on the way out even though the provider was handed the schema.
    // Structured output is a strong steer, not a guarantee, on every vendor
    // here — and a shape violation caught now is far cheaper than one that
    // reaches the planner.
    const object = schema.parse(result.object);

    return {
      model,
      // The parsed object is the payload; the text form is kept so a stored
      // response and an audit log show what the model actually emitted.
      text: JSON.stringify(object),
      object,
      toolCalls: [],
      usage: toTokenUsage(result.usage),
      finishReason: toFinishReason(result.finishReason),
      metadata: { warnings: (result.warnings ?? []).length },
    };
  }

  /**
   * Embed texts, or report that this vendor cannot.
   *
   * Batched into one request: indexing a document produces dozens of chunks,
   * and one call per chunk would multiply both latency and per-request
   * overhead for no benefit.
   */
  async embed(
    request: EmbeddingRequest,
    signal?: AbortSignal,
  ): Promise<EmbeddingResult> {
    if (!this.resolveEmbedding) {
      throw new Error(`Provider ${this.provider} has no embedding model.`);
    }

    const model = request.model ?? defaultEmbeddingModel(this.provider);
    const result = await embedMany({
      model: this.resolveEmbedding(model),
      values: [...request.texts],
      ...(signal ? { abortSignal: signal } : {}),
    });

    const inputTokens = result.usage.tokens ?? 0;

    return {
      model,
      vectors: result.embeddings,
      dimensions: result.embeddings[0]?.length ?? 0,
      usage: {
        inputTokens,
        // Embedding produces no completion tokens; reporting zero keeps the
        // cost arithmetic identical to every other call.
        outputTokens: 0,
        totalTokens: inputTokens,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    };
  }

  /** True when this vendor can embed at all. */
  canEmbed(): boolean {
    return this.resolveEmbedding !== null;
  }
}

function defaultEmbeddingModel(provider: ProviderName): string {
  const model = DEFAULT_EMBEDDING_MODELS[provider];
  if (!model) throw new Error(`Provider ${provider} has no embedding model.`);
  return model;
}

function buildEmbeddingResolver(
  options: VercelAdapterOptions,
): ((model: string) => EmbeddingModel) | null {
  const { apiKey, baseUrl } = options;
  const withKey = apiKey ? { apiKey } : {};
  const withUrl = baseUrl ? { baseURL: baseUrl } : {};
  const withFetch = options.fetch ? { fetch: options.fetch } : {};

  switch (options.provider) {
    case "openai": {
      const provider = createOpenAI({ ...withKey, ...withUrl, ...withFetch });
      return (model) => provider.textEmbeddingModel(model);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        ...withKey,
        ...withUrl,
        ...withFetch,
      });
      return (model) => provider.textEmbeddingModel(model);
    }
    case "ollama": {
      const provider = createOpenAICompatible({
        name: "ollama",
        baseURL: baseUrl ?? "http://localhost:11434/v1",
        supportsStructuredOutputs: true,
        ...withKey,
        ...withFetch,
      });
      return (model) => provider.textEmbeddingModel(model);
    }
    // Anthropic has no embedding API. Returning null is what lets the Gateway
    // skip it instead of failing the whole chain.
    case "anthropic":
      return null;
  }
}

function buildResolver(
  options: VercelAdapterOptions,
): (model: string) => LanguageModel {
  const { apiKey, baseUrl } = options;
  const withKey = apiKey ? { apiKey } : {};
  const withUrl = baseUrl ? { baseURL: baseUrl } : {};
  const withFetch = options.fetch ? { fetch: options.fetch } : {};

  switch (options.provider) {
    case "anthropic": {
      const provider = createAnthropic({ ...withKey, ...withUrl, ...withFetch });
      return (model) => provider(model);
    }
    case "openai": {
      const provider = createOpenAI({ ...withKey, ...withUrl, ...withFetch });
      return (model) => provider(model);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        ...withKey,
        ...withUrl,
        ...withFetch,
      });
      return (model) => provider(model);
    }
    case "ollama": {
      // Ollama serves an OpenAI-compatible API at /v1. Going through it keeps
      // us on a first-party @ai-sdk package instead of a community provider
      // pinned to a different zod major than the rest of the monorepo.
      const provider = createOpenAICompatible({
        name: "ollama",
        baseURL: baseUrl ?? "http://localhost:11434/v1",
        // Without this the SDK drops the JSON schema and only asks for "some
        // JSON", so the model is free to answer in a shape we then reject.
        // Ollama's OpenAI-compatible endpoint does support schema-constrained
        // output; the flag is what tells the SDK to send it.
        supportsStructuredOutputs: true,
        // Sends `stream_options: {include_usage: true}`. The OpenAI protocol
        // reports token counts on a streamed response ONLY when asked, so
        // without this every streamed call comes back with a usage of zero —
        // and zero usage prices to zero. Non-streaming calls are unaffected,
        // which is why this is invisible until something actually streams:
        // measured here, generate() reported 38/25 tokens for the same model
        // that stream() reported 0/0 for.
        includeUsage: true,
        ...withKey,
        ...withFetch,
      });
      return (model) => provider(model);
    }
  }
}

/**
 * Split our flat message list into the SDK's shape.
 *
 * System turns become `instructions` rather than messages: several vendors
 * reject a system turn in the middle of a conversation, and the SDK's
 * `allowSystemInMessages` escape hatch just defers that failure to the wire.
 */
function toPrompt(messages: readonly ProviderMessage[]): {
  instructions?: string;
  messages: ModelMessage[];
} {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const rest = messages
    .filter((message) => message.role !== "system")
    .map<ModelMessage>((message) =>
      message.role === "assistant"
        ? { role: "assistant", content: message.content }
        : { role: "user", content: message.content },
    );

  return instructions ? { instructions, messages: rest } : { messages: rest };
}

function callSettings(request: ProviderRequest): {
  temperature?: number;
  maxOutputTokens?: number;
} {
  return {
    ...(request.temperature === undefined
      ? {}
      : { temperature: request.temperature }),
    // `maxTokens` in our model, `maxOutputTokens` in the SDK — the SDK renamed
    // it to make clear it does not bound the prompt.
    ...(request.maxTokens === undefined
      ? {}
      : { maxOutputTokens: request.maxTokens }),
  };
}

function toToolSet(
  tools: readonly ProviderTool[],
  dialect: SchemaDialect,
): ToolSet {
  const set: ToolSet = {};
  for (const definition of tools) {
    // No `execute`: the SDK then reports the call instead of running it, which
    // is what we want — side effects belong to the Runtime, not the Gateway.
    set[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema<unknown>(
        forDialect(definition.inputSchema, dialect) as JSONSchema7,
      ),
    });
  }
  return set;
}

/**
 * Size keywords that grammar-constrained decoders compile into the grammar
 * itself, where a large bound can blow it up. Dropping them costs nothing:
 * `StructuredSchema.parse` still rejects an answer that violates them.
 */
const SIZE_KEYWORDS: readonly string[] = [
  "maxLength",
  "minLength",
  "maxItems",
  "minItems",
  "maxProperties",
  "minProperties",
];

export function forDialect(
  schema: JsonSchema,
  dialect: SchemaDialect,
): JsonSchema {
  return dialect === "full" ? schema : (stripSizes(schema) as JsonSchema);
}

function stripSizes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSizes);
  if (!node || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (SIZE_KEYWORDS.includes(key)) continue;
    out[key] = stripSizes(value);
  }
  return out;
}

function toProviderToolCall(call: {
  toolCallId: string;
  toolName: string;
  input: unknown;
}): ProviderToolCall {
  return { id: call.toolCallId, name: call.toolName, input: call.input };
}

/**
 * Normalise usage.
 *
 * Every field is optional in the SDK because not all vendors report all of
 * them. Missing counts become 0 rather than undefined so arithmetic downstream
 * — summing a workspace's monthly tokens — never silently produces NaN.
 */
function toTokenUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
  outputTokenDetails?: { reasoningTokens?: number | undefined } | undefined;
}): TokenUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

const FINISH_REASON_VALUES = new Set<string>([
  "stop",
  "length",
  "tool-calls",
  "content-filter",
  "error",
  "other",
]);

function toFinishReason(reason: string): FinishReason {
  return FINISH_REASON_VALUES.has(reason) ? (reason as FinishReason) : "other";
}
