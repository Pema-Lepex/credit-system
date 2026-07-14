"use client";

import { RefreshCw } from "lucide-react";

import { Alert, Button, Skeleton } from "@/components/ui";
import { CreditForm } from "@/features/credits/components/credit-form";
import { useCredit } from "@/features/credits/hooks/use-credit";
import { parseApiError } from "@/features/credits/lib/errors";
import type { ID } from "@/types";

/**
 * The edit form cannot render until the credit is loaded — its default values ARE
 * the credit. Mounting the form with empty defaults and back-filling them later
 * would reset whatever the user had already typed.
 */
export function CreditEditView({ creditId }: { creditId: ID }) {
  const { data, isPending, isError, error, refetch, isFetching } = useCredit(creditId);

  if (isPending) {
    return (
      <div className="space-y-6" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading credit</span>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive" title="Could not load this credit">
        <p>{parseApiError(error).message}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          leftIcon={<RefreshCw />}
          isLoading={isFetching}
          onClick={() => void refetch()}
        >
          Try again
        </Button>
      </Alert>
    );
  }

  return <CreditForm credit={data} />;
}
