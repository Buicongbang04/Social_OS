import type {
  BaseEntity,
  GoalId,
  Metadata,
  UserId,
  WorkspaceId,
} from "@repo/core";
import type { GoalStatus } from "../state/goal-state";

/**
 * Goal priority, per docs/kernel/01_GOAL_MODEL.md.
 * NORMAL is the default; LOW runs only when the runtime is otherwise idle.
 */
export const GOAL_PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "LOW"] as const;
export type GoalPriority = (typeof GOAL_PRIORITIES)[number];

/**
 * Goal types.
 *
 * NOTE ON A DOC CONFLICT: 01_GOAL_MODEL.md lists seven types as headings
 * (Chat, Content, Campaign, Research, Automation, Publishing, Multi-step) but a
 * different eight-node "Goal Categories" mindmap (adding Media, Marketing,
 * Analytics; dropping Campaign, Multi-step). The headings are the more
 * considered list — each has explanatory prose — so they win.
 */
export const GOAL_TYPES = [
  "CHAT",
  "CONTENT",
  "CAMPAIGN",
  "RESEARCH",
  "AUTOMATION",
  "PUBLISHING",
  "MULTI_STEP",
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const EXPECTED_OUTPUTS = [
  "CONTENT",
  "IMAGE",
  "VIDEO",
  "PDF",
  "POST",
  "NOTIFICATION",
  "ANALYTICS",
] as const;
export type ExpectedOutput = (typeof EXPECTED_OUTPUTS)[number];

/**
 * Constraints the user places on how the Goal may be met. Field names follow
 * the doc's YAML example (max_cost, timeout, approval, provider, language,
 * retry) normalised to camelCase.
 *
 * Every field is optional: a Goal with no constraints is valid and inherits
 * workspace policy defaults.
 */
export type GoalConstraints = {
  /** Hard ceiling in USD for the whole Execution. */
  maxCostUsd?: number;
  /** Whole-Execution timeout in milliseconds. */
  timeoutMs?: number;
  /** Require human approval before any side-effecting task runs. */
  approval?: boolean;
  /** Pin a specific AI provider (Phase 2 onward). */
  provider?: string;
  /** BCP-47-ish language tag for generated content, e.g. "vi". */
  language?: string;
  /** Max retry attempts per task; overrides the capability default. */
  retry?: number;
};

/** Recurring schedule. A cron fire creates a NEW Execution, never reuses one. */
export type GoalSchedule = {
  /** Standard 5-field cron, e.g. "0 8 * * *". */
  cron: string;
  /** IANA zone, e.g. "Asia/Ho_Chi_Minh". Cron without a zone is ambiguous. */
  timezone: string;
};

export type Goal = BaseEntity<GoalId> & {
  workspaceId: WorkspaceId;
  ownerId: UserId;
  title: string;
  /** The natural-language objective — the actual input to the Intent Engine. */
  objective: string;
  description: string | null;
  type: GoalType;
  priority: GoalPriority;
  constraints: GoalConstraints;
  inputs: Metadata;
  outputs: readonly ExpectedOutput[];
  schedule: GoalSchedule | null;
  /** When this Goal next fires. Null for a one-off Goal. */
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  status: GoalStatus;
  metadata: Metadata;
};

export type CreateGoalInput = {
  workspaceId: WorkspaceId;
  ownerId: UserId;
  title: string;
  objective: string;
  description?: string | null;
  type?: GoalType;
  priority?: GoalPriority;
  constraints?: GoalConstraints;
  inputs?: Metadata;
  outputs?: readonly ExpectedOutput[];
  schedule?: GoalSchedule | null;
  metadata?: Metadata;
};
