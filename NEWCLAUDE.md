You are a Senior Full Stack Software Architect and Engineer.

I already have a working Credit Management System.

Current system:
- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS
- Backend: Python FastAPI
- Database: PostgreSQL
- Authentication already exists.
- Store owners (lenders) can register.
- They can manage customers.
- They can create staff accounts.
- Staff permissions already exist.

I want you to ADD a Super Admin Panel to my existing project.

IMPORTANT:
Do NOT rewrite the existing system.
Do NOT break any existing functionality.
Only extend the current architecture.

=====================================================
SUPER ADMIN
=====================================================

There should only be ONE Super Admin.

The credentials MUST NOT be hardcoded inside the frontend.

Read them from environment variables.

Example:

SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD=

During login:

If email/password match the Super Admin credentials,
redirect to

/admin

Otherwise continue the existing authentication flow.

=====================================================
STORE OWNER APPROVAL SYSTEM
=====================================================

Every newly registered Store Owner should automatically have

status = Pending

Possible statuses:

- Pending
- Approved
- Rejected
- Suspended

Default:
Pending

When Pending:

- User can login
- Dashboard is accessible only to view approval status
- Cannot access any business features
- Cannot create customers
- Cannot create staff
- Cannot create credit records
- Cannot edit data
- Cannot use any module

Instead display a beautiful page:

----------------------------------

Your account is awaiting approval.

The Super Administrator needs to verify your account before you can use the system.

Current Status:
Pending

----------------------------------

=====================================================
REJECTED ACCOUNT
=====================================================

If Super Admin rejects an account:

User can still login.

But after login show:

Account Status:
Rejected

Reason:

(Display rejection message written by Super Admin)

Please contact the administrator.

No system functionality should be usable.

=====================================================
SUSPENDED ACCOUNT
=====================================================

If account is suspended:

User logs in.

Show

Account Suspended

Reason:
...

Everything disabled.

=====================================================
APPROVED ACCOUNT
=====================================================

Only Approved users can use the complete application.

=====================================================
SUPER ADMIN DASHBOARD
=====================================================

Keep it simple.

Minimal design.

Professional.

Responsive.

Sidebar:

Dashboard

Store Owners

Pending Approvals

Approved

Rejected

Suspended

Logout

=====================================================
DASHBOARD
=====================================================

Show cards:

Total Store Owners

Pending Approval

Approved

Rejected

Suspended

=====================================================
STORE OWNER TABLE
=====================================================

Show table with

Business Name

Owner Name

Email

Phone

Created Date

Current Status

Actions

Actions:

View

Approve

Reject

Suspend

Activate

Delete

=====================================================
VIEW DETAILS
=====================================================

Display all signup information.

Business Information

Owner Information

Phone

Email

Address

Business Name

Registration Date

Last Login

Status

=====================================================
APPROVE
=====================================================

Click Approve

Confirmation dialog

Approve Account?

YES

NO

After approval:

Status changes to Approved.

User can immediately use the system.

=====================================================
REJECT
=====================================================

When rejecting

Popup

Reason (required)

Reject button

Save reason.

The user should see this reason after login.

=====================================================
SUSPEND
=====================================================

Popup

Reason

Suspend

User immediately loses access.

=====================================================
DELETE
=====================================================

Allow permanent deletion.

Ask confirmation twice.

=====================================================
EMAIL NOTIFICATION
=====================================================

Whenever a new Store Owner registers,

send an email notification to the Super Admin using W3Forms.

DO NOT hardcode secrets.

Use environment variables:

W3FORMS_ACCESS_KEY= 59739ddd-0163-4db5-aa6c-700a8bba22f2

SUPER_ADMIN_EMAIL= pema.002.69@gmail.com

Email should contain:

New Store Owner Registration

Business Name

Owner Name

Phone

Email

Registration Date

Time

=====================================================
BACKEND
=====================================================

Create proper APIs.

Examples:

GET /admin/users

GET /admin/users/{id}

PATCH /admin/users/{id}/approve

PATCH /admin/users/{id}/reject

PATCH /admin/users/{id}/suspend

DELETE /admin/users/{id}

GET /admin/dashboard

Protect all admin APIs.

Only Super Admin can access them.

=====================================================
DATABASE
=====================================================

Extend existing User table.

Add:

status

approval_reason

approved_at

approved_by

last_login

No unnecessary tables.

=====================================================
SECURITY
=====================================================

Never trust frontend.

Every protected API must verify:

- User authenticated
- User role
- User approval status

Pending, Rejected and Suspended users must receive HTTP 403 when attempting to access protected APIs.

=====================================================
FRONTEND
=====================================================

Create:

/admin

/admin/users

/admin/users/[id]

Beautiful responsive UI.

Use existing design system.

Do not install unnecessary packages.

=====================================================
CODE QUALITY
=====================================================

Follow clean architecture.

Keep components reusable.

Keep API routes organized.

Use TypeScript types.

Use proper backend validation.

No duplicated code.

=====================================================
IMPORTANT
=====================================================

Do not rebuild the authentication system.

Integrate into the existing project.

Maintain existing coding style.

Create database migrations if necessary.

Explain every new file created.

Update all necessary backend and frontend code.

Everything should be production ready.