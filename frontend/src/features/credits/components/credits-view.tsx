"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, PlusCircle, RefreshCw, SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Button,
  Card,
  CardContent,
  EmptyState,
  Pagination,
  SkeletonTable,
  buttonVariants,
} from "@/components/ui";
import {
  CancelCreditDialog,
  DeleteCreditDialog,
} from "@/features/credits/components/credit-danger-dialogs";
import { CreditsFilters } from "@/features/credits/components/credits-filters";
import { CreditsTable } from "@/features/credits/components/credits-table";
import { useCreditList } from "@/features/credits/hooks/use-credits";
import { countActiveCreditFilters, PAGE_SIZES } from "@/features/credits/lib/filters";
import { parseApiError } from "@/features/credits/lib/errors";
import {
  CUSTOMER_BY_ID_QUERY,
  creditKeys,
  type CreditListRow,
  type CustomerByIdResult,
  type CustomerOption,
} from "@/features/credits/queries";
import { RecordPaymentDialog } from "@/features/payments/components/record-payment-dialog";
import { useAuth } from "@/lib/auth/AuthProvider";
import { gqlRequest } from "@/lib/graphql/client";
import { cn } from "@/lib/utils";

export function CreditsView() {
  const { hasPermission } = useAuth();
  const { state, update, reset, query } = useCreditList();

  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [payTarget, setPayTarget] = useState<CreditListRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CreditListRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CreditListRow | null>(null);

  // A shared `?customer=<id>` link arrives with an id and no name. Resolve it once
  // so the picker shows a person rather than a hash.
  const customerQuery = useQuery({
    queryKey: creditKeys.customerById(state.customerId ?? ""),
    queryFn: () =>
      gqlRequest<CustomerByIdResult, { id: string }>(CUSTOMER_BY_ID_QUERY, {
        id: state.customerId as string,
      }),
    enabled: Boolean(state.customerId) && customer?.id !== state.customerId,
    select: (data) => data.customer,
  });

  useEffect(() => {
    if (!state.customerId) {
      setCustomer(null);
      return;
    }
    if (customerQuery.data && customerQuery.data.id === state.customerId) {
      setCustomer(customerQuery.data);
    }
  }, [state.customerId, customerQuery.data]);

  const page = query.data;
  const activeFilters = countActiveCreditFilters(state);
  const canWrite = hasPermission("credit:write");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credits"
        description="Every credit you have written, and exactly what is still owed on it."
        actions={
          canWrite ? (
            <Link href="/credits/new" className={cn(buttonVariants({ variant: "primary" }))}>
              <PlusCircle aria-hidden="true" className="size-4" />
              New credit
            </Link>
          ) : null
        }
      />

      <CreditsFilters
        state={state}
        onChange={update}
        onReset={() => {
          setCustomer(null);
          reset();
        }}
        customer={customer}
        onCustomerChange={setCustomer}
      />

      {query.isError ? (
        <Alert variant="destructive" title="Could not load your credits">
          <p>{parseApiError(query.error).message}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            leftIcon={<RefreshCw />}
            isLoading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        </Alert>
      ) : query.isPending ? (
        <Card>
          <CardContent className="pt-6">
            <SkeletonTable rows={8} columns={6} />
          </CardContent>
        </Card>
      ) : page && page.items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            {activeFilters > 0 ? (
              <EmptyState
                icon={<SearchX />}
                title="No credit matches these filters"
                description="Nothing in the book fits what you asked for. Widen the search, or clear the filters and start again."
                action={
                  <Button variant="outline" onClick={reset}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<CreditCard />}
                title="No credits yet"
                description="A credit is a sale you have not been paid for. Write your first one and this book starts keeping itself."
                action={
                  canWrite ? (
                    <Link
                      href="/credits/new"
                      className={cn(buttonVariants({ variant: "primary" }))}
                    >
                      <PlusCircle aria-hidden="true" className="size-4" />
                      Write your first credit
                    </Link>
                  ) : null
                }
              />
            )}
          </CardContent>
        </Card>
      ) : page ? (
        <div className="space-y-4">
          <CreditsTable
            credits={page.items}
            sortField={state.sortField}
            sortDesc={state.sortDesc}
            onSortChange={(sortField, sortDesc) => update({ sortField, sortDesc })}
            onRecordPayment={setPayTarget}
            onCancel={setCancelTarget}
            onDelete={setDeleteTarget}
            isFetching={query.isFetching}
          />

          <Pagination
            page={page.pageInfo.page}
            pageSize={page.pageInfo.limit}
            totalItems={page.pageInfo.total}
            pageSizeOptions={PAGE_SIZES}
            isLoading={query.isFetching}
            onPageChange={(next) => update({ page: next })}
            onPageSizeChange={(limit) => update({ limit, page: 1 })}
          />
        </div>
      ) : null}

      {/* The dialogs live HERE, not in each row: one instance, one focus trap, and
          no chance of forty mounted dialogs on a hundred-row page. */}
      <RecordPaymentDialog
        open={payTarget !== null}
        onOpenChange={(open) => !open && setPayTarget(null)}
        credit={
          payTarget
            ? {
                id: payTarget.id,
                number: payTarget.number,
                remainingAmount: payTarget.remainingAmount,
                customerName: payTarget.customer?.name,
              }
            : null
        }
      />

      <CancelCreditDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        credit={cancelTarget}
      />

      <DeleteCreditDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        credit={deleteTarget}
      />
    </div>
  );
}
