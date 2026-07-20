/**
 * Client-side mirror of backend/app/core/security.py ROLE_PERMISSIONS.
 *
 * WHY MIRROR IT AT ALL: this drives *UI affordances only* — whether a "Delete"
 * button renders. It is never a security control. The server re-checks every
 * mutation with `require(user, Permission.X)`; hiding a button the user could
 * still call is a courtesy, showing one they can't use is a bug.
 *
 * If the backend returns `user.permissions`, we prefer that (it is the source of
 * truth). This table is the fallback for when it doesn't.
 */

import type { Permission, Role } from "@/types";

const STAFF: readonly Permission[] = [
  "business:read",
  "customer:read",
  "customer:write",
  "catalog:read",
  "credit:read",
  "credit:write",
  "payment:read",
  "payment:write",
  "expense:read",
  "expense:write",
  "expense_category:read",
  "vendor:read",
  "vendor:write",
  "cash_account:read",
  "recurring_expense:read",
  "report:read",
  "settings:read",
  "storage:read",
];

const ADMIN: readonly Permission[] = [
  ...STAFF,
  "business:update",
  "user:read",
  "user:manage",
  "customer:delete",
  "catalog:write",
  "catalog:delete",
  "credit:delete",
  "payment:delete",
  "expense:delete",
  "expense_category:manage",
  "vendor:delete",
  "cash_account:manage",
  "recurring_expense:manage",
  "export:create",
  "settings:write",
  "template:write",
  "reminder:send",
  "storage:maintain",
  "retention:manage",
  "audit:read",
];

const SUPER_ADMIN: readonly Permission[] = [...ADMIN, "business:create", "business:delete"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  STAFF,
  ADMIN,
  SUPER_ADMIN,
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}
