"use client";

import { Ban, Download, Receipt } from "lucide-react";
import { useState } from "react";

import { Badge, Button, EmptyState, toast } from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { parseApiError } from "@/features/credits/lib/errors";
import { downloadReceiptPdf } from "@/features/credits/lib/rest";
import type { CreditPaymentRow } from "@/features/credits/queries";
import { VoidPaymentDialog } from "@/features/payments/components/void-payment-dialog";
import { useAuth } from "@/lib/auth/AuthProvider";
import { PAYMENT_METHOD_LABELS, cn, formatDateTime } from "@/lib/utils";

/**
 * The payment ledger for one credit — VOIDS INCLUDED, STRUCK THROUGH.
 *
 * Hiding a voided payment would defeat the entire point of voiding instead of
 * deleting. The record exists so that six months from now, when the customer says
 * "I paid you in March", the answer is "you did, and here it is, and here is why it
 * was reversed — the cheque bounced". A vanished row cannot say that.
 *
 * So a void renders: the original amount struck through, a "Voided" chip, and the
 * reason in full. It is the most important thing on this page.
 */
export function PaymentTimeline({
  payments,
  isLoading,
}: {
  payments: CreditPaymentRow[];
  isLoading?: boolean;
}) {
  const money = useMoney();
  const { hasPermission } = useAuth();
  const [voidTarget, setVoidTarget] = useState<CreditPaymentRow | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const canVoid = hasPermission("payment:delete");

  const download = async (payment: CreditPaymentRow) => {
    setDownloading(payment.id);
    try {
      await downloadReceiptPdf(payment.id, payment.number);
    } catch (error) {
      toast.error("Could not download the receipt", {
        description: parseApiError(error).message,
      });
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading) {
    return (
      <ul className="space-y-4" aria-busy="true">
        {Array.from({ length: 2 }).map((_, index) => (
          <li key={index} className="bg-muted h-16 animate-pulse rounded-lg" />
        ))}
      </ul>
    );
  }

  if (payments.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<Receipt />}
        title="Nothing paid yet"
        description="Payments appear here as a running ledger, newest first."
      />
    );
  }

  const ordered = [...payments].sort(
    (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime(),
  );

  return (
    <>
      <ol className="relative space-y-1">
        {ordered.map((payment, index) => {
          const isLast = index === ordered.length - 1;

          return (
            <li key={payment.id} className="relative flex gap-4 pb-4 last:pb-0">
              {/* The rail. Decorative — the list order carries the meaning. */}
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className="bg-border absolute top-9 bottom-0 left-[15px] w-px"
                />
              ) : null}

              <span
                aria-hidden="true"
                className={cn(
                  "z-10 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
                  payment.isVoid
                    ? "bg-muted text-muted-foreground"
                    : "bg-success-soft text-success-soft-foreground",
                )}
              >
                {payment.isVoid ? <Ban /> : <Receipt />}
              </span>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "tabular text-sm font-semibold",
                        payment.isVoid
                          ? "text-muted-foreground line-through decoration-2"
                          : "text-foreground",
                      )}
                    >
                      {money.format(payment.amount)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {PAYMENT_METHOD_LABELS[payment.method]}
                    </span>
                    {payment.isVoid ? (
                      <Badge size="sm" variant="destructive">
                        Voided
                      </Badge>
                    ) : null}
                  </p>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Download receipt ${payment.number}`}
                      disabled={downloading === payment.id}
                      onClick={() => void download(payment)}
                    >
                      <Download />
                    </Button>

                    {canVoid && !payment.isVoid ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setVoidTarget(payment)}
                        className="text-destructive-soft-foreground hover:bg-destructive-soft"
                      >
                        Void
                      </Button>
                    ) : null}
                  </div>
                </div>

                <p className="text-muted-foreground text-xs tabular">
                  {payment.number} · {formatDateTime(payment.paidAt)}
                  {payment.reference ? ` · Ref ${payment.reference}` : ""}
                  {!payment.isVoid
                    ? ` · balance after ${money.format(payment.balanceAfter)}`
                    : ""}
                </p>

                {payment.notes ? (
                  <p className="text-muted-foreground text-xs">{payment.notes}</p>
                ) : null}

                {payment.isVoid ? (
                  <p className="border-destructive-soft-foreground/30 text-destructive-soft-foreground border-l-2 py-0.5 pl-3 text-xs">
                    <span className="font-medium">Voided</span>
                    {payment.voidedAt ? ` on ${formatDateTime(payment.voidedAt)}` : ""}
                    {payment.voidReason ? ` — ${payment.voidReason}` : " — no reason recorded"}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <VoidPaymentDialog
        open={voidTarget !== null}
        onOpenChange={(open) => !open && setVoidTarget(null)}
        payment={voidTarget}
      />
    </>
  );
}
