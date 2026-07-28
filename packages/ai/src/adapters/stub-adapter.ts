import { APICallError } from "ai";
import type {
  AdapterResult,
  AdapterStreamChunk,
  EmbeddingRequest,
  EmbeddingResult,
  ProviderAdapter,
  ProviderName,
  ProviderRequest,
  StructuredSchema,
} from "../provider/types";

/** What the stub should do for a matching prompt. */
export type StubReply =
  { text: string; object?: unknown } | { failWith: StubFailure };

export type StubFailure = {
  /** Drives retry and fallback classification, exactly as a real 429 or 500 would. */
  statusCode: number;
  message?: string;
};

export type StubAdapterOptions = {
  provider?: ProviderName;
  defaultModel?: string;
  /**
   * Matched against the concatenated prompt, first match wins. A plain string
   * matches by substring.
   */
  replies?: readonly { when: string | RegExp; reply: StubReply }[];
  /** Used when nothing matches. */
  fallbackReply?: StubReply;
  /**
   * Length of the vectors this stub returns. Omit to make the stub unable to
   * embed at all, which is how Anthropic behaves.
   */
  embeddingDimensions?: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Characters per streamed chunk. Omit to make this stub unable to stream,
   * which is how a provider without streaming support behaves.
   */
  streamChunkSize?: number;
  /**
   * Fail after this many chunks have been delivered.
   *
   * The case the Gateway's whole streaming design turns on: a failure the
   * caller has already seen part of the answer for, which must not fall back
   * to another provider.
   */
  failAfterChunks?: number;
};

/**
 * A provider that answers from a lookup table instead of a network.
 *
 * This exists so the runtime's own tests can exercise the real Gateway, the
 * real retry and fallback paths, and the real cost arithmetic without an API
 * key, without spend, and without a result that changes between runs. Tests
 * that mock the Gateway itself would prove nothing about the code that
 * actually ships.
 */
export class StubProviderAdapter implements ProviderAdapter {
  readonly provider: ProviderName;
  readonly defaultModel: string;
  /** Every request seen, for assertions about what was actually sent. */
  readonly calls: ProviderRequest[] = [];

  private readonly options: StubAdapterOptions;
  /** Texts passed to embed, for assertions about what was indexed. */
  readonly embedded: string[] = [];

  constructor(options: StubAdapterOptions = {}) {
    this.provider = options.provider ?? "anthropic";
    this.defaultModel = options.defaultModel ?? "stub-model";
    this.options = options;

    // Assigned as an own property, and only when configured — so a stub can
    // model a vendor with no embedding API at all. It has to be an instance
    // property rather than a method: a method lives on the prototype, where
    // `delete` cannot reach it, and the Gateway decides by asking whether the
    // method is there.
    if (options.embeddingDimensions !== undefined) {
      this.embed = (request) => this.fakeEmbed(request);
    }
    if (options.streamChunkSize !== undefined) {
      this.stream = (request, signal) => this.fakeStream(request, signal);
    }
  }

  embed?: (request: EmbeddingRequest) => Promise<EmbeddingResult>;

  /**
   * A deterministic vector derived from the text.
   *
   * Not a real embedding, but stable and different per input — enough for a
   * test to prove the right chunk was retrieved, with no network and no model.
   */
  private async fakeEmbed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const dimensions = this.options.embeddingDimensions ?? 8;
    this.embedded.push(...request.texts);

    const vectors = request.texts.map((text) => {
      const vector = new Array<number>(dimensions).fill(0);
      for (let i = 0; i < text.length; i += 1) {
        vector[i % dimensions] =
          (vector[i % dimensions] ?? 0) + text.charCodeAt(i);
      }
      // Normalised, so cosine similarity behaves as it would with a real one.
      const norm = Math.hypot(...vector) || 1;
      return vector.map((value) => value / norm);
    });

    const inputTokens = request.texts.reduce(
      (total, text) => total + estimateTokens(text),
      0,
    );

