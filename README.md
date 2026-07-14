# Credit Management System

Credit tracking and payment reminders for small businesses — grocery shops, cafés,
pharmacies, hardware stores, repair shops, anyone who lets customers take goods now
and pay later.

This is **not** accounting software. It answers four questions:

1. Who owes me money?
2. How much, and since when?
3. Who is late?
4. Has anybody reminded them?

---

## What's in the box

| Area | What you get |
|---|---|
| **Credits** | Multi-item credit records with per-line discount and tax, due dates, photo/invoice attachments, and an auto-derived status (Pending → Partially Paid → Paid / Overdue / Cancelled). |
| **Payments** | An append-only ledger. Payments are voided, never edited, so a customer's history always reads like a bank statement. Overpayment is refused at the counter. |
| **Reminders** | The core feature. Automatic email to **both** the customer and the owner at 7/3/1 days before the due date (or any custom schedule), in the shop's own timezone. |
| **Customers** | Profiles, an explainable internal credit score, outstanding balances, emergency contacts. |
| **Catalog** | Products (SKU, barcode, stock, images) and services. |
| **Dashboard** | Revenue, receivables, overdue trend, collections, top customers, upcoming due dates. |
| **Reports** | Daily / weekly / monthly / yearly, exportable to CSV, Excel and PDF. Invoices and receipts generate on demand. |
| **Retention** | A configurable policy (30/60/90 days or Never) that archives, warns, lets you download or postpone, and only *then* deletes. Every deletion is logged. |
| **Storage** | Automatic image compression (typically ~95% smaller), content-hash deduplication, thumbnails, orphan cleanup, and a Storage Dashboard with one-click maintenance. |

---

## Tech stack

**Frontend** — Next.js 15 (App Router), TypeScript, Tailwind CSS v4, Framer Motion,
Lucide, React Hook Form + Zod, TanStack Table, TanStack Query, Recharts.

**Backend** — Python 3.12+, FastAPI, Strawberry GraphQL, SQLModel, APScheduler.

**Database** — SQLite by default (free, zero-config). The storage and database
layers are abstracted so moving to Postgres/Turso/Supabase and S3/R2 is a change of
environment variables, not a rewrite. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Quick start

Prerequisites: **Python 3.12+** and **Node 20+**.

### 1. Backend

```bash
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env

./.venv/bin/python -m app.db.seed --reset      # demo data
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

- GraphQL + GraphiQL explorer → <http://localhost:8000/graphql>
- Health check → <http://localhost:8000/health>

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

→ <http://localhost:3000>

### 3. Log in

```
Email     admin@creditsystem.local
Password  ChangeMe123!
```

The seed creates a Bhutanese general store with 6 customers, 10 products and 15
credits spread over five months — including overdue accounts, a partially-paid
account, a blocked customer, and a customer with no email address (who therefore
*cannot* be sent reminders). The unhappy paths are seeded on purpose.

---

## ⚠️ Read this before you rely on reminders

The spec called for the free **W3Forms** email service. You need to know exactly
what that can and cannot do, because it decides whether your customers ever hear
from you.

**W3Forms is a form-to-email relay, not a mail transport.** It delivers only to the
one inbox registered against your access key. It therefore **cannot send an email to
your customer.**

| | `EMAIL_PROVIDER=w3forms` | `EMAIL_PROVIDER=smtp` |
|---|---|---|
| Reminder to the **owner** ("4 credits due tomorrow") | ✅ works | ✅ works |
| Reminder to the **customer** ("your payment is due Friday") | ❌ **cannot be delivered** | ✅ works |
| Data-deletion warnings to the owner | ✅ works | ✅ works |
| Cost | Free | Free tier on Brevo (300/day), Resend (3k/mo), or your Gmail |

The system does **not** paper over this. A customer reminder attempted on W3Forms is
recorded as **failed**, with an error explaining why, and shows up in the
notification centre. You will never be told a customer was reminded when they
weren't.

**To make customer reminders work**, set these in `backend/.env` and restart:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASSWORD=your-key
EMAIL_FROM_ADDRESS=shop@yourdomain.com
```

Nothing else changes. That is the whole point of the provider abstraction.

---

## Project layout

```
/
├── frontend/          Next.js 15 app (deploys to Vercel as-is)
├── backend/           FastAPI + GraphQL + scheduler
│   ├── app/
│   │   ├── core/        config, security (roles/permissions/JWT), errors
│   │   ├── db/          engine, session, seed
│   │   ├── models/      SQLModel entities  ← read the docstrings; they hold the design
│   │   ├── storage/     pluggable object storage + image pipeline
│   │   ├── services/    ALL business logic. No HTTP, no GraphQL.
│   │   ├── email/       pluggable providers + safe template renderer
│   │   ├── graphql/     schema, types, resolvers  (a thin shell over services)
│   │   ├── api/         REST: uploads, downloads, PDFs (binary only)
│   │   └── scheduler/   APScheduler jobs: reminders, retention, maintenance
│   └── tests/
├── database/          app.db  (SQLite)
├── uploads/           local file storage
└── docs/              architecture, installation, deployment, API
```

The layering rule, and the reason the codebase stays maintainable:

> **Services hold all the business logic and import nothing from FastAPI or
> Strawberry.** The GraphQL layer translates requests into service calls; the
> scheduler calls the exact same services with no HTTP request in sight. A rule that
> is enforced by the import graph, not by good intentions.

---

## Testing

```bash
cd backend
./.venv/bin/python -m pytest -q          # 22 tests
./.venv/bin/ruff check app/              # lint
```

The tests concentrate on the two things that hurt most when they break:

- **`test_credit_money.py`** — line totals, tax-after-discount, partial payments,
  void-and-reopen, overpayment refusal, no float drift over many payments, and the
  integrity checker that re-derives balances from the ledger.
- **`test_reminders_and_retention.py`** — idempotent reminder planning (running the
  sweep twice must never double-send), skipping credits paid since the reminder was
  queued, and the retention pipeline's central promise: **data is never purged
  unless the owner was successfully warned first.**

---

## Documentation

| | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built and *why* — the decisions and their trade-offs |
| [docs/INSTALLATION.md](docs/INSTALLATION.md) | Detailed setup, environment variables, troubleshooting |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Going live, and the Vercel/serverless caveats you must know |
| [docs/API.md](docs/API.md) | The GraphQL schema, with examples |

---

## Licence

Yours. Build a business with it.
