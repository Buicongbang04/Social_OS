import { describe, expect, it } from "vitest";
import {
  EXECUTION_STATUSES,
  allowedExecutionTransitions,
  canRequestCancellation,
  canTransitionExecution,
  isExecutionActive,
  isExecutionTerminal,
  type ExecutionStatus,
} from "./execution-state";

describe("execution state machine", () => {
  it("covers the happy path from creation to archive", () => {
    const path: ExecutionStatus[] = [
      "CREATED",
      "VALIDATING",
      "PLANNING",
      "READY",
      "SCHEDULED",
      "RUNNING",
      "COMPLETED",
      "ARCHIVED",
    ];

    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransitionExecution(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("allows the failure and retry loop", () => {
    expect(canTransitionExecution("RUNNING", "FAILED")).toBe(true);
    expect(canTransitionExecution("FAILED", "RETRYING")).toBe(true);
    expect(canTransitionExecution("RETRYING", "RUNNING")).toBe(true);
    // Retry can itself fail, otherwise a permanently broken task would loop.
    expect(canTransitionExecution("RETRYING", "FAILED")).toBe(true);
  });

  it("routes cancellation through CANCELLING so work can unwind", () => {
    // Doc 02 allowed Running → Cancelled directly; doc 04 does not, and we
    // follow doc 04 — a hard jump would strand an in-flight worker.
    expect(canTransitionExecution("RUNNING", "CANCELLED")).toBe(false);
    expect(canTransitionExecution("RUNNING", "CANCELLING")).toBe(true);
    expect(canTransitionExecution("CANCELLING", "CANCELLED")).toBe(true);
  });

  it("denies transitions that are not explicitly allowed", () => {
    expect(canTransitionExecution("CREATED", "RUNNING")).toBe(false);
    expect(canTransitionExecution("COMPLETED", "RUNNING")).toBe(false);
    expect(canTransitionExecution("PLANNING", "COMPLETED")).toBe(false);
  });

  it("makes ARCHIVED an absorbing state", () => {
    expect(allowedExecutionTransitions("ARCHIVED")).toEqual([]);
    for (const status of EXECUTION_STATUSES) {
      expect(canTransitionExecution("ARCHIVED", status)).toBe(false);
    }
  });

  it("never lets a terminal state resume work", () => {
    for (const status of EXECUTION_STATUSES.filter(isExecutionTerminal)) {
      expect(canTransitionExecution(status, "RUNNING")).toBe(false);
    }
  });

  it("classifies which states hold runtime resources", () => {
    expect(isExecutionActive("RUNNING")).toBe(true);
    expect(isExecutionActive("SCHEDULED")).toBe(true);
    expect(isExecutionActive("PAUSED")).toBe(false);
    expect(isExecutionActive("COMPLETED")).toBe(false);
  });

  it("permits cancellation from every non-terminal state", () => {
    for (const status of EXECUTION_STATUSES) {
      if (
        isExecutionTerminal(status) ||
        status === "CANCELLING" ||
        status === "FAILED"
      )
        continue;
      expect(canRequestCancellation(status)).toBe(true);
    }
  });

  it("has a defined transition list for every declared status", () => {
    // Guards against adding a status to the union but forgetting the table,
    // which would throw at runtime on the first transition attempt.
    for (const status of EXECUTION_STATUSES) {
      expect(Array.isArray(allowedExecutionTransitions(status))).toBe(true);
    }
  });

  it("only ever points at statuses that exist", () => {
    const known = new Set<string>(EXECUTION_STATUSES);
    for (const status of EXECUTION_STATUSES) {
      for (const target of allowedExecutionTransitions(status)) {
        expect(known.has(target)).toBe(true);
      }
    }
  });
});
