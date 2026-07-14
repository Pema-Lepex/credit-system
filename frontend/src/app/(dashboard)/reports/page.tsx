import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ReportsView } from "@/features/reports/components/reports-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Reports" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="What you lent, what came back, and who still owes you — daily, weekly, monthly, yearly, or a range of your own."
      />
      <PermissionGate permission="report:read" action="view reports">
        <ReportsView />
      </PermissionGate>
    </div>
  );
}
