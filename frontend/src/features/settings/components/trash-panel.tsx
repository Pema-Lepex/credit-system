"use client";

/**
 * The Trash screen: two tables (deleted credits, deleted payments), each row
 * offering Restore and Permanently delete.
 *
 * The distinction the UI must make unmistakable:
 *   • Restore            — reversible; puts the record back in the active lists.
 *   • Permanently delete — final; the row is gone for good. Guarded by a
 *                          destructive confirm dialog, never a one-click button.
 *
 * Restoring a PAYMENT can legitimately fail: if a replacement payment was
 * recorded while this one sat here, putting it back would overpay the credit.
 * The backend refuses with a ConflictError; we surface that message rather than
 * swallow it.
 */

import { RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Pagination,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import { CreditStatusBadge } from "@/features/credits/components/status-badges";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import {
  useDeletedCredits,
  useDeletedPayments,
  usePermanentlyDeleteCredit,
  usePermanentlyDeletePayment,
  useRestoreCredit,
  useRestorePayment,
  type DeletedCreditRow,
  type DeletedPaymentRow,
} from "@/features/settings/api/trash";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { PAYMENT_METHOD_LABELS } from "@/lib/utils";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof GraphQLRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function TrashPanel() {
  return (
    <div className="space-y-6">
      <DeletedCreditsCard />
      <DeletedPaymentsCard />
    </div>
  );
}

// ===========================================================================
// Credits
// ===========================================================================
function DeletedCreditsCard() {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDeletedCredits(page);

  const restore = useRestoreCredit();
  const purge = usePermanentlyDeleteCredit();

  // Rows queued for a confirm dialog. Restore is safe, so it does not use one.
  const [purging, setPurging] = useState<DeletedCreditRow | null>(null);

  const onRestore = (row: DeletedCreditRow) => {
    restore.mutate(row.id, {
      onSuccess: (credit) =>
        toast.success(`Credit ${credit.number} restored.`, {
          description: "It is back in your active credits list.",
        }),
      onError: (error) => toast.error(errorMessage(error, "Could not restore that credit.")),
    });
  };

  const onPurge = () => {
    if (!purging) return;
    purge.mutate(purging.id, {
      onSuccess: (result) => {
        toast.success(result.message);
        setPurging(null);
      },
      onError: (error) => toast.error(errorMessage(error, "Could not delete that credit.")),
    });
  };

  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deleted credits</CardTitle>
        <CardDescription>
          Credits removed from your operations list. Restore one to bring it back, or delete it
          permanently to remove it for good. Permanent deletion cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonTable rows={4} columns={5} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Trash2 />}
            title="Nothing here"
            description="Deleted credits will appear here, where you can restore them or delete them permanently."
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credit</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Remaining</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.number}</TableCell>
                      <TableCell>{row.customer?.name ?? "—"}</TableCell>
                      <TableCell>
                        <CreditStatusBadge status={row.status} size="sm" />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money.format(row.remainingAmount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRestore(row)}
                            disabled={restore.isPending || purge.isPending}
                          >
                            <RotateCcw className="size-4" aria-hidden="true" />
                            Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setPurging(row)}
                            disabled={restore.isPending || purge.isPending}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pagination
              page={page}
              pageSize={10}
              totalItems={data?.pageInfo.total ?? 0}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={purging !== null}
        onOpenChange={() => setPurging(null)}
        title="Permanently delete this credit?"
        description={
          <>
            Credit <strong>{purging?.number}</strong> and its items and payment history will be
            erased for good. This cannot be undone. To keep it, restore it instead.
          </>
        }
        confirmLabel="Delete permanently"
        destructive
        isLoading={purge.isPending}
        onConfirm={onPurge}
      />
    </Card>
  );
}

// ===========================================================================
// Payments
// ===========================================================================
function DeletedPaymentsCard() {
  const money = useMoney();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDeletedPayments(page);

  const restore = useRestorePayment();
  const purge = usePermanentlyDeletePayment();

  const [purging, setPurging] = useState<DeletedPaymentRow | null>(null);

  const onRestore = (row: DeletedPaymentRow) => {
    restore.mutate(row.id, {
      onSuccess: (payment) =>
        toast.success(`Payment ${payment.number} restored.`, {
          description: "It has been reapplied to its credit's balance.",
        }),
      // A restore can be refused if it would overpay the credit — surface why.
      onError: (error) => toast.error(errorMessage(error, "Could not restore that payment.")),
    });
  };

  const onPurge = () => {
    if (!purging) return;
    purge.mutate(purging.id, {
      onSuccess: (result) => {
        toast.success(result.message);
        setPurging(null);
      },
      onError: (error) => toast.error(errorMessage(error, "Could not delete that payment.")),
    });
  };

  const items = data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deleted payments</CardTitle>
        <CardDescription>
          Payments removed from a credit. While a payment sits here its amount is off the credit&apos;s
          balance; restoring it puts the amount back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonTable rows={4} columns={5} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Trash2 />}
            title="Nothing here"
            description="Deleted payments will appear here, where you can restore them or delete them permanently."
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Credit</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.number}</TableCell>
                      <TableCell>{row.creditNumber ?? "—"}</TableCell>
                      <TableCell>{row.customerName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="neutral" size="sm">
                          {PAYMENT_METHOD_LABELS[row.method]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money.format(row.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onRestore(row)}
                            disabled={restore.isPending || purge.isPending}
                          >
                            <RotateCcw className="size-4" aria-hidden="true" />
                            Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setPurging(row)}
                            disabled={restore.isPending || purge.isPending}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Pagination
              page={page}
              pageSize={10}
              totalItems={data?.pageInfo.total ?? 0}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={purging !== null}
        onOpenChange={() => setPurging(null)}
        title="Permanently delete this payment?"
        description={
          <>
            Payment <strong>{purging?.number}</strong> of{" "}
            <strong>{purging ? money.format(purging.amount) : ""}</strong> will be erased for good.
            This cannot be undone, and the credit&apos;s balance will not change (the amount already
            came off when it was deleted). To keep it, restore it instead.
          </>
        }
        confirmLabel="Delete permanently"
        destructive
        isLoading={purge.isPending}
        onConfirm={onPurge}
      />
    </Card>
  );
}
