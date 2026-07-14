# Installation

Getting the Credit Management System running on your machine, from nothing.

---

## 1. Prerequisites

| | Version | Check |
|---|---|---|
| **Python** | 3.12 or newer | `python3 --version` |
| **Node.js** | 20 or newer | `node --version` |
| **npm** | bundled with Node | `npm --version` |

Nothing else. No Docker, no Postgres, no Redis, no cloud account. SQLite is a file
and the scheduler runs in-process.

> Tested on Python 3.12 and 3.14. macOS, Linux, and WSL2. On native Windows use
> `.venv\Scripts\` instead of `.venv/bin/` throughout.

---

## 2. Backend

```bash
cd backend

python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt
```

That takes a minute or two (Pillow and reportlab are the slow ones).

### 2.1 Create `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Every value has a working default, so an *empty* `.env` also runs fine locally — the
file exists so you have somewhere to change things. For reference, the annotated
template is reproduced below.

```env
# --- App ---------------------------------------------------------------------
ENVIRONMENT=development
DEBUG=true

# --- Security ----------------------------------------------------------------
# Fine for localhost. MUST be replaced in production — the app refuses to boot
# in production while this is still the placeholder.
SECRET_KEY=dev-only-insecure-secret-change-me
CORS_ORIGINS=http://localhost:3000

# --- Database ----------------------------------------------------------------
# Leave unset to use ../database/app.db. Uncomment to move to Postgres/Turso.
# DATABASE_URL=postgresql+psycopg://user:pass@host:5432/credit

# --- Storage -----------------------------------------------------------------
STORAGE_BACKEND=local

# --- Email -------------------------------------------------------------------
# console  = print the rendered email to the terminal (the dev default)
# w3forms  = free, but CANNOT email customers — see §6
# smtp     = the only provider that reaches customers
EMAIL_PROVIDER=console
EMAIL_FROM_NAME=Credit Management System
EMAIL_FROM_ADDRESS=no-reply@localhost

# --- Scheduler ---------------------------------------------------------------
SCHEDULER_ENABLED=true
SCHEDULER_TIMEZONE=UTC
```

### 2.2 Seed the demo data

```bash
./.venv/bin/python -m app.db.seed --reset
```

`--reset` deletes `database/app.db` first. Without it the script is idempotent and
refuses to re-seed an already-populated database.

You get a Bhutanese general store: **6 customers, 10 products, 2 services, 15 credits**
spread over five months, **10 payments**, 2 users (an admin and a staff account), and
the 7 default email templates. The unhappy
paths are seeded on purpose — there is an overdue account, a partially-paid account,
a blocked customer who cannot take further credit, and **a customer with no email
address** (who therefore can never be sent a reminder). Seeding only the happy path is
how you ship a dashboard that looks perfect in the demo and falls apart on day one.

### 2.3 Run it

```bash
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

| | |
|---|---|
| GraphQL + GraphiQL explorer | <http://localhost:8000/graphql> |
| Health check | <http://localhost:8000/health> |
| OpenAPI docs (the 5 REST routes) | <http://localhost:8000/docs> |

A healthy boot looks like this:

```json
{"status":"ok","environment":"development","database":"ok",
 "scheduler":"running","storage":"local","email":"console"}
```

GraphiQL and `/docs` are served **only when `DEBUG=true`**. In production they are off,
and so is GraphQL introspection.

---

## 3. Frontend

```bash
cd frontend

