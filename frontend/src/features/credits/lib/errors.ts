/**
 * Server errors -> something a form or a toast can use.
 *
 * The backend's error boundary (backend/app/graphql/schema.py) guarantees exactly
 * two kinds of error: an `AppError` it raised on purpose — surfaced verbatim with
 * `extensions: { code, field? }` — and "Internal server error" with no detail. So
 * `extensions.code` is a contract we can branch on, and `extensions.field` names
 * the form control that is wrong.
 */

import { GraphQLRequestError } from "@/lib/graphql/client";
import { RestRequestError } from "@/features/credits/lib/rest";

export interface ParsedApiError {
  message: string;
  /** e.g. VALIDATION_ERROR | CONFLICT | NOT_FOUND | FORBIDDEN */
  code?: string;
  /** Present on VALIDATION_ERROR — the input field the server rejected. */
  field?: string;
  isValidation: boolean;
  /** Overpayment, "cancel a credit that has payments", duplicate — the state says no. */
  isConflict: boolean;
}

export function parseApiError(error: unknown): ParsedApiError {
  if (error instanceof GraphQLRequestError) {
    const extensions = error.graphQLErrors[0]?.extensions ?? {};
    const code = typeof extensions.code === "string" ? extensions.code : error.code;
    const field = typeof extensions.field === "string" ? extensions.field : undefined;

    return {
      message: error.isNetworkError
        ? "Could not reach the server. Check your connection and try again."
        : error.message,
      code,
      field,
      isValidation: code === "VALIDATION_ERROR",
      isConflict: code === "CONFLICT",
    };
  }

  if (error instanceof RestRequestError) {
    return {
      message: error.message,
      code: String(error.status),
      isValidation: error.status === 422,
      isConflict: error.status === 409,
    };
  }

  return {
    message: error instanceof Error ? error.message : "Something went wrong.",
    isValidation: false,
    isConflict: false,
  };
}

/**
 * Map a server field name onto a React Hook Form path.
 *
 * The server speaks snake_case and names the *domain* field (`discount_amount`);
 * the form names the *control* (`items.3.discountAmount`). Without this mapping a
 * validation error lands on nothing and the user sees a toast with no idea which
 * row is wrong.
 */
const FIELD_MAP: Record<string, string> = {
  customer_id: "customerId",
  due_date: "dueDate",
  issued_date: "issuedDate",
  reminder_date: "reminderDate",
  discount_percentage: "discountPercentage",
  tax_percentage: "taxPercentage",
  discount: "discountPercentage",
  initial_payment: "initialPayment",
  items: "items",
  notes: "notes",
  amount: "amount",
  method: "method",
  reason: "reason",
  paid_at: "paidAt",
};

export function toFormFieldName(serverField: string | undefined): string | null {
  if (!serverField) return null;
  const mapped = FIELD_MAP[serverField];
  if (mapped) return mapped;
  // Unknown but camel-cased already? Use it. Otherwise we have no safe target.
  return /^[a-z][A-Za-z0-9.]*$/.test(serverField) ? serverField : null;
}
