import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/features/settings/components/permission-gate";
import { StorageDashboard } from "@/features/settings/components/storage-dashboard";

export const metadata: Metadata = { title: "Storage" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage"
        description="What you are using, what is using it, and the tools to clean it up."
      />
      <PermissionGate permission="storage:read" action="view storage usage">
        <StorageDashboard />
      </PermissionGate>
    </div>
  );
}
