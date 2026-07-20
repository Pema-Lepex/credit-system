# Expenses & lightweight accounting

Phase 1 of the accounting module: business expenses, spending categories, and two
reports built on them. It is deliberately **not** an ERP, a general ledger, or a
double-entry system — see `PROJECT_RULES.md` for the boundary.

---

## The one rule everything else follows

**An expense never touches a customer balance.**

`app/models/ledger.py` is the *customer account* ledger: every row belongs to a
customer, carries a per-customer `seq`, and stores a `balance_after` that acts as a
checksum on that customer's balance. An expense belongs to no customer.

Posting expenses there would have required a nullable `customer_id` and would have
broken both invariants for the sake of sharing a table. So **no `LedgerEntryType`
was added** — the `expense` table is itself the record of the event, and the reports
read it directly. The spec's "expenses create business ledger entries only, do NOT
modify customer balances" is therefore true *by construction*, not by discipline.

`tests/test_expenses.py::test_recording_an_expense_never_touches_the_customer_ledger`
pins this.

---

## Data model

`backend/app/models/expense.py`

### `ExpenseCategory`
Mirrors the catalog `Category`, plus `is_active` and `sort_order`.

Deliberately a **separate table** from catalog `Category`: they are unique on the
same `(business_id, name)` pair but mean opposite things — "Fuel" as a thing you
sell is not "Fuel" as a thing you spend on — and sharing one table would put both
in every category dropdown in the app.

### `Expense`
| Field | Notes |
|---|---|
| `amount` | `MoneyType` — integer minor units, must be > 0 |
| `category_id` | nullable FK, `ON DELETE SET NULL` |
| `vendor_name` | free text **for now** — see Vendors below |
| `payment_method` | reuses the existing `PaymentMethod` enum |
| `expense_date` | a calendar **DATE**, not an instant |
| `receipt_file_id` | nullable FK into `file_asset`, via the existing storage layer |
| `created_by_user_id` / `updated_by_user_id` | nullable FKs into `user` |

`expense_date` is a DATE (like `Credit.issued_date`, unlike `Payment.paid_at`)
because a shop owner records "the rent, on the 1st" — there is no meaningful time
of day, and storing one would force every report to convert timezones to answer a
question nobody asked. Reports therefore compare it against **local** dates.

**Vendors:** `vendor_id` is Phase 2. `vendor_name` is stored now so that when the
`Vendor` model lands it can be added as a nullable FK alongside this column, with
`vendor_name` surviving as the fallback for expenses whose vendor was later
deleted. No data is lost in that migration.

### Migration
`migrations/versions/d4f7a1c62b98_add_expenses.py`, off head `c9d3e5b18f47`.
Purely additive — two `CREATE TABLE`s, no `ALTER` on anything that already exists,
with the usual `inspector.has_table` idempotency guards.

---

## Services

`backend/app/services/expense.py`

- **`ExpenseCategoryService`** — CRUD, search, sort, activate/deactivate. Deleting a
  category *uncategorises* its expenses rather than deleting them (the DB's
  `ON DELETE SET NULL` never fires for a soft delete).
- **`ExpenseService`** — `create` / `update` / `soft_delete` / `restore` /
  `permanent_delete` / `get` / `list` / `search` / `upload_receipt` /
  `remove_receipt`.

**Why expenses are editable and payments are not.** `PaymentService` refuses to
edit a payment: it is a claim about what a customer handed over, and rewriting it
rewrites a shared history the customer can argue with. An expense has no
counterparty inside the system — it is the owner's own note about their own money,
and the realistic failure mode is a typo in last Tuesday's fuel bill. So an expense
updates in place, with the before/after landing in the audit log, and soft-deletes
to the Trash. No void, no reversal.

Validation: amount > 0, no future dates, category must be in scope, everything else
optional.

---

## Permissions

