"use client";

/**
 * Quick add — record a purchase at the counter, in under five seconds.
 *
 * THE INTERACTION BUDGET IS THE DESIGN.
 *
 * A customer is standing there and the shopkeeper has one hand free. Everything the
 * full credit form asks for that is missing here is a question with no answer at a
 * counter: due date (a purchase is not an invoice — the month-end statement carries
 * the obligation), tax, discount, attachments, itemisation.
 *
 * What's left is: how much, and optionally what. Amount is autofocused with a
 * numeric keypad; the description is optional because forcing a shopkeeper mid-queue
 * to type "Cigarettes" is how you end up with a shopkeeper who uses paper.
 *
 * Server-side it is `quickSale`, which delegates to the same CreditService.create
 * the full form uses — so the ledger, the aggregates, the score and the audit trail
 * are identical. A shorter question, not a second write path.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button, Dialog, FormField, Input, toast } from "@/components/ui";
import { useQuickSale } from "@/features/ledger/api";
import { parseApiError } from "@/features/credits/lib/errors";
import { useCurrency } from "@/features/common/use-currency";
import type { ID, Money } from "@/types";

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

const schema = z.object({
  amount: z
    .string()
    .trim()
    .min(1, "How much did they take?")
    .refine((v) => MONEY.test(v), "Write it like 30 or 30.50")
    .refine((v) => Number(v) > 0, "It has to be more than zero"),
  description: z.string().trim().max(200).optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: ID;
  customerName: string;
  balance: Money;
}

export function QuickSaleDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  balance,
}: Props) {
  const currency = useCurrency();
  const quickSale = useQuickSale();
  const amountRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: "", description: "" },
  });

  useEffect(() => {
    if (open) form.reset({ amount: "", description: "" });
  }, [open, form]);

  const entered = Number(form.watch("amount") || 0);

  const submit = form.handleSubmit((values) => {
    quickSale.mutate(
      {
        customerId,
        amount: values.amount,
        description: values.description || null,
      },
      {
        onSuccess: (credit) => {
          // Deliberately does not quote the new balance: the mutation returns the
          // CREDIT, not the customer, and the balance card behind this dialog is
          // already refetching. Inventing a number here to fill the sentence is how
          // a UI ends up confidently showing a stale one.
          toast.success(`${currency.format(credit.grandTotal)} added to ${customerName}'s account`);
          onOpenChange(false);
        },
        onError: (error) =>
          toast.error("Could not add the sale", {
            description: parseApiError(error).message,
          }),
      },
    );
  });

  const { ref: amountFieldRef, ...amountField } = form.register("amount");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add a sale for ${customerName}`}
      description={`They currently owe ${currency.format(String(Math.max(0, Number(balance))))}.`}
      size="sm"
      initialFocusRef={amountRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button leftIcon={<Zap />} isLoading={quickSale.isPending} onClick={() => void submit()}>
            Add {entered > 0 ? currency.format(form.watch("amount")) : "sale"}
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
            {...amountField}
            ref={(node) => {
              amountFieldRef(node);
              amountRef.current = node;
            }}
            // inputMode=decimal: a phone keypad, not a full keyboard. This is the
            // single most-used control in the product.
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
          />
        </FormField>

        <FormField
          label="What was it?"
          description="Optional — skip it if you are busy."
          error={form.formState.errors.description?.message}
        >
          <Input
            {...form.register("description")}
            placeholder="Cigarettes"
            autoComplete="off"
          />
        </FormField>
      </form>
    </Dialog>
  );
}
