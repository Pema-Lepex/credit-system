"use client";

import { Filter, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge, Button, FormField, Input, Label, Switch } from "@/components/ui";
import { CustomerCombobox } from "@/features/credits/components/customer-combobox";
import { countActiveCreditFilters, type CreditListState } from "@/features/credits/lib/filters";
import type { CustomerOption } from "@/features/credits/queries";
import { CREDIT_STATUS_STYLES, cn } from "@/lib/utils";
import { CREDIT_STATUSES, type CreditStatus } from "@/types";

export interface CreditsFiltersProps {
  state: CreditListState;
  onChange: (patch: Partial<CreditListState>) => void;
  onReset: () => void;
  /** Kept in the parent so the picked customer's NAME survives a refetch. */
  customer: CustomerOption | null;
  onCustomerChange: (customer: CustomerOption | null) => void;
}

/**
 * Filters. All of them write to the URL (see lib/filters.ts), so the state you are
 * looking at is the state you can send to someone else.
 *
 * The search box is debounced and LOCALLY controlled: typing must not wait on a
 * round trip through the router, and pushing a URL per keystroke would fill the
 * history with garbage.
 *
 * Status is a row of toggle chips rather than a multi-select popup — five options
 * is not enough to hide behind a menu, and a chip that is on is visibly on.
 */
export function CreditsFilters({
  state,
  onChange,
  onReset,
  customer,
  onCustomerChange,
}: CreditsFiltersProps) {
  const [search, setSearch] = useState(state.search);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Adopt an externally-driven change (Back, a shared link) without fighting the
  // user's own typing.
  useEffect(() => {
    setSearch(state.search);
  }, [state.search]);

  useEffect(() => {
    if (search === state.search) return;
    const timer = setTimeout(() => onChange({ search }), 300);
    return () => clearTimeout(timer);
  }, [search, state.search, onChange]);

  const activeCount = countActiveCreditFilters(state);

  const toggleStatus = (status: CreditStatus) => {
    const next = state.status.includes(status)
      ? state.status.filter((value) => value !== status)
      : [...state.status, status];
    onChange({ status: next });
  };

  const advancedCount =
    (state.customerId ? 1 : 0) +
    (state.dueFrom || state.dueTo ? 1 : 0) +
    (state.minAmount || state.maxAmount ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="credit-search" className="sr-only">
            Search credits
          </label>
          <Input
            id="credit-search"
            type="search"
            placeholder="Search by number, customer or phone…"
            leftAddon={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="border-border bg-card flex h-9 items-center gap-2 rounded-md border px-3">
            <Switch
              id="overdue-only"
              checked={state.overdueOnly}
              onCheckedChange={(checked) => onChange({ overdueOnly: checked })}
            />
            <Label htmlFor="overdue-only" className="text-xs whitespace-nowrap">
              Overdue only
            </Label>
          </div>

          <Button
            variant={showAdvanced ? "secondary" : "outline"}
            leftIcon={<Filter />}
            aria-expanded={showAdvanced}
            aria-controls="credit-advanced-filters"
            onClick={() => setShowAdvanced((open) => !open)}
          >
            Filters
            {advancedCount > 0 ? (
              <Badge size="sm" variant="primary" className="ml-1">
                {advancedCount}
              </Badge>
            ) : null}
          </Button>

          {activeCount > 0 ? (
            <Button variant="ghost" leftIcon={<X />} onClick={onReset}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {/* Status chips. aria-pressed carries the on/off state, so it is never colour
          alone that says a filter is active. */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {CREDIT_STATUSES.map((status) => {
          const style = CREDIT_STATUS_STYLES[status];
          const active = state.status.includes(status);

          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                active
                  ? cn(style.className, "border-transparent")
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", active ? style.dot : "bg-current opacity-40")}
              />
              {style.label}
            </button>
          );
        })}
      </div>

      {showAdvanced ? (
        <div
          id="credit-advanced-filters"
          className="border-border bg-muted/30 grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="filter-customer">Customer</Label>
            <CustomerCombobox
              id="filter-customer"
              value={customer}
              allowCreate={false}
              allowClear
              placeholder="Any customer"
              onChange={(next) => {
                onCustomerChange(next);
                onChange({ customerId: next?.id ?? null });
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FormField label="Due from">
              <Input
                type="date"
                value={state.dueFrom ?? ""}
                onChange={(event) => onChange({ dueFrom: event.target.value || null })}
              />
            </FormField>
            <FormField label="Due to">
              <Input
                type="date"
                value={state.dueTo ?? ""}
                onChange={(event) => onChange({ dueTo: event.target.value || null })}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FormField label="Min amount">
              <Input
                inputMode="decimal"
                placeholder="0.00"
                className="tabular"
                value={state.minAmount ?? ""}
                onChange={(event) => onChange({ minAmount: event.target.value || null })}
              />
            </FormField>
            <FormField label="Max amount">
              <Input
                inputMode="decimal"
                placeholder="Any"
                className="tabular"
                value={state.maxAmount ?? ""}
                onChange={(event) => onChange({ maxAmount: event.target.value || null })}
              />
            </FormField>
          </div>
        </div>
      ) : null}
    </div>
  );
}
