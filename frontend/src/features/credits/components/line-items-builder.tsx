"use client";

import { Package, Plus, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import type { FieldErrors, UseFieldArrayReturn, UseFormRegister } from "react-hook-form";

import { Badge, Button, EmptyState, Input, Label } from "@/components/ui";
import { CatalogPicker } from "@/features/credits/components/catalog-picker";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import { centsToMoney, computeLineTotals } from "@/features/credits/lib/money";
import { emptyItem, type CreditFormValues } from "@/features/credits/lib/schema";
import type { CatalogEntry } from "@/features/credits/queries";
import { cn } from "@/lib/utils";

export interface LineItemsBuilderProps {
  fields: UseFieldArrayReturn<CreditFormValues, "items">;
  register: UseFormRegister<CreditFormValues>;
  errors: FieldErrors<CreditFormValues>;
  /** The live values, watched by the parent — the totals must update as you type. */
  items: CreditFormValues["items"];
  /** The business's default tax rate, pre-filled on new lines. */
  defaultTaxPercentage: string;
}

/**
 * The line-item builder.
 *
 * Each row shows its own running total, computed with the SAME formula the server
 * uses (lib/money.ts mirrors CreditService.compute_item_totals), in integer cents.
 * The server is still the source of truth and will recompute on save — the point of
 * the preview is not to be authoritative, it is to not be *wrong*. A shopkeeper who
 * reads "1,250.00" here and gets a receipt saying "1,249.99" will never trust the
 * app again, and that is exactly what float arithmetic produces.
 */
export function LineItemsBuilder({
  fields,
  register,
  errors,
  items,
  defaultTaxPercentage,
}: LineItemsBuilderProps) {
  const money = useMoney();
  const [pickerOpen, setPickerOpen] = useState(false);

  const addFromCatalog = (entry: CatalogEntry) => {
    fields.append({
      productId: entry.kind === "PRODUCT" ? entry.id : null,
      serviceId: entry.kind === "SERVICE" ? entry.id : null,
      kind: entry.kind,
      name: entry.name,
      description: "",
      unit: entry.unit,
      quantity: "1",
      // Snapshot the catalog price and tax. Editable from here on.
      unitPrice: entry.price,
      discountAmount: "0",
      taxPercentage: entry.taxPercentage ?? defaultTaxPercentage,
    });
  };

  const rootError =
    typeof errors.items?.message === "string" ? errors.items.message : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Label>Items</Label>
          <p className="text-muted-foreground text-xs">
            Pull from your catalog, or type a one-off line.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            leftIcon={<Package />}
            onClick={() => setPickerOpen(true)}
          >
            From catalog
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<Plus />}
            onClick={() => fields.append(emptyItem(defaultTaxPercentage))}
          >
            Custom line
          </Button>
        </div>
      </div>

      {rootError ? (
        <p role="alert" className="text-destructive-soft-foreground text-xs font-medium">
          {rootError}
        </p>
      ) : null}

      {fields.fields.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Package />}
          title="No items yet"
          description="A credit needs at least one line. Add one from your catalog, or type a custom one."
        />
      ) : (
        <ul className="space-y-3">
          {fields.fields.map((field, index) => {
            const values = items[index];
            const itemErrors = errors.items?.[index];

            // Recomputed on every keystroke, in integer cents. Never a float.
            const totals = values
              ? computeLineTotals({
                  quantity: values.quantity,
                  unitPrice: values.unitPrice,
                  discountAmount: values.discountAmount || "0",
                  taxPercentage: values.taxPercentage || "0",
                })
              : null;

            const kind = values?.kind ?? "CUSTOM";

            return (
              <li
                key={field.id}
                className="border-border bg-card space-y-3 rounded-lg border p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor={`item-name-${index}`}
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Item {index + 1}
                      </label>
                      {kind !== "CUSTOM" ? (
                        <Badge size="sm" variant={kind === "PRODUCT" ? "primary" : "info"}>
                          {kind === "PRODUCT" ? (
                            <Package aria-hidden="true" className="size-3" />
                          ) : (
                            <Wrench aria-hidden="true" className="size-3" />
                          )}
                          {kind === "PRODUCT" ? "Product" : "Service"}
                        </Badge>
                      ) : null}
                    </div>

                    <Input
                      id={`item-name-${index}`}
                      placeholder="What did they take?"
                      invalid={Boolean(itemErrors?.name)}
                      aria-describedby={
                        itemErrors?.name ? `item-name-error-${index}` : undefined
                      }
                      {...register(`items.${index}.name`)}
                    />

                    {itemErrors?.name?.message ? (
                      <p
                        id={`item-name-error-${index}`}
                        role="alert"
                        className="text-destructive-soft-foreground text-xs font-medium"
                      >
                        {itemErrors.name.message}
                      </p>
                    ) : null}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => fields.remove(index)}
                    className="text-muted-foreground hover:text-destructive-soft-foreground mt-6 shrink-0"
                  >
                    <Trash2 />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <NumberCell
                    label="Qty"
                    id={`item-qty-${index}`}
                    error={itemErrors?.quantity?.message}
                    {...register(`items.${index}.quantity`)}
                  />
                  <NumberCell
                    label="Unit price"
                    id={`item-price-${index}`}
                    error={itemErrors?.unitPrice?.message}
                    {...register(`items.${index}.unitPrice`)}
                  />
                  <NumberCell
                    label="Discount"
                    id={`item-discount-${index}`}
                    error={itemErrors?.discountAmount?.message}
                    {...register(`items.${index}.discountAmount`)}
                  />
                  <NumberCell
                    label="Tax %"
                    id={`item-tax-${index}`}
                    error={itemErrors?.taxPercentage?.message}
                    {...register(`items.${index}.taxPercentage`)}
                  />

                  <div className="col-span-2 flex flex-col justify-end sm:col-span-1">
                    <span className="text-muted-foreground text-xs">Line total</span>
                    <span
                      className={cn(
                        "text-foreground tabular flex h-9 items-center justify-end text-sm font-semibold",
                        totals?.discountExceedsSubtotal && "text-destructive-soft-foreground",
                      )}
                    >
                      {totals ? money.format(centsToMoney(totals.lineTotalCents)) : "—"}
                    </span>
                  </div>
                </div>

                {/* The server raises a VALIDATION_ERROR for this; say so before the
                    round trip rather than after. */}
                {totals?.discountExceedsSubtotal ? (
                  <p role="alert" className="text-destructive-soft-foreground text-xs font-medium">
                    The discount is bigger than the line itself.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <CatalogPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={addFromCatalog} />
    </div>
  );
}

/**
 * A compact numeric cell. `inputMode="decimal"` gets the numeric keypad on a phone
 * without the spinner arrows and scroll-wheel hazards of `type="number"` — and,
 * critically, keeps the value a STRING all the way to the mutation.
 */
const NumberCell = function NumberCell({
  label,
  id,
  error,
  ...props
}: {
  label: string;
  id: string;
  error?: string;
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground block text-xs">
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        className="tabular text-right"
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-destructive-soft-foreground text-xs font-medium"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};