npm install
cp .env.example .env.local     # this one does exist
npm run dev
```

→ <http://localhost:3000>

`.env.local` needs exactly one variable:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

No trailing slash. The client appends `/graphql` itself
(`src/lib/graphql/client.ts`).

---

## 4. Log in

```
Email     admin@creditsystem.local
Password  ChangeMe123!
```

Change these with `FIRST_SUPERADMIN_EMAIL` / `FIRST_SUPERADMIN_PASSWORD` **before**
seeding — they are read by the seed script, not at runtime.

> **What you will see:** the seed creates a Bhutanese general store with 6 customers,
> 10 products and 15 credits spread over five months — including overdue accounts, a
> partially-paid account, a blocked customer, and a customer with **no email address**
> (who therefore cannot be sent reminders). The unhappy paths are seeded on purpose, so
> the dashboard shows you what the app looks like with real, messy data rather than a
> tidy demo.

---

## 5. Environment variable reference

Everything below is read by `backend/app/core/config.py`. **Nothing else in the
codebase reads `os.environ` directly.** Every value has a working default; you can run
the whole thing with no `.env` at all.

### App

| Variable | Default | What it does |
|---|---|---|
| `APP_NAME` | `Credit Management System` | Title on `/docs` and in the `/` response. |
| `ENVIRONMENT` | `development` | `development` \| `staging` \| `production` \| `test`. `production` triggers `assert_production_ready()` on boot. |
| `DEBUG` | `true` | Verbose logs. **Also the master switch for GraphiQL, `/docs`, and GraphQL introspection** — all three are off when false. |
| `API_PREFIX` | `/api` | Mount point for the REST (binary) routes. |
| `GRAPHQL_PATH` | `/graphql` | Mount point for the GraphQL router. |

### Security

| Variable | Default | What it does |
|---|---|---|
| `SECRET_KEY` | `dev-only-insecure-secret-change-me` | Signs every JWT. **The app refuses to boot in production while this is unchanged.** Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | Access-token lifetime. The frontend refreshes silently on 401. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh-token lifetime. Rotated on every use. |
| `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES` | `60` | Password-reset link lifetime. Single-use. |
| `CORS_ORIGINS` | `http://localhost:3000` | **Comma-separated** list of allowed browser origins. Must include your deployed frontend URL, exactly, scheme included. |

### Database

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | `sqlite:///<repo>/database/app.db` | The only thing you change to migrate. Postgres: `postgresql+psycopg://user:pass@host:5432/db`. Turso: `sqlite+libsql://<db>.turso.io?authToken=…`. |
| `DB_ECHO` | `false` | Log every SQL statement. Loud, but the fastest way to answer "why is this query slow". |
| `DB_POOL_SIZE` | `5` | Connection pool size. **Ignored by SQLite**, honoured by Postgres/MySQL. |
| `DB_MAX_OVERFLOW` | `10` | Extra connections above the pool size under load. Ignored by SQLite. |

### Storage

| Variable | Default | What it does |
|---|---|---|
| `STORAGE_BACKEND` | `local` | `local` \| `s3`. `s3` also covers Cloudflare R2, Supabase Storage and MinIO. |
| `UPLOAD_DIR` | `<repo>/uploads` | Root of the local-disk tree. Only read when `STORAGE_BACKEND=local`. |
| `PUBLIC_FILES_URL` | `/api/files` | URL prefix the frontend uses to fetch a stored file. Local backend only. |
| `MAX_UPLOAD_MB` | `10` | Hard cap on one upload. Exceeding it returns HTTP 413. |
| `IMAGE_MAX_DIMENSION` | `1600` | Long edge, px. Every larger image is downscaled before storage. |
| `IMAGE_QUALITY` | `82` | WebP quality after compression. 82 is visually lossless at display size. |
| `THUMBNAIL_DIMENSION` | `320` | Long edge of the generated thumbnail, px. |
| `S3_ENDPOINT_URL` | *(none)* | Only for `STORAGE_BACKEND=s3`. Omit entirely for real AWS. R2: `https://<account>.r2.cloudflarestorage.com`. |
| `S3_REGION` | `auto` | `auto` is correct for R2. AWS needs a real region. |
| `S3_BUCKET` | *(none)* | **Required** when `STORAGE_BACKEND=s3`; boot fails without it. |
| `S3_ACCESS_KEY_ID` | *(none)* | S3 credentials. |
| `S3_SECRET_ACCESS_KEY` | *(none)* | S3 credentials. |
| `S3_PUBLIC_BASE_URL` | *(none)* | Your CDN origin. If unset, `url_for()` issues a 1-hour **pre-signed** URL instead, so a private bucket stays private. |

### Email

