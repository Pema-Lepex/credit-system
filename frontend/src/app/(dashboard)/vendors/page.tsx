import type { Metadata } from "next";

import { VendorsView } from "@/features/vendors/components/vendors-view";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Suppliers" };

export default function Page() {
  return (
    <PermissionGate permission="vendor:read" action="view suppliers">
      <VendorsView />
    </PermissionGate>
  );
}
