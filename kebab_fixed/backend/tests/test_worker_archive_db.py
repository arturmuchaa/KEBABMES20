"""Archiwizacja pracownika = workers.active=false.

Domyślna lista MUSI zostać przy aktywnych — żywią się nią panele hali
i kioski rozbioru (usersApi.list w DeboningHmiV3..V10Page). Zarchiwizowany
ma z hali zniknąć; biuro widzi go po jawnym includeInactive.

Powód: ADRIAN zwolnił się z rozbioru, a bez archiwizacji jedynym sposobem
na usunięcie go z HMI operatora było przestawienie roli na „ogólny" —
obejście, które fałszowało podstawę jego rozliczenia.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.workers_service import list_workers


def _worker(wid, name, active=True):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,'WORKER_DEBONING',0.55,%s) "
        "ON CONFLICT (id) DO UPDATE SET active=EXCLUDED.active",
        (wid, name, active),
    )


def test_domyslna_lista_pomija_zarchiwizowanego(db):
    _worker("w-akt", "AKTYWNY", active=True)
    _worker("w-arch", "ZWOLNIONY", active=False)
    names = {w["name"] for w in list_workers()}
    assert "AKTYWNY" in names
    assert "ZWOLNIONY" not in names


def test_include_inactive_zwraca_obu(db):
    _worker("w-akt", "AKTYWNY", active=True)
    _worker("w-arch", "ZWOLNIONY", active=False)
    names = {w["name"] for w in list_workers(include_inactive=True)}
    assert {"AKTYWNY", "ZWOLNIONY"} <= names
