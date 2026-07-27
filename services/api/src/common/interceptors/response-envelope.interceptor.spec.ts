import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { firstValueFrom, of } from "rxjs";
import {
  ResponseEnvelopeInterceptor,
  raw,
} from "./response-envelope.interceptor";

const interceptor = new ResponseEnvelopeInterceptor();
const context = {} as ExecutionContext;

function run(value: unknown): Promise<unknown> {
  const next: CallHandler = { handle: () => of(value) };
  return firstValueFrom(interceptor.intercept(context, next));
}

describe("ResponseEnvelopeInterceptor", () => {
  it("wraps a plain object into { data }", async () => {
    await expect(run({ id: "wsp_1", name: "Marketing" })).resolves.toEqual({
      data: { id: "wsp_1", name: "Marketing" },
    });
  });

  it("wraps arrays too", async () => {
    await expect(run([1, 2, 3])).resolves.toEqual({ data: [1, 2, 3] });
  });

  it("passes through a value that is already an envelope", async () => {
    const envelope = {
      data: [],
      meta: { hasMore: false },
      links: { next: null },
    };
    await expect(run(envelope)).resolves.toBe(envelope);
  });

  it("leaves 204-style empty responses alone", async () => {
    await expect(run(undefined)).resolves.toBeUndefined();
    await expect(run(null)).resolves.toBeNull();
  });

  it("unwraps an explicit raw() response for probes that need a flat body", async () => {
    await expect(run(raw({ status: "ok" }))).resolves.toEqual({ status: "ok" });
  });
});
