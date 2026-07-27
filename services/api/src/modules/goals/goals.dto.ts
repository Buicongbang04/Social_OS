import { z } from "zod";
import { EXPECTED_OUTPUTS, GOAL_PRIORITIES, GOAL_TYPES } from "@repo/runtime";

/**
 * Constraint keys mirror docs/kernel/01_GOAL_MODEL.md's YAML example
 * (max_cost, timeout, approval, provider, language, retry), normalised to
 * camelCase. All optional — a Goal with no constraints inherits workspace
 * policy defaults.
 */
const constraintsSchema = z.object({
  maxCostUsd: z.number().positive().max(10_000).optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60_000)
    .optional(),
  approval: z.boolean().optional(),
  provider: z.string().max(60).optional(),
  language: z.string().max(20).optional(),
  retry: z.number().int().min(0).max(10).optional(),
});

const scheduleSchema = z.object({
  /** Standard 5-field cron. */
  cron: z.string().min(9).max(100),
  /** Required: a cron without a zone is ambiguous across DST and regions. */
  timezone: z.string().min(3).max(64),
});

export const createGoalSchema = z.object({
  title: z.string().min(1).max(300),
  /**
   * The natural-language objective. This is the actual product input — the
   * whole point is that a user describes what they want rather than building
   * a workflow.
   */
  objective: z.string().min(3).max(5_000),
  description: z.string().max(5_000).nullable().optional(),
  type: z.enum(GOAL_TYPES).optional(),
  priority: z.enum(GOAL_PRIORITIES).optional(),
  constraints: constraintsSchema.optional(),
  inputs: z.record(z.unknown()).optional(),
  outputs: z.array(z.enum(EXPECTED_OUTPUTS)).optional(),
  schedule: scheduleSchema.nullable().optional(),
});
export type CreateGoalBody = z.infer<typeof createGoalSchema>;

export const createExecutionSchema = z.object({
  goalId: z.string().min(1),
});
export type CreateExecutionBody = z.infer<typeof createExecutionSchema>;

export const approvalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  /** Optional note, shown back on the task so the trail records the why. */
  note: z.string().max(1_000).optional(),
});
export type ApprovalBody = z.infer<typeof approvalSchema>;

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
