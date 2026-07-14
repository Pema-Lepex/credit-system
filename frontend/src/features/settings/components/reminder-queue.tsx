"use client";

import { BellOff, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Pagination,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
} from "@/components/ui";
import { useReminders } from "@/features/settings/api/reminders";
import { REMINDER_STATUS_STYLES, cn, formatDate, formatRelativeDate } from "@/lib/utils";
import type { ReminderStatus } from "@/types";

const TABS: { value: string; label: string; statuses: ReminderStatus[] }[] = [
  { value: "all", label: "All", statuses: [] },
  { value: "upcoming", label: "Upcoming", statuses: ["SCHEDULED"] },
  { value: "sent", label: "Sent", statuses: ["SENT"] },
  { value: "failed", label: "Failed", statuses: ["FAILED"] },
];

const AUDIENCE_LABELS = {
  CUSTOMER: "Customer",
  OWNER: "You",
  BOTH: "Both",
} as const;

/**
 * The reminder queue.
 *
 * `lastError` is rendered in full on a FAILED row rather than tucked behind a
 * "details" link. When customer email is not deliverable, THIS is where the user
 * finds out — and a truncated "Error" chip would let them scroll past it.
 */
export function ReminderQueue() {
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);

  const statuses = TABS.find((t) => t.value === tab)?.statuses ?? [];
  const { data, isLoading, isError, error } = useReminders({ status: statuses, page, limit: 10 });

  const reminders = data?.items ?? [];
  const total = data?.pageInfo.total ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminder queue</CardTitle>
        <CardDescription>
          Everything scheduled, sent, or failed. A failed reminder always says why.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Tabs
          value={tab}
          defaultValue="all"
          onValueChange={(value) => {
            setTab(value);
            setPage(1);
          }}
        >
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <SkeletonTable rows={4} columns={5} />
        ) : isError ? (
          <p className="text-destructive-soft-foreground text-sm">
            {error instanceof Error ? error.message : "Could not load the reminder queue."}
          </p>
        ) : reminders.length === 0 ? (
          <EmptyState
            icon={<BellOff />}
            size="sm"
            title={tab === "failed" ? "No failed reminders" : "Nothing here yet"}
            description={
              tab === "failed"
                ? "Nothing has failed to send. That is the good outcome."
                : "Reminders appear here once a credit is close to its due date."
            }
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Credit</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reminders.map((reminder) => {
                    const style = REMINDER_STATUS_STYLES[reminder.status];
                    return (
                      <TableRow key={reminder.id}>
                        <TableCell>
                          <Badge className={cn(style.className)} dot>
                            {style.label}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <div className="min-w-0">
                            <p className="text-sm">{formatDate(reminder.scheduledFor)}</p>
                            <p className="text-muted-foreground text-xs">
                              {reminder.daysBeforeDue === 0
                                ? "On the due date"
                                : reminder.daysBeforeDue > 0
                                  ? `${reminder.daysBeforeDue} days before due`
                                  : `${Math.abs(reminder.daysBeforeDue)} days overdue`}
                            </p>
                          </div>
                        </TableCell>

                        <TableCell>
                          <span className="text-sm">{AUDIENCE_LABELS[reminder.audience]}</span>
                          <span className="text-muted-foreground ml-1.5 text-xs">
                            via {reminder.channel.toLowerCase()}
                          </span>
                        </TableCell>

                        <TableCell>
                          <Link
                            href={`/credits/${reminder.creditId}`}
                            className="text-primary inline-flex items-center gap-1 text-sm hover:underline"
                          >
                            View
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </Link>
                        </TableCell>

                        <TableCell>
                          {reminder.status === "FAILED" && reminder.lastError ? (
                            // The whole reason this column exists.
                            <p className="text-destructive-soft-foreground max-w-md text-xs leading-relaxed">
                              {reminder.lastError}
                            </p>
                          ) : reminder.sentAt ? (
                            <Tooltip content={formatDate(reminder.sentAt, "d MMM yyyy, HH:mm")}>
                              <span className="text-muted-foreground text-xs">
                                Sent {formatRelativeDate(reminder.sentAt)}
                              </span>
                            </Tooltip>
                          ) : reminder.attempts > 0 ? (
                            <span className="text-muted-foreground text-xs">
                              {reminder.attempts} attempt{reminder.attempts === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            <Pagination page={page} pageSize={10} totalItems={total} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
