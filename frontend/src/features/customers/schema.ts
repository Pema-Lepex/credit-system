import { z } from "zod";

import { CUSTOMER_STATUSES } from "@/types";

/**
 * Form validation for a customer.
 *
 * Every field is a STRING in the form (that is what an <input> gives you) and is
 * converted at the boundary — money to a money string, lat/lng to numbers, empty
 * to null. Money is never parsed into a JS number on the way to the server: "0.1"
 * + "0.2" is the server's problem, in Decimal, where it is correct.
 *
 * Optional fields are validated only when non-empty: an empty phone box is not a
 * validation failure, it is an absent phone number.
 */

/**
 * Optional, but NOT `.default("")` — a Zod default makes the field optional in
 * the *input* type while required in the *output* type, and React Hook Form
 * infers its values from the output. The two disagree and the resolver stops
 * type-checking. The form always supplies "" itself, so a plain string is right.
 */
const optionalText = (max: number, label: string) =>
  z.string().max(max, `${label} is too long`);

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const customerFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160, "Name is too long"),
  phone: optionalText(40, "Phone"),
  email: optionalText(255, "Email").refine(
    (value) => value === "" || EMAIL_RE.test(value.trim()),
    "Enter a valid email address",
  ),
  address: optionalText(500, "Address"),
  city: optionalText(120, "City"),
  latitude: optionalText(24, "Latitude").refine((value) => {
    if (value === "") return true;
    const n = Number(value);
    return Number.isFinite(n) && n >= -90 && n <= 90;
  }, "Latitude must be between -90 and 90"),
  longitude: optionalText(24, "Longitude").refine((value) => {
    if (value === "") return true;
    const n = Number(value);
    return Number.isFinite(n) && n >= -180 && n <= 180;
  }, "Longitude must be between -180 and 180"),
  notes: optionalText(2000, "Notes"),
  status: z.enum(CUSTOMER_STATUSES),
  creditLimit: optionalText(16, "Credit limit").refine(
    (value) => value === "" || MONEY_RE.test(value),
    "Enter an amount like 5000 or 5000.00",
  ),
  emergencyContactName: optionalText(160, "Contact name"),
  emergencyContactPhone: optionalText(40, "Contact phone"),
  emergencyContactRelation: optionalText(80, "Relationship"),
});

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

/** The fields the server may name in `extensions.field`, camelCased. */
export const CUSTOMER_FORM_FIELDS = [
  "name",
  "phone",
  "email",
  "address",
  "city",
  "latitude",
  "longitude",
  "notes",
  "status",
  "creditLimit",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelation",
] as const;