| Permission | Staff | Admin |
|---|---|---|
| `expense:read` | ✅ | ✅ |
| `expense:write` | ✅ | ✅ |
| `expense:delete` | — | ✅ |
| `expense_category:read` | ✅ | ✅ |
| `expense_category:manage` | — | ✅ |

Split the same way as payments: staff record the day's spending, only an owner
removes a record or reshapes the categories.

Every write emits an audit log (`CREATE` / `UPDATE` / `DELETE` / `PURGE` /
`RESTORE`) against entity type `expense` or `expense_category`, including receipt
upload and removal.

---

## Reports

`backend/app/services/accounting.py` — a separate module from `reports.py`, which is
already ~1550 lines and owns two unrelated jobs. Nothing in `reports.py` changed.

### Expense report
Total spending for a period, grouped three ways: **by category**, **by vendor**, and
**by payment method**. Filterable by category, vendor, method and creator.
Uncategorised spending appears as its own row (a `LEFT JOIN`) — an owner who never
picks a category must not see an empty breakdown over a real total, which reads as
missing money.

### Cash flow
Money in (collections) against money out (expenses), bucketed over time with a
running net. The two sides are keyed **differently and deliberately**:
`Payment.paid_at` is an instant, so its bucket edges are local midnights expressed
in UTC; `Expense.expense_date` is already a local calendar date. Getting this
backwards puts a shop's evening takings on tomorrow's row.

Granularity is chosen from the range length, not by the client — day up to 62 days,
week up to 400, month beyond. Empty buckets are included: omitting a quiet week
would draw a downturn as a flat line.

### Aging receivable — "Money customers owe"
A **point-in-time** report, not a period one: "who owes me" has no start date.
`as_at` defaults to today in the shop's timezone and exists so a figure can be
reproduced later.

Buckets: Not due yet · 1–30 · 31–60 · 61–90 · 90+, by `due_date`. Only open credits
with something outstanding count — a settled credit owes nothing however late it
once was. Customers are sorted **oldest debt first**, because that is the order an
owner works down the list.

The window predicates compare `due_date` against precomputed Python dates rather
than doing date arithmetic in SQL, because SQLite and Postgres disagree about what
subtracting two dates yields. Every boundary (0/1, 30/31, 60/61, 90/91) is pinned
by a parametrised test.

### Tax summary
Grouped by rate, aggregated from credit **lines** — `CreditItem.tax_percentage` is
the rate snapshotted from the product at sale time, and the only place the per-rate
split actually exists.

`Credit.tax_amount` is summed independently as a cross-check. If a shop charged tax
at the credit level rather than per line, the two disagree and `reconciles` is
false — the UI and the exported file both say the breakdown is incomplete and show
what was actually billed, rather than quietly under-reporting. No `TaxCode` model,
per the spec.

### Profit & Loss — **cash basis**
```
  Money you collected        (payments received in the period)
− Cost of what you sold      (COGS)
= Gross profit
− Business expenses          (grouped by category)
= Net profit
```

Two approximations are baked in **deliberately**, and both are surfaced to the
reader as the label "Cash basis":

1. **Revenue is money collected**, not credit issued. That is the number a shop
   owner means by "what did we take this month", and it is the one that reconciles
   with the till.
2. **COGS is the cost of goods issued in the period, at the product's *current*
   `cost_price`.** Consequences: it is matched against collections that may relate
   to a different period, and re-pricing a product retroactively changes past COGS.
   Fixing either means snapshotting cost onto every credit line and running accrual
   matching — i.e. the double-entry system the spec rules out. `Product.cost_price`
   is what the spec says to use.

Services and free-text line items have no cost price and contribute zero COGS,
which is correct: their cost is labour, and that lands in Operating Expenses.

**This is a management figure to steer by, never an official accounting
statement.** The `basis` field travels in the GraphQL payload so every surface —
screen, PDF, XLSX — shows the caveat without re-deriving it.

