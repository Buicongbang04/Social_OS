import { describe, expect, it } from "vitest";
import { z } from "zod";
import { structured } from "./structured";

describe("structured schemas", () => {
  const Intent = structured(
    "intent",
    z.object({
      type: z.enum(["RESEARCH", "GENERATE_CONTENT", "PUBLISH"]),
      confidence: z.number().min(0).max(1),
      entities: z.record(z.string()).optional(),
    }),
    "One thing the user wants done.",
  );

  it("produces a JSON Schema a provider can be given", () => {
    expect(Intent.jsonSchema.type).toBe("object");
    expect(Intent.jsonSchema).toHaveProperty("properties.type.enum", [
      "RESEARCH",
      "GENERATE_CONTENT",
      "PUBLISH",
    ]);
    expect(Intent.jsonSchema.required).toContain("confidence");
  });

  it("carries the name and description through to the provider", () => {
    expect(Intent.name).toBe("intent");
    expect(Intent.description).toBe("One thing the user wants done.");
  });

  it("validates with the same definition that produced the schema", () => {
    const parsed = Intent.parse({ type: "PUBLISH", confidence: 0.9 });

    expect(parsed.type).toBe("PUBLISH");
    expect(parsed.confidence).toBe(0.9);
  });

  it("rejects a value the schema forbids", () => {
    expect(() => Intent.parse({ type: "DANCE", confidence: 0.9 })).toThrow();
    expect(() => Intent.parse({ type: "PUBLISH", confidence: 7 })).toThrow();
  });

  it("inlines nested definitions rather than emitting $ref", () => {
    // Several providers reject $ref/$defs in a structured-output schema, and a
    // definition one vendor silently drops produces a plausible-looking but
    // unconstrained answer.
    const Nested = structured(
      "plan",
      z.object({
        steps: z.array(z.object({ capability: z.string() })),
      }),
    );

    expect(JSON.stringify(Nested.jsonSchema)).not.toContain("$ref");
  });

  it("omits description when none was given, rather than emitting undefined", () => {
    const bare = structured("bare", z.object({ a: z.string() }));

    expect("description" in bare).toBe(false);
  });
});
