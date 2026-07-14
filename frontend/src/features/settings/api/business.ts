"use client";

/**
 * `business` / `updateBusiness`.
 *
 * The Business row backs FOUR different settings screens (Business, Reminders,
 * Data Retention, and — via currency/locale — every money figure in the app), so
 * there is exactly ONE query key for it. A save on the Reminders page must
 * repaint the currency symbol on the Business page, and a single cache entry is
 * what makes that free.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import { DEFAULT_CURRENCY, DEFAULT_CURRENCY_SYMBOL, DEFAULT_LOCALE } from "@/lib/format";
import type {
  ID,
  ISODateTime,
  Money,
  ReminderAudience,
  RetentionPolicy,
  WorkingHours,
} from "@/types";

/** Mirrors `BusinessType` in docs/schema.graphql, field for field. */
export interface BusinessSettings {
  id: ID;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;

  email: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  website: string | null;

  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;

  address: string | null;
  city: string | null;
  country: string | null;
  googleMapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;

  currency: string;
  currencySymbol: string;
  timezone: string;
  locale: string;
  taxPercentage: Money;
  workingHours: WorkingHours;

  remindersEnabled: boolean;
  reminderDaysBefore: number[];
  reminderAudience: ReminderAudience;
  reminderSendHour: number;
  notifyOwnerOnOverdue: boolean;
  notifyOwnerOnPayment: boolean;

  emailFromName: string | null;
  emailReplyTo: string | null;
  emailSignature: string | null;
  brandColor: string;

  /**
   * The W3Forms key is WRITE-ONLY: the API never sends it back, so there is no field
   * here to hold it. These two are all the UI gets, and all it needs — whether a key
   * is installed, and enough of its tail ("••••••••a1b2") to recognise which one.
   */
  hasW3formsAccessKey: boolean;
  w3formsAccessKeyHint: string | null;

  retentionPolicy: RetentionPolicy;
  retentionNotificationsEnabled: boolean;
  storageQuotaMb: number;

  isActive: boolean;
  createdAt: ISODateTime;
}

/** Every field of `BusinessUpdateInput`. All optional — send only what changed. */
export interface BusinessUpdateInput {
  name?: string;
  description?: string | null;
  logoFileId?: ID | null;
  email?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  website?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  googleMapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  currency?: string;
  currencySymbol?: string;
  timezone?: string;
  locale?: string;
  taxPercentage?: Money;
  workingHours?: WorkingHours;
  remindersEnabled?: boolean;
  reminderDaysBefore?: number[];
  reminderAudience?: ReminderAudience;
  reminderSendHour?: number;
  notifyOwnerOnOverdue?: boolean;
  notifyOwnerOnPayment?: boolean;
  emailFromName?: string | null;
  emailReplyTo?: string | null;
  emailSignature?: string | null;
  brandColor?: string;
  /**
   * Three states, and they are not interchangeable:
   *   undefined -> leave the stored key alone (the form never holds it, so this is
   *                what an ordinary save sends)
   *   ""        -> remove the stored key and fall back to the server's env var
   *   "abc..."  -> replace the stored key
   */
  w3formsAccessKey?: string;
  retentionPolicy?: RetentionPolicy;
  retentionNotificationsEnabled?: boolean;
}

const BUSINESS_FIELDS = /* GraphQL */ `
  fragment BusinessFields on BusinessType {
    id
    name
    slug
    description
    logoUrl
    email
    phone
    whatsappNumber
    website
    facebookUrl
    instagramUrl
    tiktokUrl
    address
    city
    country
    googleMapsUrl
    latitude
    longitude
    currency
    currencySymbol
    timezone
    locale
    taxPercentage
    workingHours
    remindersEnabled
    reminderDaysBefore
    reminderAudience
    reminderSendHour
    notifyOwnerOnOverdue
    notifyOwnerOnPayment
    emailFromName
    emailReplyTo
    emailSignature
    brandColor
    hasW3formsAccessKey
    w3formsAccessKeyHint
    retentionPolicy
    retentionNotificationsEnabled
    storageQuotaMb
    isActive
    createdAt
  }
`;

const BUSINESS_QUERY = /* GraphQL */ `
  ${BUSINESS_FIELDS}
  query Business {
    business {
      ...BusinessFields
    }
  }
`;

const UPDATE_BUSINESS_MUTATION = /* GraphQL */ `
  ${BUSINESS_FIELDS}
  mutation UpdateBusiness($input: BusinessUpdateInput!) {
    updateBusiness(input: $input) {
      ...BusinessFields
    }
  }
`;

export const businessKeys = {
  all: ["business"] as const,
  detail: () => ["business", "detail"] as const,
};

export function useBusiness(): UseQueryResult<BusinessSettings> {
  return useQuery({
    queryKey: businessKeys.detail(),
    queryFn: async () => {
      const data = await gqlRequest<{ business: BusinessSettings }>(BUSINESS_QUERY);
      return data.business;
    },
    // Currency/locale/timezone are read by half the app — keep them warm.
    staleTime: 5 * 60_000,
  });
}

export function useUpdateBusiness() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BusinessUpdateInput) => {
      const data = await gqlRequest<
        { updateBusiness: BusinessSettings },
        { input: BusinessUpdateInput }
      >(UPDATE_BUSINESS_MUTATION, { input });
      return data.updateBusiness;
    },
    onSuccess: (business) => {
      // Seed the cache from the mutation result rather than refetching: the
      // mutation returns the full, authoritative row.
      queryClient.setQueryData(businessKeys.detail(), business);
      // A retention-policy change moves the goalposts for the next sweep.
      void queryClient.invalidateQueries({ queryKey: ["retention"] });
    },
  });
}

export interface MoneyFormat {
  currency: string;
  locale: string;
  symbol: string;
  timezone: string;
}

/**
 * Currency + locale for every formatCurrency() call in the app, straight from the
 * business row. Falls back to the library defaults while the query is in flight,
 * so a table never renders "undefined" in the gap.
 */
export function useMoneyFormat(): MoneyFormat {
  const { data } = useBusiness();
  return {
    currency: data?.currency ?? DEFAULT_CURRENCY,
    locale: data?.locale ?? DEFAULT_LOCALE,
    symbol: data?.currencySymbol || DEFAULT_CURRENCY_SYMBOL,
    timezone: data?.timezone ?? "UTC",
  };
}
