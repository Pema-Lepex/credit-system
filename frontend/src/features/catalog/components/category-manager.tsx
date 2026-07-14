"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  FormField,
  Input,
  Spinner,
  Textarea,
  toast,
} from "@/components/ui";
import { applyServerError, toServerError } from "@/features/common/errors";
import { cn } from "@/lib/utils";
import type { ID } from "@/types";

import type { CategoryRecord } from "../api";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "../queries";
import { CATEGORY_FORM_FIELDS, categoryFormSchema, type CategoryFormValues } from "../schema";

const SWATCHES = [
  "#4f46e5",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#475569",
];

/**
 * Categories are name/description/colour — a dialog, not a page.
 *
 * Deleting one does NOT delete its products: the backend uncategorises them
 * (see `deleteCategory`'s docstring). The confirm copy says so, because a
 * shopkeeper who thinks "delete category" might mean "delete 40 products" will
 * simply never press it.
 */
export function CategoryManager({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: categories, isLoading, error } = useCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [editing, setEditing] = useState<CategoryRecord | null>(null);
  const [confirmingId, setConfirmingId] = useState<ID | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: "", description: "", color: "" },
  });

  const color = watch("color");

  useEffect(() => {
    reset({
      name: editing?.name ?? "",
      description: editing?.description ?? "",
      color: editing?.color ?? "",
    });
    setFormError(null);
  }, [editing, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = {
      name: values.name.trim(),
      description: values.description.trim() || null,
      color: values.color || null,
    };

    try {
      if (editing) {
        await updateCategory.mutateAsync({ id: editing.id, input });
        toast.success(`${input.name} updated.`);
        setEditing(null);
      } else {
        await createCategory.mutateAsync(input);
        toast.success(`${input.name} added.`);
      }
      reset({ name: "", description: "", color: "" });
    } catch (mutationError) {
      const parsed = applyServerError(
        mutationError,
        (field, message) =>
          setError(field as keyof CategoryFormValues, { type: "server", message }),
        CATEGORY_FORM_FIELDS,
      );
      if (!parsed.field) setFormError(parsed.message);
    }
  });

  const remove = async (category: CategoryRecord) => {
    try {
      await deleteCategory.mutateAsync(category.id);
      toast.success(`${category.name} deleted. Its items are now uncategorised.`);
      if (editing?.id === category.id) setEditing(null);
    } catch (mutationError) {
      toast.error(toServerError(mutationError).message);
    } finally {
      setConfirmingId(null);
    }
  };

  const isSaving = createCategory.isPending || updateCategory.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(null);
        onOpenChange(next);
      }}
      title="Categories"
      description="Used to group products and services. Deleting one leaves its items uncategorised — it never deletes them."
      size="xl"
    >
      <div className="space-y-6">
        {error ? (
          <Alert variant="destructive" title="Could not load categories">
            {toServerError(error).message}
          </Alert>
        ) : null}

        {/* ------------------------------------------------------------ list */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner label="Loading categories" />
          </div>
        ) : (categories?.length ?? 0) === 0 ? (
          <EmptyState
            size="sm"
            icon={<Tags />}
            title="No categories yet"
            description="Add one below — Groceries, Household, Repairs…"
          />
        ) : (
          <ul className="divide-border border-border divide-y rounded-lg border">
            {categories?.map((category) => (
              <li key={category.id} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="border-border size-4 shrink-0 rounded-full border"
                  style={{ backgroundColor: category.color ?? "transparent" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">{category.name}</p>
                  {category.description ? (
                    <p className="text-muted-foreground truncate text-xs">
                      {category.description}
                    </p>
                  ) : null}
                </div>

                {confirmingId === category.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-muted-foreground mr-1 text-xs">Delete?</span>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={`Confirm deleting ${category.name}`}
                      isLoading={deleteCategory.isPending}
                      onClick={() => void remove(category)}
                    >
                      <Check />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Cancel"
                      onClick={() => setConfirmingId(null)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${category.name}`}
                      onClick={() => setEditing(category)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${category.name}`}
                      onClick={() => setConfirmingId(category.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* ------------------------------------------------------------ form */}
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <h3 className="text-foreground text-sm font-semibold">
            {editing ? `Edit ${editing.name}` : "Add a category"}
          </h3>

          {formError ? <Alert variant="destructive">{formError}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" required error={errors.name?.message}>
              <Input {...register("name")} placeholder="Groceries" />
            </FormField>

            <FormField label="Colour" error={errors.color?.message}>
              <div className="flex items-center gap-1.5">
                <input type="hidden" {...register("color")} />
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    aria-label={`Colour ${swatch}`}
                    aria-pressed={color === swatch}
                    onClick={() => setValue("color", color === swatch ? "" : swatch)}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      "size-6 rounded-full transition-transform",
                      "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                      color === swatch
                        ? "ring-foreground scale-110 ring-2 ring-offset-2"
                        : "hover:scale-105",
                    )}
                  />
                ))}
              </div>
            </FormField>
          </div>

          <FormField label="Description" error={errors.description?.message}>
            <Textarea {...register("description")} rows={2} placeholder="Optional" />
          </FormField>

          <div className="flex justify-end gap-2">
            {editing ? (
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" isLoading={isSaving} leftIcon={editing ? undefined : <Plus />}>
              {editing ? "Save changes" : "Add category"}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
}
