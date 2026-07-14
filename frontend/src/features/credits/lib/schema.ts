/**
 * The credit form's shape and rules.
 *
 * EVERY MONEY FIELD IS A STRING, from the input to the mutation variable. Zod
 * `z.coerce.number()` on a price would be the single most damaging line in this
 * codebase: it would turn "12.34" into a float the instant the user typed it, and
 * every total downstream would inherit the drift. The regexes below validate the
 * *shape* of a decimal; lib/money.ts does the arithmetic in integer cents.
 */

import { z } from "zod";

import { ITEM_KINDS } from "@/types";

/** Up to 2 decimal places — MoneyType's scale. */
const MONEY = /^\d+(\.\d{1,2})?$/;
/** Up to 3 decimal places — CreditItem.quantity's scale. */
const QUANTITY = /^\d+(\.\d{1,3})?$/;
/** 0–100 with up to 2 decimal places. */
const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

const money = (message: string) => z.string().regex(MONEY, message);

/**
 * NO `.default()` ANYWHERE. Zod's `.default()` makes a field optional on the way IN
 * and required on the way OUT, which gives the schema two different types — and
 * React Hook Form's resolver then refuses to line up with `useForm<T>`. Every
 * default lives in `emptyItem()` instead, where it is one obvious place rather than
 * a type-level surprise.
 */
export const creditItemSchema = z.object({
  /** Set when the line came from the catalog; null for a free-text line. */
  productId: z.string().nullable(),
  serviceId: z.string().nullable(),
  kind: z.enum(ITEM_KINDS),
  name: z.string().trim().min(1, "Name the item").max(200),
  description: z.string().max(500).optional(),
  unit: z.string().trim().min(1).max(20),
  quantity: z
    .string()
    .regex(QUANTITY, "Use a number with at most three decimal places")
    .refine((value) => Number(value) > 0, "Quantity must be greater than zero"),
  unitPrice: money("Use a price with at most two decimal places"),
  discountAmount: money("Use an amount with at most two decimal places"),
  taxPercentage: z.string().regex(PERCENT, "Use a percentage between 0 and 100"),
});

export type CreditItemFormValues = z.infer<typeof creditItemSchema>;

export const creditFormSchema = z
  .object({
    customerId: z.string().min(1, "Choose a customer"),
    issuedDate: z.string().min(1, "Pick the date this was issued"),
    dueDate: z.string().min(1, "Pick a due date"),
    reminderDate: z.string().optional(),
    items: z.array(creditItemSchema).min(1, "Add at least one item"),
    discountPercentage: z
      .string()
      .regex(PERCENT, "Use a percentage between 0 and 100")
      .optional()
      .or(z.literal("")),
    taxPercentage: z
      .string()
      .regex(PERCENT, "Use a percentage between 0 and 100")
      .optional()
      .or(z.literal("")),
    notes: z.string().max(2000).optional(),
    initialPayment: money("Use an amount with at most two decimal places")
      .optional()
      .or(z.literal("")),
  })
  // A due date before the issue date is not a typo the server should have to catch.
  .refine((values) => !values.dueDate || values.dueDate >= values.issuedDate, {
    message: "The due date cannot be before the issue date",
    path: ["dueDate"],
  })
  .refine(
    (values) => !values.reminderDate || values.reminderDate <= values.dueDate,
    {
      message: "A reminder after the due date is not a reminder",
      path: ["reminderDate"],
    },
  );

export type CreditFormValues = z.infer<typeof creditFormSchema>;

export function emptyItem(taxPercentage = "0"): CreditItemFormValues {
  return {
    productId: null,
    serviceId: null,
    kind: "CUSTOM",
    name: "",
    description: "",
    unit: "pcs",
    quantity: "1",
    unitPrice: "0",
    discountAmount: "0",
    taxPercentage,
  };
}

/** Today, in the browser's timezone. The server re-derives "today" in the business's. */
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Default due date: 30 days out. A due date is required, and "never" is not one. */
export function defaultDueDate(days = 30): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
