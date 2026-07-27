/**
 * Goal state machine, per docs/kernel/01_GOAL_MODEL.md.
 *
 * A Goal is the standing objective; an Execution is one run of it. A scheduled
 * Goal therefore cycles EXECUTING → COMPLETED → EXECUTING across runs, which is
 * why COMPLETED is not terminal here (unlike Execution.COMPLETED).
 */
export const GOAL_STATUSES = [
  "CREATED",
  "VALIDATED",
  "PLANNED",
  "EXECUTING",
  "COMPLETED",
  "FAILED",
  "RETRY",
  "ARCHIVED",
] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

const GOAL_TRANSITIONS: Readonly<Record<GoalStatus, readonly GoalStatus[]>> =
  Object.freeze({
    CREATED: ["VALIDATED", "FAILED", "ARCHIVED"],
    VALIDATED: ["PLANNED", "FAILED", "ARCHIVED"],
    PLANNED: ["EXECUTING", "FAILED", "ARCHIVED"],
    // A recurring Goal returns to EXECUTING on its next scheduled run.
    EXECUTING: ["COMPLETED", "FAILED"],
    COMPLETED: ["EXECUTING", "ARCHIVED"],
    FAILED: ["RETRY", "ARCHIVED"],
    RETRY: ["EXECUTING", "FAILED"],
    ARCHIVED: [],
  });

export function canTransitionGoal(from: GoalStatus, to: GoalStatus): boolean {
  return GOAL_TRANSITIONS[from].includes(to);
}

export function allowedGoalTransitions(
  from: GoalStatus,
): readonly GoalStatus[] {
  return GOAL_TRANSITIONS[from];
}
