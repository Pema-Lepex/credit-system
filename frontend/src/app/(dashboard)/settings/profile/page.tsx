import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ProfileForm } from "@/features/settings/components/profile-form";

export const metadata: Metadata = { title: "Profile" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Your profile"
        description="Your name, avatar, appearance and password. This is you, not your business."
      />
      {/* No permission gate: every signed-in user owns their own profile. */}
      <ProfileForm />
    </div>
  );
}
