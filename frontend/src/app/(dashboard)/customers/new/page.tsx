import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { CustomerForm } from "@/features/customers/components/customer-form";

export const metadata: Metadata = { title: "New customer" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="New customer"
        description="Only a name is required. Everything else can be filled in later."
      />
      <CustomerForm />
    </div>
  );
}
