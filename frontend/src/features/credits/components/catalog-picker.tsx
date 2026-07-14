"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, Search, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge, Dialog, EmptyState, Input, Spinner } from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import {
  CATALOG_SEARCH_QUERY,
  creditKeys,
  type CatalogEntry,
  type CatalogSearchResult,
} from "@/features/credits/queries";
import { gqlRequest } from "@/lib/graphql/client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

export interface CatalogPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: CatalogEntry) => void;
}

/**
 * Products and services, searched together.
 *
 * They are two tables in the backend and one question in the shop ("what did they
 * take?"), so the picker asks the question rather than the schema. One query, one
 * list, one keystroke to the line item.
 *
 * The price it copies in is a SNAPSHOT: the credit records what was charged, not a
 * pointer to what the catalog says today. Editing the price on the line afterwards
 * is expected and does not touch the catalog.
 */
export function CatalogPicker({ open, onOpenChange, onSelect }: CatalogPickerProps) {
  const money = useMoney();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 220);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  const { data, isFetching } = useQuery({
    queryKey: creditKeys.catalogSearch(debounced),
    queryFn: () =>
      gqlRequest<CatalogSearchResult, Record<string, unknown>>(CATALOG_SEARCH_QUERY, {
        search: debounced || null,
        page: { page: 1, limit: 20 },
      }),
    enabled: open,
  });

  const entries = useMemo<CatalogEntry[]>(() => {
    if (!data) return [];

    const products: CatalogEntry[] = data.products.items.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price,
      taxPercentage: product.taxPercentage,
      unit: product.unit,
      kind: "PRODUCT",
      stockQuantity: product.stockQuantity,
      sku: product.sku,
    }));

    const services: CatalogEntry[] = data.services.items.map((service) => ({
      id: service.id,
      name: service.name,
      price: service.price,
      taxPercentage: service.taxPercentage,
      // A service has no unit in the backend; "service" is the honest label.
      unit: "service",
      kind: "SERVICE",
      code: service.code,
    }));

    return [...products, ...services];
  }, [data]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Add from catalog"
      description="Products and services you already sell. Prices are copied onto the line and can be edited there."
    >
      <div className="space-y-3">
        <label htmlFor="catalog-search" className="sr-only">
          Search the catalog
        </label>
        <Input
          id="catalog-search"
          type="search"
          autoFocus
          placeholder="Search by name or SKU…"
          leftAddon={<Search />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        {isFetching && entries.length === 0 ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
            <Spinner size="sm" label="" />
            Searching…
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Package />}
            title={debounced ? "Nothing matches" : "Your catalog is empty"}
            description={
              debounced
                ? `No product or service matches “${debounced}”. You can still add a custom line.`
                : "Add products and services and they will show up here. Until then, use a custom line."
            }
          />
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {entries.map((entry) => {
              const isProduct = entry.kind === "PRODUCT";
              const outOfStock =
                isProduct && entry.stockQuantity !== undefined && entry.stockQuantity !== null
                  ? Number(entry.stockQuantity) <= 0
                  : false;

              return (
                <li key={`${entry.kind}-${entry.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(entry);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "hover:bg-muted focus-visible:ring-ring flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                      "focus-visible:ring-2 focus-visible:outline-none",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                        isProduct
                          ? "bg-primary-soft text-primary-soft-foreground"
                          : "bg-info-soft text-info-soft-foreground",
                      )}
                    >
                      {isProduct ? <Package /> : <Wrench />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {entry.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {isProduct ? (entry.sku ?? "Product") : (entry.code ?? "Service")}
                        {isProduct && entry.stockQuantity !== undefined
                          ? ` · ${formatNumber(entry.stockQuantity, money.locale, { maximumFractionDigits: 3 })} in stock`
                          : ""}
                      </span>
                    </span>

                    {/* Stock is tracked but never enforced — a stale count must not
                        block a sale. So this is a warning, not a barrier. */}
                    {outOfStock ? (
                      <Badge size="sm" variant="warning">
                        Out of stock
                      </Badge>
                    ) : null}

                    <span className="text-foreground tabular shrink-0 text-sm font-medium">
                      {money.format(entry.price)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
