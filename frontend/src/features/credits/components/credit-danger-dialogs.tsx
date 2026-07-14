"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Button, ConfirmDialog, Dialog, FormField, Textarea } from "@/components/ui";
import { useCancelCredit, useDeleteCredit } from "@/features/credits/hooks/use-credit-mutations";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { toCents } from "@/features/credits/lib/money";
import type { CreditListRow } from "@/features/credits/queries";

export interface CancelCreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: CreditListRow | null;
  onCancelled?: () => void;
}

/**
 * Cancelling is sticky and the server refuses it once money has changed hands —
 * void the payments first. We say that up front rather than letting the user find
 * out from a red toast.
 *
 * The reason is optional here (the server allows null) but strongly encouraged: a
 * cancelled credit with no explanation is an argument waiting to happen.
 */
export function CancelCreditDialog({
  open,
  onOpenChange,
  credit,
  onCancelled,
}: CancelCreditDialogProps) {
  const money = useMoney();
  const cancelCredit = useCancelCredit();
  const [reason, setReason] = useState("");
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  // Compare in integer cents — "0.00", "0" and "0.0" are all the same zero, and a
  // string compare would call two of them "money has been paid".
  const hasPayments = credit ? toCents(credit.amountPaid) > BigInt(0) : false;

  const submit = async () => {
    if (!credit) return;
    try {
      await cancelCredit.mutateAsync({ id: credit.id, reason });
      onOpenChange(false);
      onCancelled?.();
    } catch {
      /* the mutation toasts the server's message */
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      dismissOnOverlayClick={false}
      initialFocusRef={keepRef}
      title="Cancel this credit"
      description={credit ? `${credit.number} · ${credit.customer?.name ?? ""}` : undefined}
      footer={
        <>
          <Button
            ref={keepRef}
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cancelCredit.isPending}
          >
            Keep it
          </Button>
          <Button
            variant="destructive"
            isLoading={cancelCredit.isPending}
            loadingText="Cancelling…"
            disabled={hasPayments}
            onClick={() => void submit()}
          >
            Cancel credit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {hasPayments ? (
          <Alert variant="destructive" title="Money has already changed hands">
            {money.format(credit?.amountPaid ?? "0")} has been paid against this credit. Void
            those payments first — the ledger has to survive the cancellation.
          </Alert>
        ) : (
          <Alert variant="warning" title="This cannot be undone">
            A cancelled credit stays on the books, marked cancelled. It stops accruing and
            stops chasing the customer.
          </Alert>
        )}

        <FormField
          label="Reason"
          description="Optional, but the person reading this in six months will thank you."
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Goods returned; written in error"
            disabled={hasPayments}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

export interface DeleteCreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: CreditListRow | null;
  onDeleted?: () => void;
}

/**
 * Delete is for a credit that should never have existed. The server refuses it the
 * moment a payment exists — cancel it instead, so the ledger survives.
 */
export function DeleteCreditDialog({
  open,
  onOpenChange,
  credit,
  onDeleted,
}: DeleteCreditDialogProps) {
  const deleteCredit = useDeleteCredit();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title="Delete this credit?"
      description={
        credit
          ? `${credit.number} will be removed for good. If any payment has been recorded against it, the server will refuse — cancel it instead, so the ledger survives.`
          : undefined
      }
      confirmLabel="Delete"
      cancelLabel="Keep it"
      isLoading={deleteCredit.isPending}
      onConfirm={async () => {
        if (!credit) return;
        try {
          await deleteCredit.mutateAsync(credit.id);
          onOpenChange(false);
          onDeleted?.();
        } catch {
          /* the mutation toasts the server's message */
        }
      }}
    />
  );
}
