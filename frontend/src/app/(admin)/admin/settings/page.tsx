import { PlatformSettingsForm } from "@/features/admin/components/platform-settings-form";

export const metadata = { title: "Settings · Super Admin" };

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Platform configuration for the super administrator.
        </p>
      </div>
      <PlatformSettingsForm />
    </div>
  );
}
