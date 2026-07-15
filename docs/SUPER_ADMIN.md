# Super Admin Panel & Store-Owner Approval

This document describes the Super Admin feature added on top of the existing Credit
Management System. It **extends** the current architecture — nothing was rewritten,
and every existing behaviour is preserved.

## What it does

- There is exactly **one Super Admin**, bootstrapped from environment variables.
- Every newly registered store owner starts as **PENDING** and cannot use any
  business feature until approved.
- The Super Admin approves / rejects / suspends / re-activates / permanently deletes
  store owners from a dedicated panel at `/admin`.
- The Super Admin is emailed (via W3Forms) whenever a new store owner registers.

## Approval model — where the status lives

The four-state approval status lives on the **Business (tenant)**, not on the User.
A store owner and every staff account they create share one business, so gating the
business gates the whole shop together (staff of a pending shop are correctly locked
out too). Fields added to `business`:

| Field | Meaning |
| --- | --- |
| `approval_status` | `PENDING` \| `APPROVED` \| `REJECTED` \| `SUSPENDED` |
| `approval_reason` | Reason shown to the owner (rejection/suspension) |
| `approved_at` | When the status last changed |
| `approved_by_user_id` | Which super-admin actioned it |

Only `APPROVED` unlocks the business modules. A `PENDING`/`REJECTED`/`SUSPENDED`
owner can still **sign in** (so they can read their own status) but every protected
API returns HTTP 403 with an `ACCOUNT_<STATUS>` error code.

Existing businesses were backfilled to `APPROVED` by the migration, so nobody
already using the system is affected.

## Environment variables (backend/.env)

```
SUPER_ADMIN_EMAIL=you@example.com
SUPER_ADMIN_PASSWORD=a-strong-password
SUPER_ADMIN_W3FORMS_ACCESS_KEY=your-web3forms-access-key   # inbox = the super-admin's
```

On boot, `app/db/bootstrap.py::ensure_super_admin()` reconciles a single
`SUPER_ADMIN` user row with these values (creates it, or updates the password if it
was rotated). Signing in with them uses the **ordinary JWT login flow** — there is
no special-cased credential check, and nothing is hardcoded in the frontend.

## How to use it

1. Set the three env vars above and restart the backend.
2. Sign in at `/login` with the super-admin credentials → you land on `/admin`.
3. Approve pending owners from **Dashboard → Pending Approvals**.

## Files added

### Backend
- `app/db/bootstrap.py` — reconciles the single super-admin user from the env on boot.
- `app/email/platform.py` — sends the "new store owner registered" W3Forms notice to
  the super-admin (best-effort; never fails a registration).
- `migrations/versions/d1a4f7c9e820_add_business_approval_status.py` — adds the four
  approval columns; backfills existing rows to `APPROVED`.
- `tests/test_super_admin_approval.py` — the gate, the state machine, and the purge.

### Backend (extended, not rewritten)
- `app/models/enums.py` — new `ApprovalStatus` enum.
- `app/models/business.py` — the four approval fields.
- `app/core/config.py` — `SUPER_ADMIN_EMAIL` / `_PASSWORD` / `_W3FORMS_ACCESS_KEY`.
- `app/services/base.py` — the approval gate (`_assert_tenant_usable`), enforced in
  `require()` and `scope_id`.
- `app/services/business.py` — `set_approval`, `hard_delete` (+ ordered `_purge_tenant`),
  `list_for_admin`, `admin_stats`, `owners_for`, `counts_for`, `get_for_admin`.
- `app/services/auth.py` — registration creates a `PENDING` business.
- `app/graphql/types.py` — `AdminBusinessType`, `AdminBusinessPage`, `AdminStats`;
  `approvalStatus`/`approvalReason` on `UserType`.
- `app/graphql/mappers.py` — `to_admin_business`, approval fields on `to_user`.
- `app/graphql/queries.py` — `adminStats`, `adminBusinesses`, `adminBusiness`.
- `app/graphql/mutations.py` — `approveBusiness`, `rejectBusiness`, `suspendBusiness`,
  `activateBusiness`, `deleteBusiness`; async `register` sends the notification.

### Frontend
- `src/app/(admin)/layout.tsx` — Super Admin route-group layout (guard + chrome).
- `src/app/(admin)/admin/page.tsx` — dashboard with status cards.
- `src/app/(admin)/admin/users/page.tsx` — store-owner table (with `?status=` filters).
- `src/app/(admin)/admin/users/[id]/page.tsx` — store-owner detail.
- `src/features/admin/queries.ts` — admin GraphQL documents.
- `src/features/admin/api.ts` — react-query hooks (stats, list, detail, 5 actions).
- `src/features/admin/components/admin-shell.tsx` — sidebar + guard.
- `src/features/admin/components/admin-dashboard.tsx` — the stat cards.
- `src/features/admin/components/store-owners-table.tsx` — the table.
- `src/features/admin/components/store-owner-detail.tsx` — the detail view.
- `src/features/admin/components/store-owner-actions.tsx` — approve/reject/suspend/
  activate/delete dialogs (shared by table + detail).
- `src/features/admin/components/admin-status-badge.tsx` — the approval chip.
- `src/features/account/account-status-screen.tsx` — the pending/rejected/suspended
  screen a blocked owner sees instead of the app.

### Frontend (extended)
- `src/types/index.ts` — `ApprovalStatus`, `AdminBusiness`, `AdminStats`, and
  `approvalStatus`/`approvalReason` on `User`.
- `src/lib/auth/queries.ts` — fetches `approvalStatus`/`approvalReason` on `me`/login.
- `src/lib/utils.ts` — `APPROVAL_STATUS_STYLES`.
- `src/app/(auth)/login/login-form.tsx` — routes `SUPER_ADMIN` → `/admin`.
- `src/components/layout/dashboard-shell.tsx` — the approval gate + super-admin redirect.

## Security notes

- Every admin API is SUPER_ADMIN-only, guarded twice: the `business:create` /
  `business:delete` permission (which no ADMIN holds) **and** an explicit
  `is_super_admin` check.
- The approval gate is enforced server-side in the service layer, so the frontend
  gate is only a UX nicety — a blocked user hitting the API directly still gets 403.
- Deleting a store owner is a **permanent** cascade (customers, credits, payments,
  files, users) and cannot be undone; the UI requires typing the business name.
