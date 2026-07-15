import { AdminDashboard } from "@/features/admin/components/admin-dashboard";

export const metadata = { title: "Dashboard · Super Admin" };

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Store owners on the platform, by approval state.
        </p>
      </div>
      <AdminDashboard />
    </div>
  );
}
