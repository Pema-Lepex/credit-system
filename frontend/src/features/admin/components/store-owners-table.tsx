"use client";

import { Search, Store } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  Card,
  CardContent,
  EmptyState,
  FormField,
  Input,
  Pagination,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { AdminStatusBadge } from "@/features/admin/components/admin-status-badge";
import { StoreOwnerActions } from "@/features/admin/components/store-owner-actions";
import { useAdminBusinesses } from "@/features/admin/api";
import { useDebouncedValue } from "@/features/common/use-debounced-value";
import { formatDate } from "@/lib/format";
import { APPROVAL_STATUSES, type ApprovalStatus } from "@/types";

function isApprovalStatus(value: string | null): value is ApprovalStatus {
  return value !== null && (APPROVAL_STATUSES as readonly string[]).includes(value);
}

const STATUS_HEADINGS: Record<ApprovalStatus, string> = {
  PENDING: "Pending approvals",
  APPROVED: "Approved store owners",
  REJECTED: "Rejected store owners",
  SUSPENDED: "Suspended store owners",
};

export function StoreOwnersTable() {
  const params = useSearchParams();
  const statusParam = params.get("status");
  const status: ApprovalStatus | "" = isApprovalStatus(statusParam) ? statusParam : "";

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);

  // A sidebar click changes the status filter without remounting — reset to page 1
  // so the operator doesn't land on an empty page 3 of a smaller filtered set.
  useEffect(() => {
    setPage(1);
  }, [status]);

  const { data, isLoading, isError, error } = useAdminBusinesses({ page, limit, status, search });

  const rows = data?.items ?? [];
  const total = data?.pageInfo.total ?? 0;
  const heading = status ? STATUS_HEADINGS[status] : "All store owners";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-muted-foreground text-sm">
            {isLoading ? "Loading…" : `${total} ${total === 1 ? "account" : "accounts"}`}
          </p>
        </div>
        <FormField label="Search store owners" hideLabel className="sm:w-72">
          <Input
            type="search"
            placeholder="Search by business, owner or email…"
            leftAddon={<Search />}
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
          />
        </FormField>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <SkeletonTable rows={6} columns={6} />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive-soft-foreground text-sm">
              {error instanceof Error ? error.message : "Could not load store owners."}
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<Store />}
              title={search ? "No store owners match your search" : "No store owners here yet"}
              description={
                search
                  ? "Try a different name or email."
                  : "New registrations will appear here as they sign up."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((business) => (
                  <TableRow key={business.id}>
                    <TableCell>
                      <Link
                        href={`/admin/users/${business.id}`}
                        className="focus-visible:ring-ring rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {business.name}
                      </Link>
                      {business.email ? (
                        <p className="text-muted-foreground truncate text-xs">{business.email}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <p className="truncate">{business.ownerName ?? "—"}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {business.ownerEmail ?? ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {business.ownerPhone ?? business.phone ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">
                        {formatDate(business.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <AdminStatusBadge status={business.approvalStatus} />
                    </TableCell>
                    <TableCell align="right">
                      <StoreOwnerActions business={business} variant="menu" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Pagination
            page={page}
            pageSize={limit}
            totalItems={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setLimit(size);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}
