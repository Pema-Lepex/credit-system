import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ProfitLossView } from "@/features/reports/components/profit-loss-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Profit & Loss" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Profit &amp; loss"
        description="What you collected, what it cost you, and what you kept — plus a breakdown of where the money went."
      />
      <PermissionGate permission="report:read" action="view reports">
        <ProfitLossView />
      </PermissionGate>
    </div>
  );
}
