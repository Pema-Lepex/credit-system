"use client";

import { CheckCircle2, Clock, ShieldBan, ShieldX, Store } from "lucide-react";

import { Card, CardContent } from "@/components/ui";
import { StatCard } from "@/features/dashboard/components/stat-card";
import { useAdminStats } from "@/features/admin/api";
import type { AdminStats } from "@/types";

type CardTone = "neutral" | "warning" | "success" | "destructive";

const CARDS: Array<{
  key: keyof AdminStats;
  label: string;
  icon: typeof Store;
  href: string;
  tone: CardTone;
}> = [
  { key: "totalStoreOwners", label: "Total Store Owners", icon: Store, href: "/admin/users", tone: "neutral" },
  { key: "pending", label: "Pending Approval", icon: Clock, href: "/admin/users?status=PENDING", tone: "warning" },
  { key: "approved", label: "Approved", icon: CheckCircle2, href: "/admin/users?status=APPROVED", tone: "success" },
  { key: "rejected", label: "Rejected", icon: ShieldX, href: "/admin/users?status=REJECTED", tone: "destructive" },
  { key: "suspended", label: "Suspended", icon: ShieldBan, href: "/admin/users?status=SUSPENDED", tone: "neutral" },
];

export function AdminDashboard() {
  const { data, isLoading, isError, error } = useAdminStats();

  if (isError) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive-soft-foreground text-sm">
            {error instanceof Error ? error.message : "Could not load the dashboard."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <StatCard
            key={card.key}
            label={card.label}
            value={isLoading || !data ? "—" : String(data[card.key])}
            icon={<Icon />}
            tone={card.tone}
            href={card.href}
          />
        );
      })}
    </div>
  );
}
