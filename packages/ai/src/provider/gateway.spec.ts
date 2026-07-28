import { RuntimeError } from "@repo/runtime";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  StubProviderAdapter,
  type StubAdapterOptions,
} from "../adapters/stub-adapter";
import { describeProvider } from "./catalog";
import {
  DEFAULT_GATEWAY_CONFIG,
  ProviderGateway,
  type GatewayConfig,
} from "./gateway";
import { ProviderStreamError } from "./errors";
import { ProviderRegistry } from "./registry";
import { structured } from "./structured";
import {
  EMPTY_USAGE,
  type EmbeddingResult,
  type ProviderAdapter,
  type ProviderName,
  type ProviderRequest,
  type ProviderResponse,
} from "./types";

const ASK: ProviderRequest = {
  messages: [{ role: "user", content: "viết bài về xu hướng AI" }],
};

/**
 * One controllable clock shared by the gateway and the registry.
 *
 * The retry backoff and the demotion cooldown are real code; only the waiting
 * is fake. Reading the gateway's clock advances it slightly so latency is
 * measurable, while `advance` lets a test skip a cooldown outright.
 */
const fakeClock = () => {
  const slept: number[] = [];
  let t = 1_000;
  return {
    slept,
    advance: (ms: number) => {
      t += ms;
    },
    registryNow: () => t,
    gateway: {
      now: () => (t += 10),
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    },
  };
};

function build(
  adapters: Partial<Record<ProviderName, StubAdapterOptions>>,
  config: Partial<GatewayConfig> = {},
) {
  const clock = fakeClock();
  const registry = new ProviderRegistry(clock.registryNow);
  const stubs = {} as Record<ProviderName, StubProviderAdapter>;

  for (const [name, options] of Object.entries(adapters) as [
    ProviderName,
    StubAdapterOptions,
  ][]) {
    const stub = new StubProviderAdapter({ ...options, provider: name });
    stubs[name] = stub;
    registry.register(stub, describeProvider(name));
  }

  const gateway = new ProviderGateway(
    registry,
    {
      default: "anthropic",
      fallback: ["openai"],
      timeoutMs: 1_000,
      attempts: 3,
      ...config,
    },
    clock.gateway,
  );

  return { gateway, registry, stubs, clock };
}

