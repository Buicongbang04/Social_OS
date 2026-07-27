import {
  newId,
  type EventId,
  type ExecutionId,
  type Metadata,
  type TaskId,
  type WorkspaceId,
} from "@repo/core";
import type { RuntimeEventType } from "./catalog";

/**
 * Event envelope, per docs/kernel/11_EVENT_BUS.md.
 *
 * `version` is on every event because consumers must keep handling older
 * shapes after a producer changes: the doc's own example is
 * `ExecutionCompleted version: 2`.
 */
export type RuntimeEvent<TPayload = Metadata> = {
  id: EventId;
  type: RuntimeEventType;
  /** Component that emitted it, e.g. "scheduler", "worker", "api". */
  source: string;
  executionId: ExecutionId | null;
  taskId: TaskId | null;
  workspaceId: WorkspaceId;
  /**
   * Shared by every event of one Execution, so a whole run can be traced in
   * one query (docs/kernel/11_EVENT_BUS.md).
   */
  correlationId: string;
  /** Schema version of `payload`, not of the envelope. */
  version: number;
  payload: TPayload;
  metadata: Metadata;
  timestamp: Date;
};

export const CURRENT_EVENT_VERSION = 1;

export type NewRuntimeEvent<TPayload = Metadata> = {
  type: RuntimeEventType;
  source: string;
  workspaceId: WorkspaceId;
  correlationId: string;
  executionId?: ExecutionId | null;
  taskId?: TaskId | null;
  payload?: TPayload;
  metadata?: Metadata;
  version?: number;
};

export function createEvent<TPayload = Metadata>(
  input: NewRuntimeEvent<TPayload>,
): RuntimeEvent<TPayload> {
  return {
    id: newId("event"),
    type: input.type,
    source: input.source,
    executionId: input.executionId ?? null,
    taskId: input.taskId ?? null,
    workspaceId: input.workspaceId,
    correlationId: input.correlationId,
    version: input.version ?? CURRENT_EVENT_VERSION,
    payload: (input.payload ?? {}) as TPayload,
    metadata: input.metadata ?? {},
    timestamp: new Date(),
  };
}

/**
 * Publisher port.
 *
 * Delivery is at-least-once (docs/kernel/11_EVENT_BUS.md), so **every consumer
 * must be idempotent** — the same event can legitimately arrive twice, e.g.
 * when a consumer crashes after acting but before acknowledging.
 */
export interface EventPublisher {
  publish<TPayload>(event: RuntimeEvent<TPayload>): Promise<void>;
  publishAll(events: readonly RuntimeEvent<unknown>[]): Promise<void>;
}

export type EventHandler = (event: RuntimeEvent<unknown>) => Promise<void>;

export interface EventSubscriber {
  subscribe(type: RuntimeEventType, handler: EventHandler): void;
  /** Fan out one event to every handler registered for its type. */
  dispatch(event: RuntimeEvent<unknown>): Promise<void>;
}

/**
 * Keys that must never appear in a published payload.
 *
 * Events fan out to analytics, notifications and plugins — anything that lands
 * in a payload should be assumed to reach all of them
 * (docs/kernel/11_EVENT_BUS.md "mask secrets").
 */
const REDACTED_KEYS = new Set([
  "password",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "api_key",
  "authorization",
  "credential",
  "passwordhash",
]);

export const REDACTED = "[REDACTED]";

/** Recursively mask sensitive keys before an event leaves the process. */
export function redactPayload<T>(payload: T): T {
  return redactValue(payload, 0) as T;
}

const MAX_REDACT_DEPTH = 10;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_REDACT_DEPTH) return value;
  if (Array.isArray(value))
    return value.map((item) => redactValue(item, depth + 1));

  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""))
      ? REDACTED
      : redactValue(item, depth + 1);
  }
  return result;
}
