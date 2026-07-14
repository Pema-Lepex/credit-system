# Deployment

Read §2 before you deploy anything. It is the section that stops you shipping a
system that silently never reminds anybody.

---

## 1. The shape of a correct deployment

| Piece | Goes on | Why |
|---|---|---|
| **Frontend** (`frontend/`) | **Vercel** — works as-is | It is a Next.js app that renders and calls an API. It touches no disk, runs no cron, holds no state. |
| **Backend** (`backend/`) | **A persistent host** — Render, Fly.io, Railway, a $5 VPS | It runs a long-lived scheduler and owns the connections to the database and object store. |
| **Database** | **Managed Postgres** — Supabase / Neon / Render | `DATABASE_URL`. **Never SQLite in production** — see §1.1. |
| **Uploads** | **Cloudinary** (or S3/R2) | `STORAGE_BACKEND=cloudinary`. **Never local disk in production** — see §1.1. |

```mermaid
flowchart LR
    U["Browser"] --> V["Vercel<br/>Next.js frontend<br/>NEXT_PUBLIC_API_URL →"]
    V -.->|"GraphQL + REST"| B
    U -->|"GraphQL + REST<br/>(the browser calls the API directly)"| B["Persistent host<br/>Render / Fly / Railway<br/>FastAPI + APScheduler"]
    U -->|"images, direct from CDN"| C
    B --> D[("Managed Postgres<br/>Supabase / Neon")]
    B --> C[("Cloudinary<br/>object store + CDN")]
    B --> M["SMTP"]
```

---

## 1.1 The two settings that silently destroy all your data

A container's filesystem is **rebuilt on every deploy**. On Render, Fly, Railway and
every serverless host, whatever was written to disk since the last deploy is gone —
and on Render's free tier it also goes when the service idles down.

So these two configurations are not "less ideal". They are **data loss on a timer**:

| Setting | What happens |
|---|---|
| `DATABASE_URL=sqlite:///…` | The database file is inside the container. Every redeploy destroys **every customer, credit and payment**. |
| `STORAGE_BACKEND=local` | Uploads are written to `uploads/`, inside the container. Every redeploy destroys **every photo, logo and receipt**. |

Both *appear* to work. The app boots, serves traffic, and looks healthy — right up
until the next deploy, when the data is simply not there. Nothing errors, because
nothing is wrong: you told it to write to a disk that does not persist.

**The app now refuses to boot on either.** With `ENVIRONMENT=production`,
`assert_production_ready()` raises and the process exits. A crash at deploy time is a
far better outcome than finding out a week later that the shop's ledger is empty.

The fix is two environment variables, and nothing else in the codebase changes:

```bash
DATABASE_URL=postgres://…      # Supabase / Neon / Render Postgres
STORAGE_BACKEND=cloudinary     # + CLOUDINARY_URL
```

---

## 2. The backend must NOT go on Vercel

Vercel runs serverless functions. You *can* get a FastAPI app to respond there. It
will look like it works. **It will be broken in three ways, and two of them are
silent.**

### (a) The reminder scheduler never fires

`app/scheduler/` starts an in-process `AsyncIOScheduler` in FastAPI's lifespan and
registers four cron jobs. A serverless function is **spun up to serve a request and
torn down afterwards.** There is no long-lived process for a cron trigger to fire
inside. The lifespan may run, the scheduler may even start — and the container is
destroyed before any trigger comes due.

**Consequence:** reminders are never sent. Overdue credits are never promoted. The
retention pipeline never archives, never warns, and never purges. Storage is never
swept. Nothing errors. The API answers every query correctly. **The product's core
feature simply does not happen, and nothing tells you.**

This is the single most important sentence in this document.

### (b) Uploads vanish

`LocalStorage` writes to the container filesystem. On serverless that filesystem is
**ephemeral**: wiped between deploys, and *not shared* between concurrent instances. A
photo uploaded by one request can be missing from the very next one, because the next
one landed on a different container.

You would have `FileAsset` rows in the database pointing at bytes that no longer
exist, and image URLs that 404 at random.

### (c) SQLite is not durable there

`database/app.db` lives on the same ephemeral filesystem. **Every write is lost on the
next deploy or cold start.** Worse, two concurrent instances get two *different* copies
of the file, and neither can see the other's writes. There is no error — just data
that quietly disappears.

### If you truly must run the backend on serverless

Then all three must be fixed, and the scheduler moved out entirely:

