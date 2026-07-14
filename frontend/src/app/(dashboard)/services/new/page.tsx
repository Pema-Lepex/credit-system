import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ServiceForm } from "@/features/catalog/components/service-form";

export const metadata: Metadata = { title: "New service" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="New service" description="A name and a price are all you need to start." />
      <ServiceForm />
    </div>
  );
}
