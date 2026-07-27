import { describe, expect, it } from "vitest";
import { VercelProviderAdapter, forDialect } from "./vercel-adapter";
import { structured } from "../provider/structured";
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
