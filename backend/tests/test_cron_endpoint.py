"""The cron endpoint is an authenticated remote trigger for email sends and VACUUM.

Its access control is therefore the whole test surface that matters: a regression
that opens it up hands an anonymous caller the ability to spam a business's
customers. These tests pin the fail-closed default and both accepted credential
forms.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.cron import router as cron_router
from app.core.config import settings

SECRET = "test-cron-secret"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A bare app with only the cron router: this is a routing/auth test, not a
    scheduler test. The job itself is stubbed -- ``reminder_sweep`` is covered in
    test_reminders_and_retention.py, and running it here would need a real DB."""

    async def fake_run_job_now(name: str) -> str:
        return f"Job '{name}' completed"

    monkeypatch.setattr("app.api.cron.run_job_now", fake_run_job_now)

    app = FastAPI()
    app.include_router(cron_router, prefix="/api")
    with TestClient(app) as c:
        yield c


@pytest.fixture
def with_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", SECRET)


@pytest.fixture
def without_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "CRON_SECRET", None)


def test_disabled_when_no_secret_configured(
    client: TestClient, without_secret: None
) -> None:
    """Fails CLOSED. An unset secret must not mean 'no auth required'."""
    response = client.post("/api/cron/reminders")
    assert response.status_code == 503
    assert "CRON_SECRET" in response.json()["detail"]


def test_rejects_missing_credential(client: TestClient, with_secret: None) -> None:
    assert client.post("/api/cron/reminders").status_code == 401


def test_rejects_wrong_secret(client: TestClient, with_secret: None) -> None:
    response = client.post(
        "/api/cron/reminders", headers={"Authorization": "Bearer wrong-secret"}
    )
    assert response.status_code == 401


def test_runs_with_bearer_header(client: TestClient, with_secret: None) -> None:
    response = client.post(
        "/api/cron/reminders", headers={"Authorization": f"Bearer {SECRET}"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "job": "reminders",
        "status": "completed",
        "detail": "Job 'reminders' completed",
    }


def test_runs_with_query_token_over_get(client: TestClient, with_secret: None) -> None:
    """The concession to free cron services that can only fetch a bare URL."""
    response = client.get(f"/api/cron/reminders?token={SECRET}")
    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_unknown_job_is_not_reachable(client: TestClient, with_secret: None) -> None:
    """The Literal type is what keeps a new scheduler job from becoming remotely
    triggerable the moment someone adds it."""
    response = client.post(
        "/api/cron/drop-everything", headers={"Authorization": f"Bearer {SECRET}"}
    )
    assert response.status_code == 422


def test_job_failure_surfaces_as_500(
    client: TestClient, with_secret: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A broken sweep must turn the cron service's dashboard red, not return 200."""

    async def boom(name: str) -> str:
        raise RuntimeError("smtp exploded")

    monkeypatch.setattr("app.api.cron.run_job_now", boom)

    response = client.post(
        "/api/cron/reminders", headers={"Authorization": f"Bearer {SECRET}"}
    )
    assert response.status_code == 500
    assert "smtp exploded" in response.json()["detail"]
