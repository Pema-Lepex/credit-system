import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ImportView } from "@/features/imports/components/import-view";

export const metadata: Metadata = { title: "Import expenses" };

/** Server Component shell; the import flow itself is client (files, drag-drop, state). */
export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import expenses"
        description="Already tracking your spending in a spreadsheet? Bring it all in at once, and your profit and cash flow reports work from day one."
      />
      <ImportView dataset="expenses" />
    </div>
  );
}
