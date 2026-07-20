# Credit Management System - Accounting Module Expansion

## Role

You are the Senior Software Architect and Lead Full Stack Engineer for this project.

Your responsibility is to extend the existing Credit Management System into a lightweight accounting system suitable for small businesses, while preserving the existing architecture and avoiding unnecessary complexity.

This is NOT an ERP.
This is NOT a double-entry accounting system.
This is NOT intended to compete with QuickBooks or Odoo.

The goal is to provide practical accounting features for shop owners using a simple single-entry bookkeeping approach.

Always follow the existing architecture, coding conventions, service patterns, permission system, audit logging, and tenant isolation.

---

# Architectural Principles

## DO

- Preserve the current architecture.
- Follow existing BaseService patterns.
- Follow TenantEntity patterns.
- Reuse existing enums whenever possible.
- Keep all features tenant-scoped.
- Reuse existing audit logging.
- Reuse existing attachment/file infrastructure.
- Reuse existing permission middleware.
- Keep APIs GraphQL-first.
- Maintain backward compatibility.
- Build features incrementally.

## DO NOT

Do NOT introduce:

- Double-entry accounting
- General Ledger
- Journal Entries
- Debit/Credit accounting
- Chart of Accounts
- Inventory valuation engines
- Bank reconciliation
- Accounts Payable subledger
- Accounts Receivable subledger redesign

The existing credit ledger remains the source of truth.

---

# Phase 1 — Expense Management

## Objective

Introduce business expenses to track outgoing money.

This is the highest priority feature.

---

## New Models

### Expense

Fields

- id
- tenant_id
- category_id (nullable FK)
- amount (MoneyType)
- vendor_id (nullable FK)
- vendor_name (nullable fallback)
- payment_method
- expense_date
- receipt_file_id (nullable)
- notes
- created_at
- updated_at
- created_by
- updated_by

Reuse:

- MoneyType
- PaymentMethod enum
- Attachment infrastructure

---

### ExpenseCategory

Fields

- id
- tenant_id
- name
- description
- color
- is_active
- sort_order

This should mirror the existing Product Category implementation.

Examples:

- Rent
- Utilities
- Salaries
- Transportation
- Fuel
- Office Supplies
- Marketing
- Miscellaneous

---

# Services

Create

ExpenseService

following the exact same structure as:

- CustomerService
- CreditService
- PaymentService

Functions

- create()
- update()
- delete()
- get_by_id()
- list()
- search()
- upload_receipt()
- remove_receipt()

---

ExpenseCategoryService

Functions

- CRUD
- Search
- Sort
- Activate/Deactivate

---

# Ledger Integration

Expenses should create business ledger entries only.

Do NOT touch customer ledgers.

Introduce a new LedgerEntryType if necessary.

Examples:

EXPENSE

or

BUSINESS_EXPENSE

Do NOT modify customer balances.

---

# Permissions

Introduce permissions

expense:view

expense:create

expense:update

expense:delete

expense_category:view

expense_category:manage

Follow existing permission implementation.

---

# Audit Logging

Every expense action must create audit logs.

Examples

Expense Created

Expense Updated

Expense Deleted

Receipt Uploaded

Receipt Deleted

Reuse current audit infrastructure.

---

# File Attachments

Expenses may contain:

Receipt

Invoice

Image

PDF

Reuse the existing storage backend.

Do not create a new upload system.

---

# Reports

## 1. Simplified Profit & Loss Report

Create a new report.

Period filters

Today

This Week

This Month

Last Month

Custom Range

Output

Revenue
(Collections received)

Less

Cost of Goods Sold

Use existing

Product.cost_price

Less

Operating Expenses

Grouped by Expense Category

Finally

Net Profit

Display clearly

Revenue

COGS

Gross Profit

Operating Expenses

Net Profit

Label

"Cash Basis"

Do NOT call this an official accounting statement.

---

## 2. Expense Report

Filters

Date Range

Category

Vendor

Payment Method

Created By

Output

