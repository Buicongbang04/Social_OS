import { Injectable, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates and narrows a request payload with a zod schema. A ZodError thrown
 * here is turned into a 422 with per-field details by AllExceptionsFilter, so
 * validation failures need no per-controller handling.
 *
 *   @Body(new ZodValidationPipe(loginSchema)) body: LoginInput
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