| Variable | Default | What it does |
|---|---|---|
| `EMAIL_PROVIDER` | `console` | `console` \| `w3forms` \| `smtp`. **`console` is refused in production.** See §6 before choosing `w3forms`. |
| `EMAIL_FROM_NAME` | `Credit Management System` | Platform-wide default sender name. A business can override it (`email_from_name`). |
| `EMAIL_FROM_ADDRESS` | `no-reply@localhost` | Envelope `From:`. Must be an address your SMTP provider will accept. |
| `W3FORMS_ACCESS_KEY` | *(none)* | Required for `EMAIL_PROVIDER=w3forms`. |
| `W3FORMS_ENDPOINT` | `https://api.web3forms.com/submit` | Override only if W3Forms changes it. |
| `SMTP_HOST` | *(none)* | e.g. `smtp-relay.brevo.com`, `smtp.gmail.com`, `smtp.resend.com`. |
| `SMTP_PORT` | `587` | 587 = STARTTLS, 465 = implicit TLS. |
| `SMTP_USER` | *(none)* | SMTP username. |
| `SMTP_PASSWORD` | *(none)* | SMTP password / API key / app password. |
| `SMTP_USE_TLS` | `true` | STARTTLS. Leave on. |

### Scheduler

| Variable | Default | What it does |
|---|---|---|
| `SCHEDULER_ENABLED` | `true` | Master switch. **Set to `false` on every instance but one** if you ever run more than one — see [ARCHITECTURE.md §14](ARCHITECTURE.md). |
| `SCHEDULER_TIMEZONE` | `UTC` | The timezone APScheduler's *cron triggers* fire in. It does **not** affect when a business's reminders go out — that is `Business.reminder_send_hour`, in the business's own IANA timezone. Leave it as UTC. |

### Retention & storage hygiene

| Variable | Default | What it does |
|---|---|---|
| `EXPORT_TTL_HOURS` | `24` | How long a generated export survives before the daily job deletes the file and marks the job `EXPIRED`. |
| `ARCHIVE_GRACE_DAYS` | `7` | Days between a batch being archived and its scheduled deletion. Also the amount a purge is deferred by when the owner was never warned. |

### Pagination

| Variable | Default | What it does |
|---|---|---|
| `DEFAULT_PAGE_SIZE` | `25` | Page size when a query omits `limit`. |
| `MAX_PAGE_SIZE` | `100` | Hard cap. A client asking for `limit: 1000000` is silently clamped to this — otherwise it is a free way to make the server materialise an entire tenant in one query. |

### Bootstrap (seed script only)

| Variable | Default | What it does |
|---|---|---|
| `FIRST_SUPERADMIN_EMAIL` | `admin@creditsystem.local` | Login for the seeded admin. Read **by the seed script**, not at runtime — change it *before* seeding. |
| `FIRST_SUPERADMIN_PASSWORD` | `ChangeMe123!` | Password for the seeded admin. Same caveat. |

### Frontend (`frontend/.env.local`)

| Variable | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend origin. No trailing slash; `/graphql` is appended by the client. `NEXT_PUBLIC_*` is **inlined into the browser bundle at build time** — never put a secret here, and remember that changing it in Vercel requires a **redeploy**, not just a restart. |

---

## 6. Making reminders actually reach customers

The single thing most likely to catch you out.

**W3Forms is a form-to-email relay, not a mail transport.** It delivers only to the one
inbox registered against your access key. It has no recipient parameter. It therefore
**cannot email your customer** — not with configuration, not with a workaround.

| | `EMAIL_PROVIDER=w3forms` | `EMAIL_PROVIDER=smtp` |
|---|---|---|
| Reminder to the **owner** ("4 credits due tomorrow") | ✅ | ✅ |
| Reminder to the **customer** ("your payment is due Friday") | ❌ **cannot be delivered** | ✅ |
| Data-deletion warnings to the owner | ✅ | ✅ |
| Cost | free | free tier: Brevo 300/day, Resend 3k/mo, or your own Gmail |

The system does not paper over this. A customer reminder attempted on W3Forms is
recorded as **failed**, with an error naming the fix, and surfaces in the notification
centre. You will never be told a customer was reminded when they weren't.

To fix it, in `backend/.env`:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASSWORD=your-key
EMAIL_FROM_ADDRESS=shop@yourdomain.com
```

Restart. Nothing else changes — same templates, same rendering, same logs. That is the
entire point of the provider abstraction.

---

## 7. Tests and linting

```bash
cd backend

./.venv/bin/python -m pytest -q         # 22 tests, ~6 seconds
./.venv/bin/ruff check app/             # lint
./.venv/bin/ruff format app/            # format
./.venv/bin/mypy app/                   # type check
```

There is no `pytest.ini`, `pyproject.toml` or `ruff.toml` — both tools run on their
defaults. The tests use an in-memory SQLite database per test and never touch
`database/app.db`.

Frontend:

```bash
cd frontend

npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run format      # prettier
```

To dump the GraphQL schema (useful for codegen, and for checking a change landed):

```bash
cd backend
./.venv/bin/python -c "from app.graphql.schema import schema; print(schema.as_str())"
```

---

## 8. Troubleshooting

### "Address already in use" on port 8000

```bash
lsof -ti:8000 | xargs kill      # macOS / Linux
```

Or just run on another port — `uvicorn app.main:app --port 8001` — and update
`NEXT_PUBLIC_API_URL` in `frontend/.env.local` to match.

Port 3000 taken? `npm run dev -- --port 3001`, then add that origin to `CORS_ORIGINS`.

### `sqlite3.OperationalError: database is locked`

SQLite allows one writer at a time. `db/session.py` already applies the two settings
that make this a non-issue:

```
PRAGMA journal_mode=WAL      # readers never block the writer
PRAGMA busy_timeout=30000    # wait 30s for the lock instead of failing instantly
```

If you still see it, something is holding a write transaction open for more than 30
seconds. The usual suspects:

- **A second process has the database open** — a stray `uvicorn`, an open DB browser,
  or a `python -m app.db.seed` you forgot about. `lsof database/app.db` will tell you.
- **A weekly `VACUUM` is running.** It rewrites the whole file and briefly takes an
  exclusive lock. It is scheduled for Sunday 03:30 for exactly this reason.
- **You ran `VACUUM` inside a transaction.** SQLite refuses. `StorageStatsService`
  takes its own `AUTOCOMMIT` connection; do not "simplify" that.

If you are chasing it, `DB_ECHO=true` shows you every statement and where the
transaction is stuck open.

### CORS errors in the browser console

> `Access to fetch at 'http://localhost:8000/graphql' from origin 'http://localhost:3000'
> has been blocked by CORS policy`

`CORS_ORIGINS` must contain the frontend's origin **exactly** — scheme included, no
trailing slash, correct port:

```env
CORS_ORIGINS=http://localhost:3000,https://your-app.vercel.app
```

It is comma-separated, and the backend must be **restarted** to pick it up (settings
are cached with `@lru_cache`). Note that Vercel preview deployments get a *different*
hostname on every push — add the preview domain, or use a stable production URL, or you
will chase this repeatedly.

Also check `NEXT_PUBLIC_API_URL` has no trailing slash. `http://localhost:8000/` +
`/graphql` produces a request to `//graphql`, which is not the same origin path.

### The scheduler is not firing

`/health` tells you whether it is even running:

```json
{"scheduler": "running"}   // good
{"scheduler": "disabled"}  // SCHEDULER_ENABLED=false
{"scheduler": "stopped"}   // enabled but not started — check the boot log
```

If it says `running` and reminders still do not go out, work down this list — the
first three catch almost everything:

