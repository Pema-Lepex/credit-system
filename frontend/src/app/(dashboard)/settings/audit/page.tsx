import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { AuditLogPanel } from "@/features/settings/components/audit-log-panel";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Activity log" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity log"
        description="Who created, updated, deleted or restored what — with the exact fields that changed. A complete, tamper-proof record of everything that happens in your account."
      />
      <PermissionGate permission="audit:read" action="view the activity log">
        <AuditLogPanel />
      </PermissionGate>
    </div>
  );
}
