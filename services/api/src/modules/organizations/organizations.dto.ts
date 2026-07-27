import { z } from "zod";

const slugSchema = z
  .string()
  .min(2)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug may contain only lowercase letters, digits and dashes",
  );

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(2000).nullable().optional(),
});
export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>;

/** `version` is mandatory — it drives the optimistic-lock compare-and-swap. */
export const updateOrganizationSchema = z.object({
  version: z.coerce.number().int().nonnegative(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
});
export type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>;
