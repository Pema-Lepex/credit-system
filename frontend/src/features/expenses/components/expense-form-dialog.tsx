"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, Button, Dialog, FormField, Input, Select, Textarea } from "@/components/ui";
import { useCashAccounts } from "@/features/cash-accounts/hooks";
import { AttachmentUploader } from "@/features/credits/components/attachment-uploader";
import { useVendors } from "@/features/vendors/hooks";
import { parseApiError, toFormFieldName } from "@/features/credits/lib/errors";
import type { UploadedFile } from "@/features/credits/lib/rest";
import {
  useCreateExpense,
  useExpenseCategories,
  useUpdateExpense,
} from "@/features/expenses/hooks/use-expenses";
import type { ExpenseRow } from "@/features/expenses/queries";
import { ProviderField } from "@/features/payments/components/provider-field";
import { joinProvider, splitProvider } from "@/features/payments/lib/providers";
import { PAYMENT_METHOD_LABELS } from "@/lib/utils";
import { PAYMENT_METHODS, type PaymentMethod } from "@/types";

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * No `.default()` anywhere: a Zod default makes a field optional on the input type
 * but required on the output type, and RHF infers from the output — which breaks
 * the resolver. Defaults are supplied in `defaultValues` instead. Same rule as
 * features/customers/schema.ts.
 */
const schema = z.object({
  amount: z
    .string()
    .min(1, "Enter an amount")
    .regex(MONEY_PATTERN, "Use a number with at most two decimal places"),
  categoryId: z.string(),
  vendorId: z.string(),
  cashAccountId: z.string(),
  vendorName: z.string().max(200),
  paymentMethod: z.enum(PAYMENT_METHODS),
  provider: z.string(),
  providerOther: z.string().max(120),
  expenseDate: z.string().min(1, "Pick a date"),
  reference: z.string().max(120),
  notes: z.string().max(1000),
});

type FormValues = z.infer<typeof schema>;

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export interface ExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null → create a new expense; a row → edit that one. */
  expense?: ExpenseRow | null;
  onSaved?: () => void;
}

/**
 * One dialog for both recording and correcting an expense.
 *
 * Unlike a payment, an expense is editable — it is the owner's own note about their
 * own money, and the realistic failure mode is a typo. See the service docstring.
 */
