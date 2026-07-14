import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ProductForm } from "@/features/catalog/components/product-form";

export const metadata: Metadata = { title: "New product" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="New product" description="A name and a price are all you need to start." />
      <ProductForm />
    </div>
  );
}
