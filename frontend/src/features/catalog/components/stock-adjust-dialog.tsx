"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Minus, Plus } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { Alert, Button, Dialog, FormField, Input, toast } from "@/components/ui";
import { toServerError } from "@/features/common/errors";
import { formatNumber } from "@/lib/format";

import type { ProductRecord } from "../api";
import { useAdjustStock } from "../queries";
import { stockAdjustSchema, type StockAdjustValues } from "../schema";

/**
 * `adjustStock` takes a signed DELTA, not a new total — two staff counting the
 * same shelf at the same time would otherwise overwrite each other's number,
 * whereas two deltas both apply. The delta is a decimal string; it never becomes
 * a JS number on the way out.
 */
export function StockAdjustDialog({
  product,
  onOpenChange,
}: {
  product: ProductRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const adjustStock = useAdjustStock();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<StockAdjustValues>({
    resolver: zodResolver(stockAdjustSchema),
    defaultValues: { delta: "", reason: "" },
  });

  useEffect(() => {
    if (product) reset({ delta: "", reason: "" });
  }, [product, reset]);

  const delta = watch("delta");
  const current = product ? Number(product.stockQuantity) : 0;
  const parsed = Number(delta);
  const preview = Number.isFinite(parsed) && delta !== "" ? current + parsed : null;

  const onSubmit = handleSubmit(async (values) => {
    if (!product) return;
    try {
      const updated = await adjustStock.mutateAsync({
        id: product.id,
        delta: values.delta,
        reason: values.reason.trim() || null,
      });
      toast.success(
        `${updated.name}: stock is now ${formatNumber(updated.stockQuantity)} ${updated.unit}.`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(toServerError(error).message);
    }
  });

  return (
    <Dialog
      open={product !== null}
      onOpenChange={onOpenChange}
      title={`Adjust stock — ${product?.name ?? ""}`}
      description="Add or subtract. Stock is allowed to go negative: a stale count must never block a sale."
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* `form=` submits the form in the dialog body — no second onClick, or
              the mutation fires twice. */}
          <Button type="submit" form="stock-adjust-form" isLoading={adjustStock.isPending}>
            Apply adjustment
          </Button>
        </>
      }
    >
      <form id="stock-adjust-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="bg-muted/50 flex items-baseline justify-between rounded-lg px-4 py-3">
          <span className="text-muted-foreground text-sm">Currently in stock</span>
          <span className="tabular text-foreground text-lg font-semibold">
            {product ? `${formatNumber(product.stockQuantity)} ${product.unit}` : "—"}
          </span>
        </div>

        <FormField
          label="Adjustment"
          required
          error={errors.delta?.message}
          description="Positive to receive, negative to write off."
        >
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Make the adjustment negative"
              onClick={() => setValue("delta", delta.startsWith("-") ? delta.slice(1) : `-${delta || "1"}`)}
            >
              <Minus />
            </Button>
            <Input {...register("delta")} inputMode="decimal" placeholder="12 or -3" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Make the adjustment positive"
              onClick={() => setValue("delta", delta.replace(/^-/, "") || "1")}
            >
              <Plus />
            </Button>
          </div>
        </FormField>

        {preview !== null && product ? (
          <Alert variant={preview < 0 ? "warning" : "info"}>
            New stock level: <strong className="tabular">{formatNumber(preview)}</strong>{" "}
            {product.unit}
            {preview < 0 ? " — this product will read as oversold." : ""}
          </Alert>
        ) : null}

        <FormField label="Reason" error={errors.reason?.message} description="Optional. Recorded in the audit log.">
          <Input {...register("reason")} placeholder="Delivery received / breakage" />
        </FormField>
      </form>
    </Dialog>
  );
}