export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense = null,
  onSaved,
}: ExpenseFormDialogProps) {
  const isEdit = Boolean(expense);
  const categories = useExpenseCategories();
  const vendors = useVendors();
  const accounts = useCashAccounts({ isActive: true });
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const [receipt, setReceipt] = useState<UploadedFile[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: "",
      categoryId: "",
      vendorId: "",
      cashAccountId: "",
      vendorName: "",
      paymentMethod: "CASH",
      provider: "",
      providerOther: "",
      expenseDate: todayISO(),
      reference: "",
      notes: "",
    },
  });

  const { reset, setError, handleSubmit, register, formState, watch, setValue } = form;
  const selectedVendorId = watch("vendorId");

  // Re-seed whenever a DIFFERENT expense is opened — otherwise the dialog would
  // still be holding the previous row's values.
  useEffect(() => {
    if (!open) return;
    reset({
      amount: expense?.amount ?? "",
      categoryId: expense?.categoryId ?? "",
      vendorId: expense?.vendorId ?? "",
      cashAccountId: expense?.cashAccountId ?? "",
      vendorName: expense?.vendorName ?? "",
      paymentMethod: expense?.paymentMethod ?? "CASH",
      provider: splitProvider(expense?.provider).choice,
      providerOther: splitProvider(expense?.provider).custom,
      expenseDate: expense?.expenseDate ?? todayISO(),
      reference: expense?.reference ?? "",
      notes: expense?.notes ?? "",
    });
    setReceipt([]);
    setFormError(null);
  }, [open, expense, reset]);

  const isSaving = createExpense.isPending || updateExpense.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const input = {
      amount: values.amount,
      categoryId: orNull(values.categoryId),
      vendorId: orNull(values.vendorId),
      cashAccountId: orNull(values.cashAccountId),
      // Only sent when no supplier was picked: choosing one makes the server
      // snapshot the supplier's own name, which must win over stale free text.
      vendorName: values.vendorId.trim() ? null : orNull(values.vendorName),
      paymentMethod: values.paymentMethod as PaymentMethod,
      provider: joinProvider(values.provider, values.providerOther),
      expenseDate: values.expenseDate,
      reference: orNull(values.reference),
      notes: orNull(values.notes),
      receiptFileId: receipt[0]?.id ?? null,
    };

    try {
      if (expense) {
        await updateExpense.mutateAsync({ id: expense.id, input });
      } else {
        await createExpense.mutateAsync(input);
      }
      onOpenChange(false);
      onSaved?.();
    } catch (error) {
      const parsed = parseApiError(error);
      const target = toFormFieldName(parsed.field) as keyof FormValues | null;

      if (target && target in schema.shape) {
        setError(target, { type: "server", message: parsed.message });
      } else {
        setFormError(parsed.message);
      }
    }
  });

  const categoryOptions = [
    { value: "", label: "No category" },
    ...(categories.data ?? []).map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];

  const vendorOptions = [
    { value: "", label: "Not from a saved supplier" },
    ...(vendors.data?.items ?? []).map((vendor) => ({
      value: vendor.id,
      label: vendor.name,
    })),
  ];

  const accountOptions = [
    { value: "", label: "Not tracked" },
    ...(accounts.data ?? []).map((account) => ({
      value: account.id,
      label: account.name,
    })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? "Edit expense" : "Record an expense"}
      description={
        isEdit
          ? "Corrections are logged — the original values stay in the audit trail."
          : "Money going out of the business. This never affects what customers owe you."
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="expense-form"
            isLoading={isSaving}
            loadingText="Saving…"
          >
            {isEdit ? "Save changes" : "Record expense"}
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {formError ? (
          <Alert variant="destructive" title="Could not save the expense">
            {formError}
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Amount" required error={formState.errors.amount?.message}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="tabular"
              {...register("amount")}
            />
          </FormField>

          <FormField
            label="Category"
            error={formState.errors.categoryId?.message}
            description="Optional — helps the reports group your spending."
          >
            <Select options={categoryOptions} {...register("categoryId")} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Paid to"
            error={formState.errors.vendorId?.message}
            description="Pick a supplier, or type a name below if they are not on the list."
          >
            <Select options={vendorOptions} {...register("vendorId")} />
          </FormField>

          <FormField label="Method" required error={formState.errors.paymentMethod?.message}>
            <Select
              options={PAYMENT_METHODS.map((method) => ({
                value: method,
                label: PAYMENT_METHOD_LABELS[method],
              }))}
              {...register("paymentMethod")}
            />
          </FormField>
        </div>

        {/* Free text stays available for the one-off purchase from a shop the owner
            will never buy from again -- forcing a Supplier record for that is friction
            a busy shopkeeper does not need. Hidden once a supplier IS picked, because
            the two would then disagree. */}
        {!selectedVendorId ? (
          <FormField
            label="Or type who you paid"
            error={formState.errors.vendorName?.message}
            description="For a one-off purchase you do not want to save as a supplier."
          >
            <Input autoComplete="off" placeholder="Optional" {...register("vendorName")} />
          </FormField>
        ) : null}

        <FormField
          label="Paid from"
          error={formState.errors.cashAccountId?.message}
          description="Which pot the money came out of. Keeps your account balances right."
        >
          <Select options={accountOptions} {...register("cashAccountId")} />
        </FormField>

        <ProviderField
          method={watch("paymentMethod")}
          choice={watch("provider")}
          custom={watch("providerOther")}
          onChoiceChange={(value) => setValue("provider", value)}
          onCustomChange={(value) => setValue("providerOther", value)}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Date" required error={formState.errors.expenseDate?.message}>
            {/* `max` mirrors the server rule: a future-dated expense is refused. */}
            <Input type="date" max={todayISO()} {...register("expenseDate")} />
          </FormField>

          <FormField
            label="Reference"
            error={formState.errors.reference?.message}
            description="Bill number, transfer ref — whatever proves it."
          >
            <Input autoComplete="off" placeholder="Optional" {...register("reference")} />
          </FormField>
        </div>

        <FormField label="Notes" error={formState.errors.notes?.message}>
          <Textarea rows={2} placeholder="Optional" {...register("notes")} />
        </FormField>

        <AttachmentUploader
          label="Receipt"
          description="A photo of the bill, if you have one."
          kind="RECEIPT"
          value={receipt}
          onChange={setReceipt}
          maxFiles={1}
        />
      </form>
    </Dialog>
  );
}
