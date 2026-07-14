"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Card, CardContent, Input, Label } from "@/components/ui";
import { FilterChip } from "@/features/common/filter-chip";
import { useDebouncedValue } from "@/features/common/use-debounced-value";
import { CUSTOMER_STATUS_STYLES } from "@/lib/utils";
import { CUSTOMER_STATUSES } from "@/types";

import type { CustomerFiltersState } from "../use-customer-filters";

/**
 * Text inputs are locally controlled and pushed to the URL on a debounce: writing
 * every keystroke into the router would re-render the route (and re-run the
 * query) six times for "Dorji".
 */
export function CustomerFilters({ filters }: { filters: CustomerFiltersState }) {
  const [search, setSearch] = useState(filters.search);
  const [min, setMin] = useState(filters.minOutstanding);
  const [max, setMax] = useState(filters.maxOutstanding);

  const debouncedSearch = useDebouncedValue(search, 300);
  const debouncedMin = useDebouncedValue(min, 400);
  const debouncedMax = useDebouncedValue(max, 400);

  const { setSearch: commitSearch, setOutstanding } = filters;

  useEffect(() => {
    if (debouncedSearch !== filters.search) commitSearch(debouncedSearch);
    // filters.search is the URL's value; comparing guards the back button from
    // being fought by this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  useEffect(() => {
    if (debouncedMin !== filters.minOutstanding || debouncedMax !== filters.maxOutstanding) {
      setOutstanding(debouncedMin, debouncedMax);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMin, debouncedMax]);

  // The URL is the source of truth: a "Clear all" press (or a back button) must
  // empty these boxes.
  useEffect(() => setSearch(filters.search), [filters.search]);
  useEffect(() => setMin(filters.minOutstanding), [filters.minOutstanding]);
  useEffect(() => setMax(filters.maxOutstanding), [filters.maxOutstanding]);

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="customer-search">Search</Label>
            <Input
              id="customer-search"
              type="search"
              value={search}
              placeholder="Name, phone or code…"
              leftAddon={<Search />}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:w-72">
            <div className="space-y-1.5">
              <Label htmlFor="customer-min">Min outstanding</Label>
              <Input
                id="customer-min"
                inputMode="decimal"
                value={min}
                placeholder="0"
                onChange={(event) => setMin(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-max">Max outstanding</Label>
              <Input
                id="customer-max"
                inputMode="decimal"
                value={max}
                placeholder="Any"
                onChange={(event) => setMax(event.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground mr-1 text-xs font-medium">Status</span>
          {CUSTOMER_STATUSES.map((status) => (
            <FilterChip
              key={status}
              active={filters.statuses.includes(status)}
              onToggle={() => filters.toggleStatus(status)}
              activeClassName={`border-transparent ${CUSTOMER_STATUS_STYLES[status].className}`}
            >
              {CUSTOMER_STATUS_STYLES[status].label}
            </FilterChip>
          ))}

          <span className="bg-border mx-1 hidden h-5 w-px sm:block" aria-hidden="true" />

          <FilterChip
            active={filters.hasOverdue}
            onToggle={() => filters.setHasOverdue(!filters.hasOverdue)}
            activeClassName="border-transparent bg-destructive-soft text-destructive-soft-foreground"
          >
            Has overdue
          </FilterChip>

          {filters.isFiltered ? (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<X />}
              onClick={filters.clear}
              className="ml-auto"
            >
              Clear all
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