- `STORAGE_BACKEND=s3` — mandatory.
- `DATABASE_URL` → a managed Postgres or Turso — mandatory.
- `SCHEDULER_ENABLED=false`, and the jobs triggered by an external cron
  (Vercel Cron, GitHub Actions, cron-job.org) hitting an authenticated endpoint you
  would need to add. **That endpoint does not exist today.** The jobs are plain async
  functions (`app/scheduler/jobs.py::run_job_now`), so wiring one up is small — but it
  is work you have to do, not a config flag.

At that point you have paid for a database and object storage and still have a worse
deployment than a $5 VPS. **Don't.**

---

## 3. Frontend → Vercel

It genuinely is as easy as advertised.

```bash
cd frontend
npx vercel        # or connect the repo in the Vercel dashboard
```

**Root directory:** `frontend`. Framework preset: Next.js. Build command, output
directory and install command are all auto-detected.

**Environment variables** (Vercel → Project → Settings → Environment Variables):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://your-backend.fly.dev` |

No trailing slash. That is the only variable the frontend has.

Two things that catch people:

- **`NEXT_PUBLIC_*` is inlined into the browser bundle at build time.** Changing it
  requires a **redeploy**, not a restart. And never put a secret behind that prefix.
- **Add the Vercel domain to the backend's `CORS_ORIGINS`.** Preview deployments get a
  fresh hostname on every push, so either add the preview domain each time or test
  against the production URL:

  ```env
  CORS_ORIGINS=https://your-app.vercel.app,https://www.yourdomain.com
  ```

---

## 4. Backend → a persistent host

Ranked by "how quickly can I get this working".

| Host | Free tier? | Persistent disk | Notes |
|---|---|---|---|
| **Fly.io** | small always-on VMs, generous | ✅ volumes | Best fit. Config below. |
| **Railway** | trial credit, then ~$5/mo | ✅ volumes | Easiest. Detects the Dockerfile, mount a volume, done. |
| **Render** | free web service **spins down after inactivity** | ✅ disks (paid) | ⚠️ The free tier sleeping means **the scheduler stops when nobody is browsing** — the same failure mode as serverless. Use a paid instance, or accept that reminders only fire while somebody is using the app. |
| **A $5 VPS** (Hetzner / DigitalOcean / Vultr) | no | ✅ it is a real disk | Total control. `docker run`, or systemd + uvicorn behind nginx. |
| **Raspberry Pi in the shop** | you own it | ✅ | Genuinely viable. This app was designed to run on one. Put Cloudflare Tunnel in front of it for HTTPS. |

### 4.1 Dockerfile

Create `backend/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Pillow needs libjpeg/zlib at runtime; the wheels bundle most of it, but the
# slim image is missing the shared libs some transitive deps expect.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libjpeg62-turbo zlib1g curl \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first: this layer is cached until requirements.txt changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# The state that must survive a deploy. Mount a volume here.
#
# WHY THESE ARE SET EXPLICITLY: config.py derives its defaults from the file's
# location (ROOT_DIR = the parent of the backend directory). Inside this image
# that resolves to "/", which is not where you want a database. Naming them
# removes the guesswork.
ENV DATABASE_URL=sqlite:////data/app.db \
    UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:8000/health || exit 1

# ONE worker, deliberately. Each worker starts its own APScheduler; two workers
# means two schedulers running every job twice. See ARCHITECTURE.md §14.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

Note the SQLite URL has **four** slashes: `sqlite:////data/app.db` = `sqlite:///` +
the absolute path `/data/app.db`.

Build and run locally to check it:

```bash
cd backend
docker build -t credit-system .
docker run --rm -p 8000:8000 \
  -v "$(pwd)/../database:/data" \
  -e SECRET_KEY=local-test \
  credit-system
curl localhost:8000/health
```

### 4.2 fly.toml

Create `backend/fly.toml`:

