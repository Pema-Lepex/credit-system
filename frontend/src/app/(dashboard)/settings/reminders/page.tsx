import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/features/settings/components/permission-gate";
import { ReminderQueue } from "@/features/settings/components/reminder-queue";
import { ReminderSettings } from "@/features/settings/components/reminder-settings";

export const metadata: Metadata = { title: "Reminders" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminders"
        description="Nudge customers before a credit falls due, and keep yourself informed when things change."
      />
      <PermissionGate permission="settings:read" action="view reminder settings">
        <div className="space-y-6">
          <ReminderSettings />
          <ReminderQueue />
        </div>
      </PermissionGate>
    </div>
  );
}
