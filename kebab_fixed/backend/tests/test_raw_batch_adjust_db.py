"""Korekta stanu partii surowca (inwentaryzacja).

Powód istnienia: liczba pojemników ćwiartki NIGDZIE nie jest liczona — wszędzie
wychodzi z `kg / container_kg`. Gdy hala przeliczy fizycznie i wyjdzie inaczej
(4-5.08.2026: partia 459, 199 pojemników na hali vs 193 w systemie), do 2026-08-05
nie było na to żadnej ścieżki w aplikacji: PUT na partii używanej w rozbiorze
zwraca 409, więc jedynym wyjściem był ręczny SQL na produkcji.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.raw_batches import RawBatchAdjust, RawBatchCreate
from app.services.raw_batches_service import adjust_batch_stock, create_batch
from app.utils.ids import now_iso


def _seed_supplier():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))


def _batch(**kw):
    base = dict(supplierId="sup1", kgReceived=6420.0, receivedDate="2026-08-04",
                slaughterDate="2026-08-03", pricePerKg=5.0, containerKg=15)
    base.update(kw)
    return create_batch(RawBatchCreate.model_validate(base))


def _adjust(**kw):
    base = dict(reason="Przeliczenie fizyczne")
    base.update(kw)
    return RawBatchAdjust.model_validate(base)


def test_korekta_w_pojemnikach_podnosi_stan_i_zapisuje_ruch(db):
    _seed_supplier()
    b = _batch()
    adjust_batch_stock(b["id"], _adjust(containers=6))

    row = query_one("SELECT kg_available, kg_received FROM raw_batches WHERE id=%s", (b["id"],))
    assert float(row["kg_available"]) == 6510.0      # 6420 + 6 × 15
    # kg_received NIE rusza się: dostawa i faktura zostają, nadwyżka to korekta stanu.
    assert float(row["kg_received"]) == 6420.0

    mv = query_all("SELECT qty, movement_type, source_type FROM stock_movements "
                   "WHERE batch_id=%s AND movement_type='ADJUST'", (b["id"],))
    assert len(mv) == 1
    assert float(mv[0]["qty"]) == 90.0
    assert mv[0]["source_type"] == "inventory"


def test_korekta_ujemna_zdejmuje_stan(db):
    _seed_supplier()
    b = _batch()
    adjust_batch_stock(b["id"], _adjust(containers=-2))
    row = query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (b["id"],))
    assert float(row["kg_available"]) == 6390.0      # 6420 − 2 × 15


def test_korekta_nie_moze_zejsc_ponizej_zera(db):
    _seed_supplier()
    b = _batch(kgReceived=30.0)
    with pytest.raises(HTTPException) as e:
        adjust_batch_stock(b["id"], _adjust(kg=-45))
    assert e.value.status_code == 400
    row = query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (b["id"],))
    assert float(row["kg_available"]) == 30.0        # bez zmian
    assert query_all("SELECT id FROM stock_movements WHERE movement_type='ADJUST'") == []


def test_korekta_dziala_na_partii_juz_rozbieranej(db):
    """Sedno funkcji: PUT jest wtedy zablokowany (409), korekta stanu musi przejść."""
    _seed_supplier()
    b = _batch()
    execute("UPDATE raw_batches SET kg_available=105 WHERE id=%s", (b["id"],))
    adjust_batch_stock(b["id"], _adjust(containers=6, reason="Przeliczenie 5.08: 13 poj. zamiast 7"))
    row = query_one("SELECT kg_available FROM raw_batches WHERE id=%s", (b["id"],))
    assert float(row["kg_available"]) == 195.0


def test_powod_jest_wymagany(db):
    with pytest.raises(ValueError):
        RawBatchAdjust.model_validate({"containers": 6, "reason": "  "})


def test_zero_jest_odrzucane(db):
    _seed_supplier()
    b = _batch()
    with pytest.raises(HTTPException) as e:
        adjust_batch_stock(b["id"], _adjust(kg=0))
    assert e.value.status_code == 400


def test_pojemniki_wymagaja_kalibru(db):
    """Partia niekalibrowana (container_kg NULL) nie umie przeliczyć pojemników."""
    _seed_supplier()
    b = _batch(containerKg=None, containersCount=100)
    with pytest.raises(HTTPException) as e:
        adjust_batch_stock(b["id"], _adjust(containers=6))
    assert e.value.status_code == 400