```toml
app = "credit-system-api"
primary_region = "sin"          # pick one near your users: sin, bom, fra, iad…

[build]
  dockerfile = "Dockerfile"

[env]
  ENVIRONMENT      = "production"
  DEBUG            = "false"
  DATABASE_URL     = "sqlite:////data/app.db"
  UPLOAD_DIR       = "/data/uploads"
  STORAGE_BACKEND  = "local"
  EMAIL_PROVIDER   = "smtp"
  SCHEDULER_ENABLED = "true"
  CORS_ORIGINS     = "https://your-app.vercel.app"

# The volume is what makes SQLite and local uploads legitimate here: it is a real
# disk that survives deploys and restarts.
[[mounts]]
  source      = "credit_data"
  destination = "/data"

[http_service]
  internal_port        = 8000
  force_https          = true

  # BOTH OF THESE MATTER, AND BOTH ARE THE OPPOSITE OF THE FLY DEFAULT.
  #
  # auto_stop_machines: a stopped machine runs no scheduler. Reminders would only
  # fire when somebody happened to be using the app — which is exactly the
  # serverless failure this whole document is about.
  auto_stop_machines  = false
  auto_start_machines = true

  # min_machines_running = 1: keep exactly one alive. Not zero (no scheduler), and
  # not more than one (two schedulers, duplicate jobs, possible duplicate emails —
  # the jobs are idempotent, but the race window between two workers reading the
  # same SCHEDULED row is real).
  min_machines_running = 1

[[http_service.checks]]
  grace_period = "10s"
  interval     = "30s"
  method       = "GET"
  path         = "/health"
  timeout      = "5s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"              # Pillow decoding a 6 MP photo wants headroom
```

Deploy:

```bash
cd backend
fly launch --no-deploy          # creates the app; keep the fly.toml above
fly volumes create credit_data --size 1        # 1 GB

# Secrets — never in fly.toml, never in git.
fly secrets set SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
fly secrets set SMTP_HOST=smtp-relay.brevo.com \
                SMTP_PORT=587 \
                SMTP_USER=... \
                SMTP_PASSWORD=... \
                EMAIL_FROM_ADDRESS=shop@yourdomain.com

fly deploy

fly logs                        # look for "Scheduler started"
curl https://credit-system-api.fly.dev/health
```

The first boot creates the tables (`init_db()`). To seed a demo tenant:

```bash
fly ssh console -C "python -m app.db.seed"
```

> **Scale to exactly one machine.** `fly scale count 1`. If you scale to 2, both run the
> scheduler. The jobs are idempotent so you will not corrupt data, but you will do the
> work twice and can duplicate an email in the race window. If you must scale for
> throughput, set `SCHEDULER_ENABLED=false` on every machine except one — which the
> current single-`fly.toml` setup cannot express, so you would need a separate worker
> app. That is the point at which you should move the jobs to a real queue instead.

### 4.3 Railway

Point it at `backend/`. It detects the Dockerfile. Add a volume mounted at `/data`, set
the same env vars, deploy. Railway keeps the container running by default — which is
what you want.

### 4.4 A VPS

```bash
git clone <repo> && cd credit-system/backend
docker build -t credit-system .
docker run -d --name credit-system --restart unless-stopped \
  -p 127.0.0.1:8000:8000 \
  -v /srv/credit-data:/data \
  --env-file /srv/credit.env \
  credit-system
```

Then nginx (or Caddy — one line for automatic HTTPS) in front, terminating TLS and
proxying to `127.0.0.1:8000`. The app reads `X-Forwarded-For` for audit-log IPs, so
make sure your proxy sets it.

---

## 5. Production checklist

Run through this before you point a real shop at it.