All aggregation goes through `analytics.money_sum` / `to_money`. Never hand-roll a
`SUM` over a `MoneyType` column — see `app/services/analytics.py` for why.

---

## GraphQL

**Queries:** `expense`, `expenses`, `deletedExpenses`, `expenseCategories`,
`expenseReport`, `profitLoss`

**Mutations:** `createExpense`, `updateExpense`, `deleteExpense`, `restoreExpense`,
`permanentlyDeleteExpense`, `uploadExpenseReceipt`, `removeExpenseReceipt`,
`createExpenseCategory`, `updateExpenseCategory`, `deleteExpenseCategory`

Money crosses the wire as a **string**, as everywhere else in this schema.
Regenerate `docs/schema.graphql` after schema changes.

---

## Downloads

The download buttons reuse the existing export pipeline rather than rendering
anything client-side. Three new datasets on the whitelist in
`app/services/export.py`:

| Dataset | Contents |
|---|---|
| `expenses` | Every expense line in range |
| `expense_summary` | The grouped breakdown (category / vendor / method) |
| `profit_loss` | The P&L as a label/value table |
| `cash_flow` | Per-period in/out/net, with a totals row |
| `aging_receivable` | One row per customer, one column per bucket |
| `tax_summary` | Per-rate breakdown, flagged if it does not reconcile |

Each works in **CSV, XLSX, JSON and PDF**. Every one calls `AccountingService`, so
a downloaded file and the on-screen report can never disagree. Files expire
server-side after 24h.

`aging_receivable` is point-in-time, so it reads the export's `end` filter as its
as-at date rather than as the end of a range.

The flow, unchanged from the existing Reports page:
1. `createExport` builds the file **server-side** and returns the job already
   generated (`READY` or `FAILED`).
2. An authenticated binary fetch to `GET /api/exports/{id}/download` — a plain
   `<a href>` cannot carry the bearer token.

`tests/test_expense_exports.py` exercises all 12 dataset × format combinations.

---

## Frontend

| Path | What |
|---|---|
| `src/features/expenses/` | queries, URL-state filters, hooks, view/table/filters/form |
| `src/app/(dashboard)/expenses/` | the Expenses route |
| `src/features/reports/components/profit-loss-view.tsx` | the P&L page |
| `src/features/reports/components/cash-flow-view.tsx` | cash flow, with a combined bar/line chart |
| `src/features/reports/components/receivables-view.tsx` | the aging ladder |
| `src/features/reports/components/tax-summary-view.tsx` | tax by rate |
| `src/features/reports/components/report-download-buttons.tsx` | shared PDF/Excel/CSV buttons |
| `src/features/reports/components/report-period-picker.tsx` | shared period control + `useReportPeriod` |
| `src/app/(dashboard)/reports/{profit-loss,cash-flow,receivables,tax}/` | the four routes |

The six reports nest under **Reports** in the sidebar, using the same
parent/children shape Settings already uses — a flat list of six was too many.

`useReportPeriod` exists because four reports needed the identical picker, the
identical "a custom range needs both dates" guard, and the identical memoised
input. Four copies would have been four chances for one to send a range the server
cannot resolve.

Mirrors the `payments/` feature conventions throughout: money is a string end to
end, filters live in the URL, sorting and paging are the server's, and every list
has a desktop table plus a separate mobile card list.

**Plain language over accounting jargon**, per the spec — "Money you collected",
"Cost of what you sold", "Business expenses", "Where the money went". The formal
terms appear only as hints under the plain ones, so the report stays recognisable
to an accountant without requiring one.

---

---

# Phase 2 — vendors, cash accounts, repeating bills

## Vendors (`vendor`)

`backend/app/models/vendor.py`, `app/services/vendor.py`. Name, phone, email,
address, notes.

**Not merged into `Customer`.** They share five contact fields and nothing else: a
customer has a balance, a credit score, a credit limit, statements and a ledger,
because money flows the other way. One table would mean every customer query
filtering out vendors, and a real risk of a supplier appearing in "who owes us
money".

