import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateObject,
  generateText,
  jsonSchema,
  tool,
  type JSONSchema7,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import type {
  AdapterResult,
  FinishReason,
  ProviderAdapter,
  ProviderMessage,
  ProviderName,
  ProviderRequest,
  ProviderTool,
  ProviderToolCall,
  StructuredSchema,
  TokenUsage,
} from "../provider/types";

/** How to reach one vendor. */
export type VercelAdapterOptions = {
  provider: ProviderName;
  defaultModel: string;
  apiKey?: string;
  baseUrl?: string;
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

  constructor(options: VercelAdapterOptions) {
    this.provider = options.provider;
    this.defaultModel = options.defaultModel;
    this.resolve = buildResolver(options);
  }

  async generate(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): Promise<AdapterResult> {
    const model = request.model ?? this.defaultModel;
    const result = await generateText({
      model: this.resolve(model),
      ...toPrompt(request.messages),
      ...(request.tools?.length ? { tools: toToolSet(request.tools) } : {}),
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

  async generateObject<T>(
    request: ProviderRequest,
    schema: StructuredSchema<T>,
    signal?: AbortSignal,
  ): Promise<AdapterResult & { object: T }> {
    const model = request.model ?? this.defaultModel;
    const result = await generateObject({
      model: this.resolve(model),
      output: "object",
      schema: jsonSchema<unknown>(schema.jsonSchema as JSONSchema7),
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
}

function buildResolver(
  options: VercelAdapterOptions,
): (model: string) => LanguageModel {
  const { apiKey, baseUrl } = options;
  const withKey = apiKey ? { apiKey } : {};
  const withUrl = baseUrl ? { baseURL: baseUrl } : {};

  switch (options.provider) {
    case "anthropic": {
      const provider = createAnthropic({ ...withKey, ...withUrl });
      return (model) => provider(model);
    }
    case "openai": {
      const provider = createOpenAI({ ...withKey, ...withUrl });
      return (model) => provider(model);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({ ...withKey, ...withUrl });
      return (model) => provider(model);
    }
    case "ollama": {
      // Ollama serves an OpenAI-compatible API at /v1. Going through it keeps
      // us on a first-party @ai-sdk package instead of a community provider
      // pinned to a different zod major than the rest of the monorepo.
      const provider = createOpenAICompatible({
        name: "ollama",
        baseURL: baseUrl ?? "http://localhost:11434/v1",
        ...withKey,
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

function toToolSet(tools: readonly ProviderTool[]): ToolSet {
  const set: ToolSet = {};
  for (const definition of tools) {
    // No `execute`: the SDK then reports the call instead of running it, which
    // is what we want — side effects belong to the Runtime, not the Gateway.
    set[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema<unknown>(definition.inputSchema as JSONSchema7),
    });
  }
  return set;
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
