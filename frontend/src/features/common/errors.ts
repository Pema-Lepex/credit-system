/**
 * Turning a server error into something a form can show.
 *
 * The backend raises AppError subclasses (core/errors.py) and the Strawberry
 * layer copies `code` and `field` into `extensions`. So a duplicate SKU arrives
 * as `{code: "CONFLICT", field: "sku"}` and a bad credit limit as
 * `{code: "VALIDATION_ERROR", field: "credit_limit"}`.
 *
 * Two things have to happen before a form can use that:
 *   1. `field` is snake_case (Python), form names are camelCase (React).
 *   2. A CONFLICT with a field (duplicate SKU) belongs ON the field; a CONFLICT
 *      without one ("customer still owes money") belongs at the top of the page.
 */

import { GraphQLRequestError } from "@/lib/graphql/client";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "STORAGE_QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "INTERNAL_SERVER_ERROR";

export interface ServerError {
  message: string;
  code?: string;
  /** camelCase, ready to hand to React Hook Form's setError. */
  field?: string;
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Never throws. An unknown thrown value still yields a readable message. */
export function toServerError(error: unknown): ServerError {
  if (error instanceof GraphQLRequestError) {
    const first = error.graphQLErrors[0];
    const extensions = first?.extensions ?? {};
    const rawField = extensions.field;
    const rawCode = extensions.code ?? error.code;
    return {
      message: first?.message ?? error.message,
      code: typeof rawCode === "string" ? rawCode : undefined,
      field: typeof rawField === "string" ? snakeToCamel(rawField) : undefined,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: "Something went wrong. Please try again." };
}

export function isCode(error: unknown, code: ErrorCode): boolean {
  return toServerError(error).code === code;
}

/** RHF's setError, minus the react-hook-form import (keeps this file generic). */
type SetFieldError = (field: string, message: string) => void;

/**
 * Route a server error to the field it belongs to.
 *
 * @returns true when the error was placed on a field. false means the caller
 *          should surface it globally (toast / form-level alert) instead —
 *          silently swallowing an unmapped error is how a save button ends up
 *          doing nothing with no explanation.
 */
export function applyServerError(
  error: unknown,
  setFieldError: SetFieldError,
  knownFields: readonly string[],
): ServerError {
  const parsed = toServerError(error);
  if (parsed.field && knownFields.includes(parsed.field)) {
    setFieldError(parsed.field, parsed.message);
  }
  return parsed;
}