describe("provider gateway", () => {
  it("returns a normalised response no matter which vendor answered", async () => {
    const { gateway } = build({
      anthropic: {
        fallbackReply: { text: "xong" },
        defaultModel: "claude-sonnet-5",
      },
    });

    const response = await gateway.generate(ASK);

    expect(response.provider).toBe("anthropic");
    expect(response.model).toBe("claude-sonnet-5");
    expect(response.text).toBe("xong");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.totalTokens).toBeGreaterThan(0);
    expect(response.latencyMs).toBeGreaterThan(0);
  });

  it("prices the answer from the model that actually served it", async () => {
    const { gateway } = build({
      anthropic: {
        defaultModel: "claude-sonnet-5",
        fallbackReply: { text: "ok" },
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
    });

    const response = await gateway.generate(ASK);

    expect(response.cost.priced).toBe(true);
    expect(response.cost.totalUsd).toBeCloseTo(3, 10);
  });

  it("retries a transient failure on the same provider before giving up on it", async () => {
    const { gateway, stubs, clock } = build({
      anthropic: {
        replies: [
          { when: "xu hướng", reply: { failWith: { statusCode: 429 } } },
        ],
      },
      openai: { fallbackReply: { text: "openai đã trả lời" } },
    });

    const response = await gateway.generate(ASK);

    // Three attempts against anthropic, then one against openai.
    expect(stubs.anthropic.calls).toHaveLength(3);
    expect(response.provider).toBe("openai");
    // Backoff grew rather than hammering a struggling vendor.
    expect(clock.slept).toEqual([1_000, 2_000]);
  });

  it("falls back to the next provider when the first is exhausted", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 503 } } },
      openai: { fallbackReply: { text: "dự phòng" } },
    });

    const response = await gateway.generate(ASK);

    expect(response.provider).toBe("openai");
    expect(response.text).toBe("dự phòng");
    expect(response.metadata.attemptedProviders).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("does not fall back when the request itself is the problem", async () => {
    // A 400 will be a 400 everywhere. Falling back would turn one clear error
    // into four calls, and — where a second vendor happens to accept it —
    // silently bill someone else for a request we already know is wrong.
    const { gateway, stubs } = build({
      anthropic: {
        fallbackReply: { failWith: { statusCode: 400, message: "bad model" } },
      },
      openai: { fallbackReply: { text: "should never be reached" } },
    });

    await expect(gateway.generate(ASK)).rejects.toThrow(/bad model/);
    expect(stubs.openai.calls).toHaveLength(0);
  });

  it("does not retry a non-retryable failure either", async () => {
    const { gateway, stubs, clock } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 401 } } },
    });

    await expect(gateway.generate(ASK)).rejects.toBeInstanceOf(RuntimeError);
    expect(stubs.anthropic.calls).toHaveLength(1);
    expect(clock.slept).toEqual([]);
  });

  it("classifies an exhausted chain as a PROVIDER failure", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 503 } } },
      openai: { fallbackReply: { failWith: { statusCode: 503 } } },
    });

    const error = await gateway.generate(ASK).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).errorClass).toBe("PROVIDER");
    expect((error as RuntimeError).context.attemptedProviders).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("honours an explicitly pinned provider instead of substituting another", async () => {
    // Someone who named a vendor did so for a reason — price, residency, or a
    // known behaviour. Quietly answering from a different one is worse than
    // failing.
    const { gateway, stubs } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 503 } } },
      openai: { fallbackReply: { text: "not this one" } },
    });

    await expect(
      gateway.generate({ ...ASK, provider: "anthropic" }),
    ).rejects.toBeInstanceOf(RuntimeError);
    expect(stubs.openai.calls).toHaveLength(0);
  });

  it("routes around a rate-limited provider until its cooldown lapses", async () => {
    const { gateway, registry, clock } = build({
      anthropic: {
        replies: [
          { when: "xu hướng", reply: { failWith: { statusCode: 429 } } },
        ],
        fallbackReply: { text: "khỏe lại" },
      },
      openai: { fallbackReply: { text: "dự phòng" } },
    });

    await gateway.generate(ASK);
    expect(registry.statusOf("anthropic")).toBe("RATE_LIMITED");

    // Still inside the cooldown: the fallback keeps serving.
    const during = await gateway.generate({
      messages: [{ role: "user", content: "chào" }],
    });
    expect(during.provider).toBe("openai");
    expect(registry.statusOf("anthropic")).toBe("RATE_LIMITED");

    // Once it lapses, the configured default is tried again and its success
    // is what restores HEALTHY. Without this the first 429 of the day would
    // sideline the default provider for the life of the process.
    clock.advance(60_000);
    const after = await gateway.generate({
      messages: [{ role: "user", content: "chào" }],
    });
    expect(after.provider).toBe("anthropic");
    expect(registry.statusOf("anthropic")).toBe("HEALTHY");
  });

  it("marks a 5xx provider unavailable", async () => {
    const { gateway, registry } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 503 } } },
      openai: { fallbackReply: { text: "dự phòng" } },
    });

    await gateway.generate(ASK);

    expect(registry.statusOf("anthropic")).toBe("UNAVAILABLE");
  });

  it("prefers a healthy provider but still tries a demoted one as a last resort", async () => {
    // A stale UNAVAILABLE flag must not be able to fail a request the provider
    // would in fact serve.
    const { gateway, registry } = build({
      anthropic: { fallbackReply: { text: "vẫn sống" } },
      openai: { fallbackReply: { failWith: { statusCode: 503 } } },
    });
    registry.transition("anthropic", "UNAVAILABLE", "stale");

    const response = await gateway.generate(ASK);

    expect(response.provider).toBe("anthropic");
  });

  it("fails clearly when nothing is registered", async () => {
    const gateway = new ProviderGateway(new ProviderRegistry(), {
      default: "anthropic",
      fallback: [],
      timeoutMs: 1_000,
      attempts: 1,
    });

    await expect(gateway.generate(ASK)).rejects.toThrow(/no ai provider/i);
  });

  it("fails clearly when a pinned provider is not registered", async () => {
    const { gateway } = build({ anthropic: { fallbackReply: { text: "ok" } } });

    await expect(
      gateway.generate({ ...ASK, provider: "google" }),
    ).rejects.toThrow(/google is not registered/i);
  });

  it("records which providers were tried, so a fallback is visible afterwards", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 429 } } },
      openai: { fallbackReply: { text: "ok" } },
    });

    const response = await gateway.generate(ASK);

    expect(response.metadata.attemptedProviders).toEqual([
      "anthropic",
      "openai",
    ]);
    expect(response.metadata.attempt).toBe(1);
  });

  it("passes the caller's model through instead of the provider default", async () => {
    const { gateway, stubs } = build({
      anthropic: {
        defaultModel: "claude-sonnet-5",
        fallbackReply: { text: "ok" },
      },
    });

    const response = await gateway.generate({ ...ASK, model: "claude-opus-5" });

    expect(response.model).toBe("claude-opus-5");
    expect(stubs.anthropic.calls[0]?.model).toBe("claude-opus-5");
  });
});

