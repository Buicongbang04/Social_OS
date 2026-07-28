import { describe, expect, it } from "vitest";
import { VercelProviderAdapter, forDialect } from "./vercel-adapter";
import { structured } from "../provider/structured";
import type { TokenUsage } from "../provider/types";
import { z } from "zod";

/**
 * These assert schema handling only — no network. What a provider does with
 * the schema is proven by running it (see verify:llm); what is checked here is
 * that we send the right thing.
 */
describe("schema dialect", () => {
  const schema = structured(
    "post",
    z.object({
      title: z.string().min(1).max(200),
      body: z.string().max(8_000),
      tags: z.array(z.string().max(40)).max(12),
    }),
  );

  it("emits the size constraints in the first place", () => {
    // If zod-to-json-schema stopped emitting these, the stripping below would
    // be silently pointless.
    const json = JSON.stringify(schema.jsonSchema);
    expect(json).toContain("maxLength");
    expect(json).toContain("maxItems");
  });

  it("defaults Ollama to the minimal dialect", () => {
    // Measured: maxLength 2000 is fine on qwen2.5:7b, 4000 crashes the model
    // runner. Grammar-constrained decoding compiles the bound into a grammar.
    const adapter = new VercelProviderAdapter({
      provider: "ollama",
      defaultModel: "qwen2.5:7b",
    });
    expect(dialectOf(adapter)).toBe("minimal");
  });

  it("leaves the hosted vendors on the full dialect", () => {
    for (const provider of ["anthropic", "openai", "google"] as const) {
      const adapter = new VercelProviderAdapter({
        provider,
        defaultModel: "m",
        apiKey: "k",
      });
      expect(dialectOf(adapter)).toBe("full");
    }
  });

  it("lets the default be overridden either way", () => {
    const strict = new VercelProviderAdapter({
      provider: "ollama",
      defaultModel: "m",
      schemaDialect: "full",
    });
    expect(dialectOf(strict)).toBe("full");
  });
});

function dialectOf(adapter: VercelProviderAdapter): string {
  return (adapter as unknown as { dialect: string }).dialect;
}

describe("forDialect", () => {
  const nested = {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 200, minLength: 1 },
      steps: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: { note: { type: "string", maxLength: 8000 } },
        },
      },
    },
    required: ["title"],
    additionalProperties: false,
  };

  it("leaves the schema untouched on the full dialect", () => {
    expect(forDialect(nested, "full")).toBe(nested);
  });

  it("strips size bounds at every depth, arrays included", () => {
    const stripped = JSON.stringify(forDialect(nested, "minimal"));

    expect(stripped).not.toContain("maxLength");
    expect(stripped).not.toContain("minLength");
    expect(stripped).not.toContain("maxItems");
  });

  it("keeps everything that actually describes the shape", () => {
    // Stripping too much would stop steering the model at all, which is the
    // opposite of the point.
    const stripped = forDialect(nested, "minimal") as Record<string, unknown>;

    expect(stripped.type).toBe("object");
    expect(stripped.required).toEqual(["title"]);
    expect(stripped.additionalProperties).toBe(false);
    expect(JSON.stringify(stripped)).toContain('"note"');
  });

  it("does not mutate the schema it was given", () => {
    // The same StructuredSchema object is reused for every call, so mutating
    // it would degrade the steer for providers that handle it fine.
    const before = JSON.stringify(nested);
    forDialect(nested, "minimal");
    expect(JSON.stringify(nested)).toBe(before);
  });
});

describe("what actually goes on the wire", () => {
  /** Records the request the SDK builds, then answers with a canned response. */
  function recordingFetch(body: string, contentType = "application/json") {
    const requests: { url: string; body: unknown }[] = [];

    const fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({
        url: String(url),
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : null,
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": contentType },
      });
    }) as unknown as typeof globalThis.fetch;

    return { fetch, requests };
  }

  it("asks Ollama to report usage on a streamed response", async () => {
    // The OpenAI protocol reports token counts on a streamed response only
    // when the request says so. Without it every streamed call comes back
    // with a usage of zero, which prices to zero — measured against a real
    // Ollama, generate() reported 38/25 tokens where stream() reported 0/0.
    // Nothing above the request body can see this, which is why the assertion
    // is on the body.
    const sse = [
      'data: {"id":"1","choices":[{"delta":{"content":"xin chào"},"index":0}]}',
      "",
      'data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":7,"completion_tokens":3}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const { fetch, requests } = recordingFetch(sse, "text/event-stream");

    const adapter = new VercelProviderAdapter({
      provider: "ollama",
      defaultModel: "qwen2.5:7b",
      fetch,
    });

    for await (const _ of adapter.stream!({
      messages: [{ role: "user", content: "chào" }],
    })) {
      // drained
    }

    const sent = requests[0]?.body as {
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
    };
    expect(sent.stream).toBe(true);
    expect(sent.stream_options?.include_usage).toBe(true);
  });

  it("carries tool calls through the stream", async () => {
    // The adapter reads `result.stream` rather than `result.textStream`
    // precisely for this: textStream drops tool calls silently, so a caller
    // asking for a tool would watch the model say nothing and finish.
    const sse = [
      'data: {"id":"1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"tim_kiem","arguments":""}}]},"index":0}]}',
      "",
      'data: {"id":"1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":\\"cà phê\\"}"}}]},"index":0}]}',
      "",
      'data: {"id":"1","choices":[{"delta":{},"finish_reason":"tool_calls","index":0}],"usage":{"prompt_tokens":9,"completion_tokens":5}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const { fetch } = recordingFetch(sse, "text/event-stream");

    const adapter = new VercelProviderAdapter({
      provider: "ollama",
      defaultModel: "qwen2.5:7b",
      fetch,
    });

    const streamed: string[] = [];
    let finalCalls: readonly { name: string; input: unknown }[] = [];

    for await (const chunk of adapter.stream!({
      messages: [{ role: "user", content: "tìm giúp tôi" }],
      tools: [
        {
          name: "tim_kiem",
          description: "Tìm kiếm",
          inputSchema: {
            type: "object",
            properties: { q: { type: "string" } },
            required: ["q"],
          },
        },
      ],
    })) {
      if (chunk.type === "tool-call") streamed.push(chunk.call.name);
      if (chunk.type === "done") finalCalls = chunk.result.toolCalls;
    }

    expect(streamed).toEqual(["tim_kiem"]);
    // Also on the final chunk, so a caller that ignores the deltas and reads
    // only the result sees the same thing.
    expect(finalCalls.map((call) => call.name)).toEqual(["tim_kiem"]);
    expect(finalCalls[0]?.input).toEqual({ q: "cà phê" });
  });

  it("reports the usage the vendor sent, not an estimate", async () => {
    const sse = [
      'data: {"id":"1","choices":[{"delta":{"content":"xin chào"},"index":0}]}',
      "",
      'data: {"id":"1","choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":7,"completion_tokens":3}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const { fetch } = recordingFetch(sse, "text/event-stream");

    const adapter = new VercelProviderAdapter({
      provider: "ollama",
      defaultModel: "qwen2.5:7b",
      fetch,
    });

    let usage: TokenUsage | undefined;
    let text = "";
    for await (const chunk of adapter.stream!({
      messages: [{ role: "user", content: "chào" }],
    })) {
      if (chunk.type === "text") text += chunk.delta;
      if (chunk.type === "done") usage = chunk.result.usage;
    }

    expect(text).toBe("xin chào");
    expect(usage?.inputTokens).toBe(7);
    expect(usage?.outputTokens).toBe(3);
  });
});
