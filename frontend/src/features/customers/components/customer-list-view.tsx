"use client";

import { CustomerFilters } from "./customer-filters";
import { CustomerTable } from "./customer-table";
import { useCustomerFilters } from "../use-customer-filters";

/**
 * The client half of /customers. One `useCustomerFilters()` here, passed down —
 * the filter bar and the table read the SAME URL-derived state, so they cannot
 * disagree about what is being shown.
 */
export function CustomerListView() {
  const filters = useCustomerFilters();

  return (
    <div className="space-y-4">
      <CustomerFilters filters={filters} />
      <CustomerTable filters={filters} />
    </div>
  );
}
