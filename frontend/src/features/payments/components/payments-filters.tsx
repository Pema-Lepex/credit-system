"use client";

import { Filter, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge, Button, FormField, Input, Label, Switch } from "@/components/ui";
import { CustomerCombobox } from "@/features/credits/components/customer-combobox";
import type { CustomerOption } from "@/features/credits/queries";
import {
  countActivePaymentFilters,
  type PaymentListState,
} from "@/features/payments/lib/filters";
import { PAYMENT_METHOD_LABELS, cn } from "@/lib/utils";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types";

export interface PaymentsFiltersProps {
  state: PaymentListState;
  onChange: (patch: Partial<PaymentListState>) => void;
  onReset: () => void;
  customer: CustomerOption | null;
  onCustomerChange: (customer: CustomerOption | null) => void;
}

export function PaymentsFilters({
  state,
  onChange,
  onReset,
  customer,
  onCustomerChange,
}: PaymentsFiltersProps) {
  const [search, setSearch] = useState(state.search);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setSearch(state.search);
  }, [state.search]);

  useEffect(() => {
    if (search === state.search) return;
    const timer = setTimeout(() => onChange({ search }), 300);
    return () => clearTimeout(timer);
  }, [search, state.search, onChange]);

  const activeCount = countActivePaymentFilters(state);
  const advancedCount =
    (state.customerId ? 1 : 0) +
    (state.dateFrom || state.dateTo ? 1 : 0) +
    (state.minAmount || state.maxAmount ? 1 : 0);

  const toggleMethod = (method: PaymentMethod) => {
    const next = state.method.includes(method)
      ? state.method.filter((value) => value !== method)
      : [...state.method, method];
    onChange({ method: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="payment-search" className="sr-only">
            Search payments
          </label>
          <Input
            id="payment-search"
            type="search"
            placeholder="Search by receipt number or reference…"
            leftAddon={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Voided payments are hidden by default but never deleted. This switch is
              how you look at the whole, honest ledger. */}
          <div className="border-border bg-card flex h-9 items-center gap-2 rounded-md border px-3">
            <Switch
              id="include-voided"
              size="sm"
              checked={state.includeVoided}
              onCheckedChange={(checked) => onChange({ includeVoided: checked })}
            />
            <Label htmlFor="include-voided" className="text-xs whitespace-nowrap">
              Show voided
            </Label>
          </div>

          <Button
            variant={showAdvanced ? "secondary" : "outline"}
            leftIcon={<Filter />}
            aria-expanded={showAdvanced}
            aria-controls="payment-advanced-filters"
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

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter by payment method"
      >
        {PAYMENT_METHODS.map((method) => {
          const active = state.method.includes(method);
          return (
            <button
              key={method}
              type="button"
              aria-pressed={active}
              onClick={() => toggleMethod(method)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                active
                  ? "bg-primary-soft text-primary-soft-foreground border-transparent"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {PAYMENT_METHOD_LABELS[method]}
            </button>
          );
        })}
      </div>

      {showAdvanced ? (
        <div
          id="payment-advanced-filters"
          className="border-border bg-muted/30 grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="payment-filter-customer">Customer</Label>
            <CustomerCombobox
              id="payment-filter-customer"
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
            <FormField label="Paid from">
              <Input
                type="date"
                value={state.dateFrom ?? ""}
                onChange={(event) => onChange({ dateFrom: event.target.value || null })}
              />
            </FormField>
            <FormField label="Paid to">
              <Input
                type="date"
                value={state.dateTo ?? ""}
                onChange={(event) => onChange({ dateTo: event.target.value || null })}
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