- [ ] **`SECRET_KEY`** — a real random value. `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Changing it later invalidates every access and refresh token in existence (everyone is logged out). *The app refuses to boot in production with the placeholder.*
- [ ] **`ENVIRONMENT=production`** and **`DEBUG=false`**. This is what turns off GraphiQL, `/docs`, **and GraphQL introspection**. *The app refuses to boot in production with `DEBUG=true`.*
- [ ] **`EMAIL_PROVIDER`** is `smtp`, not `console`. *The app refuses to boot in production with `console`.* And if it is `w3forms`, understand that **no customer will ever be emailed** ([INSTALLATION.md §6](INSTALLATION.md)).
- [ ] **`CORS_ORIGINS`** contains your real frontend origin and nothing you do not control.
- [ ] **HTTPS everywhere.** Fly/Railway/Render terminate TLS for you. On a VPS use Caddy or Certbot. Tokens travel in an `Authorization` header; plain HTTP hands them to anyone on the path.
- [ ] **Exactly one instance runs the scheduler.** One machine, or `SCHEDULER_ENABLED=false` on all but one.
- [ ] **`DATABASE_URL` points at Postgres**, not SQLite. *The app refuses to boot in production on SQLite* — on a container host the file is destroyed on every redeploy, taking every customer and credit with it (§1.1).
- [ ] **`STORAGE_BACKEND=cloudinary`** (or `s3`), not `local`. *The app refuses to boot in production on local storage* — same reason: `uploads/` lives in the container (§1.1).
- [ ] **`CLOUDINARY_URL` is set** if `STORAGE_BACKEND=cloudinary`. The driver refuses to start without credentials rather than silently falling back to a disk that does not persist.
- [ ] **Backups are scheduled** — §8. The app gives you the endpoint; it does not run the cron for you.
- [ ] **`/health` is wired to an uptime monitor.** It reports `database`, `scheduler`, `storage` and `email` — a `"scheduler": "stopped"` is the alert you actually care about.
- [ ] **Change the seeded admin password**, or do not seed at all in production and register the first business through the UI.
- [ ] **`.env`, `database/` and `uploads/` are gitignored.** (The repo currently ships a populated `database/app.db` and `uploads/` — do not carry those into a real deployment.)

---

## 6. Going to production: Postgres + Cloudinary

These two are **not optional** on a container host — see §1.1. Neither changes a single
line of application code: the database goes through `db/session.py`, and storage goes
through the `StorageBackend` Protocol in `storage/base.py`. No service, resolver or
model knows which one is behind it.

### 6.1 Database → Postgres (Supabase / Neon / Render)

**Why Postgres and not Turso.** Turso is libSQL — SQLite semantics with replication —
and it is a reasonable product. But SQLModel, SQLAlchemy 2 and Alembic support Postgres
as a first-class dialect and libSQL only through a third-party dialect
(`sqlalchemy-libsql`) whose Alembic support is thin. This app *migrates schemas* and
*pools connections*, and Postgres does both properly. Supabase and Neon both have a free
tier with no card. (`DATABASE_URL` still accepts a `sqlite+libsql://` URL untouched, so
Turso remains available if you want it.)

```bash
pip install "psycopg[binary]"   # already in requirements.txt
```

```env
# Paste the URL EXACTLY as the provider prints it. Both `postgres://` and
# `postgresql://` are rewritten to `postgresql+psycopg://` for you (config.py), because
# SQLAlchemy 2 rejects the first and routes the second to psycopg2, which is not installed.
DATABASE_URL=postgres://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres
DB_POOL_SIZE=5
DB_MAX_OVERFLOW=10
```

Then create the schema:

```bash
alembic upgrade head
```

Notes, all verified against a real Postgres:

- **Money is exact.** `MoneyType` stores integer minor units in a `BigInteger`, so
  amounts move across byte-for-byte. No float drift, no conversion step.
- **`db/session.py` already branches**: a non-SQLite URL builds a real connection pool
  with `pool_pre_ping=True` (which transparently recycles connections a managed provider
  dropped) and skips every SQLite `PRAGMA`.
- **The Storage Dashboard keeps working.** `VACUUM`, `ANALYZE`, `optimize` and the
  integrity check now dispatch by dialect and run natively on Postgres; database size
  comes from `pg_database_size`. Only **Download backup** is SQLite-only (it uses
  SQLite's online-backup API) — it returns a clear message pointing you at your
  provider's backups, which are better than anything this app could produce.

#### Moving existing data across

The schema is created by Alembic; the **rows are not copied for you**. One command:

```bash
# 1. create the schema on the new database
DATABASE_URL="postgres://…" alembic upgrade head

# 2. dry run — counts rows, writes nothing
python scripts/migrate_sqlite_to_postgres.py \
    --source sqlite:///../database/app.db \
    --target "postgres://…" --dry-run

# 3. do it
python scripts/migrate_sqlite_to_postgres.py \
    --source sqlite:///../database/app.db \
    --target "postgres://…"
```

It copies every table in **foreign-key order** (taken from SQLAlchemy's own metadata, so
it stays correct as the schema grows) inside **one transaction** — either every row
lands or none do, so a failure never leaves you with a half-migrated database.

### 6.2 Uploads → Cloudinary

Free tier, no card, CDN-backed, and it survives redeploys.

1. Sign up at [cloudinary.com](https://cloudinary.com).
2. The dashboard shows one value — copy it.

```env
STORAGE_BACKEND=cloudinary
CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>
CLOUDINARY_FOLDER=credit-system     # namespaces staging vs production
```

That is the entire change. The driver (`storage/cloudinary.py`) implements the same
Protocol as local disk, so uploads, thumbnails, the orphan sweep and the Storage
Dashboard all keep working.

Two behaviours worth knowing:

- **`url_for()` returns an absolute `https://` CDN URL**, where local storage returned a
  path relative to the API. The frontend already handles both (`lib/media.ts` passes
  absolute URLs through untouched), so nothing changes there — and images are now served
  by Cloudinary's CDN rather than by your API process.
