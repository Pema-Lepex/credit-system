"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { businessKeys, BUSINESS_QUERY, type BusinessQueryResult } from "@/features/credits/queries";
import { gqlRequest } from "@/lib/graphql/client";
import {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCY_SYMBOL,
  DEFAULT_LOCALE,
  formatCompactCurrency,
  formatCurrency,
} from "@/lib/format";
import type { Money } from "@/types";

/**
 * The business's currency + locale. Every money string in the app is formatted
 * through these, so it is fetched once and held for the session — a shop does not
 * change its currency between two clicks.
 */
export function useBusinessSettings() {
  return useQuery({
    queryKey: businessKeys.settings,
    queryFn: () => gqlRequest<BusinessQueryResult>(BUSINESS_QUERY),
    staleTime: 15 * 60_000,
    select: (data) => data.business,
  });
}

export interface MoneyFormatter {
  /** "1234.56" -> "Nu. 1,234.56" */
  format: (amount: Money | number | null | undefined) => string;
  /** "1204331.00" -> "Nu. 1.2M". For stat cards; the full value goes in a tooltip. */
  formatCompact: (amount: Money | number | null | undefined) => string;
  currency: string;
  locale: string;
  symbol: string;
}

/**
 * Formatting bound to the business's currency. Falls back to the library defaults
 * while the settings query is in flight, so nothing renders as "undefined" and no
 * component has to branch on `isLoading` just to print a number.
 *
 * The business's `currencySymbol` is passed through so BTN renders as "Nu. 1,234.56"
 * and not Intl's "BTN 1,234.56" — see format.ts for why Intl alone cannot do this.
 */
export function useMoney(): MoneyFormatter {
  const { data } = useBusinessSettings();
  const currency = data?.currency ?? DEFAULT_CURRENCY;
  const locale = data?.locale ?? DEFAULT_LOCALE;
  const symbol = data?.currencySymbol || DEFAULT_CURRENCY_SYMBOL;

  const format = useCallback(
    (amount: Money | number | null | undefined) =>
      formatCurrency(amount, currency, locale, {}, symbol),
    [currency, locale, symbol],
  );

  const formatCompactValue = useCallback(
    (amount: Money | number | null | undefined) =>
      formatCompactCurrency(amount, currency, locale, symbol),
    [currency, locale, symbol],
  );

  return { format, formatCompact: formatCompactValue, currency, locale, symbol };
}