**The fallback rule.** `Expense` keeps BOTH `vendor_id` and `vendor_name`. The name
is snapshotted onto the expense at recording time, so:

- Deleting a vendor leaves last year's expenses still saying who was paid — the id
  is detached, the text remains.
- Renaming a vendor does **not** rewrite history. Past expenses record who was paid
  *at the time*; only new ones pick up the new name.

Same reasoning as `CreditItem`'s price snapshot. The UI still offers free-text
"who you paid" when no supplier is picked, so a one-off purchase never forces a
Vendor record.

## Cash accounts (`cash_account`)

`backend/app/models/cash_account.py`, `app/services/cash_account.py`. Payments and
expenses may each optionally reference one.

**The balance is DERIVED, not stored** — the one place this deviates from the
spec's literal field list, deliberately:

```
balance = opening_balance + SUM(payments in) − SUM(expenses out)
```

A stored counter would need updating from eleven write paths (record / void /
trash / restore / purge, for payments and expenses alike), and is silently wrong
*forever* the first time one is missed. The codebase already documents that exact
failure mode for `customer.outstanding_balance`, which needs a scheduled job to
detect drift. Deriving it means the number cannot be wrong, and "no reconciliation"
becomes true because there is nothing to reconcile. Cost: two grouped queries for
the whole screen.

Voided payments and trashed expenses are excluded, matching the reports.

## Repeating bills (`recurring_expense_template`)

`backend/app/models/recurring.py`, `app/services/recurring.py`. Rent, wages,
electricity — a standing instruction that the scheduler turns into real `Expense`
rows as its dates arrive.

### Idempotency is structural, not remembered

The scheduler's contract is that every job can run twice with no ill effect. For a
generator that is the difference between "the rent was recorded" and "the rent was
recorded four times".

It is enforced by a **unique index on `(expense.recurring_template_id,
expense.expense_date)`** — not by the job tracking what it did. A second run
attempts an insert the database refuses. NULLs are distinct in a unique index on
both SQLite and Postgres, so manually recorded expenses are entirely unaffected and
may freely share a date. `next_run` advancing is a convenience; the index is the
guarantee.

Each insert runs in a SAVEPOINT so a refused duplicate cannot poison the session
and take every other template's work down with it.

### Catch-up, capped

A template whose `next_run` has passed has missed runs — the host was asleep, the
shop was offline. The generator walks forward emitting one expense per due date, so
nothing is skipped. That walk is capped at **60** per run: a daily template dormant
for three years would otherwise dump a thousand rows in one tick. Past the cap it
stops and leaves `next_run` where it got to, so the next run *continues* rather
than skipping.

### The anchor day

`anchor_day` stores the day of the month the owner actually chose. Without it a
"rent on the 31st" template drifts permanently: February clamps it to the 28th, and
every later month then advances from the 28th. With it, each month clamps from the
anchor — 31, 28, 31, 30, 31 — which is what a standing order does.

### Generated expenses are not editable

Spec: *never edit generated expenses.* `ExpenseService.update` refuses one with a
`recurring_template_id`, and the UI hides the Edit action and badges the row
"Automatic". Deleting one stays available, so a wrong row is never trapped. Editing
the template changes the future only; deleting a template keeps everything it has
already generated, like cancelling a standing order at a bank.

### Scheduling

`recurring_expense_run` in `app/scheduler/jobs.py`, registered at **01:45 daily** —
after statements, before the 02:30 cleanup, and well before any shop's reminder
hour so the day's expenses exist before anyone reads a report. Per-business local
time. Also reachable from `run_job_now("recurring_expenses")` and the
`runRecurringExpenses` mutation ("Record due now").

## Migration `e6b3c9d15a72`

