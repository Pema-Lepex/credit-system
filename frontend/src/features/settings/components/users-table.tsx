"use client";

import { MoreHorizontal, Pencil, Search, Trash2, UserPlus, UserX } from "lucide-react";
import { useState } from "react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  FormField,
  Input,
  Pagination,
  Select,
  SkeletonTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@/components/ui";
import {
  useDeactivateUser,
  useDeleteUser,
  useUsers,
  type StaffUser,
} from "@/features/settings/api/users";
import {
  CreateUserDialog,
  EditUserDialog,
} from "@/features/settings/components/user-dialogs";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GraphQLRequestError } from "@/lib/graphql/client";
import { ROLE_STYLES, cn, formatRelativeDate } from "@/lib/utils";
import { absoluteUrl } from "@/features/settings/lib/http";
import type { Role } from "@/types";

const ROLE_FILTERS = [
  { value: "", label: "All roles" },
  { value: "ADMIN", label: "Admin" },
  { value: "STAFF", label: "Staff" },
  { value: "SUPER_ADMIN", label: "Super admin" },
];

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export function UsersTable() {
  const { user: actor } = useAuth();

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [status, setStatus] = useState("");

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [deactivating, setDeactivating] = useState<StaffUser | null>(null);
  const [deleting, setDeleting] = useState<StaffUser | null>(null);

  const deactivateUser = useDeactivateUser();
  const deleteUser = useDeleteUser();

  const { data, isLoading, isError, error } = useUsers({
    page,
    limit,
    search,
    role,
    isActive: status === "" ? undefined : status === "active",
  });

  const users = data?.items ?? [];
  const total = data?.pageInfo.total ?? 0;

  const onDeactivate = async () => {
    if (!deactivating) return;
    try {
      await deactivateUser.mutateAsync(deactivating.id);
      toast.success(`${deactivating.fullName} can no longer sign in.`);
      setDeactivating(null);
    } catch (err) {
      toast.error(
        err instanceof GraphQLRequestError ? err.message : "Could not deactivate that user.",
      );
    }
  };

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await deleteUser.mutateAsync(deleting.id);
      toast.success(`${deleting.fullName} has been removed.`);
      setDeleting(null);
    } catch (err) {
      toast.error(
        err instanceof GraphQLRequestError ? err.message : "Could not delete that user.",
      );
    }
  };

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------------- filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:max-w-2xl sm:flex-row">
          <FormField label="Search users" hideLabel className="flex-1">
            <Input
              type="search"
              placeholder="Search by name or email…"
              leftAddon={<Search />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </FormField>
          <FormField label="Filter by role" hideLabel className="sm:w-40">
            <Select
              value={role}
              options={ROLE_FILTERS}
              onChange={(event) => {
                setRole(event.target.value as Role | "");
                setPage(1);
              }}
            />
          </FormField>
          <FormField label="Filter by status" hideLabel className="sm:w-40">
            <Select
              value={status}
              options={STATUS_FILTERS}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            />
          </FormField>
        </div>

        <Button leftIcon={<UserPlus />} onClick={() => setCreateOpen(true)}>
          Invite user
        </Button>
      </div>

      {/* ---------------------------------------------------------------- table */}
      {isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <SkeletonTable rows={5} columns={5} />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive-soft-foreground text-sm">
              {error instanceof Error ? error.message : "Could not load users."}
            </p>
          </CardContent>
        </Card>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={<UserPlus />}
              title={search || role || status ? "No users match those filters" : "No users yet"}
              description={
                search || role || status
                  ? "Try clearing the filters."
                  : "Invite your first staff member to give them access."
              }
              action={
                <Button leftIcon={<UserPlus />} onClick={() => setCreateOpen(true)}>
                  Invite user
                </Button>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead align="right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((staff) => {
                  const roleStyle = ROLE_STYLES[staff.role];
                  const isSelf = staff.id === actor?.id;

                  return (
                    <TableRow key={staff.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={absoluteUrl(staff.avatarUrl)}
                            name={staff.fullName}
                            seed={staff.id}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {staff.fullName}
                              {isSelf ? (
                                <span className="text-muted-foreground font-normal"> (you)</span>
                              ) : null}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">
                              {staff.email}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge className={cn(roleStyle.className)}>{roleStyle.label}</Badge>
                      </TableCell>

                      <TableCell>
                        <Badge variant={staff.isActive ? "success" : "neutral"} dot>
                          {staff.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        <span className="text-muted-foreground text-sm">
                          {staff.lastLoginAt ? formatRelativeDate(staff.lastLoginAt) : "Never"}
                        </span>
                      </TableCell>

                      <TableCell align="right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions for ${staff.fullName}`}
                            className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              icon={<Pencil />}
                              onSelect={() => setEditing(staff)}
                            >
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              icon={<UserX />}
                              disabled={isSelf || !staff.isActive}
                              onSelect={() => setDeactivating(staff)}
                            >
                              Deactivate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              icon={<Trash2 />}
                              destructive
                              disabled={isSelf}
                              onSelect={() => setDeleting(staff)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
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

      {/* --------------------------------------------------------------- modals */}
      <CreateUserDialog open={isCreateOpen} onOpenChange={setCreateOpen} />
      <EditUserDialog user={editing} onOpenChange={() => setEditing(null)} />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={() => setDeactivating(null)}
        title="Deactivate this user?"
        description={`${deactivating?.fullName ?? "They"} will no longer be able to sign in. Everything they recorded stays exactly where it is, and you can reactivate them at any time.`}
        confirmLabel="Deactivate"
        isLoading={deactivateUser.isPending}
        onConfirm={onDeactivate}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={() => setDeleting(null)}
        title="Delete this user?"
        description={`${deleting?.fullName ?? "This user"} will be removed. The credits and payments they recorded are kept — they are the business's records, not theirs. If you only want to revoke access, deactivate them instead.`}
        confirmLabel="Delete user"
        destructive
        isLoading={deleteUser.isPending}
        onConfirm={onDelete}
      />
    </div>
  );
}
