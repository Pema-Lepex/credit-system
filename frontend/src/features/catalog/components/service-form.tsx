"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Clock, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";

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
  Switch,
  Textarea,
  toast,
} from "@/components/ui";
import { applyServerError } from "@/features/common/errors";
import { useCurrency } from "@/features/common/use-currency";

import type { ServiceInput, ServiceRecord } from "../api";
import { useCategories, useCreateService, useUpdateService } from "../queries";
import { SERVICE_FORM_FIELDS, serviceFormSchema, type ServiceFormValues } from "../schema";
import { CategoryManager } from "./category-manager";

function toDefaults(service?: ServiceRecord): ServiceFormValues {
  return {
    name: service?.name ?? "",
    code: service?.code ?? "",
    description: service?.description ?? "",
    categoryId: service?.categoryId ?? "",
    price: service?.price ?? "",
    taxPercentage: service?.taxPercentage ?? "",
    durationMinutes: service?.durationMinutes != null ? String(service.durationMinutes) : "",
    isActive: service?.isActive ?? true,
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export function ServiceForm({ service }: { service?: ServiceRecord }) {
  const router = useRouter();
  const currency = useCurrency();
  const isEdit = Boolean(service);

  const { data: categories } = useCategories();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createService = useCreateService();
  const updateService = useUpdateService(service?.id ?? "");
  const isSaving = createService.isPending || updateService.isPending;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: toDefaults(service),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const input: ServiceInput = {
      name: values.name.trim(),
      code: orNull(values.code),
      description: orNull(values.description),
      categoryId: values.categoryId || null,
      price: values.price,
      taxPercentage: orNull(values.taxPercentage),
      // Duration is the one genuinely integral field on this form.
      durationMinutes:
        values.durationMinutes.trim() === "" ? null : Number(values.durationMinutes),
      isActive: values.isActive,
    };

    try {
      const saved = isEdit
        ? await updateService.mutateAsync(input)
        : await createService.mutateAsync(input);
      toast.success(isEdit ? `${saved.name} updated.` : `${saved.name} added.`);
      router.push("/services");
    } catch (error) {
      // A duplicate code comes back as CONFLICT with field="code".
      const parsed = applyServerError(
        error,
        (field, message) =>
          setError(field as keyof ServiceFormValues, { type: "server", message }),
        SERVICE_FORM_FIELDS,
      );
      if (!parsed.field || !SERVICE_FORM_FIELDS.includes(parsed.field as never)) {
        setFormError(parsed.message);
      }
    }
  });

  return (
    <>
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
                <CardTitle>Service</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <FormField label="Name" required error={errors.name?.message}>
                  <Input {...register("name")} placeholder="Phone screen repair" />
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="Code"
                    error={errors.code?.message}
                    description="Must be unique in your catalog."
                  >
                    <Input {...register("code")} placeholder="REP-SCR" />
                  </FormField>

                  <FormField
                    label="Duration (minutes)"
                    error={errors.durationMinutes?.message}
                    description="Optional."
                  >
                    <Input
                      {...register("durationMinutes")}
                      inputMode="numeric"
                      placeholder="45"
                      leftAddon={<Clock />}
                    />
                  </FormField>
                </div>

                <FormField label="Description" error={errors.description?.message}>
                  <Textarea {...register("description")} rows={4} placeholder="Optional" />
                </FormField>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Pricing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <FormField
                  label={`Price (${currency.currency})`}
                  required
                  error={errors.price?.message}
                >
                  <Input
                    {...register("price")}
                    inputMode="decimal"
                    placeholder="500.00"
                    leftAddon={<span className="text-xs font-medium">{currency.symbol}</span>}
                  />
                </FormField>

                <FormField label="Tax %" error={errors.taxPercentage?.message}>
                  <Input {...register("taxPercentage")} inputMode="decimal" placeholder="0" />
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Organisation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <FormField label="Category" error={errors.categoryId?.message}>
                  <Select
                    {...register("categoryId")}
                    options={[
                      { value: "", label: "Uncategorised" },
                      ...(categories ?? []).map((category) => ({
                        value: category.id,
                        label: category.name,
                      })),
                    ]}
                  />
                </FormField>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  leftIcon={<Tags />}
                  onClick={() => setCategoriesOpen(true)}
                >
                  Manage categories
                </Button>

                <Controller
                  control={control}
                  name="isActive"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      label="Active"
                    />
                  )}
                />
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving}>
            {isEdit ? "Save changes" : "Create service"}
          </Button>
        </div>
      </form>

      <CategoryManager open={categoriesOpen} onOpenChange={setCategoriesOpen} />
    </>
  );
}
