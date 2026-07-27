import { type TypeOf, type ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { JsonSchema, StructuredSchema } from "./types";

/**
 * The converter, pinned to a plain signature.
 *
 * Its published return type is a deep conditional that tsc gives up on
 * ("excessively deep") the moment it is asked to relate it to anything else.
 * We only ever want the runtime document, so the type is narrowed once here
 * rather than fought at each call site.
 */
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: ZodTypeAny,
  options: { $refStrategy: "none"; target: "jsonSchema7" },
) => JsonSchema;

/**
 * Build a StructuredSchema from a zod schema.
 *
 * One definition produces both halves — the JSON Schema the provider is told
 * to follow and the validator the answer is checked against — so the two can
 * never drift apart. Hand-writing them separately is how a model ends up
 * dutifully obeying a schema that no longer matches what the code parses.
 *
 * Callers that do not use zod can build a StructuredSchema literal instead;
 * nothing in the Gateway depends on this helper.
 */
export function structured<S extends ZodTypeAny>(
  name: string,
  schema: S,
  description?: string,
): StructuredSchema<TypeOf<S>> {
  const jsonSchema = toJsonSchema(schema, {
    // Inline everything. Several providers reject `$ref`/`$defs` in a
    // structured-output schema, and a shared definition that one vendor
    // silently drops is worse than a larger document.
    $refStrategy: "none",
    target: "jsonSchema7",
  });

  return {
    name,
    ...(description === undefined ? {} : { description }),
    jsonSchema,
    parse: (value: unknown): TypeOf<S> => schema.parse(value) as TypeOf<S>,
  };
}