    return {
      model: request.model ?? `${this.defaultModel}-embed`,
      vectors,
      dimensions,
      usage: {
        inputTokens,
        outputTokens: 0,
        totalTokens: inputTokens,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    };
  }

  async generate(request: ProviderRequest): Promise<AdapterResult> {
    const reply = this.replyFor(request);
    return this.result(request, "text" in reply ? reply.text : "");
  }

  stream?: (
    request: ProviderRequest,
    signal?: AbortSignal,
  ) => AsyncGenerator<AdapterStreamChunk, void, undefined>;

  /**
   * The canned reply, cut into pieces.
   *
   * An instance property assigned in the constructor rather than a method, for
   * the same reason `embed` is: a method lives on the prototype where `delete`
   * cannot reach it, and a stub has to be able to model a provider that does
   * not stream at all.
   */
  private async *fakeStream(
    request: ProviderRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<AdapterStreamChunk, void, undefined> {
    const reply = this.replyFor(request);
    const text = "text" in reply ? reply.text : "";
    const size = Math.max(1, this.options.streamChunkSize ?? 8);

    let delivered = 0;
    for (let at = 0; at < text.length; at += size) {
      // Honoured rather than ignored, so this stub can model what a real
      // provider does when the caller walks away — a stub that kept going
      // would let the Gateway's abort wiring look correct while doing nothing.
      signal?.throwIfAborted();

      if (
        this.options.failAfterChunks !== undefined &&
        delivered >= this.options.failAfterChunks
      ) {
        throw new APICallError({
          message: `Stub provider ${this.provider} dropped the stream.`,
          url: `stub://${this.provider}`,
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      }

      delivered += 1;
      yield { type: "text", delta: text.slice(at, at + size) };
    }

    yield { type: "done", result: this.result(request, text) };
  }

  async generateObject<T>(
    request: ProviderRequest,
    schema: StructuredSchema<T>,
  ): Promise<AdapterResult & { object: T }> {
    const reply = this.replyFor(request);
    const raw = "object" in reply ? reply.object : undefined;

    // Validate through the caller's schema rather than casting, so a canned
    // answer that has drifted from the schema fails the test loudly — the way
    // a real model returning the wrong shape would.
    const object = schema.parse(raw);

    return {
      ...this.result(request, JSON.stringify(object)),
      object,
    };
  }

  /** Throws the configured failure, or returns the matching success reply. */
  private replyFor(
    request: ProviderRequest,
  ): Extract<StubReply, { text: string }> {
    this.calls.push(request);

    const prompt = request.messages.map((m) => m.content).join("\n");
    const matched = this.options.replies?.find(({ when }) =>
      typeof when === "string" ? prompt.includes(when) : when.test(prompt),
    )?.reply ??
      this.options.fallbackReply ?? { text: "" };

    if ("failWith" in matched) {
      throw new APICallError({
        message:
          matched.failWith.message ??
          `Stub provider ${this.provider} returned ${matched.failWith.statusCode}.`,
        url: `stub://${this.provider}`,
        requestBodyValues: {},
        statusCode: matched.failWith.statusCode,
        // Mirror the SDK's own rule so stubbed failures are classified by the
        // same code path as real ones.
        isRetryable:
          matched.failWith.statusCode === 429 ||
          matched.failWith.statusCode === 408 ||
          matched.failWith.statusCode === 409 ||
          matched.failWith.statusCode >= 500,
      });
    }

    return matched;
  }

  private result(request: ProviderRequest, text: string): AdapterResult {
    const inputTokens =
      this.options.inputTokens ??
      request.messages.reduce(
        (total, message) => total + estimateTokens(message.content),
        0,
      );
    const outputTokens = this.options.outputTokens ?? estimateTokens(text);

    return {
      model: request.model ?? this.defaultModel,
      text,
      toolCalls: [],
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      finishReason: "stop",
      metadata: { stub: true },
    };
  }
}

/**
 * A crude but stable token count.
 *
 * Not accurate — no tokenizer is being run — but deterministic, which is the
 * only property a test needs. Nothing outside the stub uses it.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
