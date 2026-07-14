import { PackagePlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { SkeletonTable, buttonVariants } from "@/components/ui";
import { ProductListView } from "@/features/catalog/components/product-list-view";

export const metadata: Metadata = { title: "Products" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="The goods you sell on credit."
        actions={
          <Link href="/products/new" className={buttonVariants()}>
            <PackagePlus />
            New product
          </Link>
        }
      />

      {/* useSearchParams() below opts this subtree out of prerendering. */}
      <Suspense
        fallback={
          <div className="border-border bg-card rounded-lg border p-4">
            <SkeletonTable rows={6} columns={5} />
          </div>
        }
      >
        <ProductListView />
      </Suspense>
    </div>
  );
}
