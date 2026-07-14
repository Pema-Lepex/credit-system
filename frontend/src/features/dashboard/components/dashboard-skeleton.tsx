"use client";

import { Card, Skeleton } from "@/components/ui";

/**
 * The loading shape mirrors the loaded shape — same grid, same card heights — so
 * nothing jumps when the data lands. A spinner in the middle of the page would
 * reflow every widget the instant it resolved.
 */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading your dashboard</span>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <Card key={index} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-64 w-full sm:h-72" />
        </Card>
        <Card className="p-5">
          <Skeleton className="mb-4 h-5 w-32" />
          <Skeleton className="h-64 w-full sm:h-72" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="space-y-4 p-5">
            <Skeleton className="h-5 w-36" />
            {Array.from({ length: 5 }).map((__, row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-4 w-16 shrink-0" />
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}
