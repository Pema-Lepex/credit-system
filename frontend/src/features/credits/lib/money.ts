/**
 * Decimal-safe money math, in scaled integers.
 *
 * WHY THIS EXISTS
 * ---------------
 * The backend stores money as integer minor units and serialises Decimal as a
 * *String* scalar precisely so a JS float never touches it. The credit form,
 * however, must show a LIVE total as the user types — which means the client has
 * to do arithmetic. Doing it with `Number` reintroduces exactly the bug the string
 * scalar was designed to prevent (0.1 + 0.2 = 0.30000000000000004; 1.005 rounds
 * DOWN because it is really 1.00499999999999989).
 *
 * So every value is parsed into a `bigint` of scaled integer units, all arithmetic
 * happens there, and it is formatted back to a string at the very end. The server
 * is still the source of truth and will recompute — this preview simply must not
 * lie to the shopkeeper.
 *
 * (The `BigInt(n)` calls rather than `0n` literals are deliberate: tsconfig targets
 * ES2017, which has no BigInt literal syntax. The runtime is identical.)
 *
 * SCALES — copied from backend/app/models/credit.py:
 *   money       2 dp  (MoneyType -> integer minor units)
 *   quantity    3 dp  (max_digits=12, decimal_places=3)
 *   percentage  2 dp  (max_digits=5,  decimal_places=2)
 *
 * ROUNDING — ROUND_HALF_UP, matching `quantize_money()` in models/types.py.
 * Bankers' rounding would drift from the invoice by a cent on half the lines that
 * land on a .005 boundary.
 */

import type { Money } from "@/types";

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;
export const PERCENT_SCALE = 2;

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const FIVE = BigInt(5);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

function pow10(n: number): bigint {
  let result = ONE;
  for (let i = 0; i < n; i++) result *= TEN;
  return result;
}

/**
 * Parse a decimal string into scaled integer units.
 * `parseScaled("12.345", 2)` -> 1235n (half-up on the dropped digit).
 * Returns `null` for anything that is not a finite decimal — the caller decides
 * whether that is a validation error or simply "not typed yet".
 */
export function parseScaled(
  value: string | number | null | undefined,
  scale: number,
): bigint | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (raw === "") return null;

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) return null;

  const sign = match[1] ?? "";
  const intPart = match[2] ?? "";
  const fracPart = match[3] ?? "";
  if (intPart === "" && fracPart === "") return null;

  // Keep one extra digit so we can round half-up on it, then drop it.
  const padded = (fracPart + "0".repeat(scale + 1)).slice(0, scale + 1);
  const digits = BigInt(`${intPart || "0"}${padded}`);

  const lastDigit = digits % TEN;
  let scaled = digits / TEN;
  // ROUND_HALF_UP is defined on the magnitude, which is why the sign is applied
  // only after rounding — otherwise -1.005 would round to -1.00, not -1.01.
  if (lastDigit >= FIVE) scaled += ONE;

  return sign === "-" ? -scaled : scaled;
}

