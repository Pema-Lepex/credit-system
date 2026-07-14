import { z } from "zod";

/**
 * Auth schemas. Shared by the forms (via zodResolver) and by anything that needs
 * the inferred types — one definition, no drift between validation and TS.
 *
 * The password rules mirror what the backend enforces. Client-side validation is
 * a UX affordance (instant feedback, no round-trip); the server is the authority.
 */

const email = z
  .string()
  .min(1, "Email is required")
  .email("Enter a valid email address")
  .max(255, "Email is too long")
  .transform((value) => value.trim().toLowerCase());

const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const loginSchema = z.object({
  email,
  // Deliberately NOT the strict `password` rule: an existing account may predate
  // the current policy, and telling someone their correct password is "invalid"
  // at the login screen is maddening.
  password: z.string().min(1, "Password is required"),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .min(2, "Enter your full name")
      .max(160, "Name is too long")
      .transform((v) => v.trim()),
    businessName: z
      .string()
      .min(2, "Enter your business name")
      .max(160, "Business name is too long")
      .transform((v) => v.trim()),
    email,
    password,
    confirmPassword: z.string().min(1, "Confirm your password"),
    acceptTerms: z.literal(true, {
      message: "You must accept the terms to continue",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"], // attach the error to the field the user must fix
  });
export type RegisterValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/** 0-4, for the strength meter. Cheap heuristic, not zxcvbn — no 400kB dependency. */
export function passwordStrength(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}
