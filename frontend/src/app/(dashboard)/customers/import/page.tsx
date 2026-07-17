import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ImportView } from "@/features/imports/components/import-view";

export const metadata: Metadata = { title: "Import customers" };

/** Server Component shell; the import flow itself is client (files, drag-drop, state). */
export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import customers"
        description="Already have your customers in a spreadsheet? Bring them all in at once."
      />
      <ImportView dataset="customers" />
    </div>
  );
}
