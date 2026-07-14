"use client";

import { ArrowRight, CalendarCheck } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  buttonVariants,
} from "@/components/ui";
import { DueDateBadge } from "@/features/credits/components/status-badges";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { UpcomingDueCredit } from "@/features/dashboard/queries";
import { cn, formatDate } from "@/lib/utils";

/**
 * What to chase today, and in what order.
 *
 * The list is the API's — already sorted by due date and limited — so it is the
 * same "next seven days" the reminder sweep is working from. Showing a different
 * horizon here than the one that actually sends emails would be a lie by omission.
 */
export function UpcomingDue({ credits }: { credits: UpcomingDueCredit[] }) {
  const money = useMoney();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Upcoming due dates</CardTitle>
        <Link
          href="/credits?status=PENDING,PARTIALLY_PAID,OVERDUE"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-2")}
        >
          All open
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardHeader>

      <CardContent className="flex-1">
        {credits.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<CalendarCheck />}
            title="Nothing falls due soon"
            description="Credits approaching their due date appear here so you know who to call."
          />
        ) : (
          <ul className="divide-border -my-1 divide-y">
            {credits.map((credit) => (
              <li key={credit.id}>
                <Link
                  href={`/credits/${credit.id}`}
                  className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block truncate text-sm font-medium">
                      {credit.customer?.name ?? "Unknown customer"}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {credit.number} · {formatDate(credit.dueDate)}
                    </span>
                  </span>

                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-foreground tabular text-sm font-medium">
                      {money.format(credit.remainingAmount)}
                    </span>
                    <DueDateBadge dueDate={credit.dueDate} status={credit.status} size="sm" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
