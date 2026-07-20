"use client";

import { Plus, ReceiptText, RefreshCw, SearchX } from "lucide-react";
import { useState } from "react";

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
import { ExpenseFormDialog } from "@/features/expenses/components/expense-form-dialog";
import { ExpensesFilters } from "@/features/expenses/components/expenses-filters";
import { ExpensesTable } from "@/features/expenses/components/expenses-table";
import { useDeleteExpense, useExpenseList } from "@/features/expenses/hooks/use-expenses";
import {
  DEFAULT_PAGE_SIZE,
  countActiveExpenseFilters,
} from "@/features/expenses/lib/filters";
import type { ExpenseRow } from "@/features/expenses/queries";
import { useAuth } from "@/lib/auth/AuthProvider";
import { formatDate } from "@/lib/utils";

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function ExpensesView() {
  const { state, update, reset, query } = useExpenseList();

  const money = useMoney();
  const { hasPermission } = useAuth();
  const deleteExpense = useDeleteExpense();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExpenseRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);

  const canWrite = hasPermission("expense:write");
  const page = query.data;
  const activeFilters = countActiveExpenseFilters(state);

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  const openEdit = (expense: ExpenseRow) => {
    setEditTarget(expense);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Money going out of the business — rent, stock, fuel, wages. Recording an expense never changes what your customers owe you."
        actions={
          canWrite ? (
            <Button leftIcon={<Plus />} onClick={openCreate}>
              Record expense
            </Button>
          ) : null
        }
      />

      <ExpensesFilters state={state} onChange={update} onReset={reset} />

      {query.isError ? (
        <Alert variant="destructive" title="Could not load your expenses">
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
                title="No expense matches these filters"
                description="Nothing fits what you asked for. Try widening the dates, or clear the filters."
                action={
                  <Button variant="outline" onClick={reset}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ReceiptText />}
                title="No expenses yet"
                description="Record what the business spends — rent, stock, fuel, wages — and your profit report starts working straight away."
                action={
                  canWrite ? (
                    <Button leftIcon={<Plus />} onClick={openCreate}>
                      Record your first expense
                    </Button>
                  ) : null
                }
              />
            )}
          </CardContent>
        </Card>
      ) : page ? (
        <div className="space-y-4">
          <ExpensesTable
            expenses={page.items}
            sortField={state.sortField}
            sortDesc={state.sortDesc}
            onSortChange={(sortField, sortDesc) => update({ sortField, sortDesc })}
            onEdit={openEdit}
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

      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        expense={editTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this expense?"
        description={
          deleteTarget ? (
            <>
              The <strong>{money.format(deleteTarget.amount)}</strong> expense from{" "}
              <strong>{formatDate(deleteTarget.expenseDate)}</strong> will move to the Trash. Your
              profit and expense reports will stop counting it. Nothing is permanently removed
              here.
            </>
          ) : null
        }
        confirmLabel="Move to Trash"
        destructive
        isLoading={deleteExpense.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteExpense.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
