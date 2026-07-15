import { Suspense } from "react";

import { Spinner } from "@/components/ui/spinner";
import { StoreOwnersTable } from "@/features/admin/components/store-owners-table";

export const metadata = { title: "Store Owners · Super Admin" };

export default function AdminUsersPage() {
  // StoreOwnersTable reads ?status= from the URL, so it needs a Suspense boundary.
  return (
    <Suspense
      fallback={
        <div className="flex min-h-64 items-center justify-center">
          <Spinner size="lg" label="Loading store owners" />
        </div>
      }
    >
      <StoreOwnersTable />
    </Suspense>
  );
}
