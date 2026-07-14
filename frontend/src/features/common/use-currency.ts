"use client";

/**
 * The business's currency, fetched once and cached for the session.
 *
 * Money is a *string* on the wire ("2944.00"). It is formatted, never summed, in
 * this app — and formatting needs the business's ISO-4217 code and locale, not a
 * hard-coded USD. One query, an hour of staleness (a business does not change its
 * currency mid-session), shared by every table and card.
 */

import { useQuery } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, formatCurrency } from "@/lib/format";
import type { Money } from "@/types";

const BUSINESS_CURRENCY_QUERY = /* GraphQL */ `
  query BusinessCurrency {
    business {
      id
      currency
      currencySymbol
      locale
    }
  }
`;

interface BusinessCurrencyResult {
  business: {
    id: string;
    currency: string;
    currencySymbol: string;
    locale: string;
  };
}

export const businessCurrencyKey = ["business", "currency"] as const;

export interface CurrencyFormatter {
  currency: string;
  locale: string;
  symbol: string;
  format: (amount: Money | number | null | undefined) => string;
}

/** Intl wants "en-US"; the backend stores "en". Widen the bare code. */
function normaliseLocale(locale: string | undefined): string {
  if (!locale) return DEFAULT_LOCALE;
  return locale.includes("-") ? locale : DEFAULT_LOCALE;
}

export function useCurrency(): CurrencyFormatter {
  const { data } = useQuery({
    queryKey: businessCurrencyKey,
    queryFn: () => gqlRequest<BusinessCurrencyResult>(BUSINESS_CURRENCY_QUERY),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });

  const currency = data?.business.currency ?? DEFAULT_CURRENCY;
  const locale = normaliseLocale(data?.business.locale);

  return {
    currency,
    locale,
    symbol: data?.business.currencySymbol ?? "$",
    format: (amount) => formatCurrency(amount, currency, locale),
  };
}
