import { z } from "zod";

/**
 * Catalog form validation.
 *
 * Money and quantities are validated as STRINGS with a regex, not parsed into
 * numbers: `Number("1234.56")` is a lossy round trip back to "1234.5600000001"
 * territory, and the server wants a Decimal string anyway. Stock is allowed a
 * leading "-" because the backend permits negative stock on purpose (a stale
 * count must never block a sale).
 */

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const QUANTITY_RE = /^-?\d{1,12}(\.\d{1,3})?$/;
const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/;

const optional = (max: number, label: string) => z.string().max(max, `${label} is too long`);

const money = (label: string) =>
  z.string().refine((v) => v === "" || MONEY_RE.test(v), `${label} must look like 1250 or 1250.00`);

const percent = z
  .string()
  .refine((v) => v === "" || PERCENT_RE.test(v), "Tax must be a number")
  .refine((v) => v === "" || Number(v) <= 100, "Tax cannot exceed 100%");

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  sku: optional(64, "SKU"),
  barcode: optional(64, "Barcode"),
  description: optional(2000, "Description"),
  categoryId: z.string(),
  price: z
    .string()
    .min(1, "Price is required")
    .refine((v) => MONEY_RE.test(v), "Price must look like 185 or 185.00"),
  costPrice: money("Cost price"),
  taxPercentage: percent,
  stockQuantity: z
    .string()
    .refine((v) => v === "" || QUANTITY_RE.test(v), "Stock must be a number"),
  lowStockThreshold: z
    .string()
    .refine((v) => v === "" || QUANTITY_RE.test(v), "Threshold must be a number"),
  unit: z.string().trim().min(1, "Unit is required").max(16, "Unit is too long"),
  isActive: z.boolean(),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;

export const PRODUCT_FORM_FIELDS = [
  "name",
  "sku",
  "barcode",
  "description",
  "categoryId",
  "price",
  "costPrice",
  "taxPercentage",
  "stockQuantity",
  "lowStockThreshold",
  "unit",
  "isActive",
] as const;

export const serviceFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name is too long"),
  code: optional(64, "Code"),
  description: optional(2000, "Description"),
  categoryId: z.string(),
  price: z
    .string()
    .min(1, "Price is required")
    .refine((v) => MONEY_RE.test(v), "Price must look like 500 or 500.00"),
  taxPercentage: percent,
  durationMinutes: z
    .string()
    .refine((v) => v === "" || /^\d{1,4}$/.test(v), "Duration must be whole minutes")
    .refine((v) => v === "" || Number(v) > 0, "Duration must be more than zero"),
  isActive: z.boolean(),
});
export type ServiceFormValues = z.infer<typeof serviceFormSchema>;

export const SERVICE_FORM_FIELDS = [
  "name",
  "code",
  "description",
  "categoryId",
  "price",
  "taxPercentage",
  "durationMinutes",
  "isActive",
] as const;

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  description: optional(500, "Description"),
  color: z.string().refine((v) => v === "" || /^#[0-9a-fA-F]{6}$/.test(v), "Pick a colour"),
});
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export const CATEGORY_FORM_FIELDS = ["name", "description", "color"] as const;

/** Signed decimal string — the delta for `adjustStock`. */
export const stockAdjustSchema = z.object({
  delta: z
    .string()
    .min(1, "Enter an amount")
    .refine((v) => QUANTITY_RE.test(v), "Use a number like 12 or -3")
    .refine((v) => Number(v) !== 0, "A zero adjustment changes nothing"),
  reason: z.string().max(200, "Reason is too long"),
});
export type StockAdjustValues = z.infer<typeof stockAdjustSchema>;
