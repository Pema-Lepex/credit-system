/**
 * Suggested banks / wallets for the "which one" field on a payment or expense.
 *
 * A SUGGESTION LIST, NOT AN ENUM. The server stores whatever the user types
 * (`Payment.provider` is free text), so this list only decides what the dropdown
 * offers. That matters for two reasons:
 *
 *   1. The banks a shop deals with are a fact about its COUNTRY. Hardcoding these
 *      into the schema would make the product unusable outside Bhutan and would
 *      need a migration every time a bank rebrands.
 *   2. A shop using something not on the list must never be blocked. "Other" is
 *      always available and writes free text.
 *
 * THIS IS THE ONE PLACE TO EDIT to change what a shop sees. Nothing else reads it.
 */
export const PAYMENT_PROVIDERS: readonly string[] = [
  "Bank of Bhutan",
  "Bhutan National Bank Ltd",
  "Druk PNB Ltd",
  "Bhutan Development Bank Ltd",
  "T Bank Ltd",
  "DK",
] as const;

/** The sentinel the Select uses for "not on the list" — never stored. */
export const PROVIDER_OTHER = "__other__";

/**
 * Cash has no bank behind it, so the field is hidden for it. Every other method
 * can meaningfully name one: a transfer or mobile payment names the bank, a cheque
 * names the bank it is drawn on, a card names the issuer, and OTHER is exactly the
 * case where writing it down matters most.
 */
export function providerApplies(method: string): boolean {
  return method !== "CASH";
}

/**
 * Split a stored provider into the Select value and the free-text value.
 *
 * A provider that is not on the suggestion list — because it was typed, imported,
 * or the list has since changed — must still round-trip when the form reopens,
 * rather than silently resetting to blank.
 */
export function splitProvider(provider: string | null | undefined): {
  choice: string;
  custom: string;
} {
  const value = (provider ?? "").trim();
  if (!value) return { choice: "", custom: "" };
  if (PAYMENT_PROVIDERS.includes(value)) return { choice: value, custom: "" };
  return { choice: PROVIDER_OTHER, custom: value };
}

/** The value to send: the free text when "Other" is picked, otherwise the choice. */
export function joinProvider(choice: string, custom: string): string | null {
  if (choice === PROVIDER_OTHER) return custom.trim() || null;
  return choice.trim() || null;
}