describe("provider gateway — structured output", () => {
  const PlanSchema = structured(
    "plan",
    z.object({
      steps: z.array(z.object({ capability: z.string() })).min(1),
    }),
    "An ordered list of capabilities to run.",
  );

  it("returns a parsed object alongside the usual response fields", async () => {
    const { gateway } = build({
      anthropic: {
        fallbackReply: {
          text: "",
          object: { steps: [{ capability: "content.generate" }] },
        },
      },
    });

    const response = await gateway.generateObject(ASK, PlanSchema);

    expect(response.object.steps[0]?.capability).toBe("content.generate");
    expect(response.cost.priced).toBeDefined();
    expect(response.usage.totalTokens).toBeGreaterThan(0);
  });

  it("rejects a well-formed answer of the wrong shape", async () => {
    // "Structured output" is a steer, not a guarantee. Validating here means a
    // bad shape fails at the boundary rather than inside the planner.
    const { gateway } = build({
      anthropic: { fallbackReply: { text: "", object: { steps: [] } } },
    });

    await expect(gateway.generateObject(ASK, PlanSchema)).rejects.toThrow();
  });

  it("falls back for structured calls on the same terms as free-form ones", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { failWith: { statusCode: 429 } } },
      openai: {
        fallbackReply: {
          text: "",
          object: { steps: [{ capability: "social.publish" }] },
        },
      },
    });

    const response = await gateway.generateObject(ASK, PlanSchema);

    expect(response.provider).toBe("openai");
    expect(response.object.steps).toHaveLength(1);
  });
});

describe("provider gateway — embedding", () => {
  it("turns texts into vectors and prices the call", async () => {
    const { gateway } = build({
      anthropic: { embeddingDimensions: 8, inputTokens: 100, outputTokens: 0 },
    });

    const result = await gateway.embed({ texts: ["xin chào", "cà phê"] });

    expect(result.vectors).toHaveLength(2);
    expect(result.dimensions).toBe(8);
    expect(result.provider).toBe("anthropic");
    expect(result.cost).toBeDefined();
  });

  it("keeps vectors in the same order as the texts", async () => {
    // Off by one here silently associates every chunk with the wrong text, and
    // the only symptom is retrieval quietly returning nonsense.
    const { gateway } = build({ anthropic: { embeddingDimensions: 8 } });

    const first = await gateway.embed({ texts: ["a"] });
    const both = await gateway.embed({ texts: ["a", "b"] });

    expect(both.vectors[0]).toEqual(first.vectors[0]);
  });

  it("skips a provider that cannot embed instead of failing the chain", async () => {
    // Anthropic has no embedding API. A chain of anthropic then openai must
    // still embed via openai while preferring anthropic for generation.
    const { gateway } = build({
      anthropic: { fallbackReply: { text: "ok" } },
      openai: { embeddingDimensions: 4 },
    });

    const result = await gateway.embed({ texts: ["xin chào"] });

    expect(result.provider).toBe("openai");
    expect(result.dimensions).toBe(4);
  });

  it("says so clearly when nothing registered can embed", async () => {
    const { gateway } = build({ anthropic: { fallbackReply: { text: "ok" } } });

    await expect(gateway.embed({ texts: ["x"] })).rejects.toThrow(
      /no registered provider can produce embeddings/i,
    );
  });

  it("refuses a pinned provider that has no embedding model", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { text: "ok" } },
      openai: { embeddingDimensions: 4 },
    });

    await expect(
      gateway.embed({ provider: "anthropic", texts: ["x"] }),
    ).rejects.toThrow(/cannot produce embeddings/i);
  });
});

