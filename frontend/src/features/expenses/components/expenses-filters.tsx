"use client";

import { Filter, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge, Button, FormField, Input, Select } from "@/components/ui";
import { useExpenseCategories } from "@/features/expenses/hooks/use-expenses";
import {
  countActiveExpenseFilters,
  type ExpenseListState,
} from "@/features/expenses/lib/filters";
import { PAYMENT_METHOD_LABELS, cn } from "@/lib/utils";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types";

export interface ExpensesFiltersProps {
  state: ExpenseListState;
  onChange: (patch: Partial<ExpenseListState>) => void;
  onReset: () => void;
}

export function ExpensesFilters({ state, onChange, onReset }: ExpensesFiltersProps) {
  const [search, setSearch] = useState(state.search);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Inactive categories are included here: an old expense may still be filed under
  // a bucket the owner has since retired, and you must be able to filter for it.
  const categories = useExpenseCategories({ includeInactive: true });

  useEffect(() => {
    setSearch(state.search);
  }, [state.search]);

  useEffect(() => {
    if (search === state.search) return;
    const timer = setTimeout(() => onChange({ search }), 300);
    return () => clearTimeout(timer);
  }, [search, state.search, onChange]);

  const activeCount = countActiveExpenseFilters(state);
  const advancedCount =
    (state.vendorName.trim() ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0) +
    (state.minAmount || state.maxAmount ? 1 : 0);

  const toggleMethod = (method: PaymentMethod) => {
    const next = state.paymentMethod.includes(method)
      ? state.paymentMethod.filter((value) => value !== method)
      : [...state.paymentMethod, method];
    onChange({ paymentMethod: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="expense-search" className="sr-only">
            Search expenses
          </label>
          <Input
            id="expense-search"
            type="search"
            placeholder="Search by who you paid, category, reference or notes…"
            leftAddon={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="w-44">
            <label htmlFor="expense-category-filter" className="sr-only">
              Filter by category
            </label>
            <Select
              id="expense-category-filter"
              value={state.categoryId ?? ""}
              onChange={(event) => onChange({ categoryId: event.target.value || null })}
              options={[
                { value: "", label: "All categories" },
                ...(categories.data ?? []).map((category) => ({
                  value: category.id,
                  label: category.name,
                })),
              ]}
            />
          </div>

          <Button
            variant={showAdvanced ? "secondary" : "outline"}
            leftIcon={<Filter />}
            onClick={() => setShowAdvanced((open) => !open)}
            aria-expanded={showAdvanced}
          >
            Filters
            {advancedCount > 0 ? (
              <Badge size="sm" variant="neutral" className="ml-1.5">
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

      {/* Method chips: multi-select, so "cash and card" is one click each. */}
      <div className="flex flex-wrap gap-2">
        {PAYMENT_METHODS.map((method) => {
          const selected = state.paymentMethod.includes(method);
          return (
            <button
              key={method}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleMethod(method)}
              className={cn(
                "focus-visible:ring-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {PAYMENT_METHOD_LABELS[method]}
            </button>
          );
        })}
      </div>

      {showAdvanced ? (
        <div className="border-border bg-card grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Paid to">
            <Input
              placeholder="Vendor name"
              value={state.vendorName}
              onChange={(event) => onChange({ vendorName: event.target.value })}
            />
          </FormField>

          <FormField label="From">
            <Input
              type="date"
              value={state.dateFrom ?? ""}
              onChange={(event) => onChange({ dateFrom: event.target.value || null })}
            />
          </FormField>

          <FormField label="To">
            <Input
              type="date"
              value={state.dateTo ?? ""}
              onChange={(event) => onChange({ dateTo: event.target.value || null })}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-2">
            <FormField label="Min">
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={state.minAmount ?? ""}
                onChange={(event) => onChange({ minAmount: event.target.value || null })}
              />
            </FormField>
            <FormField label="Max">
              <Input
                inputMode="decimal"
                placeholder="0.00"
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
