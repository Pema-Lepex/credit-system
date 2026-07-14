import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/features/settings/components/permission-gate";
import { RetentionSettings } from "@/features/settings/components/retention-settings";

export const metadata: Metadata = { title: "Data retention" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data retention"
        description="How long settled records stay in your active lists — and exactly what is scheduled for deletion, with time to change your mind."
      />
      <PermissionGate permission="settings:read" action="view retention settings">
        <RetentionSettings />
      </PermissionGate>
    </div>
  );
}
