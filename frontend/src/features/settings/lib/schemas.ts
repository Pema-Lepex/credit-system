/**
 * Zod schemas for the settings forms.
 *
 * DELIBERATELY TRANSFORM-FREE. A `.transform()` makes a schema's input type
 * diverge from its output type, and React Hook Form's resolver then has to
 * reconcile two different shapes — which is where the "why is my field typed
 * `unknown`" afternoon comes from. Trimming and "" -> null happen once, on
 * submit, in `toInput()`. The schema's only job is to say yes or no.
 *
 * Every optional text field is `""` when empty, never `undefined`: a controlled
 * <input value={undefined}> is an uncontrolled input, and React will tell you so
 * in the console the moment the user types.
 */

import { z } from "zod";

import { isValidTimezone } from "./locale-data";
import type { WorkingHours, WorkingHoursDay } from "@/types";

/** "" is always allowed — the field is optional. Otherwise it must parse. */
const optionalUrl = z
  .string()
  .max(500, "That URL is too long")
  .refine((v) => v === "" || /^https?:\/\/.+/i.test(v), "Enter a full URL, starting with https://");

const optionalEmail = z
  .string()
  .max(255, "That email is too long")
  .refine(
    (v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    "Enter a valid email address",
  );

/** Money and percentages travel as strings — never parse them into a float. */
const percentString = z
  .string()
  .refine((v) => v === "" || /^\d{1,3}(\.\d{1,2})?$/.test(v), "Use a number like 5 or 7.50")
  .refine((v) => v === "" || Number(v) <= 100, "Cannot be more than 100%");

/** A coordinate, as typed. Kept as a string in the form; coerced once on submit. */
function coordinate(max: number, label: string) {
  return z
    .string()
    .refine((v) => v === "" || /^-?\d{1,3}(\.\d+)?$/.test(v), `Enter a number, e.g. ${label}`)
    .refine((v) => v === "" || Math.abs(Number(v)) <= max, `Must be between -${max} and ${max}`);
}

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #4f46e5");

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, e.g. 09:00");

export const workingHoursDaySchema = z.object({
  open: time,
  close: time,
  closed: z.boolean(),
});

/**
 * Seven named keys, not `z.record(string, …)`.
 *
 * A record type would infer `Record<string, Day>`, which does not structurally
 * match `WorkingHours` (a Partial of seven literal keys) in either direction, and
 * you spend the afternoon casting. Naming the days keeps the form type and the
 * domain type the same shape.
 */
export const workingHoursSchema = z.object({
  mon: workingHoursDaySchema,
  tue: workingHoursDaySchema,
  wed: workingHoursDaySchema,
  thu: workingHoursDaySchema,
  fri: workingHoursDaySchema,
  sat: workingHoursDaySchema,
  sun: workingHoursDaySchema,
});

export const DAYS = [
  { key: "mon", label: "Monday", short: "Mon" },
  { key: "tue", label: "Tuesday", short: "Tue" },
  { key: "wed", label: "Wednesday", short: "Wed" },
  { key: "thu", label: "Thursday", short: "Thu" },
  { key: "fri", label: "Friday", short: "Fri" },
  { key: "sat", label: "Saturday", short: "Sat" },
  { key: "sun", label: "Sunday", short: "Sun" },
] as const;

export type DayKey = (typeof DAYS)[number]["key"];

export const DEFAULT_DAY: WorkingHoursDay = { open: "09:00", close: "17:00", closed: false };

export type WorkingHoursValues = z.infer<typeof workingHoursSchema>;

/** The JSON column may be empty or half-populated — fill the gaps, never crash. */
export function normaliseWorkingHours(
  value: WorkingHours | null | undefined,
): WorkingHoursValues {
  const result = {} as WorkingHoursValues;
  for (const { key } of DAYS) {
    const day: WorkingHoursDay | undefined = value?.[key];
    result[key] = {
      open: day?.open ?? DEFAULT_DAY.open,
      close: day?.close ?? DEFAULT_DAY.close,
      closed: day?.closed ?? key === "sun",
    };
  }
  return result;
}

export const businessSchema = z.object({
  // Profile
  name: z.string().min(2, "Enter your business name").max(160, "That name is too long"),
  description: z.string().max(2000, "Keep the description under 2000 characters"),
  logoFileId: z.string().nullable(),

  // Contact
  email: optionalEmail,
  phone: z.string().max(40, "That phone number is too long"),
  whatsappNumber: z.string().max(40, "That number is too long"),
  website: optionalUrl,

  // Social
  facebookUrl: optionalUrl,
  instagramUrl: optionalUrl,
  tiktokUrl: optionalUrl,

  // Location
  address: z.string().max(300, "That address is too long"),
  city: z.string().max(120, "That city name is too long"),
  country: z.string().max(120, "That country name is too long"),
  googleMapsUrl: optionalUrl,
  latitude: coordinate(90, "27.4712"),
  longitude: coordinate(180, "89.6339"),

  // Localisation
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, "Use a 3-letter code, e.g. USD")
    .max(3),
  currencySymbol: z.string().min(1, "Enter a symbol").max(8, "That symbol is too long"),
  timezone: z.string().refine(isValidTimezone, "Pick a timezone from the list"),
  locale: z.string().min(2, "Pick a locale").max(20),
  taxPercentage: percentString,

  // Working hours (JSON column)
  workingHours: workingHoursSchema,

  // Branding
  brandColor: hexColor,
  emailFromName: z.string().max(120, "That name is too long"),
  emailReplyTo: optionalEmail,
  emailSignature: z.string().max(1000, "Keep the signature under 1000 characters"),
  /**
   * Left blank on every normal save: the form is never given the stored key, so an
   * empty box means "unchanged", not "delete". Removal is an explicit button, which
   * sends "" — see business-form.tsx.
   */
  w3formsAccessKey: z.string().max(255, "That key is too long"),
});

