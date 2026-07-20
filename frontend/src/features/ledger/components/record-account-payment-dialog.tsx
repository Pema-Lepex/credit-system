"use client";

/**
 * Record a payment against the customer's ACCOUNT.
 *
 * WHAT IS NOT IN THIS DIALOG, AND WHY THAT MATTERS
 * ------------------------------------------------
 * There is no credit picker and no allocation grid. The shopkeeper is never asked
 * which of 400 purchases the money is for, because that question has no answer —
 * the customer paid down a balance. Server-side this is one ledger entry regardless
 * of how much history sits behind it (see PaymentService.record_to_account).
 *
 * The amount DEFAULTS TO THE FULL BALANCE, because salary day is the common case:
 * open, confirm, done. Editing it down is the exception and costs one edit.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
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
  toast,
} from "@/components/ui";
import { useRecordAccountPayment } from "@/features/ledger/api";
import { parseApiError } from "@/features/credits/lib/errors";
import { useCurrency } from "@/features/common/use-currency";
import { ProviderField } from "@/features/payments/components/provider-field";
import { joinProvider } from "@/features/payments/lib/providers";
import { PAYMENT_METHOD_LABELS } from "@/lib/utils";
import { PAYMENT_METHODS, type ID, type Money } from "@/types";

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const schema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "Enter how much they paid")
    .refine((v) => MONEY.test(v), "Write it like 450 or 450.50")
    .refine((v) => Number(v) > 0, "A payment has to be more than zero"),
  method: z.enum(PAYMENT_METHODS),
  provider: z.string(),
  providerOther: z.string().max(120),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: ID;
  customerName: string;
  balance: Money;
}

export function RecordAccountPaymentDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  balance,
}: Props) {
  const currency = useCurrency();
  const record = useRecordAccountPayment();
  const owed = Math.max(0, Number(balance));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: owed > 0 ? owed.toFixed(2) : "",
      method: "CASH",
      provider: "",
      providerOther: "",
    },
  });

  // Re-seed on open: the balance moves between openings, and a stale default would
  // quietly under-settle the account.
  useEffect(() => {
    if (open) {
      form.reset({
        amount: owed > 0 ? owed.toFixed(2) : "",
        method: "CASH",
        provider: "",
        providerOther: "",
      });
    }
  }, [open, owed, form]);

  const entered = Number(form.watch("amount") || 0);
  const remaining = owed - entered;

  const submit = form.handleSubmit((values) => {
    record.mutate(
      {
        customerId,
        amount: values.amount,
        method: values.method,
        provider: joinProvider(values.provider, values.providerOther),
        reference: values.reference || null,
        notes: values.notes || null,
      },
      {
        onSuccess: (payment) => {
          toast.success(`Payment recorded — ${payment.number}`, {
            description: `${customerName}'s balance is now ${currency.format(payment.balanceAfter)}.`,
          });
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error("Could not record the payment", {
            description: parseApiError(error).message,
          }),
      },
    );
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record payment"
      description={`${customerName} owes ${currency.format(String(owed))}. This pays down their balance — you do not have to say which purchase it is for.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button isLoading={record.isPending} onClick={() => void submit()}>
            Record payment
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField label="Amount" error={form.formState.errors.amount?.message} required>
          <Input
            {...form.register("amount")}
            inputMode="decimal"
            autoFocus
            placeholder="0.00"
          />
        </FormField>

        {/* The consequence, before they commit to it. A shopkeeper should never have
            to do this arithmetic in their head at the counter. */}
        {entered > 0 && (
          <Alert variant={remaining < 0 ? "warning" : "neutral"}>
            {remaining > 0 ? (
              <>
                {customerName} will still owe{" "}
                <strong>{currency.format(remaining.toFixed(2))}</strong>.
              </>
            ) : remaining === 0 ? (
              <>
                This settles their account <strong>in full</strong>.
              </>
            ) : (
              <>
                This is <strong>{currency.format(Math.abs(remaining).toFixed(2))}</strong> more
                than they owe. The extra is kept as an advance against future purchases.
              </>
            )}
          </Alert>
        )}

        <FormField label="Method" error={form.formState.errors.method?.message}>
          <Select
            {...form.register("method")}
            options={PAYMENT_METHODS.map((method) => ({
              value: method,
              label: PAYMENT_METHOD_LABELS[method],
            }))}
          />
        </FormField>

        <ProviderField
          method={form.watch("method")}
          choice={form.watch("provider")}
          custom={form.watch("providerOther")}
          onChoiceChange={(value) => form.setValue("provider", value)}
          onCustomChange={(value) => form.setValue("providerOther", value)}
        />

        <FormField
          label="Reference"
          description="A transfer number, a cheque number — anything you might need to look up later."
          error={form.formState.errors.reference?.message}
        >
          <Input {...form.register("reference")} placeholder="e.g. July salary" />
        </FormField>

        <FormField label="Notes" error={form.formState.errors.notes?.message}>
          <Textarea {...form.register("notes")} rows={2} />
        </FormField>
      </form>
    </Dialog>
  );
}
