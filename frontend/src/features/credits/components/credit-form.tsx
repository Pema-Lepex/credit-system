"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { PageHeader } from "@/components/layout/page-header";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Label,
  Separator,
  Textarea,
  buttonVariants,
  toast,
} from "@/components/ui";
import { AttachmentUploader } from "@/features/credits/components/attachment-uploader";
import { CustomerCombobox } from "@/features/credits/components/customer-combobox";
import { LineItemsBuilder } from "@/features/credits/components/line-items-builder";
import { useBusinessSettings, useMoney } from "@/features/credits/hooks/use-business-settings";
import { useCreateCredit, useUpdateCredit } from "@/features/credits/hooks/use-credit-mutations";
import { parseApiError, toFormFieldName } from "@/features/credits/lib/errors";
import { centsToMoney, computeCreditTotals } from "@/features/credits/lib/money";
import type { UploadedFile } from "@/features/credits/lib/rest";
import {
  creditFormSchema,
  defaultDueDate,
  emptyItem,
  todayISO,
  type CreditFormValues,
} from "@/features/credits/lib/schema";
import type {
  CreditCreateInput,
  CreditDetail,
  CreditItemInput,
  CustomerOption,
} from "@/features/credits/queries";
import { cn } from "@/lib/utils";

export interface CreditFormProps {
  /** Present when editing. Absent means create. */
  credit?: CreditDetail;
}

/**
 * The most important form in the app.
 *
 * TOTALS ARE LIVE AND DECIMAL-SAFE. Every keystroke recomputes the preview in
 * integer cents with the server's own formula (lib/money.ts). Nothing here ever
 * becomes a float, and nothing here is authoritative — the server recomputes on
 * save. The preview's only job is to never lie.
 *
 * SERVER VALIDATION LANDS ON THE FIELD. The backend answers a bad line with
 * `extensions: { code: "VALIDATION_ERROR", field: "discount_amount" }`; we map that
 * onto the control (see lib/errors.ts) so the error appears where the mistake is,
 * not in a toast the user has to translate.
 */
