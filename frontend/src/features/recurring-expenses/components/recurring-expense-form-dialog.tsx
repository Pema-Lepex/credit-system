"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, Button, Dialog, FormField, Input, Select, Textarea } from "@/components/ui";
import { useCashAccounts } from "@/features/cash-accounts/hooks";
import { parseApiError, toFormFieldName } from "@/features/credits/lib/errors";
import { useExpenseCategories } from "@/features/expenses/hooks/use-expenses";
import {
  useCreateRecurringExpense,
  useUpdateRecurringExpense,
} from "@/features/recurring-expenses/hooks";
import type { RecurringExpenseRow } from "@/features/recurring-expenses/queries";
import { useVendors } from "@/features/vendors/hooks";
import { PAYMENT_METHOD_LABELS } from "@/lib/utils";
import {
  EXPENSE_FREQUENCIES,
  PAYMENT_METHODS,
  type ExpenseFrequency,
  type PaymentMethod,
} from "@/types";

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Plain language, per the spec — "Every month", not "MONTHLY". */
export const FREQUENCY_LABELS: Record<ExpenseFrequency, string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  YEARLY: "Every year",
};

const schema = z.object({
  name: z.string().min(1, "Give it a name, e.g. 'Shop rent'").max(200),
  amount: z
    .string()
    .min(1, "Enter an amount")
    .regex(MONEY_PATTERN, "Use a number with at most two decimal places"),
  frequency: z.enum(EXPENSE_FREQUENCIES),
  nextRun: z.string().min(1, "Pick the first date"),
  endDate: z.string(),
  categoryId: z.string(),
  vendorId: z.string(),
  cashAccountId: z.string(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().max(1000),
});

type FormValues = z.infer<typeof schema>;

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export interface RecurringExpenseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: RecurringExpenseRow | null;
}

export function RecurringExpenseFormDialog({
  open,
  onOpenChange,
  template = null,
}: RecurringExpenseFormDialogProps) {
  const isEdit = Boolean(template);
  const categories = useExpenseCategories();
  const vendors = useVendors();
  const accounts = useCashAccounts({ isActive: true });
  const createTemplate = useCreateRecurringExpense();
  const updateTemplate = useUpdateRecurringExpense();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      amount: "",
      frequency: "MONTHLY",
      nextRun: todayISO(),
      endDate: "",
      categoryId: "",
      vendorId: "",
      cashAccountId: "",
      paymentMethod: "CASH",
      notes: "",
    },
  });

  const { reset, setError, handleSubmit, register, formState } = form;

  useEffect(() => {
    if (!open) return;
    reset({
      name: template?.name ?? "",
      amount: template?.amount ?? "",
      frequency: template?.frequency ?? "MONTHLY",
      nextRun: template?.nextRun ?? todayISO(),
      endDate: template?.endDate ?? "",
      categoryId: template?.categoryId ?? "",
      vendorId: template?.vendorId ?? "",
      cashAccountId: template?.cashAccountId ?? "",
      paymentMethod: template?.paymentMethod ?? "CASH",
      notes: template?.notes ?? "",
    });
    setFormError(null);
  }, [open, template, reset]);

  const isSaving = createTemplate.isPending || updateTemplate.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = {
      name: values.name.trim(),
      amount: values.amount,
      frequency: values.frequency as ExpenseFrequency,
      nextRun: values.nextRun,
      endDate: orNull(values.endDate),
      categoryId: orNull(values.categoryId),
      vendorId: orNull(values.vendorId),
      cashAccountId: orNull(values.cashAccountId),
      paymentMethod: values.paymentMethod as PaymentMethod,
      notes: orNull(values.notes),
    };

    try {
      if (template) {
        await updateTemplate.mutateAsync({ id: template.id, input });
      } else {
        await createTemplate.mutateAsync(input);
      }
      onOpenChange(false);
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

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? "Edit repeating bill" : "Add a repeating bill"}
      description="Something you pay on a schedule — rent, wages, electricity. We record it for you when it falls due."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="recurring-form" isLoading={isSaving} loadingText="Saving…">
            {isEdit ? "Save changes" : "Schedule it"}
          </Button>
        </>
      }
    >
      <form id="recurring-form" onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {formError ? (
          <Alert variant="destructive" title="Could not save it">
            {formError}
          </Alert>
        ) : null}

        {isEdit ? (
          <Alert variant="info">
            Changes apply to future bills only. Anything already recorded stays as it is.
          </Alert>
        ) : null}

        <FormField label="What is it?" required error={formState.errors.name?.message}>
          <Input autoComplete="off" placeholder="e.g. Shop rent" {...register("name")} />
        </FormField>

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

          <FormField label="How often" required error={formState.errors.frequency?.message}>
            <Select
              options={EXPENSE_FREQUENCIES.map((value) => ({
                value,
                label: FREQUENCY_LABELS[value],
              }))}
              {...register("frequency")}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="First one due"
            required
            error={formState.errors.nextRun?.message}
            description="On a monthly bill, this day of the month is kept every month."
          >
            <Input type="date" {...register("nextRun")} />
          </FormField>

          <FormField
            label="Stop after"
            error={formState.errors.endDate?.message}
            description="Leave blank to keep going until you stop it."
          >
            <Input type="date" {...register("endDate")} />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Category" error={formState.errors.categoryId?.message}>
            <Select
              options={[
                { value: "", label: "No category" },
                ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
              {...register("categoryId")}
            />
          </FormField>

          <FormField label="Paid to" error={formState.errors.vendorId?.message}>
            <Select
              options={[
                { value: "", label: "No supplier" },
                ...(vendors.data?.items ?? []).map((v) => ({ value: v.id, label: v.name })),
              ]}
              {...register("vendorId")}
            />
          </FormField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Paid from" error={formState.errors.cashAccountId?.message}>
            <Select
              options={[
                { value: "", label: "Not tracked" },
                ...(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name })),
              ]}
              {...register("cashAccountId")}
            />
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

        <FormField label="Notes" error={formState.errors.notes?.message}>
          <Textarea rows={2} placeholder="Optional" {...register("notes")} />
        </FormField>
      </form>
    </Dialog>
  );
}
