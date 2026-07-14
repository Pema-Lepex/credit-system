"use client";

import { LogOut, Settings, User as UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/AuthProvider";
import { ROLE_STYLES, cn } from "@/lib/utils";

export function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (!user) return null;

  const role = ROLE_STYLES[user.role];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.fullName}`}
        className={cn(
          "hover:bg-muted flex items-center gap-2 rounded-full p-0.5 transition-colors",
          "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        )}
      >
        <Avatar size="sm" src={user.avatarUrl} name={user.fullName} seed={user.id} />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" aria-label="Account">
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar size="md" src={user.avatarUrl} name={user.fullName} seed={user.id} />
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-medium">{user.fullName}</p>
            <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          </div>
        </div>
        <div className="px-2.5 pb-2">
          <Badge size="sm" className={role.className}>
            {role.label}
          </Badge>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem icon={<UserIcon />} onSelect={() => router.push("/settings/profile")}>
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem icon={<Settings />} onSelect={() => router.push("/settings")}>
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          icon={<LogOut />}
          destructive
          disabled={isSigningOut}
          onSelect={() => {
            setIsSigningOut(true);
            void logout();
          }}
        >
          {isSigningOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
