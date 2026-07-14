"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Tags } from "lucide-react";
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
import { ImageUploader, type UploadedImage } from "@/features/common/image-uploader";
import { useCurrency } from "@/features/common/use-currency";

import type { ProductInput, ProductRecord } from "../api";
import { useCategories, useCreateProduct, useUpdateProduct } from "../queries";
import { PRODUCT_FORM_FIELDS, productFormSchema, type ProductFormValues } from "../schema";
import { CategoryManager } from "./category-manager";

const UNITS = ["pcs", "kg", "g", "l", "ml", "m", "box", "pack", "hour"];

function toDefaults(product?: ProductRecord): ProductFormValues {
  return {
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? "",
    price: product?.price ?? "",
    costPrice: product?.costPrice ?? "",
    taxPercentage: product?.taxPercentage ?? "",
    stockQuantity: product?.stockQuantity ?? "0",
    lowStockThreshold: product?.lowStockThreshold ?? "",
    unit: product?.unit ?? "pcs",
    isActive: product?.isActive ?? true,
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value.trim());

export function ProductForm({ product }: { product?: ProductRecord }) {
  const router = useRouter();
  const currency = useCurrency();
  const isEdit = Boolean(product);

  const { data: categories } = useCategories();
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct(product?.id ?? "");
  const isSaving = createProduct.isPending || updateProduct.isPending;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: toDefaults(product),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const input: ProductInput = {
      name: values.name.trim(),
      sku: orNull(values.sku),
      barcode: orNull(values.barcode),
      description: orNull(values.description),
      categoryId: values.categoryId || null,
      // Every one of these stays a string, exactly as typed.
      price: values.price,
      costPrice: orNull(values.costPrice),
      taxPercentage: orNull(values.taxPercentage),
      stockQuantity: values.stockQuantity.trim() === "" ? "0" : values.stockQuantity,
      lowStockThreshold: orNull(values.lowStockThreshold),
      unit: values.unit.trim(),
      // Only sent when the user uploaded something: the API returns image URLs but
      // takes file ids, so there is nothing to echo back for the existing set.
      imageFileIds: images.length > 0 ? images.map((image) => image.id) : null,
      isActive: values.isActive,
    };

    try {
      const saved = isEdit
        ? await updateProduct.mutateAsync(input)
        : await createProduct.mutateAsync(input);
      toast.success(isEdit ? `${saved.name} updated.` : `${saved.name} added.`);
      router.push("/products");
    } catch (error) {
      const parsed = applyServerError(
        error,
        (field, message) =>
          setError(field as keyof ProductFormValues, { type: "server", message }),
        PRODUCT_FORM_FIELDS,
      );
      // A duplicate SKU comes back as CONFLICT with field="sku" and lands on the
      // SKU box above. Anything unpinned still has to be said out loud.
      if (!parsed.field || !PRODUCT_FORM_FIELDS.includes(parsed.field as never)) {
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
                <CardTitle>Product</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <FormField label="Name" required error={errors.name?.message}>
                  <Input {...register("name")} placeholder="Cooking Oil 1L" />
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    label="SKU"
                    error={errors.sku?.message}
                    description="Must be unique in your catalog."
                  >
                    <Input {...register("sku")} placeholder="OIL-1L" autoCapitalize="characters" />
                  </FormField>
                  <FormField label="Barcode" error={errors.barcode?.message}>
                    <Input {...register("barcode")} inputMode="numeric" placeholder="890…" />
                  </FormField>
                </div>

                <FormField label="Description" error={errors.description?.message}>
                  <Textarea {...register("description")} rows={3} placeholder="Optional" />
                </FormField>

                <FormField label="Images" error={undefined}>
                  <div>
                    <ImageUploader
                      kind="PRODUCT_IMAGE"
                      label="Product images"
                      multiple
                      max={6}
                      value={images}
                      onChange={setImages}
                      existing={product?.imageUrls ?? []}
                      hint={
                        isEdit
                          ? "Uploading replaces the current images."
                          : "Up to 6. They are compressed on upload."
                      }
                    />
                  </div>
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stock</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 pt-0 sm:grid-cols-3">
                <FormField
                  label="Quantity"
                  error={errors.stockQuantity?.message}
                  description={isEdit ? "Use Adjust stock for movements." : undefined}
                >
                  <Input {...register("stockQuantity")} inputMode="decimal" placeholder="0" />
                </FormField>
                <FormField
                  label="Low-stock threshold"
                  error={errors.lowStockThreshold?.message}
                  description="Blank = no warning."
                >
                  <Input {...register("lowStockThreshold")} inputMode="decimal" placeholder="10" />
                </FormField>
                <FormField label="Unit" required error={errors.unit?.message}>
                  <Input {...register("unit")} list="product-units" placeholder="pcs" />
                </FormField>
                <datalist id="product-units">
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit} />
                  ))}
                </datalist>
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
                    placeholder="185.00"
                    leftAddon={<span className="text-xs font-medium">{currency.symbol}</span>}
                  />
                </FormField>

                <FormField
                  label="Cost price"
                  error={errors.costPrice?.message}
                  description="What you paid. Never shown to customers."
                >
                  <Input
                    {...register("costPrice")}
                    inputMode="decimal"
                    placeholder="150.00"
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
                <p className="text-muted-foreground text-xs">
                  Inactive products stay in past credits but cannot be added to new ones.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving}>
            {isEdit ? "Save changes" : "Create product"}
          </Button>
        </div>
      </form>

      <CategoryManager open={categoriesOpen} onOpenChange={setCategoriesOpen} />
    </>
  );
}
