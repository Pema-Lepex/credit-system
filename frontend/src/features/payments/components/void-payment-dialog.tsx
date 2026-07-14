"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Button, Dialog, FormField, Textarea } from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { useVoidPayment } from "@/features/payments/hooks/use-payments";
import type { PaymentRow } from "@/features/payments/queries";
import { formatDate } from "@/lib/format";

export interface VoidPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Pick<PaymentRow, "id" | "number" | "amount" | "paidAt"> | null;
  onVoided?: () => void;
}

/**
 * Void, not delete.
 *
 * The ledger is append-only: a voided payment stays on the record, struck through,
 * with the reason attached. That is the whole mechanism by which a shopkeeper can
 * later prove what happened — a deleted row proves nothing.
 *
 * The reason is REQUIRED by the server. We require it here too, and say why, so the
 * user understands they are writing something permanent rather than filling in a box.
 */
export function VoidPaymentDialog({
  open,
  onOpenChange,
  payment,
  onVoided,
}: VoidPaymentDialogProps) {
  const money = useMoney();
  const voidPayment = useVoidPayment();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setTouched(false);
  }, [open]);

  const trimmed = reason.trim();
  const error = touched && trimmed.length === 0 ? "A reason is required." : undefined;

  const submit = async () => {
    setTouched(true);
    if (!payment || trimmed.length === 0) return;

    try {
      await voidPayment.mutateAsync({ id: payment.id, reason: trimmed });
      onOpenChange(false);
      onVoided?.();
    } catch {
      /* the mutation's onError already toasted the server's message */
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      // Destructive: a stray backdrop click must not start this.
      dismissOnOverlayClick={false}
      initialFocusRef={cancelRef}
      title="Void this payment"
      description={
        payment
          ? `${payment.number} · ${money.format(payment.amount)} · ${formatDate(payment.paidAt)}`
          : undefined
      }
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={voidPayment.isPending}
          >
            Keep it
          </Button>
          <Button
            variant="destructive"
            isLoading={voidPayment.isPending}
            loadingText="Voiding…"
            onClick={() => void submit()}
          >
            Void payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert variant="warning" title="This stays on the record">
          The payment is not deleted. It stays on the ledger, struck through, with your reason
          attached — and the customer&apos;s balance goes back up by{" "}
          {payment ? money.format(payment.amount) : "the amount"}.
        </Alert>

        <FormField
          label="Reason"
          required
          error={error}
          description="Written into the permanent record. Be specific — future-you is the reader."
        >
          <Textarea
            rows={3}
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="e.g. Cheque bounced; recorded against the wrong credit"
          />
        </FormField>
      </div>
    </Dialog>
  );
}
