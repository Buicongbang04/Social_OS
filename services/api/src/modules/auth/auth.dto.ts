import { z } from "zod";

/**
 * Password policy per docs/platform/06_AUTHENTICATION.md ("Strong Password").
 * Length is the dominant factor for entropy, so the floor is 12 rather than
 * the more common 8, and an upper bound exists because argon2 hashes the whole
 * input — an unbounded password is a cheap CPU-exhaustion vector.
 */
const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(256, "Password must be at most 256 characters");

export const registerSchema = z.object({
  email: z.string().email().max(320),
  password: passwordSchema,
  fullName: z.string().min(1).max(200).optional(),
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(
      /^[a-z0-9_-]+$/i,
      "Username may contain only letters, digits, _ and -",
    )
    .optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(320),
  // No length constraints on login: rejecting a short password here would
  // reveal the policy and add nothing, since it simply will not match.
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};
