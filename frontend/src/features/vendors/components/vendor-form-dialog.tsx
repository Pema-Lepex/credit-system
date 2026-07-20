"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, Button, Dialog, FormField, Input, Textarea } from "@/components/ui";
import { parseApiError, toFormFieldName } from "@/features/credits/lib/errors";
import { useCreateVendor, useUpdateVendor } from "@/features/vendors/hooks";
import type { VendorRow } from "@/features/vendors/queries";

/** No `.default()` — see the note in the expense form for why RHF breaks on it. */
const schema = z.object({
  name: z.string().min(1, "Give the supplier a name").max(200),
  phone: z.string().max(40),
  email: z.string().max(255),
  address: z.string().max(500),
  notes: z.string().max(1000),
});

type FormValues = z.infer<typeof schema>;

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export interface VendorFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendor?: VendorRow | null;
}

export function VendorFormDialog({ open, onOpenChange, vendor = null }: VendorFormDialogProps) {
  const isEdit = Boolean(vendor);
  const createVendor = useCreateVendor();
  const updateVendor = useUpdateVendor();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "", email: "", address: "", notes: "" },
  });

  const { reset, setError, handleSubmit, register, formState } = form;

  useEffect(() => {
    if (!open) return;
    reset({
      name: vendor?.name ?? "",
      phone: vendor?.phone ?? "",
      email: vendor?.email ?? "",
      address: vendor?.address ?? "",
      notes: vendor?.notes ?? "",
    });
    setFormError(null);
  }, [open, vendor, reset]);

  const isSaving = createVendor.isPending || updateVendor.isPending;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = {
      name: values.name.trim(),
      phone: orNull(values.phone),
      email: orNull(values.email),
      address: orNull(values.address),
      notes: orNull(values.notes),
    };

    try {
      if (vendor) {
        await updateVendor.mutateAsync({ id: vendor.id, input });
      } else {
        await createVendor.mutateAsync(input);
      }
      onOpenChange(false);
    } catch (error) {
      const parsed = parseApiError(error);
      const target = toFormFieldName(parsed.field) as keyof FormValues | null;
      // A duplicate name is a CONFLICT with no `field`, but it is unambiguously
      // about the name — put it there rather than in a generic banner.
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
      title={isEdit ? "Edit supplier" : "Add a supplier"}
      description="Anyone the business pays — a wholesaler, the landlord, the electricity company."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-form" isLoading={isSaving} loadingText="Saving…">
            {isEdit ? "Save changes" : "Add supplier"}
          </Button>
        </>
      }
    >
      <form id="vendor-form" onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        {formError ? (
          <Alert variant="destructive" title="Could not save the supplier">
            {formError}
          </Alert>
        ) : null}

        <FormField label="Name" required error={formState.errors.name?.message}>
          <Input autoComplete="off" placeholder="e.g. Thimphu Wholesale" {...register("name")} />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Phone" error={formState.errors.phone?.message}>
            <Input autoComplete="off" placeholder="Optional" {...register("phone")} />
          </FormField>
          <FormField label="Email" error={formState.errors.email?.message}>
            <Input autoComplete="off" placeholder="Optional" {...register("email")} />
          </FormField>
        </div>

        <FormField label="Address" error={formState.errors.address?.message}>
          <Input autoComplete="off" placeholder="Optional" {...register("address")} />
        </FormField>

        <FormField label="Notes" error={formState.errors.notes?.message}>
          <Textarea rows={2} placeholder="Optional" {...register("notes")} />
        </FormField>
      </form>
    </Dialog>
  );
}
