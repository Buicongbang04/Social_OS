import { Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodType, ZodTypeDef } from "zod";

/**
 * Validates and narrows a request payload with a zod schema. A ZodError thrown
 * here is turned into a 422 with per-field details by AllExceptionsFilter, so
 * validation failures need no per-controller handling.
 *
 *   @Body(new ZodValidationPipe(loginSchema)) body: LoginInput
 *
 * The input and output types are separate so a schema may `.transform()` — an
 * ISO string becoming a `Date`, say. Tying them together would push that
 * conversion into every handler, which is where it gets forgotten.
 */
@Injectable()
export class ZodValidationPipe<TOut, TIn = unknown> implements PipeTransform<
  unknown,
  TOut
> {
  constructor(private readonly schema: ZodType<TOut, ZodTypeDef, TIn>) {}

  transform(value: unknown): TOut {
    return this.schema.parse(value);
  }
}