describe("provider gateway — embedding adapters written as classes", () => {
  /**
   * The real adapters are classes whose `embed` reads `this`. The stub's is an
   * arrow function, so it survives being pulled off the object — which means
   * the stub alone cannot prove the Gateway keeps the binding.
   */
  class ClassAdapter implements ProviderAdapter {
    readonly provider = "openai" as const;
    readonly defaultModel = "class-embed";

    generate(): Promise<never> {
      throw new Error("not used");
    }
    generateObject(): Promise<never> {
      throw new Error("not used");
    }

    async embed(): Promise<EmbeddingResult> {
      return {
        // Throws "cannot read properties of undefined" if `this` was lost.
        model: this.defaultModel,
        vectors: [[1, 0]],
        dimensions: 2,
        usage: EMPTY_USAGE,
      };
    }
  }

  it("keeps the adapter bound when it calls embed", async () => {
    const clock = fakeClock();
    const registry = new ProviderRegistry(clock.registryNow);
    registry.register(new ClassAdapter(), describeProvider("openai"));
    const gateway = new ProviderGateway(
      registry,
      { ...DEFAULT_GATEWAY_CONFIG, default: "openai" },
      clock.gateway,
    );

    const result = await gateway.embed({ texts: ["x"] });

    expect(result.model).toBe("class-embed");
  });
});

