import type { Metadata } from "next";

import { CreditForm } from "@/features/credits/components/credit-form";

export const metadata: Metadata = { title: "New credit" };

export default async function Page({
  searchParams,
}: {
  // Next 15 passes searchParams as a promise. `?customerId=` arrives when the user
  // clicks "New credit" from a customer's page, so we preselect that customer.
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  return <CreditForm initialCustomerId={customerId} />;
}
