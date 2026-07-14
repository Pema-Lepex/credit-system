import type { ReactNode } from "react";

import { SettingsNav } from "@/features/settings/components/settings-nav";

/**
 * Shared chrome for every settings route.
 *
 * A Server Component wrapping one client sub-nav. It matters most on mobile, where
 * the sidebar's nested settings links are behind a hamburger — without this, moving
 * from Business to Users is a round trip through a drawer.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <SettingsNav />
      {children}
    </div>
  );
}
