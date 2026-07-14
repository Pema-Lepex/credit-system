import type { Metadata } from "next";

import { CustomerDetail } from "@/features/customers/components/customer-detail";

export const metadata: Metadata = { title: "Customer" };

/** Next 15: `params` is a Promise. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetail id={id} />;
}
