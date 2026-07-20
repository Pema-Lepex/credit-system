import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CashFlowView } from "@/features/reports/components/cash-flow-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Cash Flow" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash flow"
        description="What came in, what went out, and what you were left with."
      />
      <PermissionGate permission="report:read" action="view reports">
        <CashFlowView />
      </PermissionGate>
    </div>
  );
}
