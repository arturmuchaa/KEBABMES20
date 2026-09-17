"""Inwentaryzacja partii mięsa — korekta stanu po przeliczeniu w chłodni.

POWÓD ISTNIENIA: 17.09.2026 na produkcji wisiało 22 884 kg mięsa po terminie
(do 22 dni po dacie) — pozostałość po tygodniu, w którym masowano ręcznie, bo
panel jeszcze nie działał. Ćwiartka miała ścieżkę korekty od dawna
(`/raw-batches/{id}/adjust`), partia mięsa NIE — zostawał goły SQL, który
zdejmuje kilogramy i zostawia rozjazd między stanem a księgą ruchów. Dokładnie
tego szuka `deploy/proba_generalna.py`.

Zasada jak w całym module: RUCH PRZED zmianą stanu.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.raw_batches import MeatLotAdjust
from app.services import raw_batches_service as svc
from app.utils.ids import cuid

pytestmark = pytest.mark.usefixtures("db")


def _lot(kg=1000.0, lot_no="511"):
    ms_id = cuid()
    execute(
        "INSERT INTO meat_stock (id, lot_no, material_name, kg_initial, kg_available, "
        "kg_reserved, production_date, expiry_date) VALUES (%s,%s,'Mięso z/s',%s,%s,0,%s,%s)",
        (ms_id, lot_no, kg, kg, "2026-09-01", "2026-09-08"),
    )
    return ms_id


def _ruchy(lot_id):
    return query_all(
        "SELECT movement_type, qty, source_type FROM stock_movements "
        "WHERE batch_id=%s AND product_type='meat' ORDER BY created_at",
        (lot_id,),
    )


def test_korekta_w_dol_zdejmuje_kilogramy():
    lot = _lot(kg=1000)
    out = svc.adjust_meat_lot(lot, MeatLotAdjust(kg=-250, reason="inwentaryzacja chłodni"))
    assert float(out["kg_available"]) == 750.0


def test_korekta_zostawia_slad_w_ksiedze_ruchow():
    # Bez ruchu stan rozjeżdża się z księgą — to sygnatura „ducha 415".
    lot = _lot(kg=1000)
    svc.adjust_meat_lot(lot, MeatLotAdjust(kg=-250, reason="inwentaryzacja"))
    ruchy = _ruchy(lot)
    assert len(ruchy) == 1
    assert ruchy[0]["movement_type"] == "ADJUST"
    assert float(ruchy[0]["qty"]) == 250.0
    assert ruchy[0]["source_type"] == "inventory"


def test_zerowanie_partii_po_terminie():
    lot = _lot(kg=2798)
    out = svc.adjust_meat_lot(lot, MeatLotAdjust(kg=-2798, reason="po terminie — nie ma w chłodni"))
    assert float(out["kg_available"]) == 0.0


def test_korekta_w_gore_dokłada():
    lot = _lot(kg=100)
    out = svc.adjust_meat_lot(lot, MeatLotAdjust(kg=40, reason="przeliczenie"))
    assert float(out["kg_available"]) == 140.0


def test_nie_zejdzie_ponizej_zera():
    lot = _lot(kg=100)
    with pytest.raises(HTTPException) as e:
        svc.adjust_meat_lot(lot, MeatLotAdjust(kg=-150, reason="za duzo"))
    assert "zera" in str(e.value.detail).lower()
    assert float(query_one("SELECT kg_available FROM meat_stock WHERE id=%s", (lot,))["kg_available"]) == 100.0


def test_powod_jest_obowiazkowy():
    # Korekta bez powodu jest w kartotece nieodróżnialna od zmyślenia.
    lot = _lot()
    with pytest.raises(HTTPException) as e:
        svc.adjust_meat_lot(lot, MeatLotAdjust(kg=-10, reason="   "))
    assert "powód" in str(e.value.detail).lower()


def test_korekta_zerowa_jest_odrzucana():
    lot = _lot()
    with pytest.raises(HTTPException):
        svc.adjust_meat_lot(lot, MeatLotAdjust(kg=0, reason="nic"))


def test_nie_rusza_kg_initial():
    # `kg_initial` mówi, ile partia DAŁA na rozbiorze — korekta stanu w chłodni
    # tego nie zmienia, inaczej rozjechałaby się wydajność rozbioru.
    lot = _lot(kg=1000)
    svc.adjust_meat_lot(lot, MeatLotAdjust(kg=-250, reason="inwentaryzacja"))
    assert float(query_one("SELECT kg_initial FROM meat_stock WHERE id=%s", (lot,))["kg_initial"]) == 1000.0


def test_nieznana_partia_to_404():
    with pytest.raises(HTTPException) as e:
        svc.adjust_meat_lot("nie-ma-takiej", MeatLotAdjust(kg=-1, reason="x"))
    assert e.value.status_code == 404
