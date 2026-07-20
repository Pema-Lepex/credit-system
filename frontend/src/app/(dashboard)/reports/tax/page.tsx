import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TaxSummaryView } from "@/features/reports/components/tax-summary-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Tax Summary" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax summary"
        description="What you charged in tax, grouped by rate."
      />
      <PermissionGate permission="report:read" action="view reports">
        <TaxSummaryView />
      </PermissionGate>
    </div>
  );
}
