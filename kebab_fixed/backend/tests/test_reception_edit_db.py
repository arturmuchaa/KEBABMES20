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
