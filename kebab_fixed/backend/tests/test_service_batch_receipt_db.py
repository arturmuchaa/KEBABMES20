"""Przyjęcie mięsa z/s NA USŁUGĘ — osobna seria numerów 48U, 49U…"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.raw_batches import RawBatchCreate
from app.services.raw_batches_service import create_batch, next_batch_number
from app.utils.ids import now_iso


def _seed():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KLIENT USŁUGOWY','5130064478',true,%s)", (now_iso(),))


def _dto(**kw):
    base = dict(supplierId="sup1", materialTypeId="mat-mieso-zs", kgReceived=1000.0,
                receivedDate="2026-07-30", expiryDate="2026-08-06", pricePerKg=0.0)
    base.update(kw)
    return RawBatchCreate.model_validate(base)


def test_pierwsza_partia_uslugowa_dostaje_numer_48U(db):
    _seed()
    b = create_batch(_dto(isService=True))
    assert b["internal_batch_no"] == "48U"
    assert b["is_service"] is True


def test_kolejne_partie_uslugowe_ida_49U_50U(db):
    _seed()
    assert create_batch(_dto(isService=True))["internal_batch_no"] == "48U"
    assert create_batch(_dto(isService=True))["internal_batch_no"] == "49U"
    assert create_batch(_dto(isService=True))["internal_batch_no"] == "50U"


def test_seria_uslugowa_nie_rusza_serii_podstawowej(db):
    _seed()
    create_batch(_dto(isService=True))          # 48U
    zwykla = create_batch(_dto(materialTypeId="mat-cwiartka"))
    assert not zwykla["internal_batch_no"].endswith("U")
    assert create_batch(_dto(isService=True))["internal_batch_no"] == "49U"


def test_usluga_trafia_na_ogolny_magazyn_miesa_pod_swoim_numerem(db):
    """Mięso z/s nie wymaga rozbioru — leci wprost do meat_stock i tam ma
    być widoczne pod numerem usługowym, gotowe do masowania."""
    _seed()
    create_batch(_dto(isService=True, kgReceived=1000.0))
    lot = query_one("SELECT lot_no, kg_available, status, material_type_id "
                    "FROM meat_stock WHERE lot_no='48U'")
    assert lot is not None, "partia usługowa musi wejść na magazyn mięsa"
    assert float(lot["kg_available"]) == 1000.0
    assert lot["status"] == "AVAILABLE"
    assert lot["material_type_id"] == "mat-mieso-zs"


def test_reczny_numer_uslugowy_synchronizuje_sekwencje(db):
    _seed()
    create_batch(_dto(isService=True, internalBatchNo="60U"))
    assert create_batch(_dto(isService=True))["internal_batch_no"] == "61U"


def test_podpowiedz_numeru_dla_uslugi(db):
    _seed()
    assert next_batch_number(is_service=True)["suggestedBatchNo"] == "48U"
    create_batch(_dto(isService=True))
    assert next_batch_number(is_service=True)["suggestedBatchNo"] == "49U"
    assert not next_batch_number()["suggestedBatchNo"].endswith("U")


def test_usluga_dozwolona_tylko_na_miesie_zs(db):
    """Usługa dotyczy wyłącznie mięsa z/s — na ćwiartce to pomyłka operatora."""
    _seed()
    with pytest.raises(HTTPException) as e:
        create_batch(_dto(materialTypeId="mat-cwiartka", isService=True))
    assert e.value.status_code == 400