/** Format scaled integer units back to a fixed-point string. `1234n, 2` -> "12.34". */
export function formatScaled(value: bigint, scale: number): string {
  const negative = value < ZERO;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${intPart}${fracPart}`;
}

// ---------------------------------------------------------------------------
// Money-specific conveniences
// ---------------------------------------------------------------------------
/** "1234.56" -> 123456n. Unparseable input is 0, never NaN. */
export function toCents(value: Money | number | null | undefined): bigint {
  return parseScaled(value, MONEY_SCALE) ?? ZERO;
}

/** 123456n -> "1234.56". This is the string shape the API expects back. */
export function centsToMoney(cents: bigint): Money {
  return formatScaled(cents, MONEY_SCALE);
}

/**
 * `round(a * b / divisor)`, half-up on the magnitude, never leaving bigint.
 */
function mulDivRound(a: bigint, b: bigint, divisor: bigint): bigint {
  const product = a * b;
  const negative = product < ZERO !== divisor < ZERO;
  const absProduct = product < ZERO ? -product : product;
  const absDivisor = divisor < ZERO ? -divisor : divisor;
  if (absDivisor === ZERO) return ZERO;
  // +half then floor == round-half-up on the magnitude.
  const rounded = (absProduct * TWO + absDivisor) / (absDivisor * TWO);
  return negative ? -rounded : rounded;
}

// ---------------------------------------------------------------------------
// The line-item formula — mirrors CreditService.compute_item_totals EXACTLY
// ---------------------------------------------------------------------------
export interface LineTotalsInput {
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  taxPercentage: string;
}

export interface LineTotals {
  /** unit_price * quantity */
  lineSubtotalCents: bigint;
  discountCents: bigint;
  taxCents: bigint;
  /** (subtotal - discount) + tax */
  lineTotalCents: bigint;
  /** True when the discount exceeds the line subtotal — the server refuses this. */
  discountExceedsSubtotal: boolean;
}

/**
 * line_subtotal = unit_price * quantity
 * taxable       = line_subtotal - discount   (tax applies AFTER the discount)
 * tax           = taxable * tax_pct / 100
 * line_total    = taxable + tax
 */
export function computeLineTotals(input: LineTotalsInput): LineTotals {
  const priceCents = parseScaled(input.unitPrice, MONEY_SCALE) ?? ZERO;
  const quantityUnits = parseScaled(input.quantity, QUANTITY_SCALE) ?? ZERO;
  const discountCents = parseScaled(input.discountAmount, MONEY_SCALE) ?? ZERO;
  const taxPct = parseScaled(input.taxPercentage, PERCENT_SCALE) ?? ZERO;

  // price(2dp) * qty(3dp) is 5dp — divide back down to 2dp, half-up.
  const lineSubtotalCents = mulDivRound(priceCents, quantityUnits, pow10(QUANTITY_SCALE));

  const discountExceedsSubtotal = discountCents > lineSubtotalCents;
  const taxable = lineSubtotalCents - discountCents;

  // The percentage is 2dp AND we divide by 100 -> scale by 10^2 * 100.
  const taxCents = mulDivRound(taxable, taxPct, pow10(PERCENT_SCALE) * HUNDRED);

  return {
    lineSubtotalCents,
    discountCents,
    taxCents,
    lineTotalCents: taxable + taxCents,
    discountExceedsSubtotal,
  };
}

// ---------------------------------------------------------------------------
// The credit-level formula — mirrors CreditService.recalculate (invariant I1)
// ---------------------------------------------------------------------------
export interface CreditTotalsInput {
  items: readonly LineTotalsInput[];
  /** Whole-invoice discount, applied on top of the per-line discounts. */
  discountPercentage?: string | null;
  taxPercentage?: string | null;
  /** An optional payment taken at creation time. */
  initialPayment?: string | null;
}

export interface CreditTotals {
  subtotalCents: bigint;
  /** Per-line discounts + the whole-invoice percentage discount. */
  discountCents: bigint;
  /** Per-line tax + the whole-invoice percentage tax. */
  taxCents: bigint;
  grandTotalCents: bigint;
  paidCents: bigint;
  remainingCents: bigint;
  lines: LineTotals[];
  /** The server raises VALIDATION_ERROR for these; the form must not submit. */
  discountExceedsSubtotal: boolean;
  initialPaymentExceedsTotal: boolean;
}

export function computeCreditTotals(input: CreditTotalsInput): CreditTotals {
  const lines = input.items.map(computeLineTotals);

  let subtotalCents = ZERO;
  let itemDiscountCents = ZERO;
  let itemTaxCents = ZERO;
  for (const line of lines) {
    subtotalCents += line.lineSubtotalCents;
    itemDiscountCents += line.discountCents;
    itemTaxCents += line.taxCents;
  }

  // The whole-invoice discount applies to the base AFTER line discounts, so a line
  // is never discounted twice.
  const baseAfterItemDiscounts = subtotalCents - itemDiscountCents;
  const creditDiscountPct = parseScaled(input.discountPercentage, PERCENT_SCALE) ?? ZERO;
  const creditDiscountCents = mulDivRound(
    baseAfterItemDiscounts,
    creditDiscountPct,
    pow10(PERCENT_SCALE) * HUNDRED,
  );

  const discountCents = itemDiscountCents + creditDiscountCents;

  const creditTaxPct = parseScaled(input.taxPercentage, PERCENT_SCALE) ?? ZERO;
  const creditTaxCents = mulDivRound(
    subtotalCents - discountCents,
    creditTaxPct,
    pow10(PERCENT_SCALE) * HUNDRED,
  );

  const taxCents = itemTaxCents + creditTaxCents;
  const grandTotalCents = subtotalCents - discountCents + taxCents;

  const paidCents = parseScaled(input.initialPayment, MONEY_SCALE) ?? ZERO;
  // Clamped at zero, exactly as invariant I3 does: a negative "remaining" would
  // silently understate the receivables total.
  const owed = grandTotalCents - paidCents;
  const remainingCents = owed > ZERO ? owed : ZERO;

  return {
    subtotalCents,
    discountCents,
    taxCents,
    grandTotalCents,
    paidCents,
    remainingCents,
    lines,
    discountExceedsSubtotal:
      discountCents > subtotalCents || lines.some((line) => line.discountExceedsSubtotal),
    initialPaymentExceedsTotal: paidCents > grandTotalCents,
  };
}

/** True when `amount` is a valid, strictly-positive money string. */
export function isPositiveMoney(amount: string): boolean {
  const cents = parseScaled(amount, MONEY_SCALE);
  return cents !== null && cents > ZERO;
}

/** Compare two money strings without ever converting them to a float. */
export function moneyExceeds(amount: string, limit: Money): boolean {
  return toCents(amount) > toCents(limit);
}
