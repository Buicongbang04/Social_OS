import { describe, expect, it } from "vitest";
import {
  TASK_STATUSES,
  allowedTaskTransitions,
  areDependenciesSatisfied,
  canTransitionTask,
  isTaskTerminal,
  type TaskStatus,
} from "./task-state";

describe("task state machine", () => {
  it("separates SUCCESS (worker returned) from COMPLETED (result persisted)", () => {
    // Collapsing these would lose the window where a worker finished but the
    // runtime crashed before writing — the exact case recovery must handle.
    expect(canTransitionTask("RUNNING", "SUCCESS")).toBe(true);
    expect(canTransitionTask("SUCCESS", "COMPLETED")).toBe(true);
    expect(canTransitionTask("RUNNING", "COMPLETED")).toBe(false);
  });

  it("covers the happy path", () => {
    const path: TaskStatus[] = [
      "PENDING",
      "READY",
      "RUNNING",
      "SUCCESS",
      "COMPLETED",
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionTask(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows the retry loop and lets retry give up", () => {
    expect(canTransitionTask("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionTask("FAILED", "RETRY")).toBe(true);
    expect(canTransitionTask("RETRY", "RUNNING")).toBe(true);
    expect(canTransitionTask("RETRY", "FAILED")).toBe(true);
  });

  it("does not let a failed task jump straight back to running", () => {
    // It must pass through RETRY so the attempt counter is incremented;
    // otherwise a task could retry forever without ever exhausting its policy.
    expect(canTransitionTask("FAILED", "RUNNING")).toBe(false);
  });

  it("makes COMPLETED and CANCELLED absorbing", () => {
    expect(allowedTaskTransitions("COMPLETED")).toEqual([]);
    expect(allowedTaskTransitions("CANCELLED")).toEqual([]);
    expect(isTaskTerminal("COMPLETED")).toBe(true);
    expect(isTaskTerminal("CANCELLED")).toBe(true);
    expect(isTaskTerminal("FAILED")).toBe(false);
  });

  it("gates readiness on dependencies being COMPLETED, not merely SUCCESS", () => {
    // SUCCESS means the output exists in memory but may not be durable yet;
    // a downstream task reading it could see nothing after a crash.
    expect(areDependenciesSatisfied(["COMPLETED", "COMPLETED"])).toBe(true);
    expect(areDependenciesSatisfied(["COMPLETED", "SUCCESS"])).toBe(false);
    expect(areDependenciesSatisfied(["RUNNING"])).toBe(false);
    expect(areDependenciesSatisfied(["FAILED"])).toBe(false);
  });

  it("treats a task with no dependencies as satisfied", () => {
    expect(areDependenciesSatisfied([])).toBe(true);
  });

  it("only ever points at statuses that exist", () => {
    const known = new Set<string>(TASK_STATUSES);
    for (const status of TASK_STATUSES) {
      for (const target of allowedTaskTransitions(status)) {
        expect(known.has(target)).toBe(true);
      }
    }
  });
});
