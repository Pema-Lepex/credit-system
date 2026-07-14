"use client";

import { LayoutGrid, Search, Table2, Tags, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Card, CardContent, Input, Label, Select } from "@/components/ui";
import { FilterChip } from "@/features/common/filter-chip";
import { useDebouncedValue } from "@/features/common/use-debounced-value";
import { cn } from "@/lib/utils";

import { useCategories } from "../queries";
import type { ProductFiltersState, ServiceFiltersState } from "../use-catalog-filters";

/**
 * One filter bar for both catalog tables. Products get two extra controls (low
 * stock, view toggle); services get the same search / category / active trio, so
 * the shared 90% lives here rather than in two files that drift.
 */
export function CatalogFilters({
  filters,
  onManageCategories,
  kind,
}: {
  filters: ProductFiltersState | ServiceFiltersState;
  onManageCategories: () => void;
  kind: "product" | "service";
}) {
  const { data: categories } = useCategories();
  const [search, setSearch] = useState(filters.search);
  const debouncedSearch = useDebouncedValue(search, 300);
  const { setSearch: commitSearch } = filters;

  const productFilters = kind === "product" ? (filters as ProductFiltersState) : null;

  useEffect(() => {
    if (debouncedSearch !== filters.search) commitSearch(debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => setSearch(filters.search), [filters.search]);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="catalog-search">Search</Label>
            <Input
              id="catalog-search"
              type="search"
              value={search}
              placeholder={kind === "product" ? "Name or SKU…" : "Name or code…"}
              leftAddon={<Search />}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="space-y-1.5 sm:w-56">
            <Label htmlFor="catalog-category">Category</Label>
            <Select
              id="catalog-category"
              value={filters.categoryId ?? ""}
              onChange={(event) => filters.setCategory(event.target.value || null)}
              options={[
                { value: "", label: "All categories" },
                ...(categories ?? []).map((category) => ({
                  value: category.id,
                  label: category.name,
                })),
              ]}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={filters.isActive === true}
            onToggle={() => filters.setActive(filters.isActive === true ? null : true)}
            activeClassName="border-transparent bg-success-soft text-success-soft-foreground"
          >
            Active
          </FilterChip>
          <FilterChip
            active={filters.isActive === false}
            onToggle={() => filters.setActive(filters.isActive === false ? null : false)}
            activeClassName="border-transparent bg-neutral-soft text-neutral-soft-foreground"
          >
            Inactive
          </FilterChip>

          {productFilters ? (
            <FilterChip
              active={productFilters.lowStockOnly}
              onToggle={() => productFilters.setLowStockOnly(!productFilters.lowStockOnly)}
              activeClassName="border-transparent bg-warning-soft text-warning-soft-foreground"
            >
              Low stock
            </FilterChip>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Tags />}
            onClick={onManageCategories}
            className="ml-auto"
          >
            Categories
          </Button>

          {filters.isFiltered ? (
            <Button variant="ghost" size="sm" leftIcon={<X />} onClick={filters.clear}>
              Clear
            </Button>
          ) : null}

          {productFilters ? (
            <div
              role="group"
              aria-label="View"
              className="border-border flex items-center gap-0.5 rounded-md border p-0.5"
            >
              <ViewButton
                active={productFilters.view === "table"}
                label="Table view"
                onClick={() => productFilters.setView("table")}
              >
                <Table2 className="size-4" aria-hidden="true" />
              </ViewButton>
              <ViewButton
                active={productFilters.view === "grid"}
                label="Grid view"
                onClick={() => productFilters.setView("grid")}
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
              </ViewButton>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-ring inline-flex size-7 items-center justify-center rounded transition-colors focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:text-foreground bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