Three new tables, four new **nullable** columns (`expense.vendor_id`,
`expense.cash_account_id`, `expense.recurring_template_id`,
`payment.cash_account_id`), one unique index.

**The added columns carry no database-level foreign key**, deliberately. SQLite
cannot `ALTER` a constraint in, so a real FK would have meant Alembic batch mode —
a copy-and-move rebuild of `expense` *and* of `payment`. Rebuilding the payments
table on a live database is a much bigger risk than the constraint is worth, and
the constraint buys almost nothing: `ON DELETE SET NULL` only fires on a hard
delete, while every parent here is soft-deleted. `CategoryService` already
documents this gap and hand-detaches its members; `VendorService`,
`CashAccountService` and `RecurringExpenseService` do the same, which is also where
the scope check lives.

Every added column is nullable with no server default, so existing rows are valid
the moment the migration lands and no backfill is needed.

## Permissions

| Permission | Staff | Admin |
|---|---|---|
| `vendor:read` / `vendor:write` | ✅ | ✅ |
| `vendor:delete` | — | ✅ |
| `cash_account:read` | ✅ | ✅ |
| `cash_account:manage` | — | ✅ |
| `recurring_expense:read` | ✅ | ✅ |
| `recurring_expense:manage` | — | ✅ |

Staff add a supplier while recording an expense and pick an account; they do not
create accounts or schedules.

## Frontend

| Path | What |
|---|---|
| `src/features/vendors/` + `/vendors` | "Suppliers" |
| `src/features/cash-accounts/` + `/cash-accounts` | "Cash & Bank" — balance cards |
| `src/features/recurring-expenses/` + `/recurring-expenses` | "Repeating Bills" |

Grouped under a **Money out** nav section. Plain language throughout, per the spec:
"Suppliers", "Cash & Bank", "Repeating Bills", "Every month" — not "Vendors",
"Chart of Accounts", "MONTHLY".

---

---

# Dashboard

`AccountingService.dashboard()` returns the money-out half in **seven queries**,
regardless of how many months are charted — the monthly series is one `SUM(CASE)`
column set per side, exactly like `_cash_rows`.

It is exposed as a SEPARATE `accounting` block on the `Dashboard` type rather than
merged into `DashboardSummary`, which is already wide and knows nothing about
expenses. Purely additive: a client that does not ask for the new fields gets
exactly the payload it got before.

| Band | Contents |
|---|---|
| **Today** | Today's sales · collections · expenses · what customers owe |
| **This month** | Revenue · expenses (with a vs-last-month delta) · net cash flow · net profit |
| *(existing)* | The original summary tiles and trend charts, untouched |
| **Money in and out** | Revenue vs Expenses · Cash Flow Trend |
| **Spending** | Top expense categories (pie) · Recent expenses · Chase these first |

Three decisions worth keeping:

- **Net profit has ONE definition.** The dashboard tile and the P&L report both
  compute revenue − COGS − expenses, and a test asserts they agree. Two different
  numbers under one name would be worse than no number.
- **"Overdue" has ONE definition.** The Chase-these-first panel is built from the
  aging report's own rows, so it means the same thing as the receivables page.
  Customers who are merely *not yet due* are filtered out.
- **Semantic colour, not series colour.** Revenue-vs-Expenses uses the success and
  destructive tones so the reader never has to consult a legend to learn which bar
  is the good one. `ChartTheme` gained `positive`/`negative` for this; they are
  never used as a categorical series colour.

The expense pie is coloured from the owner's **own** category colours where they
set one, falling back to the fixed ramp — a shop that colour-codes "Rent" red sees
red on the dashboard too.

---

## Still not built

**Print button** on reports — asked for in the spec. There is no `window.print`
anywhere in the app, so it was never built for the original reports either.

**Bottom-sheet mobile forms and sticky save** — the forms use the existing
`Dialog`, matching every other form in the app. A `Sheet` primitive exists if the
spec's literal reading is wanted.
