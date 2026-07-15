"""Reconcile the single platform super-admin from the environment.

Runs on every boot (see app.main lifespan). The super-admin's credentials live in
the environment -- never in code, never in the frontend -- so SUPER_ADMIN_EMAIL /
SUPER_ADMIN_PASSWORD are the source of truth and this function makes the database
match them:

  * no such user            -> create one (role=SUPER_ADMIN, business_id=NULL).
  * password no longer matches the env value -> update the hash, so rotating the
    env password takes effect on the next deploy.
  * user exists but is not an active SUPER_ADMIN -> repair role / active / deleted.

WHY A REAL DB ROW rather than a hardcoded credential check at the login door: it
means the super-admin signs in through the exact same AuthService.login path as
everyone else -- same JWT issuing, same refresh-token rotation, same lockout, same
audit trail. There is no second, weaker authentication path to get wrong.

Idempotent and safe to run on every boot. A no-op when the two env vars are unset.
"""

from __future__ import annotations

import logging

from sqlmodel import Session, select

from app.core.config import settings
from app.core.security import Role, hash_password, verify_password
from app.db.session import engine
from app.models.user import User
from app.services.auth import normalise_email

log = logging.getLogger("app.bootstrap")


def ensure_super_admin() -> None:
    email = (settings.SUPER_ADMIN_EMAIL or "").strip()
    password = settings.SUPER_ADMIN_PASSWORD or ""
    if not email or not password:
        log.info("SUPER_ADMIN_EMAIL/PASSWORD not set; skipping super-admin bootstrap.")
        return

    addr = normalise_email(email)
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == addr)).first()

        if user is None:
            session.add(
                User(
                    email=addr,
                    hashed_password=hash_password(password),
                    full_name="Super Administrator",
                    role=Role.SUPER_ADMIN,
                    business_id=None,  # the operator belongs to no single tenant
                    is_active=True,
                )
            )
            session.commit()
            log.info("Bootstrapped super-admin %s", addr)
            return

        # The user already exists. Reconcile it toward the env-defined operator.
        changed = False
        if Role(user.role) is not Role.SUPER_ADMIN:
            user.role = Role.SUPER_ADMIN
            user.business_id = None
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if user.deleted_at is not None:
            user.deleted_at = None
            changed = True
        # Keep the environment authoritative: a rotated env password is applied here.
        # verify_password is a no-op-cost check when it already matches.
        if not verify_password(password, user.hashed_password):
            user.hashed_password = hash_password(password)
            user.failed_login_attempts = 0
            user.locked_until = None
            changed = True

        if changed:
            session.add(user)
            session.commit()
            log.info("Reconciled super-admin %s", addr)


if __name__ == "__main__":
    # Run directly to create/repair the super-admin without starting the whole app:
    #   python -m app.db.bootstrap
    # Prints exactly what it did against the database your .env points at.
    from sqlmodel import Session, select

    from app.db.session import engine, init_db
    from app.models.user import User

    print(f"Database   : {settings.DATABASE_URL}")
    print(f"Super email: {settings.SUPER_ADMIN_EMAIL or '(unset)'}")
    if not (settings.SUPER_ADMIN_EMAIL and settings.SUPER_ADMIN_PASSWORD):
        print(
            "\nSUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD are not set in backend/.env.\n"
            "Add them and run this again."
        )
        raise SystemExit(1)

    init_db()  # make sure the tables (and the approval columns) exist
    ensure_super_admin()

    with Session(engine) as s:
        rows = s.exec(select(User).where(User.role == "SUPER_ADMIN")).all()
        if rows:
            print("\nSUPER_ADMIN accounts now in the database:")
            for u in rows:
                print(f"  - {u.email}  (active={u.is_active})")
            print("\nSign in at /login with these credentials; you land on /admin.")
        else:
            print("\nNo super-admin was created — check the logs above.")
