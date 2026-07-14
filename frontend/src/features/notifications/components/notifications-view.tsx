"use client";

import { Archive, ArrowRight, BellOff, Check, CheckCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Pagination,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  toast,
} from "@/components/ui";
import {
  notificationHref,
  useArchiveNotification,
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  type AppNotification,
} from "@/features/notifications/api";
import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { NOTIFICATION_KIND_STYLES, cn, formatDateTime, formatRelativeDate } from "@/lib/utils";
import type { NotificationState } from "@/types";

const TABS: { value: string; label: string; state: NotificationState | null }[] = [
  { value: "unread", label: "Unread", state: "UNREAD" },
  { value: "read", label: "Read", state: "READ" },
  { value: "archived", label: "Archived", state: "ARCHIVED" },
];

export function NotificationsView() {
  const [tab, setTab] = useState("unread");
  const [page, setPage] = useState(1);

  const state = TABS.find((t) => t.value === tab)?.state ?? null;
  const { data, isLoading, isError } = useNotifications(state, page);

  const markAllRead = useMarkAllRead();

  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  const onMarkAllRead = async () => {
    try {
      const count = await markAllRead.mutateAsync();
      toast.success(
        count === 0 ? "Nothing to mark." : `${count} notification${count === 1 ? "" : "s"} marked as read.`,
      );
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not mark them read.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={tab}
          defaultValue="unread"
          onValueChange={(value) => {
            setTab(value);
            setPage(1);
          }}
        >
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                <span className="flex items-center gap-1.5">
                  {t.label}
                  {t.value === "unread" && unreadCount > 0 ? (
                    <Badge variant="primary" size="sm">
                      {unreadCount}
                    </Badge>
                  ) : null}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<CheckCheck />}
          disabled={unreadCount === 0}
          isLoading={markAllRead.isPending}
          onClick={() => void onMarkAllRead()}
        >
          Mark all as read
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive-soft-foreground text-sm">
              Could not load your notifications.
            </p>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<BellOff />}
              title={
                tab === "unread"
                  ? "You're all caught up"
                  : tab === "archived"
                    ? "Nothing archived"
                    : "Nothing read yet"
              }
              description={
                tab === "unread"
                  ? "New reminders, payments and warnings will appear here."
                  : "Notifications you deal with end up here."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* A list, not a stack of divs: AT announces "list, 12 items". */}
          <ul className="space-y-2">
            {items.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </ul>

          <Pagination
            page={page}
            pageSize={20}
            totalItems={data?.pageInfo.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

function NotificationRow({ notification }: { notification: AppNotification }) {
  const markRead = useMarkRead();
  const archive = useArchiveNotification();
  const remove = useDeleteNotification();

  const href = notificationHref(notification.link);
  const isUnread = notification.state === "UNREAD";
  const kindStyle = NOTIFICATION_KIND_STYLES[notification.kind];

  const act = async (
    run: () => Promise<unknown>,
    success: string,
    failure: string,
  ): Promise<void> => {
    try {
      await run();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof GraphQLRequestError ? error.message : failure);
    }
  };

  return (
    <li>
      <Card
        className={cn(
          "transition-colors",
          isUnread && "border-primary/30 bg-primary-soft/20",
        )}
      >
        <CardContent className="flex items-start gap-3 p-4 sm:p-4">
          <NotificationIcon kind={notification.kind} />

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-foreground text-sm font-semibold">{notification.title}</p>
              {isUnread ? (
                <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
              ) : null}
              <Badge variant="neutral" size="sm">
                {kindStyle.label}
              </Badge>
              {isUnread ? <span className="sr-only">Unread</span> : null}
            </div>

            <p className="text-muted-foreground text-sm leading-relaxed">
              {notification.message}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              <Tooltip content={formatDateTime(notification.createdAt)}>
                <time
                  dateTime={notification.createdAt}
                  className="text-muted-foreground text-xs"
                >
                  {formatRelativeDate(notification.createdAt)}
                </time>
              </Tooltip>

              {href ? (
                <Link
                  href={href}
                  onClick={() => {
                    // Opening the thing the notification is about is the clearest
                    // possible signal that it has been read.
                    if (isUnread) markRead.mutate(notification.id);
                  }}
                  className="text-primary inline-flex items-center gap-1 text-xs font-medium hover:underline"
                >
                  View
                  <ArrowRight className="size-3" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isUnread ? (
              <Tooltip content="Mark as read">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Mark "${notification.title}" as read`}
                  isLoading={markRead.isPending}
                  onClick={() =>
                    void act(
                      () => markRead.mutateAsync(notification.id),
                      "Marked as read.",
                      "Could not mark it read.",
                    )
                  }
                >
                  <Check />
                </Button>
              </Tooltip>
            ) : null}

            {notification.state !== "ARCHIVED" ? (
              <Tooltip content="Archive">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Archive "${notification.title}"`}
                  isLoading={archive.isPending}
                  onClick={() =>
                    void act(
                      () => archive.mutateAsync(notification.id),
                      "Archived.",
                      "Could not archive it.",
                    )
                  }
                >
                  <Archive />
                </Button>
              </Tooltip>
            ) : null}

            <Tooltip content="Delete">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete "${notification.title}"`}
                isLoading={remove.isPending}
                onClick={() =>
                  void act(
                    () => remove.mutateAsync(notification.id),
                    "Deleted.",
                    "Could not delete it.",
                  )
                }
              >
                <Trash2 />
              </Button>
            </Tooltip>
          </div>
        </CardContent>
      </Card>
    </li>
  );
}
