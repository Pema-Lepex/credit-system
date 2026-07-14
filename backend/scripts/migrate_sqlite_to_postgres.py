"""Copy an existing SQLite database into Postgres, once.

    cd backend
    .venv/bin/python scripts/migrate_sqlite_to_postgres.py \
        --source sqlite:///../database/app.db \
        --target "postgresql://user:pass@host:5432/dbname"

    # see what would happen, touch nothing:
    .venv/bin/python scripts/migrate_sqlite_to_postgres.py --source ... --target ... --dry-run

WHY A SCRIPT AND NOT AN ALEMBIC MIGRATION
-----------------------------------------
Alembic migrates a SCHEMA within one database. This moves DATA between two different
engines, which is a one-time operation, not part of the version history. Baking it
into a migration would re-run it on every fresh deploy.

ORDER IS THE WHOLE PROBLEM
--------------------------
Rows must be inserted parent-before-child or a foreign key rejects them --
`business` before `customer` before `credit` before `payment`. We do not hand-maintain
that order: SQLAlchemy already knows it, because it knows the FKs.
`metadata.sorted_tables` returns them topologically sorted, so the order stays correct
as the schema grows.

SEQUENCES ARE NOT AN ISSUE HERE
-------------------------------
Every primary key in this schema is an application-generated string (a uuid4 hex --
see models/base.py), not a database sequence. So there are no sequences to re-seed
after the copy, which is the usual way a SQLite->Postgres move goes wrong: rows land
fine, then the first INSERT collides on an id because the sequence still says 1.

The target schema must already exist: run `alembic upgrade head` against Postgres
first. This script only moves rows.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, delete, insert, select  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

import app.models  # noqa: F401,E402  (importing registers every table on the metadata)
from app.core.config import Settings  # noqa: E402

BATCH = 500


def _engine(url: str) -> Engine:
    # Route the target URL through the same normaliser the app uses, so a connection
    # string pasted straight from Supabase/Render works here exactly as it does there.
    normalised = Settings(DATABASE_URL=url).DATABASE_URL
    connect_args = {"check_same_thread": False} if normalised.startswith("sqlite") else {}
    return create_engine(normalised, connect_args=connect_args)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="SQLite URL to read from")
    parser.add_argument("--target", required=True, help="Postgres URL to write to")
    parser.add_argument(
        "--dry-run", action="store_true", help="Count rows and exit without writing"
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Delete existing rows in the target first. Destructive; asks for confirmation.",
    )
    args = parser.parse_args()

    source = _engine(args.source)
    target = _engine(args.target)

    if source.dialect.name != "sqlite":
        return _fail(f"--source must be SQLite, got {source.dialect.name}")
    if target.dialect.name == "sqlite":
        return _fail("--target is SQLite. This script exists to move you OFF SQLite.")

    # Topologically sorted: parents first, so foreign keys are always satisfiable.
    tables = list(SQLModel.metadata.sorted_tables)

    print(f"source : {source.url.render_as_string(hide_password=True)}")
    print(f"target : {target.url.render_as_string(hide_password=True)}")
    print(f"tables : {len(tables)} (in dependency order)\n")

    with source.connect() as src, target.connect() as dst:
        # The target schema must exist. Checking one table beats a confusing
        # "relation does not exist" fifty rows into the copy.
        missing = [t.name for t in tables if not target.dialect.has_table(dst, t.name)]
        if missing:
            return _fail(
                f"target is missing {len(missing)} table(s), e.g. {missing[:3]}. "
                f"Run `alembic upgrade head` against the target first."
            )

        if args.truncate and not args.dry_run:
            confirm = input("DELETE all existing rows in the target? [type 'yes'] ")
            if confirm.strip().lower() != "yes":
                return _fail("aborted")
            # Children first -- the reverse of insert order.
            for table in reversed(tables):
                dst.execute(delete(table))
            print("target cleared\n")

        # ONE transaction for the whole copy, committed at the end.
        #
        # Committing per table looks tidier in the log and is wrong: a failure partway
        # through (a FK violation, an enum label the target does not know) leaves the
        # target holding some tables and not others. Re-running then trips a duplicate
        # -key error on the tables that DID land, and the operator is left hand-deleting
        # rows from a half-migrated production database. Either every row arrives or
        # none do.
        total = 0
        for table in tables:
            rows = [dict(r) for r in src.execute(select(table)).mappings()]
            if not rows:
                print(f"  {table.name:<24} 0")
                continue

            if not args.dry_run:
                # Batched inserts, single transaction: one 20k-row statement is a memory
                # spike, but each batch still joins the same transaction.
                for start in range(0, len(rows), BATCH):
                    dst.execute(insert(table), rows[start : start + BATCH])

            total += len(rows)
            print(f"  {table.name:<24} {len(rows)}")

        if not args.dry_run:
            dst.commit()

    verb = "would copy" if args.dry_run else "copied"
    print(f"\n{verb} {total} rows.")
    if args.dry_run:
        print("Dry run — nothing was written.")
    else:
        print("Now point DATABASE_URL at the target and restart the backend.")
    return 0


def _fail(message: str) -> int:
    print(f"ERROR: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
