import type { Metadata } from "@repo/core";

/**
 * Thrown by a capability that cannot finish without a person.
 *
 * Deliberately not a RuntimeError: this is not a failure, and treating it as
 * one would retry it three times and then dead-letter a task that is working
 * exactly as intended. The engine catches it before the error path and parks
 * the task in WAITING instead.
 *
 * An exception rather than a return value because a capability may need to
 * stop from arbitrary depth — inside a nested call, after a partial step — and
 * threading a "suspend" outcome back through every handler signature would put
 * the burden on capabilities that never suspend.
 */
export class ApprovalRequired extends Error {
  /** Shown to whoever is being asked to decide. */
  readonly summary: Metadata;

  constructor(message: string, summary: Metadata = {}) {
    super(message);
    this.name = "ApprovalRequired";
    this.summary = summary;
  }
}

export function isApprovalRequired(error: unknown): error is ApprovalRequired {
  return error instanceof ApprovalRequired;
}

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
