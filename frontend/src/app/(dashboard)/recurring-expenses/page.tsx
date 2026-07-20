import type { Metadata } from "next";

import { RecurringExpensesView } from "@/features/recurring-expenses/components/recurring-expenses-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Repeating Bills" };

export default function Page() {
  return (
    <PermissionGate permission="recurring_expense:read" action="view repeating bills">
      <RecurringExpensesView />
    </PermissionGate>
  );
}
