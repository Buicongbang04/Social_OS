import type { ExecutionId, Metadata, TaskId, WorkspaceId } from "@repo/core";
import type { Execution, ExecutionPlan } from "../model/execution";
import type { Goal } from "../model/goal";
import type { Intent } from "../model/intent";
import type { Task } from "../model/task";

/**
 * Turns a natural-language objective into structured Intents.
 *
 * Phase 1 ships a deterministic keyword implementation; Phase 2 swaps in an
 * LLM-backed one. Because the Runtime only ever sees this interface, that swap
 * touches no scheduling, state or retry code.
 */
export interface IntentAnalyzer {
  analyze(goal: Goal, executionId: ExecutionId): Promise<readonly Intent[]>;
}

/** Turns Intents into an executable DAG. Assigns capabilities, never workers. */
export interface Planner {
  plan(input: {
    execution: Execution;
    goal: Goal;
    intents: readonly Intent[];
  }): Promise<ExecutionPlan>;
}

/**
 * What a capability declares about itself, per docs/kernel/07_CAPABILITY_ENGINE.md.
 *
 * Capability ids use dotted lowercase `category.action` (e.g. "content.generate").
 * The kernel doc leaves the format unspecified — it shows bare PascalCase names —
 * but the Plugin and MCP registries this must interoperate with already use
 * dotted ids, and one convention beats two.
 */
export type CapabilityDescriptor = {
  id: string;
  name: string;
  /**
   * One sentence on what this does and when to pick it.
   *
   * Written for the Planner, which is a model choosing from a list: given only
   * an id and a name it has to guess, and a wrong guess is a whole plan built
   * around the wrong step. Say what it acts on and what it does not.
   */
  description?: string;
  /**
   * Hidden from the Planner, but still executable when named directly.
   *
   * For capabilities that exist to exercise the runtime rather than to do
   * anything for a user — a deliberately flaky step, a step that always fails.
   * They have to stay registered so an integration test can name one, and they
   * must never appear in the menu the Planner chooses from: a model offered
   * "Flaky Once" alongside "Generate Content" will eventually pick it, and it
   * has.
   */
  internal?: boolean;
  /** Semver. Lets a plan pin behaviour across a capability upgrade. */
  version: string;
  category: string;
  /** Worker types able to run it, e.g. ["FUNCTION"]. */
  supportedWorkers: readonly string[];
  /** Permissions the caller must hold, as `scope.resource.action` keys. */
  permissions: readonly string[];
  timeoutMs?: number;
  /**
   * Roughly what one run of this capability costs, in USD.
   *
   * A declared nominal figure, not a measurement — it exists so the budget
   * check can refuse a step that plainly will not fit in what is left, rather
   * than starting it and being charged anyway. Omit it when the capability
   * costs nothing (a deterministic function) or when no sensible figure exists;
   * the budget is still enforced against actual spend either way.
   */
  estimatedCostUsd?: number;
  metadata?: Metadata;
};

export interface CapabilityRegistry {
  register(descriptor: CapabilityDescriptor): void;
  get(capabilityId: string): CapabilityDescriptor | null;
  list(): readonly CapabilityDescriptor[];
  has(capabilityId: string): boolean;
}

/**
 * Policy decision, per docs/kernel/08_POLICY_ENGINE.md. Deterministic — never
 * an LLM call — so an authorization outcome is reproducible and auditable.
 */
export type PolicyDecision =
  | { outcome: "ALLOW" }
  | { outcome: "DENY"; reason: string; code: string }
  | { outcome: "REQUIRE_APPROVAL"; reason: string };

export type PolicyContext = {
  workspaceId: WorkspaceId;
  execution: Execution;
  goal: Goal;
  capabilityId: string;
  estimatedCostUsd: number;
};

export interface PolicyEvaluator {
  evaluate(context: PolicyContext): Promise<PolicyDecision>;
}

/**
 * What one Execution has already spent, in USD.
 *
 * A separate port from the usage recorder because the runtime reads this on a
 * hot path — before every task — and must not depend on how or where usage is
 * stored. An estimate made at plan time is a guess; this is the number that
 * actually stops a runaway.
 */
export interface SpendReader {
  spentUsd(executionId: ExecutionId): Promise<number>;
}

/** A unit of work handed to the queue. Deliberately small — the full Task lives in the DB. */
export type QueuedTask = {
  taskId: TaskId;
  executionId: ExecutionId;
  workspaceId: WorkspaceId;
  capability: string;
  priority: Task["priority"];
  /** Epoch ms before which the task must not be dispatched. */
  notBefore: number;
  attempt: number;
};

/**
 * Task queue port.
 *
 * `reserve` hands out a task with a visibility timeout: if the consumer dies
 * without acking, the reservation lapses and the task becomes claimable again,
 * so a crashed worker loses no work (docs/runtime/09_RUNTIME_QUEUE.md).
 */
export interface TaskQueue {
  enqueue(task: QueuedTask): Promise<void>;
  /** Claim up to `limit` due tasks. Returns [] when nothing is ready. */
  reserve(limit: number): Promise<readonly QueuedTask[]>;
  /** Acknowledge success — removes the task permanently. */
  ack(taskId: TaskId): Promise<void>;
  /** Return a task to the queue, optionally delayed for a retry backoff. */
  release(taskId: TaskId, delayMs: number): Promise<void>;
  /** Retries exhausted: park for human inspection instead of dropping. */
  deadLetter(taskId: TaskId, reason: string): Promise<void>;
  /** Re-queue tasks whose reservation lapsed. Returns how many were recovered. */
  recoverExpired(): Promise<number>;
  size(): Promise<number>;
}

/** Distributed lock so only one scheduler node acts on a given key. */
export interface SchedulerLock {
  acquire(key: string, ttlMs: number): Promise<boolean>;
  release(key: string): Promise<void>;
}
