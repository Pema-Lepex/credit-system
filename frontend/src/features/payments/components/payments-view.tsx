"use client";

import { useQuery } from "@tanstack/react-query";
import { Receipt, RefreshCw, SearchX } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  Pagination,
  SkeletonTable,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { parseApiError } from "@/features/credits/lib/errors";
import {
  CUSTOMER_BY_ID_QUERY,
  creditKeys,
  type CustomerByIdResult,
  type CustomerOption,
} from "@/features/credits/queries";
import { PaymentsFilters } from "@/features/payments/components/payments-filters";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import { VoidPaymentDialog } from "@/features/payments/components/void-payment-dialog";
import { useDeletePayment, usePaymentList } from "@/features/payments/hooks/use-payments";
import { countActivePaymentFilters, DEFAULT_PAGE_SIZE } from "@/features/payments/lib/filters";
import type { PaymentRow } from "@/features/payments/queries";
import { gqlRequest } from "@/lib/graphql/client";

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function PaymentsView() {
  const { state, update, reset, query } = usePaymentList();

  const money = useMoney();
  const deletePayment = useDeletePayment();

  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [voidTarget, setVoidTarget] = useState<PaymentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentRow | null>(null);

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
  const activeFilters = countActivePaymentFilters(state);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Every payment, as an append-only ledger. Nothing is ever deleted — a correction is a void, with a reason, and the original stays."
      />

      <PaymentsFilters
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
        <Alert variant="destructive" title="Could not load the ledger">
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
                title="No payment matches these filters"
                description="Nothing in the ledger fits what you asked for. Try widening the dates, or clear the filters."
                action={
                  <Button variant="outline" onClick={reset}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Receipt />}
                title="No payments yet"
                description="When a customer pays, record it against their credit — from the credit itself, or straight from the credits list. It lands here."
              />
            )}
          </CardContent>
        </Card>
      ) : page ? (
        <div className="space-y-4">
          <PaymentsTable
            payments={page.items}
            sortField={state.sortField}
            sortDesc={state.sortDesc}
            onSortChange={(sortField, sortDesc) => update({ sortField, sortDesc })}
            onVoid={setVoidTarget}
            onDelete={setDeleteTarget}
            isFetching={query.isFetching}
          />

          <Pagination
            page={page.pageInfo.page}
            pageSize={page.pageInfo.limit ?? DEFAULT_PAGE_SIZE}
            totalItems={page.pageInfo.total}
            pageSizeOptions={PAGE_SIZES}
            isLoading={query.isFetching}
            onPageChange={(next) => update({ page: next })}
            onPageSizeChange={(limit) => update({ limit, page: 1 })}
          />
        </div>
      ) : null}

      <VoidPaymentDialog
        open={voidTarget !== null}
        onOpenChange={(open) => !open && setVoidTarget(null)}
        payment={voidTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this payment?"
        description={
          deleteTarget ? (
            <>
              Payment <strong>{deleteTarget.number}</strong> of{" "}
              <strong>{money.format(deleteTarget.amount)}</strong> will move to the Trash and its
              amount will go back onto the credit&apos;s balance. You can restore it any time from
              Settings → Trash — nothing is permanently removed here.
            </>
          ) : null
        }
        confirmLabel="Move to Trash"
        destructive
        isLoading={deletePayment.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deletePayment.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
