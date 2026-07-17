import { Upload, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { SkeletonTable, buttonVariants } from "@/components/ui";
import { CustomerListView } from "@/features/customers/components/customer-list-view";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Customers" };

/**
 * Server Component. The filter/table half is client (it owns URL state and
 * TanStack Query), and is wrapped in Suspense because `useSearchParams()` opts
 * its subtree out of static prerendering — without the boundary the build fails.
 */
export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="The people who owe you — and how reliably they pay."
        actions={
          <>
            <Link
              href="/customers/import"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              <Upload />
              Import
            </Link>
            <Link href="/customers/new" className={buttonVariants()}>
              <UserPlus />
              New customer
            </Link>
          </>
        }
      />

      <Suspense
        fallback={
          <div className="border-border bg-card rounded-lg border p-4">
            <SkeletonTable rows={6} columns={6} />
          </div>
        }
      >
        <CustomerListView />
      </Suspense>
    </div>
  );
}