- **Images are not re-compressed.** Our own pipeline (`storage/images.py`) already
  resizes to `IMAGE_MAX_DIMENSION` and encodes WebP at `IMAGE_QUALITY`; the driver
  uploads those exact bytes rather than letting Cloudinary re-encode them.

Existing local uploads are **not** migrated — re-upload them, or write a one-off script
that walks `uploads/` and calls `CloudinaryStorage.write(key, data, content_type)` with
each file's existing `storage_key` (that key is what `FileAsset` already points at, so
preserving it is all that is required).

### 6.3 Alternative: S3 / Cloudflare R2 / Supabase Storage

Also supported, if you would rather not use Cloudinary.

```bash
pip install boto3
```

```env
STORAGE_BACKEND=s3
S3_BUCKET=credit-system
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# Cloudflare R2 (10 GB free, no egress fees):
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto

# Real AWS S3: omit S3_ENDPOINT_URL entirely and set a real region.
# S3_REGION=eu-west-1

# Optional: your CDN origin. If you omit it, url_for() issues 1-hour PRE-SIGNED
# URLs instead, so a private bucket stays private — and you get the per-request
# revocation that local storage cannot offer.
# S3_PUBLIC_BASE_URL=https://cdn.yourdomain.com
```

`boto3` is imported **lazily**, inside `S3Storage.__init__`, so a free-tier user never
pays the install or the cold-start cost of an AWS SDK they do not call.

Migrating existing files: copy `uploads/` into the bucket preserving paths
(`aws s3 sync uploads/ s3://bucket/ --endpoint-url …`). Storage keys are
backend-agnostic, so the `FileAsset` rows already point at the right objects — nothing
in the database changes.

Side benefit: `/api/files/{key}` stops being used at all. `url_for()` points the browser
straight at the bucket or CDN, which also closes the unauthenticated-file-serving gap
([ARCHITECTURE.md §17](ARCHITECTURE.md)).

### Rung 4 — console / W3Forms → real SMTP

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com    # or smtp.resend.com, smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_USE_TLS=true
EMAIL_FROM_ADDRESS=shop@yourdomain.com
```

| Provider | Free tier | Host |
|---|---|---|
| Brevo | 300 emails/day | `smtp-relay.brevo.com:587` |
| Resend | 3,000/month, 100/day | `smtp.resend.com:587` |
| Gmail | ~500/day | `smtp.gmail.com:587` — needs 2FA + an **app password** |

**This is the rung that makes customer reminders work at all.** No code changes: same
templates, same rendering, same `EmailLog`. `can_send_to_arbitrary_recipients` flips to
`True` and `EmailService` stops refusing customer mail.

Set up SPF/DKIM on your sending domain or your reminders land in spam, which is a
different way of not reaching the customer.

---

## 7. Alembic migrations

**Honest status: Alembic is in `requirements.txt` and referenced in the code comments,
but the repository contains no `alembic/` directory and no `alembic.ini`.** Today the
schema is created by `SQLModel.metadata.create_all()` in `init_db()` on every boot.

`create_all()` **creates missing tables. It does not alter existing ones.** Add a column
to a model and deploy, and the table keeps its old shape — then every query touching the
new column fails with `no such column`. That is survivable in development (delete the
file and re-seed). **It is not survivable in production.**

So initialise Alembic **before** your first real deploy:

```bash
cd backend
./.venv/bin/alembic init alembic
```

Then in `alembic/env.py`:

```python
from app.core.config import settings
import app.models          # noqa: F401 — registers every table on the metadata
from sqlmodel import SQLModel

config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)
target_metadata = SQLModel.metadata
```

And add `import sqlmodel` to the top of `alembic/script.py.mako`, or generated
migrations will not be able to reference `sqlmodel.sql.sqltypes.AutoString`.

Baseline against the current schema, then work normally:

```bash
./.venv/bin/alembic revision --autogenerate -m "baseline"
./.venv/bin/alembic stamp head          # existing DB already matches — do not re-run it

# from then on:
./.venv/bin/alembic revision --autogenerate -m "add customer.whatsapp"
./.venv/bin/alembic upgrade head
./.venv/bin/alembic downgrade -1        # if it went wrong
```

Always **read** the autogenerated migration before applying it. Alembic does not detect
column renames (it emits a drop + an add — i.e. it silently deletes your data), and it
is unreliable about server defaults and constraint changes.

In production, run `alembic upgrade head` as a **release step** — before the new
container takes traffic, not from inside the app. On Fly:

```toml
[deploy]
  release_command = "alembic upgrade head"
