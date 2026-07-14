/**
 * Global search — one query across customers, credits, payments and products.
 *
 * The server does the union and the ranking (queries.py `search`); the client
 * groups the hits by `kind` and renders them. `amount` and `status` are optional
 * because a product hit has a price but no status, and a customer hit has a
 * status but the "amount" is what they owe.
 */

import type { ID, Money } from "@/types";

export const SEARCH_KINDS = ["customer", "credit", "payment", "product"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchHit {
  kind: string;
  id: ID;
  title: string;
  subtitle: string;
  amount: Money | null;
  status: string | null;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
}

export const SEARCH_QUERY = /* GraphQL */ `
  query GlobalSearch($query: String!, $limit: Int!) {
    search(query: $query, limit: $limit) {
      hits {
        kind
        id
        title
        subtitle
        amount
        status
      }
      total
    }
  }
`;

export interface SearchResult {
  search: SearchResults;
}

/** Where a hit lives. The palette is a router, so this is the whole contract. */
export function hrefForHit(hit: SearchHit): string {
  switch (hit.kind) {
    case "customer":
      return `/customers/${hit.id}`;
    case "credit":
      return `/credits/${hit.id}`;
    case "payment":
      return `/payments/${hit.id}`;
    case "product":
      return `/products/${hit.id}/edit`;
    default:
      return "/dashboard";
  }
}

export const KIND_LABELS: Record<string, string> = {
  customer: "Customers",
  credit: "Credits",
  payment: "Payments",
  product: "Products",
};

/** Stable group order — customers first, because that is what people search for. */
export const KIND_ORDER: readonly string[] = ["customer", "credit", "payment", "product"];
