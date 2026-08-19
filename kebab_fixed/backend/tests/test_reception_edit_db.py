"""Edycja przyjęcia: PUT na CAŁY dokument dostawy.

Modal na osiem pól zastąpił pełny formularz — zapis idzie jednym żądaniem,
a backend sam wylicza, co zmienić, dołożyć i anulować.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.receptions import ReceptionCreate, ReceptionUpdate
from app.services.receptions_service import create_reception, update_reception
from app.utils.ids import now_iso


def _seed_dostawca(sid="sup-edit", nazwa="KOKO"):
    execute(
        "INSERT INTO suppliers (id, code, name, display_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
        (sid, nazwa, nazwa, nazwa, now_iso()),
    )
    for mid, nazwa_mat, rozbior in (
        ("mat-cwiartka", "Ćwiartka z kurczaka", True),
        ("mat-filet-kurczak", "Filet z kurczaka", False),
        ("mat-mieso-zs", "Mięso z/s", False),
    ):
        execute(
            "INSERT INTO raw_material_types (id, name, requires_deboning) "
            "VALUES (%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (mid, nazwa_mat, rozbior),
        )
    return sid


def _przyjmij(sid, material="mat-cwiartka", grupy=(("500", 1000.0),)):
    """Dostawa z listy (numer porządkowy, kg)."""
    return create_reception(ReceptionCreate.model_validate({
        "supplierId": sid,
        "materialTypeId": material,
        "receivedDate": "2026-08-14",
        "documentNo": "FA/1/08/2026",
        "pricePerKg": 5.0,
        "groups": [
            {"internalBatchNo": nr, "kgReceived": kg,
             "supplierBatches": [{"supplierBatchNo": f"HDI-{nr}", "kgReceived": kg}]}
            for nr, kg in grupy
        ],
    }))


def _grupa(batch, kg=None):
    """Grupa do PUT-a odwzorowująca istniejącą partię (domyślnie bez zmian)."""
    return {
        "batchId": batch["id"],
        "internalBatchNo": batch["internal_batch_no"],
        "kgReceived": float(kg if kg is not None else batch["kg_received"]),
        "supplierBatches": [],
    }


def test_edycja_zapisuje_naglowek_dokumentu(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid)
    rec_id = out["reception"]["id"]
    partia = out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14",
        "documentNo": "FA/999/08/2026",
        "notes": "poprawiony numer faktury",
        "pricePerKg": 5.0,
        "materialTypeId": "mat-cwiartka",
        "groups": [_grupa(partia)],
    }))

    rec = query_one("SELECT document_no, notes FROM receptions WHERE id=%s", (rec_id,))
    assert rec["document_no"] == "FA/999/08/2026"
    assert rec["notes"] == "poprawiony numer faktury"


def test_edycja_poprawia_kilogramy_i_cene_nietknietej_cwiartki(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("501", 1000.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14",
        "materialTypeId": "mat-cwiartka",
        "pricePerKg": 6.5,
        "groups": [dict(_grupa(partia, kg=1200.0), slaughterDate="2026-08-10")],
    }))

    row = query_one(
        "SELECT kg_received, kg_available, price_per_kg, slaughter_date "
        "FROM raw_batches WHERE id=%s", (partia["id"],))
    assert float(row["kg_received"]) == 1200.0
    # Ćwiartka trzyma stan na dostawie — po korekcie idzie razem z wagą.
    assert float(row["kg_available"]) == 1200.0
    assert float(row["price_per_kg"]) == 6.5
    assert str(row["slaughter_date"]) == "2026-08-10"


def _zamroz(batch_id, kg=500.0):
    """Symuluje pobranie do rozbioru — partia staje się „ruszona"."""
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, kg_quarter, "
        " kg_meat, status, created_at) VALUES (%s,%s,'x',%s,0,'complete',%s)",
        (f"de-{batch_id[:8]}", batch_id, kg, now_iso()),
    )


def test_zmiana_zamrozonej_pozycji_daje_409(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("502", 1000.0),))
    rec_id, partia = out["reception"]["id"], out["batches"][0]
    _zamroz(partia["id"])

    with pytest.raises(HTTPException) as err:
        update_reception(rec_id, ReceptionUpdate.model_validate({
            "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
            "pricePerKg": 5.0, "groups": [_grupa(partia, kg=900.0)],
        }))
    assert err.value.status_code == 409
    assert "502" in str(err.value.detail)   # numer porządkowy w komunikacie


def test_blokada_jednej_pozycji_nie_zapisuje_pozostalych(db):
    """Atomowość: dokument zapisany w połowie rozjeżdża księgę."""
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("503", 600.0), ("504", 400.0)))
    rec_id, wolna, ruszona = out["reception"]["id"], out["batches"][0], out["batches"][1]
    _zamroz(ruszona["id"])

    with pytest.raises(HTTPException):
        update_reception(rec_id, ReceptionUpdate.model_validate({
            "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
            "pricePerKg": 5.0,
            "groups": [_grupa(wolna, kg=700.0), _grupa(ruszona, kg=300.0)],
        }))

    row = query_one("SELECT kg_received FROM raw_batches WHERE id=%s", (wolna["id"],))
    assert float(row["kg_received"]) == 600.0   # nietknięta pozycja BEZ zmian


def test_zamrozona_pozycja_bez_zmian_przechodzi(db):
    sid = _seed_dostawca()
    out = _przyjmij(sid, grupy=(("505", 600.0), ("506", 400.0)))
    rec_id, wolna, ruszona = out["reception"]["id"], out["batches"][0], out["batches"][1]
    _zamroz(ruszona["id"])

    update_reception(rec_id, ReceptionUpdate.model_validate({
        "receivedDate": "2026-08-14", "materialTypeId": "mat-cwiartka",
        "pricePerKg": 5.0,
        "groups": [_grupa(wolna, kg=650.0), _grupa(ruszona)],
    }))

    assert float(query_one(
        "SELECT kg_received FROM raw_batches WHERE id=%s", (wolna["id"],))["kg_received"]) == 650.0
