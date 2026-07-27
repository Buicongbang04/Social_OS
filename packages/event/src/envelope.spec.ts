import { describe, expect, it, vi } from "vitest";
import type { ExecutionId, WorkspaceId } from "@repo/core";
import { isRuntimeEventType } from "./catalog";
import { REDACTED, createEvent, redactPayload } from "./envelope";
import { InMemoryEventBus } from "./in-memory-bus";

const WORKSPACE_ID = "wsp_01HX8ZQ7P9K2M4N6R8T0V2W4A1" as WorkspaceId;
const EXECUTION_ID = "exe_01HX8ZQ7P9K2M4N6R8T0V2W4Y6" as ExecutionId;

const base = {
  source: "scheduler",
  workspaceId: WORKSPACE_ID,
  correlationId: "req_01HX8ZQ7P9K2M4N6R8T0V2W4Y6",
} as const;

describe("createEvent", () => {
  it("fills the envelope the docs specify", () => {
    const event = createEvent({
      ...base,
      type: "ExecutionStarted",
      executionId: EXECUTION_ID,
    });

    expect(event.id).toMatch(/^evt_/);
    expect(event.type).toBe("ExecutionStarted");
    expect(event.executionId).toBe(EXECUTION_ID);
    expect(event.taskId).toBeNull();
    expect(event.version).toBe(1);
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it("carries the correlation id that ties one Execution's events together", () => {
    const a = createEvent({ ...base, type: "ExecutionStarted" });
    const b = createEvent({ ...base, type: "ExecutionCompleted" });

    // Same run → same correlation id, which is what makes a trace queryable.
    expect(a.correlationId).toBe(b.correlationId);
    expect(a.id).not.toBe(b.id);
  });
});

describe("event catalog", () => {
  it("recognises documented event names", () => {
    expect(isRuntimeEventType("ExecutionCompleted")).toBe(true);
    expect(isRuntimeEventType("TaskRetried")).toBe(true);
    expect(isRuntimeEventType("DeadLetterCreated")).toBe(true);
  });

  it("rejects names that are not in the catalog", () => {
    // Catches a typo at the boundary instead of publishing an event nothing
    // is subscribed to.
    expect(isRuntimeEventType("ExecutionFinished")).toBe(false);
    expect(isRuntimeEventType("TaskRetry")).toBe(false);
  });
});

describe("redactPayload", () => {
  it("masks secrets before an event leaves the process", () => {
    // Events fan out to analytics, notifications and plugins — a secret in a
    // payload should be assumed to reach all of them.
    const redacted = redactPayload({
      user: "alice",
      password: "hunter2",
      apiKey: "sk-live-123",
      accessToken: "eyJhbGciOi",
    });

    expect(redacted).toEqual({
      user: "alice",
      password: REDACTED,
      apiKey: REDACTED,
      accessToken: REDACTED,
    });
  });

  it("masks nested and snake_case variants", () => {
    const redacted = redactPayload({
      connector: { name: "facebook", api_key: "secret-value" },
      list: [{ token: "abc" }],
    });

    expect(redacted).toEqual({
      connector: { name: "facebook", api_key: REDACTED },
      list: [{ token: REDACTED }],
    });
  });

  it("leaves ordinary values untouched", () => {
    const at = new Date();
    expect(redactPayload({ count: 3, ok: true, at })).toEqual({
      count: 3,
      ok: true,
      at,
    });
  });
});

describe("InMemoryEventBus", () => {
  it("delivers an event to every handler for its type", async () => {
    const bus = new InMemoryEventBus();
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe("TaskCompleted", async (event) => first(event.type));
    bus.subscribe("TaskCompleted", async (event) => second(event.type));

    await bus.publish(createEvent({ ...base, type: "TaskCompleted" }));

    expect(first).toHaveBeenCalledWith("TaskCompleted");
    expect(second).toHaveBeenCalledWith("TaskCompleted");
  });

  it("does not deliver to handlers for a different type", async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe("TaskFailed", handler);

    await bus.publish(createEvent({ ...base, type: "TaskCompleted" }));

    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates a failing handler from the others", async () => {
    // A broken consumer must not stop the rest from seeing the event, nor
    // fail the Execution that emitted it — an event is a notification, not a
    // transaction.
    const errors: unknown[] = [];
    const bus = new InMemoryEventBus((error) => errors.push(error));
    const healthy = vi.fn();

    bus.subscribe("TaskCompleted", async () => {
      throw new Error("consumer exploded");
    });
    bus.subscribe("TaskCompleted", healthy);

    await expect(
      bus.publish(createEvent({ ...base, type: "TaskCompleted" })),
    ).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it("preserves ordering within one execution", async () => {
    // docs/kernel/11_EVENT_BUS.md guarantees order within an Execution:
    // ExecutionStarted → TaskStarted → TaskCompleted → ExecutionCompleted.
    const bus = new InMemoryEventBus();
    const seen: string[] = [];

    for (const type of [
      "ExecutionStarted",
      "TaskStarted",
      "TaskCompleted",
      "ExecutionCompleted",
    ] as const) {
      bus.subscribe(type, async (event) => {
        seen.push(event.type);
      });
    }

    await bus.publishAll([
      createEvent({ ...base, type: "ExecutionStarted" }),
      createEvent({ ...base, type: "TaskStarted" }),
      createEvent({ ...base, type: "TaskCompleted" }),
      createEvent({ ...base, type: "ExecutionCompleted" }),
    ]);

    expect(seen).toEqual([
      "ExecutionStarted",
      "TaskStarted",
      "TaskCompleted",
      "ExecutionCompleted",
    ]);
  });

  it("records history for assertions", async () => {
    const bus = new InMemoryEventBus();
    await bus.publish(createEvent({ ...base, type: "ExecutionCreated" }));

    expect(bus.history().map((event) => event.type)).toEqual([
      "ExecutionCreated",
    ]);

    bus.clear();
    expect(bus.history()).toEqual([]);
  });
});
