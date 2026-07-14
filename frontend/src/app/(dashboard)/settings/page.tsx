import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { SettingsIndex } from "@/features/settings/components/settings-index";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Everything about how your business runs — profile, staff, emails, reminders, storage and your data."
      />
      <SettingsIndex />
    </div>
  );
}
