import { applyDecorators } from "@nestjs/common";
import { ApiBody } from "@nestjs/swagger";
import type { ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * Document a request body from the zod schema that validates it.
 *
 * The two must not be written twice. Nest's own inference reads class DTOs,
 * and this codebase validates with zod — so without this the generated spec
 * would show every write endpoint taking an empty body. A specification that
 * omits what a caller has to send is worse than none, because a caller trusts
 * it and gets a 422 with no idea why.
 *
 * Deriving it from the schema also means the two cannot drift: change the
 * validation and the document changes with it, in the same commit, or not at
 * all.
 */
export function ApiZodBody(schema: ZodType): MethodDecorator {
  // Cast at the boundary. zod-to-json-schema's generics reconstruct the whole
  // schema tree in the type system, and on the larger schemas here that hits
  // TypeScript's instantiation depth limit — a compiler cost with no bearing on
  // what the function returns, which is a plain JSON Schema either way.
  const toJsonSchema = zodToJsonSchema as unknown as (
    schema: unknown,
    options: Record<string, unknown>,
  ) => Record<string, unknown>;

  return applyDecorators(
    ApiBody({
      schema: toJsonSchema(schema, {
        // Inline rather than $ref'd into a shared definitions block. Each
        // endpoint's body is read where the endpoint is, and a reader
        // following a pointer to another part of the document to learn what a
        // field means is a reader who stops reading.
        $refStrategy: "none",
        target: "openApi3",
      }),
    }),
  );
}
