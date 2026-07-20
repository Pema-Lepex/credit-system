import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, SkeletonTable } from "@/components/ui";
import { ExpensesView } from "@/features/expenses/components/expenses-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Expenses" };

/** The Suspense boundary is required by `useSearchParams` in the view below. */
export default function Page() {
  return (
    <PermissionGate permission="expense:read" action="view expenses">
      <Suspense
        fallback={
          <div className="space-y-6">
            <PageHeader
              title="Expenses"
              description="Money going out of the business."
            />
            <Card>
              <CardContent className="pt-6">
                <SkeletonTable rows={8} columns={6} />
              </CardContent>
            </Card>
          </div>
        }
      >
        <ExpensesView />
      </Suspense>
    </PermissionGate>
  );
}
