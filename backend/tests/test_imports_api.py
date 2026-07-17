"""The import routes over real HTTP: auth, multipart, and the dry_run default.

test_imports.py drives the service directly. This drives the wire, because the
things that break at this layer are invisible from the service: a route that
forgets its auth dependency, a `dry_run` flag that arrives as the string "false"
and is truthy, a template served with the wrong content type.
"""

from __future__ import annotations

import io
from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.imports import router as imports_router
from app.core.security import create_access_token
from app.db.session import get_session
from app.models.customer import Customer
from app.models.user import User

CSV = b"name,phone,city\nSonam Dorji,17111111,Thimphu\nPema Lhamo,17222222,Paro\n"


@pytest.fixture
def client(session: Session) -> Iterator[TestClient]:
    """The real router, wired to the test's in-memory database.

    The session override is what makes this an integration test rather than a
    mock: the rows the requests create are the rows the assertions read back.
    """
    app = FastAPI()
    app.include_router(imports_router, prefix="/api")
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth(admin: User) -> dict[str, str]:
    token = create_access_token(admin.id, business_id=admin.business_id, role=admin.role)
    return {"Authorization": f"Bearer {token}"}


def _upload(client: TestClient, auth: dict[str, str], data: bytes, **params) -> object:
    return client.post(
        "/api/imports/customers",
        params=params,
        files={"file": ("customers.csv", io.BytesIO(data), "text/csv")},
        headers=auth,
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def test_every_import_route_requires_a_token(client: TestClient) -> None:
    """No route here may be reachable anonymously -- one of them writes data."""
    assert client.get("/api/imports/customers/template").status_code == 401
    assert client.get("/api/imports/customers/fields").status_code == 401
    assert (
        client.post(
            "/api/imports/customers",
            files={"file": ("c.csv", io.BytesIO(CSV), "text/csv")},
        ).status_code
        == 401
    )


def test_a_garbage_token_is_refused(client: TestClient) -> None:
    response = client.get(
        "/api/imports/customers/template", headers={"Authorization": "Bearer nonsense"}
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
def test_xlsx_template_downloads_as_a_workbook(client: TestClient, auth) -> None:
    response = client.get("/api/imports/customers/template", headers=auth)

    assert response.status_code == 200
    assert "spreadsheetml" in response.headers["content-type"]
    assert "customers-import-template.xlsx" in response.headers["content-disposition"]
    assert response.content[:4] == b"PK\x03\x04"  # a real zip/xlsx, not an error page


def test_csv_template_downloads_as_csv(client: TestClient, auth) -> None:
    response = client.get(
        "/api/imports/customers/template", params={"format": "csv"}, headers=auth
    )

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert response.content.decode("utf-8-sig").startswith("name,phone,email")


def test_template_format_is_an_allow_list(client: TestClient, auth) -> None:
    """?format=../../etc/passwd must not reach the service."""
    response = client.get(
        "/api/imports/customers/template", params={"format": "exe"}, headers=auth
    )
    assert response.status_code == 422


def test_unknown_dataset_404s_rather_than_500s(client: TestClient, auth) -> None:
    response = client.get("/api/imports/invoices/template", headers=auth)
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Field guide
# ---------------------------------------------------------------------------
def test_field_guide_describes_every_column(client: TestClient, auth) -> None:
    body = client.get("/api/imports/credits/fields", headers=auth).json()

    assert body["dataset"] == "credits"
    keys = [c["key"] for c in body["columns"]]
    assert "customer_code" in keys
    assert "due_date" in keys

    due = next(c for c in body["columns"] if c["key"] == "due_date")
    assert due["required"] is True
    assert due["example"]  # the UI renders this; an empty example is a bug


def test_field_guide_exposes_enum_choices(client: TestClient, auth) -> None:
    body = client.get("/api/imports/customers/fields", headers=auth).json()
    status = next(c for c in body["columns"] if c["key"] == "status")
    assert set(status["choices"]) == {"ACTIVE", "INACTIVE", "BLOCKED", "DEFAULTED"}


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
def test_upload_defaults_to_a_dry_run(client: TestClient, auth, session: Session) -> None:
    """THE important one. A client that forgets ?dry_run must not write anything."""
    response = _upload(client, auth, CSV)

    assert response.status_code == 200
    body = response.json()
    assert body["dryRun"] is True
    assert body["created"] == 0
    assert body["totalRows"] == 2
    assert session.exec(select(Customer)).first() is None


def test_upload_with_dry_run_false_imports(client: TestClient, auth, session: Session) -> None:
    body = _upload(client, auth, CSV, dry_run=False).json()

    assert body["ok"] is True
    assert body["created"] == 2
    names = {c.name for c in session.exec(select(Customer)).all()}
    assert names == {"Sonam Dorji", "Pema Lhamo"}


def test_bad_rows_come_back_200_with_a_report(client: TestClient, auth) -> None:
    """A bad ROW is an answer, not an HTTP failure -- the client renders the report."""
    response = _upload(client, auth, b"name,city\n,Thimphu\n", dry_run=False)

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["created"] == 0
    assert body["errors"][0]["row"] == 2
    assert body["errors"][0]["column"] == "name"


def test_an_unreadable_file_is_a_4xx(client: TestClient, auth) -> None:
    """A bad FILE is a failed request -- there is no report to render."""
    response = _upload(client, auth, b"nothing,useful\n1,2\n")
    assert response.status_code == 422
    assert "name" in response.json()["detail"]


def test_an_empty_file_is_rejected(client: TestClient, auth) -> None:
    assert _upload(client, auth, b"").status_code == 422
