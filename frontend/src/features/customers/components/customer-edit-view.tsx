"use client";

import { Alert, Skeleton } from "@/components/ui";
import { toServerError } from "@/features/common/errors";
import type { ID } from "@/types";

import { useCustomer } from "../queries";
import { CustomerForm } from "./customer-form";

/**
 * The form cannot be rendered until the record is in hand — an uncontrolled
 * <input> keeps its first `defaultValue` forever, so mounting the form empty and
 * filling it in later would leave every box blank.
 */
export function CustomerEditView({ id }: { id: ID }) {
  const { data: customer, isLoading, error } = useCustomer(id);

  if (error) {
    return (
      <Alert variant="destructive" title="Could not load this customer">
        {toServerError(error).message}
      </Alert>
    );
  }

  if (isLoading || !customer) {
    return (
      <div className="space-y-6" role="status" aria-busy="true">
        <span className="sr-only">Loading customer</span>
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-96 rounded-lg lg:col-span-2" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      </div>
    );
  }

  return <CustomerForm customer={customer} />;
}
