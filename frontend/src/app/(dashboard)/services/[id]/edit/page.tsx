import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ServiceEditView } from "@/features/catalog/components/catalog-edit-views";

export const metadata: Metadata = { title: "Edit service" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit service"
        description="Past credits keep the name and price they were sold at — editing here does not rewrite history."
      />
      <ServiceEditView id={id} />
    </div>
  );
}
