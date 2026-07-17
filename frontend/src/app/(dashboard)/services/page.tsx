import { Plus, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { SkeletonTable, buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import { ServiceListView } from "@/features/catalog/components/service-list-view";

export const metadata: Metadata = { title: "Services" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="The services you offer on credit."
        actions={
          <>
            <Link
              href="/services/import"
              className={cn(buttonVariants({ variant: "secondary" }))}
            >
              <Upload />
              Import
            </Link>
            <Link href="/services/new" className={buttonVariants()}>
              <Plus />
              New service
            </Link>
          </>
        }
      />

      <Suspense
        fallback={
          <div className="border-border bg-card rounded-lg border p-4">
            <SkeletonTable rows={6} columns={5} />
          </div>
        }
      >
        <ServiceListView />
      </Suspense>
    </div>
  );
}
