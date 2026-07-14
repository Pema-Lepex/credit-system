import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CustomerEditView } from "@/features/customers/components/customer-edit-view";

export const metadata: Metadata = { title: "Edit customer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <PageHeader title="Edit customer" description="Changes take effect immediately." />
      <CustomerEditView id={id} />
    </div>
  );
}
