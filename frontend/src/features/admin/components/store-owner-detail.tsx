"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@/components/ui";
import { AdminStatusBadge } from "@/features/admin/components/admin-status-badge";
import { StoreOwnerActions } from "@/features/admin/components/store-owner-actions";
import { useAdminBusiness } from "@/features/admin/api";
import { formatDate, formatDateTime, formatRelativeDate } from "@/lib/format";
import type { AdminBusiness, ID } from "@/types";

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground text-sm font-medium break-words sm:text-right">
        {value ?? "—"}
      </dd>
    </div>
  );
}

export function StoreOwnerDetail({ id }: { id: ID }) {
  const router = useRouter();
  const { data: business, isLoading, isError, error } = useAdminBusiness(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError || !business) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive-soft-foreground text-sm">
            {error instanceof Error ? error.message : "This store owner could not be found."}
          </p>
          <Link
            href="/admin/users"
            className="text-primary mt-4 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to store owners
          </Link>
        </CardContent>
      </Card>
    );
  }

  const b: AdminBusiness = business;
  const showReason =
    (b.approvalStatus === "REJECTED" || b.approvalStatus === "SUSPENDED") && Boolean(b.approvalReason);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/users"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Store owners
        </Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
            <AdminStatusBadge status={b.approvalStatus} />
          </div>
          {b.description ? (
            <p className="text-muted-foreground max-w-prose text-sm">{b.description}</p>
          ) : null}
        </div>
        <StoreOwnerActions
          business={b}
          variant="buttons"
          onDeleted={() => router.replace("/admin/users")}
        />
      </div>

      {showReason ? (
        <Alert variant={b.approvalStatus === "REJECTED" ? "destructive" : "warning"}>
          <p className="font-medium">
            {b.approvalStatus === "REJECTED" ? "Rejection reason" : "Suspension reason"}
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{b.approvalReason}</p>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Business information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-border divide-y">
              <Row label="Business name" value={b.name} />
              <Row label="Email" value={b.email} />
              <Row label="Phone" value={b.phone} />
              <Row label="Address" value={b.address} />
              <Row label="City" value={b.city} />
              <Row label="Country" value={b.country} />
              <Row label="Registered" value={formatDate(b.createdAt)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-border divide-y">
              <Row label="Owner name" value={b.ownerName} />
              <Row label="Owner email" value={b.ownerEmail} />
              <Row label="Owner phone" value={b.ownerPhone} />
              <Row
                label="Last login"
                value={b.ownerLastLoginAt ? formatRelativeDate(b.ownerLastLoginAt) : "Never"}
              />
              <Row label="Current status" value={<AdminStatusBadge status={b.approvalStatus} />} />
              <Row
                label="Status updated"
                value={b.approvedAt ? formatDateTime(b.approvedAt) : "—"}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-semibold tracking-tight">{b.userCount ?? "—"}</p>
              <p className="text-muted-foreground text-xs">Users</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{b.customerCount ?? "—"}</p>
              <p className="text-muted-foreground text-xs">Customers</p>
            </div>
            <div>
              <p className="text-2xl font-semibold tracking-tight">{b.creditCount ?? "—"}</p>
              <p className="text-muted-foreground text-xs">Credits</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
