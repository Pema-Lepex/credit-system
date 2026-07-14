import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { PermissionGate } from "@/features/settings/components/permission-gate";
import { TemplateEditor } from "@/features/settings/components/template-editor";

export const metadata: Metadata = { title: "Email templates" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Email templates"
        description="Edit the emails your customers receive. The preview on the right is the real thing — same layout, same branding, sample data."
      />
      <PermissionGate permission="settings:read" action="view email templates">
        <TemplateEditor />
      </PermissionGate>
    </div>
  );
}