export function CreditForm({ credit }: CreditFormProps) {
  const router = useRouter();
  const money = useMoney();
  const business = useBusinessSettings();
  const createCredit = useCreateCredit();
  const updateCredit = useUpdateCredit();

  const isEdit = Boolean(credit);
  const defaultTax = business.data?.taxPercentage ?? "0";

  const [customer, setCustomer] = useState<CustomerOption | null>(
    credit?.customer
      ? {
          id: credit.customer.id,
          name: credit.customer.name,
          code: credit.customer.code,
          phone: credit.customer.phone ?? null,
          outstandingBalance: "0",
          creditLimit: null,
          status: "ACTIVE",
        }
      : null,
  );
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [invoice, setInvoice] = useState<UploadedFile[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const defaultValues = useMemo<CreditFormValues>(() => {
    if (credit) {
      return {
        customerId: credit.customerId,
        issuedDate: credit.issuedDate,
        dueDate: credit.dueDate,
        reminderDate: credit.reminderDate ?? "",
        discountPercentage: credit.discountPercentage ?? "",
        taxPercentage: credit.taxPercentage ?? "",
        notes: credit.notes ?? "",
        initialPayment: "",
        items: [...credit.items]
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            productId: item.productId,
            serviceId: item.serviceId,
            kind: item.kind,
            name: item.name,
            description: item.description ?? "",
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount,
            taxPercentage: item.taxPercentage,
          })),
      };
    }

    return {
      customerId: "",
      issuedDate: todayISO(),
      dueDate: defaultDueDate(),
      reminderDate: "",
      discountPercentage: "",
      taxPercentage: "",
      notes: "",
      initialPayment: "",
      items: [emptyItem("0")],
    };
  }, [credit]);

  const form = useForm<CreditFormValues>({
    resolver: zodResolver(creditFormSchema),
    defaultValues,
    mode: "onBlur",
  });

  const { control, register, handleSubmit, watch, setValue, setError, formState } = form;
  const fields = useFieldArray({ control, name: "items" });

  // The business's default tax rate only arrives after a round trip. Seed the first
  // (still-untouched) line with it rather than leaving 0 and making the user retype.
  useEffect(() => {
    if (isEdit || !business.data) return;
    const items = form.getValues("items");
    if (items.length === 1 && items[0]?.name === "" && items[0]?.taxPercentage === "0") {
      setValue("items.0.taxPercentage", business.data.taxPercentage);
    }
  }, [business.data, isEdit, form, setValue]);

  const items = watch("items");
  const discountPercentage = watch("discountPercentage");
  const taxPercentage = watch("taxPercentage");
  const initialPayment = watch("initialPayment");

  const totals = useMemo(
    () =>
      computeCreditTotals({
        items: (items ?? []).map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount || "0",
          taxPercentage: item.taxPercentage || "0",
        })),
        discountPercentage: discountPercentage || null,
        taxPercentage: taxPercentage || null,
        initialPayment: isEdit ? null : initialPayment || null,
      }),
    [items, discountPercentage, taxPercentage, initialPayment, isEdit],
  );

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const itemInputs: CreditItemInput[] = values.items.map((item) => ({
      name: item.name.trim(),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      kind: item.kind,
      productId: item.productId,
      serviceId: item.serviceId,
      description: item.description?.trim() || null,
      unit: item.unit || "pcs",
      discountAmount: item.discountAmount || "0",
      taxPercentage: item.taxPercentage || "0",
    }));

    try {
      if (credit) {
        await updateCredit.mutateAsync({
          id: credit.id,
          input: {
            items: itemInputs,
            dueDate: values.dueDate,
            reminderDate: values.reminderDate || null,
            discountPercentage: values.discountPercentage || null,
            taxPercentage: values.taxPercentage || null,
            notes: values.notes?.trim() || null,
            photoFileIds: photos.length > 0 ? photos.map((file) => file.id) : null,
            invoiceFileId: invoice[0]?.id ?? null,
          },
        });
        router.push(`/credits/${credit.id}`);
        return;
      }

      const input: CreditCreateInput = {
        customerId: values.customerId,
        items: itemInputs,
        issuedDate: values.issuedDate,
        dueDate: values.dueDate,
        reminderDate: values.reminderDate || null,
        discountPercentage: values.discountPercentage || null,
        taxPercentage: values.taxPercentage || null,
        notes: values.notes?.trim() || null,
        photoFileIds: photos.length > 0 ? photos.map((file) => file.id) : null,
        invoiceFileId: invoice[0]?.id ?? null,
        initialPayment: values.initialPayment || null,
      };

      const created = await createCredit.mutateAsync(input);
      router.push(`/credits/${created.id}`);
    } catch (error) {
      const parsed = parseApiError(error);
      const field = toFormFieldName(parsed.field);

      // The server names a domain field; put the message on the matching control.
      // A discount error names `discount_amount`, which could belong to any line —
      // without a row index we cannot place it, so it goes to the banner rather than
      // onto an arbitrary row where it would be actively misleading.
      if (field && field in defaultValues) {
        setError(field as keyof CreditFormValues, { type: "server", message: parsed.message });
        toast.error("Check the highlighted field");
      } else {
        setFormError(parsed.message);
      }
    }
  });

  const isSaving = createCredit.isPending || updateCredit.isPending;
  const blockedByPreview = totals.discountExceedsSubtotal || totals.initialPaymentExceedsTotal;

  return (
    <div className="space-y-6">
      <Link
        href={credit ? `/credits/${credit.id}` : "/credits"}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2")}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {credit ? credit.number : "All credits"}
      </Link>

      <PageHeader
        title={isEdit ? `Edit ${credit?.number}` : "New credit"}
        description={
          isEdit
            ? "Change the lines, the dates or the notes. The totals are recomputed on save."
            : "A sale you have not been paid for. Pick the customer, list what they took, set a due date."
        }
      />

      <form onSubmit={(event) => void onSubmit(event)} className="space-y-6" noValidate>
        {formError ? (
          <Alert variant="destructive" title="The server refused this credit">
            {formError}
          </Alert>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* ------------------------------------------------------ customer */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Customer</CardTitle>
                {isEdit ? (
                  <CardDescription>
                    A credit cannot change hands. To bill someone else, cancel this one and
                    write a new credit.
                  </CardDescription>
                ) : null}
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  <Label htmlFor="customerId" required>
                    Who is this for?
                  </Label>
                  <CustomerCombobox
                    id="customerId"
                    value={customer}
                    disabled={isEdit}
                    invalid={Boolean(formState.errors.customerId)}
                    onChange={(next) => {
                      setCustomer(next);
                      setValue("customerId", next?.id ?? "", { shouldValidate: true });
                    }}
                  />
                  {formState.errors.customerId?.message ? (
                    <p
                      role="alert"
                      className="text-destructive-soft-foreground text-xs font-medium"
                    >
                      {formState.errors.customerId.message}
                    </p>
                  ) : null}
                  <input type="hidden" {...register("customerId")} />
                </div>
              </CardContent>
            </Card>

            {/* --------------------------------------------------------- items */}
            <Card>
              <CardContent className="pt-6">
                <LineItemsBuilder
                  fields={fields}
                  register={register}
                  errors={formState.errors}
                  items={items ?? []}
                  defaultTaxPercentage={defaultTax}
                />
              </CardContent>
            </Card>

            {/* --------------------------------------------------------- dates */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Dates</CardTitle>
                <CardDescription>
                  The due date is what the reminder sweep chases. It is not optional.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <FormField
                  label="Issued"
                  required
                  error={formState.errors.issuedDate?.message}
                >
                  <Input type="date" disabled={isEdit} {...register("issuedDate")} />
                </FormField>

                <FormField label="Due" required error={formState.errors.dueDate?.message}>
                  <Input type="date" {...register("dueDate")} />
                </FormField>

                <FormField
                  label="Remind on"
                  error={formState.errors.reminderDate?.message}
                  description="Optional. Defaults to your reminder settings."
                >
                  <Input type="date" {...register("reminderDate")} />
                </FormField>
              </CardContent>
            </Card>

            {/* --------------------------------------------------- notes/files */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle>Notes and attachments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <FormField label="Notes" error={formState.errors.notes?.message}>
                  <Textarea
                    rows={3}
                    placeholder="Anything you will want to remember in six months."
                    {...register("notes")}
                  />
                </FormField>

                <AttachmentUploader
                  label="Photos"
                  description="The goods, the handshake, the signed slip — whatever proves it."
                  kind="CREDIT_PHOTO"
                  multiple
                  value={photos}
                  onChange={setPhotos}
                />

                <AttachmentUploader
                  label="Invoice"
                  description="An existing invoice document, if you already have one."
                  kind="INVOICE"
                  value={invoice}
                  onChange={setInvoice}
                  maxFiles={1}
                />
              </CardContent>
            </Card>
          </div>

          {/* -------------------------------------------------------- summary */}
          <div className="space-y-6">
            <Card className="lg:sticky lg:top-20">
              <CardHeader className="pb-4">
                <CardTitle>Totals</CardTitle>
                <CardDescription>
                  Computed the same way the server computes them. It will recheck on save.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    label="Discount %"
                    error={formState.errors.discountPercentage?.message}
                  >
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      className="tabular text-right"
                      {...register("discountPercentage")}
                    />
                  </FormField>

                  <FormField label="Tax %" error={formState.errors.taxPercentage?.message}>
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      className="tabular text-right"
                      {...register("taxPercentage")}
                    />
                  </FormField>
                </div>

                <Separator />

                <dl className="space-y-2 text-sm">
                  <Row label="Subtotal" value={money.format(centsToMoney(totals.subtotalCents))} />
                  <Row
                    label="Discount"
                    value={`−${money.format(centsToMoney(totals.discountCents))}`}
                  />
                  <Row label="Tax" value={money.format(centsToMoney(totals.taxCents))} />

                  <Separator className="my-2" />

                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-foreground font-semibold">Grand total</dt>
                    <dd className="text-foreground tabular text-base font-semibold">
                      {money.format(centsToMoney(totals.grandTotalCents))}
                    </dd>
                  </div>

                  {!isEdit ? (
                    <>
                      <Row
                        label="Paid now"
                        value={money.format(centsToMoney(totals.paidCents))}
                      />
                      <div className="bg-muted/60 -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2">
                        <dt className="text-foreground font-semibold">Remaining</dt>
                        <dd className="text-foreground tabular font-semibold">
                          {money.format(centsToMoney(totals.remainingCents))}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>

                {totals.discountExceedsSubtotal ? (
                  <Alert variant="destructive" title="The discount is too big">
                    A discount cannot exceed what is being discounted. The server refuses this.
                  </Alert>
                ) : null}

                {!isEdit ? (
                  <>
                    <Separator />
                    <FormField
                      label="Paid at the counter"
                      error={formState.errors.initialPayment?.message}
                      description="If they paid something right now. Cash, recorded as the first payment."
                    >
                      <Input
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tabular text-right"
                        {...register("initialPayment")}
                      />
                    </FormField>

                    {totals.initialPaymentExceedsTotal ? (
                      <Alert variant="destructive" title="That is more than the credit">
                        The server refuses an overpayment. Take{" "}
                        {money.format(centsToMoney(totals.grandTotalCents))} or less.
                      </Alert>
                    ) : null}
                  </>
                ) : null}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                fullWidth
                size="lg"
                leftIcon={<Save />}
                isLoading={isSaving}
                loadingText={isEdit ? "Saving…" : "Creating…"}
                disabled={blockedByPreview}
              >
                {isEdit ? "Save changes" : "Create credit"}
              </Button>

              <Link
                href={credit ? `/credits/${credit.id}` : "/credits"}
                className={cn(buttonVariants({ variant: "ghost" }), "w-full")}
              >
                Cancel
              </Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground tabular">{value}</dd>
    </div>
  );
}
