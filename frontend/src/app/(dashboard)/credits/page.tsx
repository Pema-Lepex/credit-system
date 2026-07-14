import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, SkeletonTable } from "@/components/ui";
import { CreditsView } from "@/features/credits/components/credits-view";

export const metadata: Metadata = { title: "Credits" };

/**
 * The list reads its filters from the query string with `useSearchParams`, which
 * Next requires to sit inside a Suspense boundary — without one, the whole route
 * opts out of static rendering and the build says so. The fallback is the same
 * skeleton the query's own pending state uses, so there is no second layout shift.
 */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <PageHeader
            title="Credits"
            description="Every credit you have written, and exactly what is still owed on it."
          />
          <Card>
            <CardContent className="pt-6">
              <SkeletonTable rows={8} columns={6} />
            </CardContent>
          </Card>
        </div>
      }
    >
      <CreditsView />
    </Suspense>
  );
}
