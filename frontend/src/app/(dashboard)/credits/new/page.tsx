import type { Metadata } from "next";

import { CreditForm } from "@/features/credits/components/credit-form";

export const metadata: Metadata = { title: "New credit" };

export default function Page() {
  return <CreditForm />;
}
