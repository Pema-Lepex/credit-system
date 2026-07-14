import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { NotificationsView } from "@/features/notifications/components/notifications-view";

export const metadata: Metadata = { title: "Notifications" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Reminders sent, payments received, and everything else worth knowing."
      />
      {/* Not gated: notifications are addressed to the signed-in user. */}
      <NotificationsView />
    </div>
  );
}
