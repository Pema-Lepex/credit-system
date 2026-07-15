import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/features/settings/components/permission-gate";
import { TrashPanel } from "@/features/settings/components/trash-panel";

export const metadata: Metadata = { title: "Trash" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Trash"
        description="Credits and payments you have deleted. Restore anything you removed by mistake, or delete it permanently to remove it from the system for good."
      />
      <PermissionGate permission="credit:delete" action="view the trash">
        <TrashPanel />
      </PermissionGate>
    </div>
  );
}
