"use client";

import { ArrowRight, CreditCard, Inbox, Receipt } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  buttonVariants,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { ActivityItem } from "@/features/dashboard/queries";
import { formatRelativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The unified feed: credits written and payments taken, interleaved in time.
 *
 * Two separate lists would make the owner reconcile them by eye — "did that
 * payment come in before or after I gave him the new credit?" is exactly the
 * question one merged, time-ordered feed answers for free.
 */
export function LatestActivity({ items }: { items: ActivityItem[] }) {
  const money = useMoney();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Latest activity</CardTitle>
        <Link
          href="/payments"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-2")}
        >
          View ledger
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardHeader>

      <CardContent className="flex-1">
        {items.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Inbox />}
            title="Nothing has happened yet"
            description="New credits and payments show up here as they are recorded."
          />
        ) : (
          <ul className="divide-border -my-1 divide-y">
            {items.map((item) => {
              const isPayment = item.kind === "payment";
              // A payment has no page of its own; the ledger, filtered to its
              // number, is the closest honest destination.
              const href = isPayment
                ? `/payments?q=${encodeURIComponent(item.label)}`
                : `/credits/${item.id}`;

              return (
                <li key={`${item.kind}-${item.id}`}>
                  <Link
                    href={href}
                    className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                        isPayment
                          ? "bg-success-soft text-success-soft-foreground"
                          : "bg-primary-soft text-primary-soft-foreground",
                      )}
                    >
                      {isPayment ? <Receipt /> : <CreditCard />}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {item.customerName}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {isPayment ? "Payment" : "Credit"} {item.label} ·{" "}
                        {formatRelativeDate(item.at)}
                      </span>
                    </span>

                    <span
                      className={cn(
                        "tabular shrink-0 text-sm font-medium",
                        isPayment ? "text-success-soft-foreground" : "text-foreground",
                      )}
                    >
                      {isPayment ? "+" : ""}
                      {money.format(item.amount)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