1. **It is not that business's hour yet.** The job runs hourly and only acts on a
   business when `datetime.now(business.timezone).hour == business.reminder_send_hour`
   (default **9**, in the business's *own* IANA timezone). At 14:00 UTC with a shop in
   `Asia/Thimphu`, it is 20:00 there — nothing will happen.
2. **It already ran today for that business.** The `_ran_today` guard checks for a
   `SENT` reminder on that business's local date. One run per business per local day.
3. **`reminders_enabled` is false on the business**, or `reminder_days_before` is empty.
4. **Nothing is due.** Reminders are only planned for open credits with
   `remaining_amount > 0`, due between *today − 30 days* and *today + max(offset) + 1*.
5. **You are on serverless.** There is no long-lived process; the scheduler never fires
   at all. See [DEPLOYMENT.md](DEPLOYMENT.md) — this is the reason the backend must not
   go on Vercel.

To test without waiting, run the job by hand:

```bash
cd backend
./.venv/bin/python -c "
import asyncio
from app.scheduler.jobs import run_job_now
print(asyncio.run(run_job_now('reminders')))"
```

Valid job names: `reminders`, `daily`, `weekly`, `monthly`. Note it *still* honours the
per-business hour check, so to force a send, temporarily set the business's
`reminder_send_hour` to the current hour in its timezone. The `runMaintenance` GraphQL
mutation exposes the individual maintenance operations.

### Emails are not being sent

Check `/health` for the active provider, then work through:

| Symptom | Cause |
|---|---|
| Emails appear in the terminal, never in an inbox | `EMAIL_PROVIDER=console`. That is what console does. |
| **Owner emails arrive, customer emails all fail** | **`EMAIL_PROVIDER=w3forms`. This is the trap.** W3Forms physically cannot deliver to a customer. See §6. It is not misconfiguration — it is the provider's design. |
| Every email fails with an SMTP error | Wrong host/port/credentials. Gmail needs an **app password**, not your account password, and 2FA must be on. |
| A specific customer never gets reminded | They have no email address on file. The planner skips them rather than queueing a row that can only ever fail. Check `Customer.email`. |
| Nothing at all, no log lines | The template may be switched off (`EmailTemplate.is_active = false`). That produces an `EmailLog` row with the reason. |

**Every send attempt writes an `EmailLog` row** — success, provider rejection,
capability refusal, or an exception inside the provider. That table is where the answer
is:

```bash
cd backend
./.venv/bin/python -c "
from sqlmodel import Session, select, col
from app.db.session import engine
from app.models.communication import EmailLog
with Session(engine) as s:
    for e in s.exec(select(EmailLog).order_by(col(EmailLog.created_at).desc()).limit(10)):
        print(e.created_at, e.provider, e.to_address, e.success, e.error)"
```

### Pylance / VS Code cannot find the venv

Symptoms: `Import "fastapi" could not be resolved`, no autocomplete, red squiggles
under every import — while the code runs fine in the terminal.

VS Code is using the system interpreter, not `backend/.venv`. Fix:

1. `⌘⇧P` → **Python: Select Interpreter** → **Enter interpreter path** →
   `backend/.venv/bin/python`.
2. If it still misbehaves, add `.vscode/settings.json`:

   ```json
   {
     "python.defaultInterpreterPath": "backend/.venv/bin/python",
     "python.analysis.extraPaths": ["backend"]
   }
   ```

3. `⌘⇧P` → **Developer: Reload Window**.

The `extraPaths` entry matters: imports are absolute (`from app.core.config import
settings`), so the analyser needs `backend/` on its path, not the repo root.

### `ModuleNotFoundError: No module named 'app'`

You are running from the wrong directory or with the wrong interpreter. Every backend
command runs **from `backend/`** with **`./.venv/bin/python`** — not a globally
activated `python`.

### `sqlite3.OperationalError: no such table: business`

The database file is missing or empty. Tables are created on boot by `init_db()`, but a
*seed* is what makes the app usable:

```bash
cd backend && ./.venv/bin/python -m app.db.seed --reset
```

### The frontend loads but every page is empty

The backend is running but the database was never seeded. Tables exist; rows do not.

```bash
cd backend && ./.venv/bin/python -m app.db.seed --reset
```

### Login works, then every request 401s

The access token lives for 30 minutes and is held **in memory only** — a hard reload
drops it. The client is supposed to refresh silently using the `localStorage` refresh
token. If it does not:

- Check `localStorage` for `cms.refresh_token`. Missing means the login response was
  not stored.
- Refresh tokens **rotate**: each use revokes the presented token. Two tabs refreshing
  simultaneously can race — the client de-duplicates with a single shared in-flight
  promise, but a stale tab left open overnight may lose. Signing in again fixes it.
- Changing `SECRET_KEY` invalidates every token ever issued. Sign in again.

---

## 9. Project layout

```
/
├── frontend/          Next.js 15 app (deploys to Vercel as-is)
├── backend/
│   ├── app/
│   │   ├── core/        config, security (roles/permissions/JWT), errors
│   │   ├── db/          engine, session, seed
│   │   ├── models/      SQLModel entities  ← the docstrings hold the design
│   │   ├── storage/     pluggable object storage + image pipeline
│   │   ├── services/    ALL business logic. No HTTP, no GraphQL.
│   │   ├── email/       pluggable providers + safe template renderer
│   │   ├── graphql/     schema, types, resolvers (a thin shell over services)
│   │   ├── api/         REST: uploads, downloads, PDFs (binary only)
│   │   └── scheduler/   APScheduler jobs: reminders, retention, maintenance
│   └── tests/           22 tests
├── database/          app.db (SQLite) — gitignore this in a real repo
├── uploads/           local file storage — gitignore this too
└── docs/              you are here
```

---

## Next

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How it is built and why |
| [API.md](API.md) | The GraphQL API, with working examples |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Going live — read the Vercel section before you deploy anything |
</content>
</invoke>
