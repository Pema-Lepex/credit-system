"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, Button, Dialog, FormField, Input, Textarea } from "@/components/ui";
import {
  useCreateCashAccount,
  useUpdateCashAccount,
} from "@/features/cash-accounts/hooks";
import type { CashAccountRow } from "@/features/cash-accounts/queries";
import { parseApiError, toFormFieldName } from "@/features/credits/lib/errors";

/** Leading `-` allowed: an overdrawn bank account is a real thing a shop can have. */
const SIGNED_MONEY = /^-?\d+(\.\d{1,2})?$/;

const schema = z.object({
  name: z.string().min(1, "Give the account a name").max(120),
  openingBalance: z
    .string()
    .refine((value) => value.trim() === "" || SIGNED_MONEY.test(value.trim()), {
      message: "Use a number with at most two decimal places",
    }),
  description: z.string().max(500),
});

type FormValues = z.infer<typeof schema>;

export interface CashAccountFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: CashAccountRow | null;
}

export function CashAccountFormDialog({
  open,
  onOpenChange,
  account = null,
}: CashAccountFormDialogProps) {
  const isEdit = Boolean(account);
  const createAccount = useCreateCashAccount();
  const updateAccount = useUpdateCashAccount();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", openingBalance: "", description: "" },
  });

  const { reset, setError, handleSubmit, register, formState } = form;

  useEffect(() => {
    if (!open) return;
    reset({
      name: account?.name ?? "",
      openingBalance: account?.openingBalance ?? "",
      description: account?.description ?? "",
    });
    setFormError(null);
  }, [open, account, reset]);

  const isSaving = createAccount.isPending || updateAccount.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = {
      name: values.name.trim(),
      openingBalance: values.openingBalance.trim() || "0",
      description: values.description.trim() || null,
    };

    try {
      if (account) {
        await updateAccount.mutateAsync({ id: account.id, input });
      } else {
        await createAccount.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (error) {
      const parsed = parseApiError(error);
      const target = toFormFieldName(parsed.field) as keyof FormValues | null;
      const field = target ?? (parsed.isConflict ? "name" : null);

      if (field && field in schema.shape) {
        setError(field, { type: "server", message: parsed.message });
      } else {
        setFormError(parsed.message);
      }
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit account" : "Add an account"}
      description="Somewhere money sits — the cash drawer, a bank account, a mobile wallet."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="cash-account-form" isLoading={isSaving} loadingText="Saving…">
            {isEdit ? "Save changes" : "Add account"}
          </Button>
        </>
      }
    >
      <form id="cash-account-form" onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {formError ? (
          <Alert variant="destructive" title="Could not save the account">
            {formError}
          </Alert>
        ) : null}

        <FormField label="Name" required error={formState.errors.name?.message}>
          <Input autoComplete="off" placeholder="e.g. Cash drawer" {...register("name")} />
        </FormField>

        <FormField
          label="Starting amount"
          error={formState.errors.openingBalance?.message}
          description="What was in it when you started tracking. Leave blank for zero; a minus sign is fine if it is overdrawn."
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="tabular"
            {...register("openingBalance")}
          />
        </FormField>

        <FormField label="Notes" error={formState.errors.description?.message}>
          <Textarea rows={2} placeholder="Optional" {...register("description")} />
        </FormField>
      </form>
    </Dialog>
  );
}