```

Once Alembic owns the schema, `init_db()`'s `create_all()` becomes a no-op on an
existing database (every table already exists), so it is harmless to leave in.

---

## 8. Backup and restore

### Backing up SQLite

There is a built-in endpoint, and it is the one you should use:

```
GET /api/storage/backup
Authorization: Bearer <token>      # requires the storage:maintain permission
→ a consistent .db snapshot
```

It uses SQLite's **online backup API** (`sqlite3.Connection.backup()`), not a file copy.
That distinction is not pedantry: `cp app.db backup.db` on a **live** database gives you
a *torn* copy — another connection can commit a page mid-read, so the copy contains half
of one transaction and half of another. It will often open fine and then fail an
integrity check. That is the worst kind of backup: the one you find out is broken on the
day you need it. The online backup API copies pages under the database's own locking
rules and restarts if a writer touches a page it has already copied, so the result is
always a single consistent snapshot.

Automate it:

```bash
#!/bin/sh
# /etc/cron.daily/credit-backup
TOKEN=$(…obtain an access token for a storage:maintain user…)
curl -fsS -H "Authorization: Bearer $TOKEN" \
  https://your-backend.fly.dev/api/storage/backup \
  -o "/backups/app-$(date +%F).db"
find /backups -name 'app-*.db' -mtime +30 -delete
```

Or, with shell access to the host, skip HTTP entirely:

```bash
fly ssh console -C "sqlite3 /data/app.db '.backup /tmp/backup.db'"
fly ssh sftp get /tmp/backup.db ./app-$(date +%F).db
```

`sqlite3`'s `.backup` command uses the same online API. **`.dump` does not** — it is a
logical SQL dump, which is fine for archival but slower and larger.

**Back up `uploads/` too.** The database holds `FileAsset` rows; the bytes are on disk.
A database backup alone restores a system full of broken image links.

```bash
tar czf uploads-$(date +%F).tar.gz -C /data uploads/
```

(Once you are on R2/S3 this stops being your problem — object storage is already
replicated, and you can turn on versioning.)

### Restoring

```bash
# 1. Stop the app. A restore into a live database is a corrupt database.
fly scale count 0

# 2. Put the file back.
fly ssh console
  cp /backups/app-2026-07-14.db /data/app.db
  rm -f /data/app.db-wal /data/app.db-shm    # stale WAL from the old file
  exit

# 3. Start, and verify.
fly scale count 1
curl https://your-backend.fly.dev/health
```

Then run the integrity check — the `runMaintenance(operation: "check_integrity")`
mutation, or:

```bash
sqlite3 /data/app.db "PRAGMA integrity_check;"     # must print exactly: ok
```

Deleting the `-wal` and `-shm` sidecars matters. They belong to the *old* database
file; leaving them next to a restored one is how you get a database that opens happily
and is subtly wrong.

**Test your restore.** A backup you have never restored is a hypothesis, not a backup.

### On Postgres

Your provider handles it. Supabase and Neon both do point-in-time recovery on the free
tier. The `/api/storage/backup` endpoint returns a clear error explaining that, rather
than pretending.

---

## 9. After the first deploy

Five minutes of verification that catches almost everything:

```bash
# 1. Is it alive, and is the scheduler actually running?
curl -s https://your-backend.fly.dev/health
# {"status":"ok","database":"ok","scheduler":"running","storage":"local","email":"smtp"}
#                                  ^^^^^^^^^^^^^^^^^^^^ if this says "stopped", nothing
#                                  automatic will ever happen. Stop and fix it.

# 2. Is introspection really off? (It must be, in production.)
curl -s -X POST https://your-backend.fly.dev/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __schema { types { name } } }"}'
# → an error. If it returns the schema, DEBUG is still true.

# 3. Is GraphiQL gone?
curl -sI https://your-backend.fly.dev/graphql | head -1     # should not serve the IDE

# 4. Can you log in, and does CORS allow the real frontend?
#    Do this from the deployed frontend, in a browser, with devtools open.

# 5. Does an email actually leave?
#    Send yourself a reminder from the app, then check EmailLog for success=true.
```

Then set the business's `reminder_send_hour` to the next hour in its timezone and wait
for the sweep. If a reminder lands, the system is doing its job.

---

## Next

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Why the scheduler is in-process, and what that costs |
| [INSTALLATION.md](INSTALLATION.md) | The full environment-variable reference |
| [API.md](API.md) | The GraphQL API |
</content>
</invoke>
