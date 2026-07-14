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

export function useMarkRead() {
  const invalidate = useInvalidateNotifications();
  return useMutation({
    mutationFn: async (id: ID) => {
      const data = await gqlRequest<{ markNotificationRead: AppNotification }, { id: ID }>(
        MARK_READ_MUTATION,
        { id },
      );
      return data.markNotificationRead;
    },
    onSuccess: () => void invalidate(),
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
