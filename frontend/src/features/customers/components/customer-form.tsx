"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Select,
  Textarea,
  toast,
} from "@/components/ui";
import { applyServerError } from "@/features/common/errors";
import { ImageUploader, type UploadedImage } from "@/features/common/image-uploader";
import { useCurrency } from "@/features/common/use-currency";
import { CUSTOMER_STATUS_STYLES } from "@/lib/utils";
import { CUSTOMER_STATUSES } from "@/types";

import type { CustomerInput, CustomerRecord } from "../api";
import { useCreateCustomer, useUpdateCustomer } from "../queries";
import { CUSTOMER_FORM_FIELDS, customerFormSchema, type CustomerFormValues } from "../schema";

export interface CustomerFormProps {
  /** Omit to create. */
  customer?: CustomerRecord;
}

function toDefaults(customer?: CustomerRecord): CustomerFormValues {
  return {
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    city: customer?.city ?? "",
    latitude: customer?.latitude != null ? String(customer.latitude) : "",
    longitude: customer?.longitude != null ? String(customer.longitude) : "",
    notes: customer?.notes ?? "",
    status: customer?.status ?? "ACTIVE",
    creditLimit: customer?.creditLimit ?? "",
    emergencyContactName: customer?.emergencyContactName ?? "",
    emergencyContactPhone: customer?.emergencyContactPhone ?? "",
    emergencyContactRelation: customer?.emergencyContactRelation ?? "",
  };
}

/** "" → null so the server's `_set` leaves the column alone (it cannot be blanked). */
const orNull = (value: string) => (value.trim() === "" ? null : value.trim());
const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

export function CustomerForm({ customer }: CustomerFormProps) {
  const router = useRouter();
  const currency = useCurrency();
  const isEdit = Boolean(customer);

  const [photo, setPhoto] = useState<UploadedImage[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer(customer?.id ?? "");
  const isSaving = createCustomer.isPending || updateCustomer.isPending;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: toDefaults(customer),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const input: CustomerInput = {
      name: values.name.trim(),
      phone: orNull(values.phone),
      email: orNull(values.email),
      address: orNull(values.address),
      city: orNull(values.city),
      latitude: numberOrNull(values.latitude),
      longitude: numberOrNull(values.longitude),
      notes: orNull(values.notes),
      status: values.status,
      // Money crosses the wire as the string the user typed. No Number() anywhere.
      creditLimit: orNull(values.creditLimit),
      emergencyContactName: orNull(values.emergencyContactName),
      emergencyContactPhone: orNull(values.emergencyContactPhone),
      emergencyContactRelation: orNull(values.emergencyContactRelation),
      // Only sent when the user actually uploaded one — a null here means
      // "unchanged" to the API, which is exactly what we want on edit.
      photoFileId: photo[0]?.id ?? null,
    };

    try {
      const saved = isEdit
        ? await updateCustomer.mutateAsync(input)
        : await createCustomer.mutateAsync(input);
      toast.success(isEdit ? `${saved.name} updated.` : `${saved.name} added.`);
      router.push(`/customers/${saved.id}`);
    } catch (error) {
      const parsed = applyServerError(
        error,
        (field, message) =>
          setError(field as keyof CustomerFormValues, { type: "server", message }),
        CUSTOMER_FORM_FIELDS,
      );
      // Anything the server did not pin to a field still has to be visible.
      if (!parsed.field || !CUSTOMER_FORM_FIELDS.includes(parsed.field as never)) {
        setFormError(parsed.message);
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {formError ? (
        <Alert variant="destructive" title="Could not save">
          {formError}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <FormField label="Full name" required error={errors.name?.message}>
                <Input {...register("name")} placeholder="Sonam Dorji" autoComplete="name" />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Phone" error={errors.phone?.message}>
                  <Input
                    {...register("phone")}
                    type="tel"
                    placeholder="+975 17 12 34 56"
                    autoComplete="tel"
                  />
                </FormField>
                <FormField label="Email" error={errors.email?.message}>
                  <Input
                    {...register("email")}
                    type="email"
                    placeholder="name@example.com"
                    autoComplete="email"
                  />
                </FormField>
              </div>

              <FormField label="Photo" error={undefined}>
                <div>
                  <ImageUploader
                    kind="CUSTOMER_PHOTO"
                    label="Customer photo"
                    shape="circle"
                    value={photo}
                    onChange={setPhoto}
                    existing={customer?.photoUrl ? [customer.photoUrl] : []}
                    hint="JPEG, PNG or WebP, up to 10 MB. It is compressed on upload."
                  />
                </div>
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where they are</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <FormField label="Address" error={errors.address?.message}>
                <Textarea
                  {...register("address")}
                  rows={2}
                  placeholder="Shop 4, Norzin Lam"
                  autoComplete="street-address"
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="City" error={errors.city?.message}>
                  <Input {...register("city")} placeholder="Thimphu" />
                </FormField>
                <FormField
                  label="Latitude"
                  error={errors.latitude?.message}
                  description="Optional"
                >
                  <Input
                    {...register("latitude")}
                    inputMode="decimal"
                    placeholder="27.4712"
                    leftAddon={<MapPin />}
                  />
                </FormField>
                <FormField
                  label="Longitude"
                  error={errors.longitude?.message}
                  description="Optional"
                >
                  <Input
                    {...register("longitude")}
                    inputMode="decimal"
                    placeholder="89.6339"
                    leftAddon={<MapPin />}
                  />
                </FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Emergency contact</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-0 sm:grid-cols-3">
              <FormField label="Name" error={errors.emergencyContactName?.message}>
                <Input {...register("emergencyContactName")} placeholder="Pema Lhamo" />
              </FormField>
              <FormField label="Phone" error={errors.emergencyContactPhone?.message}>
                <Input {...register("emergencyContactPhone")} type="tel" placeholder="+975 …" />
              </FormField>
              <FormField label="Relationship" error={errors.emergencyContactRelation?.message}>
                <Input {...register("emergencyContactRelation")} placeholder="Sister" />
              </FormField>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Credit terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <FormField label="Status" required error={errors.status?.message}>
                <Select
                  {...register("status")}
                  options={CUSTOMER_STATUSES.map((status) => ({
                    value: status,
                    label: CUSTOMER_STATUS_STYLES[status].label,
                  }))}
                />
              </FormField>

              <FormField
                label={`Credit limit (${currency.currency})`}
                error={errors.creditLimit?.message}
                description="Leave blank for no limit. Used by the credit score."
              >
                <Input
                  {...register("creditLimit")}
                  inputMode="decimal"
                  placeholder="5000.00"
                  leftAddon={<span className="text-xs font-medium">{currency.symbol}</span>}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <FormField label="Internal notes" hideLabel error={errors.notes?.message}>
                <Textarea
                  {...register("notes")}
                  rows={6}
                  placeholder="Anything your staff should know before extending more credit."
                />
              </FormField>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isSaving}>
          {isEdit ? "Save changes" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}
