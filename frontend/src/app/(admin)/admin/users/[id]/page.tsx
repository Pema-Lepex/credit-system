import { StoreOwnerDetail } from "@/features/admin/components/store-owner-detail";

export const metadata = { title: "Store Owner · Super Admin" };

// Next 15: route params arrive as a Promise. Await it, then hand the id to the
// client detail view, which owns the data fetching and the actions.
export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoreOwnerDetail id={id} />;
}
