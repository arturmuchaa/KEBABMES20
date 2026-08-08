"""Kontrakt tras płacowych — sam styk z frontem, bez DB.

Powód: `payrollApi` przepuszcza DTO przez `toSnake()`, więc na drut idzie
`date_from`/`dry_run`. Trasa czytająca `dateFrom`/`dryRun` przyjmowała żądanie
BEZ BŁĘDU, ale z pustymi datami (plan wychodził pusty: „nikt nie ma nic do
rozliczenia") i z `dry_run=True`, więc zatwierdzenie nie zapisywało niczego.
Cichy rozjazd — dlatego pilnuje go test kontraktowy.
"""
from app.models.workers import BulkSettleDto
from app.routes import workers as route


def test_bulk_settle_przekazuje_payload_z_toSnake(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.svc, "bulk_settle", lambda **kw: seen.update(kw) or {})

    # dokładnie to, co wysyła front po toSnake()
    dto = BulkSettleDto.model_validate({
        "role": "WORKER_DEBONING",
        "date_from": "2026-08-03",
        "date_to": "2026-08-09",
        "dry_run": False,
    })
    route.bulk_settle(dto)

    assert seen == {
        "role": "WORKER_DEBONING",
        "date_from": "2026-08-03",
        "date_to": "2026-08-09",
        "dry_run": False,
    }


def test_bulk_settle_domyslnie_jest_podgladem():
    """Brak `dry_run` musi znaczyć PODGLĄD — nigdy zapis."""
    dto = BulkSettleDto.model_validate({
        "role": "WORKER_GENERAL", "date_from": "2026-08-03", "date_to": "2026-08-09",
    })
    assert dto.dry_run is True


def test_bulk_settle_wymaga_dat():
    """Puste daty dawały pusty plan i mylący komunikat — teraz to błąd 422."""
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        BulkSettleDto.model_validate({"role": "WORKER_DEBONING"})
