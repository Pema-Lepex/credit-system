import type { Metadata } from "next";

import { CreditDetailView } from "@/features/credits/components/credit-detail-view";

export const metadata: Metadata = { title: "Credit" };

/**
 * Next 15 hands route params as a Promise — awaiting it here keeps the client
 * component's prop a plain string.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreditDetailView creditId={id} />;
}