Total Expenses

Grouped by

Category

Vendor

Payment Method

---

## 3. Cash Flow Report

Money In

Existing Payment records

Money Out

Expenses

Display

Daily

Weekly

Monthly

Net Cash Flow

Money In - Money Out

---

## 4. Aging Receivable Report

Build from existing Credit model.

Buckets

Current

1–30 Days

31–60 Days

61–90 Days

90+ Days

Display

Customer

Outstanding Amount

Bucket

Total Outstanding

---

## 5. Tax Summary

Reuse existing

Product.tax_percentage

Credit.tax_amount

Aggregate by tax rate.

No TaxCode model required.

---

# Phase 2

Vendor Module

Create

Vendor

Fields

- id
- tenant_id
- name
- phone
- email
- address
- notes

Expense may reference Vendor.

Fallback to vendor_name if deleted.

---

Cash Account Module

Purpose

Track where money lives.

Examples

Cash

Bank

Wallet

Mobile Money

Fields

- id
- tenant_id
- name
- balance
- description

Payments and Expenses may optionally reference CashAccount.

Maintain running balances.

No reconciliation.

---

Recurring Expenses

Create

RecurringExpenseTemplate

Fields

- category
- amount
- vendor
- frequency
- next_run
- active

Use scheduler infrastructure.

Generate Expense automatically.

Never edit generated expenses.

---

# GraphQL

Expose

Expense Queries

Expense Mutations

ExpenseCategory Queries

ExpenseCategory Mutations

Vendor Queries

Vendor Mutations

CashAccount Queries

CashAccount Mutations

RecurringExpense Queries

RecurringExpense Mutations

Follow current GraphQL naming conventions.

---

# Validation

Amount

> 0

Expense Date

Cannot be invalid

Category

Optional

Vendor

Optional

Receipt

Optional

Notes

Optional

---

# API Principles

Pagination

Filtering

Sorting

Searching

Permission Guards

Tenant Isolation

Audit Logs

Consistent Error Handling

Follow existing project conventions.

---

# UI/UX Principles

The application should remain simple enough that a shop owner with no accounting knowledge can understand it immediately.

Avoid accounting jargon whenever possible.

Instead of:

Accounts Receivable

Use

Money Customers Owe

Instead of:

Accounts Payable

Use

Business Expenses

Instead of:

Ledger

Use

History

Use plain language.

---

# Dashboard Additions

Add widgets

Today's Sales

Today's Collections

Today's Expenses

Outstanding Credit

Net Cash Flow

Monthly Revenue

Monthly Expenses

Net Profit

Recent Expenses

Top Expense Categories

Overdue Customers

---

# Charts

Monthly Revenue

Monthly Expenses

Revenue vs Expenses

Expense Category Pie Chart

Cash Flow Trend

Top Customers

Top Expense Categories

---

# Expense Form

Fields

Expense Category

Vendor

Amount

Payment Method

Expense Date

Receipt Upload

Notes

Large Save button

Mobile-friendly layout

---

# Reports UI

Provide

Date Range Picker

Export PDF

Export Excel

Print

Grouping

Filtering

Search

Summary Cards

Charts

Responsive tables

---

# Mobile UX

Bottom sheet forms

Large touch targets

Simple navigation

Minimal scrolling

Sticky Save button

Fast loading

---

# Design System

Continue using the existing design language.

Maintain consistency across:

Spacing

Typography

Colors

Cards

Tables

Buttons

Dialogs

Icons

Animations

Never introduce a different design style.

---

# Coding Standards

Every feature must include

Model

Migration

Repository

Service

GraphQL Schema

Permissions

Audit Logging

Validation

Tests

Documentation

---

# Success Criteria

The finished system should feel like:

A professional credit management application with lightweight accounting capabilities suitable for:

- Grocery stores
- Small retailers
- Pharmacies
- Hardware shops
- Local businesses

without becoming a full ERP or traditional accounting software.

Keep everything simple, practical, maintainable, and consistent with the existing architecture.