export type BusinessFormValues = z.infer<typeof businessSchema>;

/** "" -> null, and trim everything. The one place the form shape meets the API shape. */
export function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "That password is too long")
  .regex(/[a-z]/, "Include a lowercase letter")
  .regex(/[A-Z]/, "Include an uppercase letter")
  .regex(/[0-9]/, "Include a number");

export const userCreateSchema = z.object({
  fullName: z.string().min(2, "Enter their full name").max(160, "That name is too long"),
  email: z.string().min(1, "Email is required").email("Enter a valid email address").max(255),
  phone: z.string().max(40, "That phone number is too long"),
  password,
  // SUPER_ADMIN is absent from the UI list when the actor is an ADMIN — see
  // assignableRoles(). The server enforces it; the form just never offers it.
  role: z.enum(["SUPER_ADMIN", "ADMIN", "STAFF"]),
});
export type UserCreateValues = z.infer<typeof userCreateSchema>;

export const userEditSchema = z.object({
  fullName: z.string().min(2, "Enter their full name").max(160, "That name is too long"),
  phone: z.string().max(40, "That phone number is too long"),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "STAFF"]),
  isActive: z.boolean(),
});
export type UserEditValues = z.infer<typeof userEditSchema>;

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
export const emailTemplateSchema = z.object({
  subject: z.string().min(1, "The subject cannot be empty").max(255, "That subject is too long"),
  bodyHtml: z.string().min(1, "The body cannot be empty").max(20000, "That body is too long"),
  footerHtml: z.string().max(5000, "That footer is too long"),
  signature: z.string().max(2000, "That signature is too long"),
  primaryColor: hexColor,
  accentColor: hexColor,
  showLogo: z.boolean(),
  isActive: z.boolean(),
});
export type EmailTemplateValues = z.infer<typeof emailTemplateSchema>;

// ---------------------------------------------------------------------------
// Reminders (a slice of the Business row)
// ---------------------------------------------------------------------------
export const remindersSchema = z.object({
  remindersEnabled: z.boolean(),
  reminderDaysBefore: z
    .array(z.number().int().min(0).max(365))
    .min(1, "Add at least one reminder day")
    .max(10, "That is a lot of reminders — 10 is the maximum"),
  reminderAudience: z.enum(["CUSTOMER", "OWNER", "BOTH"]),
  reminderSendHour: z.number().int().min(0).max(23),
  notifyOwnerOnOverdue: z.boolean(),
  notifyOwnerOnPayment: z.boolean(),
});
export type RemindersValues = z.infer<typeof remindersSchema>;

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
export const profileSchema = z.object({
  fullName: z.string().min(2, "Enter your full name").max(160, "That name is too long"),
  phone: z.string().max(40, "That phone number is too long"),
  avatarFileId: z.string().nullable(),
  theme: z.enum(["light", "dark", "system"]),
  language: z.string().min(2, "Pick a language").max(20),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: password,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "Choose a password you have not used before",
    path: ["newPassword"],
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
