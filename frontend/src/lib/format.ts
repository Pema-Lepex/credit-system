/**
 * Formatting primitives.
 *
 * All formatters are locale/currency-aware and take an explicit locale so a
 * business in Thimphu and one in Berlin can render the same component
 * differently. They also never throw: a bad ISO string or an unknown currency
 * code degrades to something readable rather than crashing a table row.
 */

import {
  format,
  formatDistanceToNowStrict,
  isValid,
  parseISO,
  differenceInCalendarDays,
} from "date-fns";

import type { Money } from "@/types";

export const DEFAULT_LOCALE = "en-US";
export const DEFAULT_CURRENCY = "BTN";
/** Fallback only — the real symbol comes from the business's `currencySymbol`. */
export const DEFAULT_CURRENCY_SYMBOL = "Nu.";

/**
 * Money arrives from GraphQL as a *string* (Python Decimal -> String scalar) to
 * avoid float drift in transit. Coerce only at the display edge.
 */
export function toNumber(value: Money | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * WHY THE SYMBOL IS AN EXPLICIT OVERRIDE, NOT LEFT TO Intl
 * --------------------------------------------------------
 * Intl only knows a currency's symbol *per locale*, and for BTN neither option is
 * usable in a shop:
 *
 *   en-US + BTN -> "BTN 1,234.50"        (ISO code, not the symbol people read)
 *   dz-BT + BTN -> "Nu. ༡,༢༣༤.༥༠"        (right symbol, Tibetan digits)
 *
 * So we take the grouping/decimals from the business's locale (en-US: Latin
 * digits, "1,234.50") and splice in the business's own `currency_symbol` — the
 * field the model has always had and the formatter never used. Pass no symbol and
 * behaviour is exactly Intl's, so USD/EUR businesses are unaffected.
 */
export function formatCurrency(
  amount: Money | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {},
  symbol?: string | null,
): string {
  const value = toNumber(amount);
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...options,
    });
    if (!symbol) return formatter.format(value);

    // Replace only the currency part; every other part (digits, group separators,
    // minus sign, compact suffix) keeps the locale's own rendering.
    return formatter
      .formatToParts(value)
      .map((part) => (part.type === "currency" ? symbol : part.value))
      .join("");
  } catch {
    // Unknown/invalid ISO-4217 code — still show the number rather than blow up.
    return `${symbol || currency} ${value.toFixed(2)}`;
  }
}

/** Dashboard cards: 1.2M instead of 1,204,331.00 — full value belongs in a tooltip. */
export function formatCompactCurrency(
  amount: Money | number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
  symbol?: string | null,
): string {
  return formatCurrency(
    amount,
    currency,
    locale,
    {
      notation: "compact",
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    },
    symbol,
  );
}

export function formatNumber(
  value: number | string | null | undefined,
  locale: string = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  const n = toNumber(value as Money | number);
  return new Intl.NumberFormat(locale, options).format(n);
}

export function formatPercent(
  value: number | string | null | undefined,
  locale: string = DEFAULT_LOCALE,
  fractionDigits = 1,
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(toNumber(value as Money | number) / 100);
}

/** Accepts an ISO string or a Date; returns null when unparseable. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : parseISO(value);
  return isValid(d) ? d : null;
}

export function formatDate(
  value: string | Date | null | undefined,
  pattern = "d MMM yyyy",
  fallback = "—",
): string {
  const d = toDate(value);
  return d ? format(d, pattern) : fallback;
}

export function formatDateTime(
  value: string | Date | null | undefined,
  pattern = "d MMM yyyy, HH:mm",
  fallback = "—",
): string {
  return formatDate(value, pattern, fallback);
}

/** "3 days ago" / "in 2 months". Strict = no "about". */
export function formatRelativeDate(
  value: string | Date | null | undefined,
  fallback = "—",
): string {
  const d = toDate(value);
  return d ? formatDistanceToNowStrict(d, { addSuffix: true }) : fallback;
}

/**
 * Due-date language, which is the whole point of this product.
 * Negative = overdue by N days; 0 = due today.
 */
export function formatDueDate(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): {
  label: string;
  days: number | null;
  tone: "neutral" | "warning" | "destructive" | "success";
} {
  const d = toDate(value);
  if (!d) return { label: "—", days: null, tone: "neutral" };

  const days = differenceInCalendarDays(d, now);
  if (days < 0) {
    const n = Math.abs(days);
    return { label: `${n} day${n === 1 ? "" : "s"} overdue`, days, tone: "destructive" };
  }
  if (days === 0) return { label: "Due today", days, tone: "warning" };
  if (days === 1) return { label: "Due tomorrow", days, tone: "warning" };
  if (days <= 7) return { label: `Due in ${days} days`, days, tone: "warning" };
  return { label: `Due ${format(d, "d MMM yyyy")}`, days, tone: "neutral" };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** Base-1024. The storage dashboard is the only consumer that cares. */
export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  const b = toNumber(bytes as number);
  if (b <= 0) return "0 B";
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = b / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${BYTE_UNITS[i]}`;
}

/** "Sonam Dorji" -> "SD". Falls back to "?" so an avatar is never blank. */
export function initials(name: string | null | undefined, max = 2): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, max)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function truncate(value: string | null | undefined, length = 60): string {
  if (!value) return "";
  return value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
}

/** Phone numbers are free-text in the DB; only strip noise, never reformat. */
export function formatPhone(phone: string | null | undefined): string {
  return phone?.trim() ?? "—";
}
