import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/features/settings/components/permission-gate";
import { UsersTable } from "@/features/settings/components/users-table";

export const metadata: Metadata = { title: "Users" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Who can sign in, and what they are allowed to do. Staff record credits and payments; admins can also change settings."
      />
      {/* The whole page is gated: without user:manage every action here would be
          refused by the server anyway. */}
      <PermissionGate permission="user:manage" action="manage staff accounts">
        <UsersTable />
      </PermissionGate>
    </div>
  );
}