describe("provider gateway — streaming", () => {
  /** Collect a stream into its deltas and its final response. */
  async function drain(gateway: ProviderGateway, request = ASK) {
    const deltas: string[] = [];
    let done: ProviderResponse | undefined;

    for await (const chunk of gateway.stream(request)) {
      if (chunk.type === "text") deltas.push(chunk.delta);
      if (chunk.type === "done") done = chunk.response;
    }

    return { deltas, done, text: deltas.join("") };
  }

  it("delivers the answer in pieces and finishes with the whole thing", async () => {
    const { gateway } = build({
      anthropic: {
        fallbackReply: { text: "Cà phê Việt Nam chủ yếu là robusta." },
        streamChunkSize: 8,
      },
    });

    const { deltas, text, done } = await drain(gateway);

    expect(deltas.length).toBeGreaterThan(1);
    expect(text).toBe("Cà phê Việt Nam chủ yếu là robusta.");
    expect(done?.text).toBe(text);
  });

  it("prices the call on the final chunk", async () => {
    // Usage is only knowable when the vendor ends the response, so metering
    // happens there and nowhere else.
    const { gateway } = build({
      anthropic: {
        // A model the price table knows. With the stub's own default the cost
        // is legitimately zero and `priced` is false — which is the point of
        // having both fields, and would make this assertion meaningless.
        defaultModel: "claude-sonnet-5",
        fallbackReply: { text: "xin chào" },
        streamChunkSize: 4,
        inputTokens: 1_000_000,
        outputTokens: 0,
      },
    });

    const { done } = await drain(gateway);

    expect(done?.usage.inputTokens).toBe(1_000_000);
    expect(done?.cost.priced).toBe(true);
    expect(done?.cost.totalUsd).toBeCloseTo(3, 10);
    expect(done?.latencyMs).toBeGreaterThan(0);
  });

  it("falls back to the next provider when the first fails before any chunk", async () => {
    // Nothing has been shown yet, so switching provider is invisible and safe.
    const { gateway } = build({
      anthropic: {
        fallbackReply: { failWith: { statusCode: 503 } },
        streamChunkSize: 8,
      },
      openai: { fallbackReply: { text: "trả lời từ openai" }, streamChunkSize: 8 },
    });

    const { text, done } = await drain(gateway);

    expect(text).toBe("trả lời từ openai");
    expect(done?.provider).toBe("openai");
  });

  it("does NOT fall back once the caller has seen part of the answer", async () => {
    // The decision the whole design turns on. Retrying here replays the answer
    // from the beginning on top of text the reader already has, and nothing
    // downstream can tell the two apart.
    const { gateway, stubs } = build({
      anthropic: {
        fallbackReply: { text: "một câu trả lời khá dài để cắt ra nhiều mảnh" },
        streamChunkSize: 5,
        failAfterChunks: 2,
      },
      openai: { fallbackReply: { text: "KHÔNG ĐƯỢC DÙNG" }, streamChunkSize: 5 },
    });

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of gateway.stream(ASK)) {
          if (chunk.type === "text") seen.push(chunk.delta);
        }
      })(),
    ).rejects.toThrow(ProviderStreamError);

    expect(seen).toHaveLength(2);
    expect(stubs.openai?.calls).toHaveLength(0);
  });

  it("carries what was already produced on a mid-stream failure", async () => {
    // The vendor charged for those tokens whether or not the answer is usable.
    const { gateway } = build({
      anthropic: {
        fallbackReply: { text: "abcdefghij" },
        streamChunkSize: 2,
        failAfterChunks: 3,
      },
    });

    try {
      for await (const _ of gateway.stream(ASK)) {
        // drained for the error
      }
      expect.unreachable("the stream should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderStreamError);
      expect((error as ProviderStreamError).partial.textSoFar).toBe("abcdef");
    }
  });

  it("is not retryable once it has failed mid-stream", async () => {
    const { gateway } = build({
      anthropic: {
        fallbackReply: { text: "abcdefghij" },
        streamChunkSize: 2,
        failAfterChunks: 1,
      },
    });

    try {
      for await (const _ of gateway.stream(ASK)) {
        // drained for the error
      }
      expect.unreachable("the stream should have failed");
    } catch (error) {
      expect((error as RuntimeError).retryable).toBe(false);
    }
  });

  it("skips a provider that cannot stream", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { text: "không stream được" } },
      openai: { fallbackReply: { text: "stream được" }, streamChunkSize: 4 },
    });

    const { done } = await drain(gateway);

    expect(done?.provider).toBe("openai");
  });

  it("treats a stream that ends without finishing as a failure", async () => {
    // A vendor that closes the connection after some text and never reports
    // usage. Accepting it would mean billing nothing for tokens that were
    // charged, and any caller waiting for the final chunk would wait for ever.
    class TruncatingAdapter implements ProviderAdapter {
      readonly provider = "openai" as const;
      readonly defaultModel = "truncating";

      generate(): Promise<never> {
        throw new Error("not used");
      }
      generateObject(): Promise<never> {
        throw new Error("not used");
      }
      async *stream(): AsyncGenerator<
        { type: "text"; delta: string },
        void,
        undefined
      > {
        yield { type: "text", delta: "một nửa câu" };
      }
    }

    const clock = fakeClock();
    const registry = new ProviderRegistry(clock.registryNow);
    registry.register(new TruncatingAdapter(), describeProvider("openai"));
    const gateway = new ProviderGateway(
      registry,
      { ...DEFAULT_GATEWAY_CONFIG, default: "openai" },
      clock.gateway,
    );

    await expect(
      (async () => {
        for await (const _ of gateway.stream(ASK)) {
          // drained for the error
        }
      })(),
    ).rejects.toThrow(/without finishing/i);
  });

  it("says so clearly when nothing registered can stream", async () => {
    const { gateway } = build({ anthropic: { fallbackReply: { text: "x" } } });

    await expect(
      (async () => {
        for await (const _ of gateway.stream(ASK)) {
          // never reached
        }
      })(),
    ).rejects.toThrow(/no registered provider can stream/i);
  });

  it("refuses a pinned provider that cannot stream", async () => {
    const { gateway } = build({
      anthropic: { fallbackReply: { text: "x" } },
      openai: { fallbackReply: { text: "y" }, streamChunkSize: 4 },
    });

    await expect(
      (async () => {
        for await (const _ of gateway.stream({ ...ASK, provider: "anthropic" })) {
          // never reached
        }
      })(),
    ).rejects.toThrow(/cannot stream/i);
  });
});
