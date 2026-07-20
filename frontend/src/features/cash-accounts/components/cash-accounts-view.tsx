"use client";

import { ArrowDownRight, ArrowUpRight, Pencil, Plus, RefreshCw, Trash2, Wallet } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { CashAccountFormDialog } from "@/features/cash-accounts/components/cash-account-form-dialog";
import { useCashAccounts, useDeleteCashAccount } from "@/features/cash-accounts/hooks";
import type { CashAccountRow } from "@/features/cash-accounts/queries";
import { parseApiError } from "@/features/credits/lib/errors";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn, toNumber } from "@/lib/utils";

export function CashAccountsView() {
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CashAccountRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CashAccountRow | null>(null);

  const money = useMoney();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("cash_account:manage");

  const query = useCashAccounts();
  const deleteAccount = useDeleteCashAccount();
  const accounts = query.data;

  const openCreate = () => {
    setEditTarget(null);
    setFormOpen(true);
  };

  // The headline figure: everything the business is holding, everywhere.
  const total = (accounts ?? []).reduce((sum, a) => sum + toNumber(a.balance), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash &amp; bank"
        description="Where your money sits. Balances update themselves from the payments you take in and the expenses you pay out."
        actions={
          canManage ? (
            <Button leftIcon={<Plus />} onClick={openCreate}>
              Add account
            </Button>
          ) : null
        }
      />

      {query.isError ? (
        <Alert variant="destructive" title="Could not load your accounts">
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : accounts && accounts.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<Wallet />}
              title="No accounts yet"
              description="Add the places your money sits — the cash drawer, your bank, a mobile wallet — and every payment and expense can be traced back to one."
              action={
                canManage ? (
                  <Button leftIcon={<Plus />} onClick={openCreate}>
                    Add your first account
                  </Button>
                ) : null
              }
            />
          </CardContent>
        </Card>
      ) : accounts ? (
        <div className={cn("space-y-6", query.isFetching && "opacity-70 transition-opacity")}>
          <Card>
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-sm">Total across all accounts</p>
              <p className="text-foreground mt-1 text-3xl font-semibold tabular">
                {money.format(String(total))}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => {
              const isNegative = toNumber(account.balance) < 0;
              return (
                <Card key={account.id}>
                  <CardContent className="space-y-4 pt-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-foreground truncate font-medium">{account.name}</p>
                        {account.description ? (
                          <p className="text-muted-foreground mt-0.5 line-clamp-1 text-xs">
                            {account.description}
                          </p>
                        ) : null}
                      </div>
                      <Wallet aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
                    </div>

                    <div>
                      <p className="text-muted-foreground text-xs">Balance now</p>
                      <p
                        className={cn(
                          "mt-0.5 text-2xl font-semibold tabular",
                          isNegative ? "text-destructive" : "text-foreground",
                        )}
                      >
                        {money.format(account.balance)}
                      </p>
                    </div>

                    <dl className="text-muted-foreground grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="flex items-center gap-1">
                          <ArrowUpRight aria-hidden="true" className="size-3" />
                          In
                        </dt>
                        <dd className="text-foreground mt-0.5 tabular">
                          {money.format(account.moneyIn)}
                        </dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-1">
                          <ArrowDownRight aria-hidden="true" className="size-3" />
                          Out
                        </dt>
                        <dd className="text-foreground mt-0.5 tabular">
                          {money.format(account.moneyOut)}
                        </dd>
                      </div>
                    </dl>

                    <p className="text-muted-foreground text-xs">
                      Started at {money.format(account.openingBalance)}
                    </p>

                    {canManage ? (
                      <div className="flex gap-3 border-t border-border pt-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditTarget(account);
                            setFormOpen(true);
                          }}
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(account)}
                          className="text-destructive-soft-foreground ml-auto inline-flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Trash2 aria-hidden="true" className="size-3.5" />
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      <CashAccountFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditTarget(null);
        }}
        account={editTarget}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove this account?"
        description={
          deleteTarget ? (
            <>
              <strong>{deleteTarget.name}</strong> will be removed. Every payment and expense you
              recorded against it is kept exactly as it is — they simply stop being assigned to an
              account. Nothing is deleted and no totals change.
            </>
          ) : null
        }
        confirmLabel="Remove account"
        destructive
        isLoading={deleteAccount.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteAccount.mutateAsync(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
