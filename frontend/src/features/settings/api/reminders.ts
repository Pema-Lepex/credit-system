"use client";

/**
 * The reminder queue: `reminders(status, page)`.
 *
 * The reminder *settings* live on the Business row (see api/business.ts) — this
 * module is only the queue of what has been scheduled, sent, or has failed.
 * `lastError` is selected deliberately: a FAILED customer reminder on a
 * relay-only email provider carries an explanation, and hiding it would leave a
 * shopkeeper believing their customer was chased when they were not.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { gqlRequest } from "@/lib/graphql/client";
import type {
  ID,
  ISODate,
  ISODateTime,
  ReminderAudience,
  ReminderChannel,
  ReminderStatus,
} from "@/types";
import type { PageInfo } from "./users";

export interface ScheduledReminderRow {
  id: ID;
  creditId: ID;
  customerId: ID;
  audience: ReminderAudience;
  channel: ReminderChannel;
  scheduledFor: ISODate;
  daysBeforeDue: number;
  status: ReminderStatus;
  sentAt: ISODateTime | null;
  attempts: number;
  lastError: string | null;
}

export interface ReminderPage {
  items: ScheduledReminderRow[];
  pageInfo: PageInfo;
}

const REMINDERS_QUERY = /* GraphQL */ `
  query Reminders($status: [ReminderStatus!], $page: PageInput) {
    reminders(status: $status, page: $page) {
      items {
        id
        creditId
        customerId
        audience
        channel
        scheduledFor
        daysBeforeDue
        status
        sentAt
        attempts
        lastError
      }
      pageInfo {
        total
        page
        limit
        pages
        hasNext
        hasPrevious
      }
    }
  }
`;

export interface RemindersFilter {
  /** Empty = every status. */
  status: ReminderStatus[];
  page: number;
  limit: number;
}

export const reminderKeys = {
  all: ["reminders"] as const,
  list: (filter: RemindersFilter) => ["reminders", "list", filter] as const,
};

export function useReminders(filter: RemindersFilter): UseQueryResult<ReminderPage> {
  return useQuery({
    queryKey: reminderKeys.list(filter),
    queryFn: async () => {
      const data = await gqlRequest<
        { reminders: ReminderPage },
        { status: ReminderStatus[] | null; page: { page: number; limit: number } }
      >(REMINDERS_QUERY, {
        status: filter.status.length > 0 ? filter.status : null,
        page: { page: filter.page, limit: filter.limit },
      });
      return data.reminders;
    },
    placeholderData: (previous) => previous,
  });
}
