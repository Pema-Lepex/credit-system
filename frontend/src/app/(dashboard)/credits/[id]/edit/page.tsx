import type { Metadata } from "next";

import { CreditEditView } from "@/features/credits/components/credit-edit-view";

export const metadata: Metadata = { title: "Edit credit" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CreditEditView creditId={id} />;
}
