"use client";

/**
 * `notifications(state, page)`, `unreadNotificationCount`, and the four mutations.
 *
 * The unread count is its own query, on its own key, polled on a 60s interval by
 * the topbar bell. It is a COUNT(*) on the server — deliberately cheap — so
 * polling it is fine, whereas polling the full notification list every minute for
 * a number would not be.
 *
 * Every mutation invalidates BOTH the list and the count: marking one item read
 * changes the badge, and a stale badge is the most visible bug this feature can
 * have.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type {
  ID,
  ISODateTime,
  NotificationKind,
  NotificationLink,
  NotificationState,
} from "@/types";
import type { PageInfo } from "@/features/settings/api/users";

export interface AppNotification {
  id: ID;
  kind: NotificationKind;
  state: NotificationState;
  title: string;
  message: string;
  /** JSON deep-link payload, e.g. {"type":"credit","id":"…"}. */
  link: NotificationLink;
  readAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface NotificationPage {
  items: AppNotification[];
  pageInfo: PageInfo;
  unreadCount: number;
}

const NOTIFICATION_FIELDS = /* GraphQL */ `
  fragment NotificationFields on NotificationType {
    id
    kind
    state
    title
    message
    link
    readAt
    createdAt
  }
`;

const NOTIFICATIONS_QUERY = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  query Notifications($state: NotificationState, $page: PageInput) {
    notifications(state: $state, page: $page) {
      items {
        ...NotificationFields
      }
      pageInfo {
        total
        page
        limit
        pages
        hasNext
        hasPrevious
      }
      unreadCount
    }
  }
`;

const UNREAD_COUNT_QUERY = /* GraphQL */ `
  query UnreadNotificationCount {
    unreadNotificationCount
  }
`;

const MARK_READ_MUTATION = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  mutation MarkNotificationRead($id: ID!) {
    markNotificationRead(id: $id) {
      ...NotificationFields
    }
  }
`;

const MARK_ALL_READ_MUTATION = /* GraphQL */ `
  mutation MarkAllNotificationsRead {
    markAllNotificationsRead
  }
`;

const ARCHIVE_MUTATION = /* GraphQL */ `
  ${NOTIFICATION_FIELDS}
  mutation ArchiveNotification($id: ID!) {
    archiveNotification(id: $id) {
      ...NotificationFields
    }
  }
`;

const DELETE_MUTATION = /* GraphQL */ `
  mutation DeleteNotification($id: ID!) {
    deleteNotification(id: $id) {
      success
      message
    }
  }
`;

export const notificationKeys = {
  all: ["notifications"] as const,
  list: (state: NotificationState | null, page: number, limit: number) =>
    ["notifications", "list", state, page, limit] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,
};

export function useNotifications(
  state: NotificationState | null,
  page: number,
  limit = 20,
): UseQueryResult<NotificationPage> {
  return useQuery({
    queryKey: notificationKeys.list(state, page, limit),
    queryFn: async () => {
      const data = await gqlRequest<
        { notifications: NotificationPage },
        { state: NotificationState | null; page: { page: number; limit: number } }
      >(NOTIFICATIONS_QUERY, { state, page: { page, limit } });
      return data.notifications;
    },
    placeholderData: (previous) => previous,
  });
}

/** The badge count. Polled — see the module note. */
export function useUnreadCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: async () => {
      const data = await gqlRequest<{ unreadNotificationCount: number }>(UNREAD_COUNT_QUERY);
      return data.unreadNotificationCount;
    },
    refetchInterval: 60_000,
    // The count is worth re-checking when the user comes back to the tab, even
    // though the global default turns this off for everything else.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

function useInvalidateNotifications() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });
}

/**
 * Mark one notification read — optimistically.
 *
 * Clicking a notification in the bell dropdown should feel instant, but the round
 * trip is a full GraphQL request. So we apply the change to the cache up front:
 * flip the item to READ in every cached list page and drop the unread badge by
 * one, immediately. If the server rejects it we roll the snapshot back; either
 * way we re-sync from the server on settle.
 */
export function useMarkRead() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateNotifications();

  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ markNotificationRead: AppNotification }, { id: ID }>(
        MARK_READ_MUTATION,
        { id },
      );
      return data.markNotificationRead;
    },

    onMutate: async (id: ID) => {
      // Stop any in-flight refetch from clobbering the optimistic snapshot.
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });

      // Snapshot everything we touch so onError can restore it verbatim.
      const listSnapshots = queryClient.getQueriesData<NotificationPage>({
        queryKey: notificationKeys.all,
      });
      const previousCount = queryClient.getQueryData<number>(notificationKeys.unreadCount());

      // Was the target actually unread? Only then should the badge move.
      let wasUnread = false;
      const readAt = new Date().toISOString();

      for (const [key, page] of listSnapshots) {
        if (!page) continue;
        let changed = false;
        const items = page.items.map((item) => {
          if (item.id !== id || item.state !== "UNREAD") return item;
          changed = true;
          wasUnread = true;
          return { ...item, state: "READ" as NotificationState, readAt };
        });
        if (!changed) continue;
        queryClient.setQueryData<NotificationPage>(key, {
          ...page,
          items,
          unreadCount: Math.max(0, page.unreadCount - 1),
        });
      }

      if (wasUnread && typeof previousCount === "number") {
        queryClient.setQueryData<number>(
          notificationKeys.unreadCount(),
          Math.max(0, previousCount - 1),
        );
      }

      return { listSnapshots, previousCount };
    },

    onError: (_error, _id, context) => {
      // Put every cache back exactly as it was before the optimistic write.
      context?.listSnapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(notificationKeys.unreadCount(), context.previousCount);
      }
    },

    // Reconcile with server truth whether we succeeded or rolled back.
    onSettled: () => void invalidate(),
  });
}

export function useMarkAllRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async () => {
      const data = await gqlRequest<{ markAllNotificationsRead: number }>(MARK_ALL_READ_MUTATION);
      return data.markAllNotificationsRead;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useArchiveNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ archiveNotification: AppNotification }, { id: ID }>(
        ARCHIVE_MUTATION,
        { id },
      );
      return data.archiveNotification;
    },
    onSuccess: () => void invalidate(),
  });
}

export function useDeleteNotification() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<
        { deleteNotification: { success: boolean; message: string } },
        { id: ID }
      >(DELETE_MUTATION, { id });
      return data.deleteNotification;
    },
    onSuccess: () => void invalidate(),
  });
}

/**
 * Turn the `link` JSON into a route.
 *
 * The payload is `{type, id}` (or an explicit `url`). An unknown type returns null
 * rather than guessing a route — a deep-link to a 404 is worse than a
 * notification that simply is not clickable.
 */
export function notificationHref(link: NotificationLink | null | undefined): string | null {
  if (!link) return null;
  if (typeof link.url === "string" && link.url.startsWith("/")) return link.url;
  if (!link.type || !link.id) return null;

  const routes: Record<string, string> = {
    credit: "/credits",
    customer: "/customers",
    payment: "/payments",
    product: "/products",
    service: "/services",
    export: "/reports",
  };

  const base = routes[link.type];
  return base ? `${base}/${link.id}` : null;
}
