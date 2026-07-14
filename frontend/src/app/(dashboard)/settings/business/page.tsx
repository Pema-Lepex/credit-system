import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { BusinessForm } from "@/features/settings/components/business-form";
import { PermissionGate } from "@/features/settings/components/permission-gate";

export const metadata: Metadata = { title: "Business" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Business"
        description="Your profile, contact details, location, currency, working hours and branding. These appear on every invoice, receipt and email you send."
      />
      <PermissionGate permission="settings:read" action="view business settings">
        <BusinessForm />
      </PermissionGate>
    </div>
  );
}
