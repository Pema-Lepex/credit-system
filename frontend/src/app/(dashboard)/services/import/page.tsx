import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ImportView } from "@/features/imports/components/import-view";

export const metadata: Metadata = { title: "Import services" };

/** Server Component shell; the import flow itself is client (files, drag-drop, state). */
export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import services"
        description="Already have your services in a spreadsheet? Bring them all in at once."
      />
      <ImportView dataset="services" />
    </div>
  );
}
