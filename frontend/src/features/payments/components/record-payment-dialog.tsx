"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  Alert,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { AttachmentUploader } from "@/features/credits/components/attachment-uploader";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { parseApiError, toFormFieldName } from "@/features/credits/lib/errors";
import { moneyExceeds } from "@/features/credits/lib/money";
import type { UploadedFile } from "@/features/credits/lib/rest";
import { ProviderField } from "@/features/payments/components/provider-field";
import { useRecordPayment } from "@/features/payments/hooks/use-payments";
import { joinProvider } from "@/features/payments/lib/providers";
import { PAYMENT_METHOD_LABELS } from "@/lib/utils";
import { PAYMENT_METHODS, type ID, type Money, type PaymentMethod } from "@/types";

/** The credit being paid — the caller has this already, so we never re-fetch it. */
export interface PayableCredit {
  id: ID;
  number: string;
  remainingAmount: Money;
  customerName?: string | null;
}

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

const schema = z.object({
  // A string, all the way down. Parsing it to a number here would be the one place
  // a float could sneak into the money path.
  amount: z
    .string()
    .min(1, "Enter an amount")
    .regex(MONEY_PATTERN, "Use a number with at most two decimal places"),
  method: z.enum(PAYMENT_METHODS),
  provider: z.string(),
  providerOther: z.string().max(120),
  paidAt: z.string().min(1, "Pick a date"),
  reference: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credit: PayableCredit | null;
  onRecorded?: () => void;
}

/**
 * The dialog the shopkeeper opens most.
 *
 * The amount is PRE-FILLED WITH THE REMAINING BALANCE, because the overwhelmingly
 * common case is a customer settling up. Typing the number they were just told is
 * busywork, and a mistyped one is an overpayment the server will refuse.
 *
 * OVERPAYMENT: the server refuses it with a CONFLICT whose message names the exact
 * amount that would settle the credit. We put that message on the amount field —
 * where the user is already looking — and never swallow it into a generic "failed".
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  credit,
  onRecorded,
}: RecordPaymentDialogProps) {
  const money = useMoney();
  const recordPayment = useRecordPayment();
  const [receipt, setReceipt] = useState<UploadedFile[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: credit?.remainingAmount ?? "",
      method: "CASH",
      provider: "",
      providerOther: "",
      paidAt: todayISO(),
      reference: "",
      notes: "",
    },
  });

  const { reset, setError, handleSubmit, register, formState, watch, setValue } = form;

  // Re-seed whenever a DIFFERENT credit is opened. Without this the dialog would
  // still be holding the previous customer's balance.
  useEffect(() => {
    if (!open || !credit) return;
    reset({
      amount: credit.remainingAmount,
      method: "CASH",
      provider: "",
      providerOther: "",
      paidAt: todayISO(),
      reference: "",
      notes: "",
    });
    setReceipt([]);
    setFormError(null);
  }, [open, credit, reset]);

  const amount = watch("amount");
  const method = watch("method");
  // A local guard, not the authority. The server is the authority and will refuse
  // an overpayment regardless — this just says so before the round trip.
  const wouldOverpay =
    Boolean(credit) &&
    MONEY_PATTERN.test(amount ?? "") &&
    moneyExceeds(amount, credit!.remainingAmount);

  const onSubmit = handleSubmit(async (values) => {
    if (!credit) return;
    setFormError(null);

    try {
      await recordPayment.mutateAsync({
        creditId: credit.id,
        amount: values.amount,
        method: values.method as PaymentMethod,
        provider: joinProvider(values.provider, values.providerOther),
        paidAt: values.paidAt,
        reference: values.reference?.trim() || null,
        notes: values.notes?.trim() || null,
        receiptFileId: receipt[0]?.id ?? null,
      });
      onOpenChange(false);
      onRecorded?.();
    } catch (error) {
      const parsed = parseApiError(error);

      // An overpayment is a CONFLICT, not a VALIDATION_ERROR, and it carries no
      // `field` — but it is unambiguously about the amount, so that is where it goes.
      const target = parsed.isConflict
        ? "amount"
        : (toFormFieldName(parsed.field) as keyof FormValues | null);

      if (target && target in schema.shape) {
        setError(target as keyof FormValues, { type: "server", message: parsed.message });
      } else {
        setFormError(parsed.message);
      }
    }
  });

  const settleHint = credit ? `${money.format(credit.remainingAmount)} outstanding` : "";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Record a payment"
      description={
        credit
          ? `${credit.number}${credit.customerName ? ` · ${credit.customerName}` : ""} — ${settleHint}`
          : undefined
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="record-payment-form"
            isLoading={recordPayment.isPending}
            loadingText="Recording…"
          >
            Record payment
          </Button>
        </>
      }
    >
      <form id="record-payment-form" onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {formError ? (
          <Alert variant="destructive" title="Could not record the payment">
            {formError}
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Amount"
            required
            error={formState.errors.amount?.message}
            description={
              wouldOverpay
                ? undefined
                : `Pre-filled to settle the credit in full (${settleHint}).`
            }
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="tabular"
              {...register("amount")}
            />
          </FormField>

          <FormField label="Method" required error={formState.errors.method?.message}>
            <Select
              options={PAYMENT_METHODS.map((method) => ({
                value: method,
                label: PAYMENT_METHOD_LABELS[method],
              }))}
              {...register("method")}
            />
          </FormField>
        </div>

        <ProviderField
          method={method}
          choice={watch("provider")}
          custom={watch("providerOther")}
          onChoiceChange={(value) => setValue("provider", value)}
          onCustomChange={(value) => setValue("providerOther", value)}
        />

        {wouldOverpay ? (
          <Alert variant="warning" title="More than is owed">
            {credit
              ? `Only ${money.format(credit.remainingAmount)} is outstanding. The server will refuse anything above that — record ${money.format(credit.remainingAmount)} to settle it in full.`
              : null}
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Date paid" required error={formState.errors.paidAt?.message}>
            <Input type="date" max={todayISO()} {...register("paidAt")} />
          </FormField>

          <FormField
            label="Reference"
            error={formState.errors.reference?.message}
            description="Cheque number, transfer ref — whatever proves it."
          >
            <Input autoComplete="off" placeholder="Optional" {...register("reference")} />
          </FormField>
        </div>

        <FormField label="Notes" error={formState.errors.notes?.message}>
          <Textarea rows={2} placeholder="Optional" {...register("notes")} />
        </FormField>

        <AttachmentUploader
          label="Receipt"
          description="A photo of the slip, if you have one."
          kind="RECEIPT"
          value={receipt}
          onChange={setReceipt}
          maxFiles={1}
        />
      </form>
    </Dialog>
  );
}
