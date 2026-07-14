"use client";

import type { ColumnDef, SortingState, Updater } from "@tanstack/react-table";
import { CreditCard, MoreHorizontal, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  toast,
} from "@/components/ui";
import { DataTable, stopRowClick } from "@/features/common/data-table";
import { toServerError } from "@/features/common/errors";
import { assetUrl } from "@/features/common/media";
import { useCurrency } from "@/features/common/use-currency";
import { useAuth } from "@/lib/auth/AuthProvider";
import { CUSTOMER_STATUS_STYLES, cn, formatRelativeDate } from "@/lib/utils";

import type { CustomerRecord } from "../api";
import { useCustomers, useDeleteCustomer } from "../queries";
import type { CustomerFiltersState, CustomerSortField } from "../use-customer-filters";
import { CreditScoreCell } from "./credit-score";

/** Column ids ARE the server's sort field names (customer.py SORT_FIELDS). */
const SORTABLE: Record<string, CustomerSortField> = {
  name: "name",
  outstanding_balance: "outstanding_balance",
  credit_score: "credit_score",
};

export function CustomerTable({ filters }: { filters: CustomerFiltersState }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const currency = useCurrency();
  const { data, isLoading, isFetching, error } = useCustomers(
    filters.variables.filter,
    filters.variables.page,
    filters.variables.sort,
  );
  const deleteCustomer = useDeleteCustomer();

  const [target, setTarget] = useState<CustomerRecord | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const canWrite = hasPermission("customer:write");
  const canDelete = hasPermission("customer:delete");
  const canWriteCredit = hasPermission("credit:write");

  const sorting = useMemo<SortingState>(
    () => [{ id: filters.sortField, desc: filters.sortDesc }],
    [filters.sortField, filters.sortDesc],
  );

  const { setSort } = filters;
  const onSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      if (!first) return;
      const field = SORTABLE[first.id];
      if (field) setSort(field, first.desc);
    },
    [setSort, sorting],
  );

  const closeDialog = useCallback(() => {
    setTarget(null);
    setConflict(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!target) return;
    setConflict(null);
    try {
      await deleteCustomer.mutateAsync(target.id);
      toast.success(`${target.name} deleted.`);
      closeDialog();
    } catch (mutationError) {
      const parsed = toServerError(mutationError);
      // CONFLICT is the server doing its job: you cannot delete someone who owes
      // you money. Keep the dialog open and say exactly why.
      if (parsed.code === "CONFLICT") {
        setConflict(parsed.message);
      } else {
        toast.error(parsed.message);
        closeDialog();
      }
    }
  }, [closeDialog, deleteCustomer, target]);

  const columns = useMemo<ColumnDef<CustomerRecord, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Customer",
        enableSorting: true,
        cell: ({ row }) => {
          const customer = row.original;
          return (
            <div className="flex min-w-0 items-center gap-3">
              <Avatar
                size="sm"
                src={assetUrl(customer.photoThumbnailUrl ?? customer.photoUrl)}
                name={customer.name}
                seed={customer.id}
              />
              <div className="min-w-0">
                <p className="text-foreground truncate font-medium">{customer.name}</p>
                <p className="text-muted-foreground truncate text-xs">{customer.code}</p>
              </div>
            </div>
          );
        },
      },
      {
        id: "phone",
        header: "Phone",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground tabular whitespace-nowrap">
            {row.original.phone ?? "—"}
          </span>
        ),
      },
      {
        id: "outstanding_balance",
        header: "Outstanding",
        enableSorting: true,
        meta: { numeric: true, align: "right" as const },
        cell: ({ row }) => {
          const owed = row.original.outstandingBalance;
          const isOwing = Number(owed) > 0;
          return (
            <span className={cn("font-medium", isOwing ? "text-foreground" : "text-muted-foreground")}>
              {currency.format(owed)}
            </span>
          );
        },
      },
      {
        id: "credit_score",
        header: "Score",
        enableSorting: true,
        cell: ({ row }) => <CreditScoreCell score={row.original.creditScore} />,
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => {
          const customer = row.original;
          const style = CUSTOMER_STATUS_STYLES[customer.status];
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={style.className} size="sm" dot>
                {style.label}
              </Badge>
              {customer.overdueCount > 0 ? (
                <Badge variant="destructive" size="sm">
                  {customer.overdueCount} overdue
                </Badge>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "last_activity",
        header: "Last activity",
        enableSorting: false,
        cell: ({ row }) => {
          const { lastPaymentAt, lastCreditAt } = row.original;
          const latest =
            lastPaymentAt && lastCreditAt
              ? lastPaymentAt > lastCreditAt
                ? lastPaymentAt
                : lastCreditAt
              : (lastPaymentAt ?? lastCreditAt);
          return (
            <span className="text-muted-foreground whitespace-nowrap">
              {latest ? formatRelativeDate(latest) : "No activity"}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { align: "right" as const },
        cell: ({ row }) => {
          const customer = row.original;
          return (
            <div className="flex justify-end" onClick={stopRowClick}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Actions for ${customer.name}`}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent aria-label={`Actions for ${customer.name}`}>
                  <DropdownMenuItem
                    icon={<Users />}
                    onSelect={() => router.push(`/customers/${customer.id}`)}
                  >
                    View profile
                  </DropdownMenuItem>
                  {canWrite ? (
                    <DropdownMenuItem
                      icon={<Pencil />}
                      onSelect={() => router.push(`/customers/${customer.id}/edit`)}
                    >
                      Edit
                    </DropdownMenuItem>
                  ) : null}
                  {canWriteCredit ? (
                    <DropdownMenuItem
                      icon={<CreditCard />}
                      onSelect={() => router.push(`/credits/new?customerId=${customer.id}`)}
                    >
                      New credit
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <DropdownMenuItem
                      icon={<Trash2 />}
                      destructive
                      onSelect={() => setTarget(customer)}
                    >
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [canDelete, canWrite, canWriteCredit, currency, router],
  );

  if (error) {
    return (
      <Alert variant="destructive" title="Could not load customers">
        {toServerError(error).message}
      </Alert>
    );
  }

  return (
    <>
      <DataTable
        label="Customers"
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        sorting={sorting}
        onSortingChange={onSortingChange}
        page={filters.page}
        pageSize={filters.limit}
        totalItems={data?.pageInfo.total ?? 0}
        onPageChange={filters.setPage}
        onPageSizeChange={filters.setLimit}
        isLoading={isLoading}
        isFetching={isFetching}
        onRowClick={(row) => router.push(`/customers/${row.id}`)}
        renderCard={(customer) => (
          <CustomerCard customer={customer} format={currency.format} />
        )}
        emptyState={
          <EmptyState
            icon={<Users />}
            title={filters.isFiltered ? "No customers match those filters" : "No customers yet"}
            description={
              filters.isFiltered
                ? "Try widening the outstanding range or clearing a status."
                : "Add the first person you sell to on credit."
            }
            action={
              filters.isFiltered ? (
                <Button variant="outline" onClick={filters.clear}>
                  Clear filters
                </Button>
              ) : canWrite ? (
                <Button leftIcon={<UserPlus />} onClick={() => router.push("/customers/new")}>
                  New customer
                </Button>
              ) : null
            }
          />
        }
      />

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => (open ? undefined : closeDialog())}
        title={`Delete ${target?.name ?? "customer"}?`}
        description={
          conflict ? (
            <Alert variant="destructive" title="This customer still owes money">
              {conflict}
            </Alert>
          ) : (
            "Their record is removed from the active list. This cannot be undone from here."
          )
        }
        confirmLabel={conflict ? "Try again" : "Delete"}
        destructive
        isLoading={deleteCustomer.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function CustomerCard({
  customer,
  format,
}: {
  customer: CustomerRecord;
  format: (amount: string) => string;
}) {
  const style = CUSTOMER_STATUS_STYLES[customer.status];

  return (
    <Link
      href={`/customers/${customer.id}`}
      className="border-border bg-card hover:border-foreground/20 focus-visible:ring-ring block rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <Avatar
          size="md"
          src={customer.photoThumbnailUrl ?? customer.photoUrl}
          name={customer.name}
          seed={customer.id}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-foreground truncate font-medium">{customer.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {customer.code}
                {customer.phone ? ` · ${customer.phone}` : ""}
              </p>
            </div>
            <CreditScoreCell score={customer.creditScore} />
          </div>

          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <p className="text-muted-foreground text-[11px] tracking-wide uppercase">
                Outstanding
              </p>
              <p className="tabular text-foreground text-base font-semibold">
                {format(customer.outstandingBalance)}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Badge className={style.className} size="sm" dot>
                {style.label}
              </Badge>
              {customer.overdueCount > 0 ? (
                <Badge variant="destructive" size="sm">
                  {customer.overdueCount} overdue
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
