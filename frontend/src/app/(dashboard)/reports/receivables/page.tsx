import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ReceivablesView } from "@/features/reports/components/receivables-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Money Customers Owe" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Money customers owe"
        description="Who owes you, how much, and how long it has been outstanding."
      />
      <PermissionGate permission="report:read" action="view reports">
        <ReceivablesView />
      </PermissionGate>
    </div>
  );
}
