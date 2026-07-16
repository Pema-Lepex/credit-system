"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Spinner,
  toast,
} from "@/components/ui";
import {
  notificationHref,
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from "@/features/notifications/api";
import { NotificationIcon } from "@/features/notifications/components/notification-icon";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { cn, formatRelativeDate } from "@/lib/utils";

export interface NotificationBellProps {
  /**
   * Optional seed from the caller. The live count comes from the query below
   * (polled every 60s) and wins as soon as it resolves.
   */
  unreadCount?: number;
  className?: string;
}

/** How many recent items the dropdown shows. Any more and it becomes the page. */
const RECENT_LIMIT = 5;

/**
 * The topbar bell.
 *
 * The badge count is its own query — `unreadNotificationCount`, which the backend
 * documents as "a COUNT(*), not a fetch" — polled on a 60s refetchInterval. The
 * dropdown's list is a SEPARATE query that only runs while the menu is open,
 * because DropdownMenuContent unmounts its children on close. So a closed bell
 * costs one cheap integer a minute, not five notification bodies.
 */
export function NotificationBell({ unreadCount: seed, className }: NotificationBellProps) {
  const router = useRouter();
  const { data: liveCount } = useUnreadCount();

  const unreadCount = liveCount ?? seed ?? 0;
  const hasUnread = unreadCount > 0;
  // Past 9 the exact number stops being useful and starts breaking the layout.
  const display = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={
          hasUnread
            ? `Notifications, ${unreadCount} unread`
            : "Notifications, no unread messages"
        }
        className={cn(
          "text-muted-foreground relative inline-flex size-9 items-center justify-center rounded-md",
          "hover:bg-muted hover:text-foreground transition-colors",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          className,
        )}
      >
        <Bell className="size-4" aria-hidden="true" />
        {hasUnread ? (
          <span
            // A visual duplicate of the count that is already in the accessible name.
            aria-hidden="true"
            className={cn(
              "absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1",
              "bg-destructive text-destructive-foreground text-[10px] leading-4 font-semibold",
              "ring-background ring-2",
            )}
          >
            {display}
          </span>
        ) : null}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" aria-label="Notifications" className="w-80 p-0 sm:w-96">
        <NotificationDropdownBody
          unreadCount={unreadCount}
          onNavigate={(href) => router.push(href)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationDropdownBody({
  unreadCount,
  onNavigate,
}: {
  unreadCount: number;
  onNavigate: (href: string) => void;
}) {
  const { data, isLoading } = useNotifications(null, 1, RECENT_LIMIT);
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const items = data?.items ?? [];

  const onMarkAllRead = async () => {
    try {
      const count = await markAllRead.mutateAsync();
      toast.success(
        count === 0
          ? "Nothing to mark."
          : `${count} notification${count === 1 ? "" : "s"} marked as read.`,
      );
    } catch (error) {
      toast.error(
        error instanceof GraphQLRequestError ? error.message : "Could not mark them read.",
      );
    }
  };

  return (
    // Cap to the shorter of 28rem and the space actually on screen (minus the
    // topbar + gutters), so on a short phone the panel never runs past the
    // viewport — the list in the middle scrolls instead. 100dvh, not 100vh, so
    // mobile browser chrome is accounted for.
    <div className="flex max-h-[min(28rem,calc(100dvh-5rem))] flex-col">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <p className="text-foreground text-sm font-semibold">
          Notifications
          {unreadCount > 0 ? (
            <span className="text-muted-foreground font-normal"> · {unreadCount} unread</span>
          ) : null}
        </p>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={() => void onMarkAllRead()}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium focus-visible:ring-2 focus-visible:outline-none"
          >
            <CheckCheck className="size-3.5" aria-hidden="true" />
            Mark all read
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner label="Loading notifications" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-3 py-8 text-center text-sm">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {items.map((notification) => {
              const href = notificationHref(notification.link);
              const isUnread = notification.state === "UNREAD";

              const open = () => {
                // Opening the thing a notification is about is the clearest possible
                // signal that it has been read.
                if (isUnread) markRead.mutate(notification.id);
                if (href) onNavigate(href);
              };

              return (
                <li key={notification.id}>
                  {/*
                    Interactive only when there is somewhere to go. A button that
                    does nothing is worse than a plain row: a keyboard user tabs to
                    it, presses Enter, and nothing happens.
                  */}
                  <div
                    role={href ? "button" : undefined}
                    tabIndex={href ? 0 : undefined}
                    onClick={href ? open : undefined}
                    onKeyDown={
                      href
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              open();
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      "flex items-start gap-2.5 px-3 py-2.5 text-left",
                      href &&
                        "hover:bg-muted focus-visible:ring-ring cursor-pointer focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                      isUnread && "bg-primary-soft/20",
                    )}
                  >
                    <NotificationIcon kind={notification.kind} size="sm" />

                    <div className="min-w-0 flex-1">
                      <p className="text-foreground flex items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{notification.title}</span>
                        {isUnread ? (
                          <span
                            aria-hidden="true"
                            className="bg-primary size-1.5 shrink-0 rounded-full"
                          />
                        ) : null}
                      </p>
                      <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                        {notification.message}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-[11px]">
                        {formatRelativeDate(notification.createdAt)}
                        {isUnread ? <span className="sr-only"> — unread</span> : null}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-border border-t p-2">
        <Link
          href="/notifications"
          className="text-primary hover:bg-muted focus-visible:ring-ring block rounded-md py-1.5 text-center text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          See all notifications
        </Link>
      </div>
    </div>
  );
}
