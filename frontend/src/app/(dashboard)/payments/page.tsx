import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, SkeletonTable } from "@/components/ui";
import { PaymentsView } from "@/features/payments/components/payments-view";

export const metadata: Metadata = { title: "Payments" };

/** The Suspense boundary is required by `useSearchParams` in the view below. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <PageHeader
            title="Payments"
            description="Every payment, as an append-only ledger."
          />
          <Card>
            <CardContent className="pt-6">
              <SkeletonTable rows={8} columns={6} />
            </CardContent>
          </Card>
        </div>
      }
    >
      <PaymentsView />
    </Suspense>
  );
}
