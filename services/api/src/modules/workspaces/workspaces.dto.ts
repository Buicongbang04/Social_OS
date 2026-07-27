import { z } from "zod";
import { WORKSPACE_ROLES } from "@repo/domain";

/** Lowercase, URL-safe, no leading/trailing dash — used in paths and subdomains. */
const slugSchema = z
  .string()
  .min(2)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may contain only lowercase letters, digits and dashes",
  );

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(2000).nullable().optional(),
  organizationId: z.string().min(1),
});
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceSchema>;

/**
 * `version` is required, not optional: it is the compare-and-swap value for
 * optimistic locking (docs/data/04_TRANSACTION_MODEL.md). Making it optional
 * would turn the whole mechanism into decoration, since clients would omit it.
 */
export const updateWorkspaceSchema = z.object({
  version: z.coerce.number().int().nonnegative(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
});
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceSchema>;

export const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(WORKSPACE_ROLES),
});
export type AddMemberBody = z.infer<typeof addMemberSchema>;

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
