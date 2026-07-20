import type { Metadata } from "next";

import { CashAccountsView } from "@/features/cash-accounts/components/cash-accounts-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Cash & Bank" };

export default function Page() {
  return (
    <PermissionGate permission="cash_account:read" action="view cash accounts">
      <CashAccountsView />
    </PermissionGate>
  );
}
