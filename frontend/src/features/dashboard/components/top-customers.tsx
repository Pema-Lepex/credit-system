"use client";

import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";

import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  buttonVariants,
} from "@/components/ui";
import { useMoney } from "@/features/credits/hooks/use-business-settings";
import type { TopCustomer } from "@/features/dashboard/queries";
import { cn, creditScoreStyle } from "@/lib/utils";

/**
 * Who owes the most.
 *
 * Sorted by OUTSTANDING, not by total credit: the customer who has bought the most
 * and paid every time is not a risk, and putting them at the top of this list would
 * point the owner at the wrong person.
 */
export function TopCustomers({ customers }: { customers: TopCustomer[] }) {
  const money = useMoney();

  return (
    <Card className="flex flex-col">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Top customers by balance</CardTitle>
        <Link
          href="/customers"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-2")}
        >
          All customers
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </CardHeader>

      <CardContent className="flex-1">
        {customers.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Users />}
            title="No customers yet"
            description="Add a customer, write their first credit, and they will show up here."
          />
        ) : (
          <ul className="divide-border -my-1 divide-y">
            {customers.map((customer) => {
              const score = creditScoreStyle(customer.creditScore);
              return (
                <li key={customer.customerId}>
                  <Link
                    href={`/customers/${customer.customerId}`}
                    className="focus-visible:ring-ring hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <Avatar size="sm" name={customer.name} seed={customer.customerId} />

                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {customer.name}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {customer.creditCount} credit{customer.creditCount === 1 ? "" : "s"} ·{" "}
                        {money.format(customer.totalCredit)} written
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-foreground tabular text-sm font-medium">
                        {money.format(customer.outstanding)}
                      </span>
                      {/* The number AND the word — a 34 means nothing on its own, and
                          the colour alone would mean nothing to a colourblind reader. */}
                      <Badge size="sm" className={score.className}>
                        {score.label} · {customer.creditScore}
                      </Badge>
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
