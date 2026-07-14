"use client";

import { Alert, Skeleton } from "@/components/ui";
import { toServerError } from "@/features/common/errors";
import type { ID } from "@/types";

import { useProduct, useService } from "../queries";
import { ProductForm } from "./product-form";
import { ServiceForm } from "./service-form";

/**
 * The record has to be in hand before the form mounts: React Hook Form reads
 * `defaultValues` once, so a form mounted empty stays empty.
 */
function FormSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-96 rounded-lg lg:col-span-2" />
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}

export function ProductEditView({ id }: { id: ID }) {
  const { data: product, isLoading, error } = useProduct(id);

  if (error) {
    return (
      <Alert variant="destructive" title="Could not load this product">
        {toServerError(error).message}
      </Alert>
    );
  }
  if (isLoading || !product) return <FormSkeleton />;

  return <ProductForm product={product} />;
}

export function ServiceEditView({ id }: { id: ID }) {
  const { data: service, isLoading, error } = useService(id);

  if (error) {
    return (
      <Alert variant="destructive" title="Could not load this service">
        {toServerError(error).message}
      </Alert>
    );
  }
  if (isLoading || !service) return <FormSkeleton />;

  return <ServiceForm service={service} />;
}
