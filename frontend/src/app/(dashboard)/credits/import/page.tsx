import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ImportView } from "@/features/imports/components/import-view";

export const metadata: Metadata = { title: "Import credits" };

/** Server Component shell; the import flow itself is client (files, drag-drop, state). */
export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import credits"
        description="Bring in your past credit records from a spreadsheet. Import your customers first."
      />
      <ImportView dataset="credits" />
    </div>
  );
}
