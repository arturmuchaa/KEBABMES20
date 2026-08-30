"""Zdjęcie palety ważenia zbiorczego.

Operator na hali potrafi dotknąć „Etykieta" przy pełnym wskazaniu wagi
i zapisać paletę, której nie ma (153 kg). Biuro umiało ją POPRAWIĆ, ale nie
umiało zdjąć — zostawała zmniejszona do 0,5 kg i i tak pokazywała się
masowni jako mięso do wzięcia (biuro, 30.08.2026).
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.meat_pallets import MeatPalletCreate
from app.services.meat_pallets_service import (
    create_pallet, get_pallet, list_pallets, usun_palete,
)
from app.utils.ids import cuid, now_iso


def _partia(lot="500", kg=1000.0):
    bid = cuid()
    execute("INSERT INTO raw_batches (id, internal_batch_no, kg_received, created_at) "
            "VALUES (%s,%s,%s,%s)", (bid, lot, kg, now_iso()))
    execute("INSERT INTO meat_stock (id, raw_batch_id, lot_no, kg_initial, kg_available, "
            "created_at) VALUES (%s,%s,%s,%s,%s,%s)", (cuid(), bid, lot, kg, kg, now_iso()))
    return bid


def _paleta(kg=153.0, lot="500", dzien="2026-08-30"):
    return create_pallet(MeatPalletCreate.model_validate({
        "targetKg": 200, "kgNet": kg, "containers": 8, "operator": "Adrian",
        "productionDate": dzien, "lots": [{"lotNo": lot, "kg": kg}],
    }))


class TestZdjeciePalety:
    def test_zdjeta_paleta_znika_z_listy(self, db):
        _partia()
        p = _paleta()
        assert len(list_pallets("2026-08-30")) == 1
        usun_palete(p["pallet_no"], "operator kliknął etykietę przez pomyłkę", "biuro")
        assert list_pallets("2026-08-30") == []

    def test_zdjetej_palety_nie_da_sie_dodrukowac(self, db):
        # Dodruk wprowadziłby na masownię towar, którego nie ma.
        _partia()
        p = _paleta()
        usun_palete(p["pallet_no"], "pomyłka operatora", "biuro")
        with pytest.raises(HTTPException) as e:
            get_pallet(p["pallet_no"])
        assert e.value.status_code == 404

    def test_kilogramy_WRACAJA_do_puli_partii(self, db):
        # Sedno sprawy: pomyłkowa paleta nie może blokować mięsa, które
        # fizycznie leży w chłodni.
        _partia(kg=1000.0)
        p = _paleta(kg=153.0)
        usun_palete(p["pallet_no"], "pomyłka operatora", "biuro")
        # Po zdjęciu ta sama partia znów przyjmuje pełną paletę.
        druga = _paleta(kg=900.0)
        assert druga["kg_net"] == 900.0

    def test_wiersz_zostaje_w_bazie_ze_sladem(self, db):
        _partia()
        p = _paleta()
        usun_palete(p["pallet_no"], "operator kliknął etykietę", "anna")
        row = query_one("SELECT deleted_at, deleted_by, deleted_reason FROM meat_pallets "
                        "WHERE pallet_no=%s", (p["pallet_no"],))
        assert row["deleted_at"] is not None
        assert row["deleted_by"] == "anna"
        assert row["deleted_reason"] == "operator kliknął etykietę"

    def test_sklad_palety_ZOSTAJE_w_sladzie_korekty(self, db):
        _partia()
        p = _paleta(kg=153.0)
        usun_palete(p["pallet_no"], "pomyłka operatora", "biuro")
        kor = query_all("SELECT changes FROM meat_pallet_corrections")
        assert len(kor) == 1
        assert kor[0]["changes"]["action"] == "deleted"
        assert kor[0]["changes"]["before"]["kg_net"] == 153.0
        assert kor[0]["changes"]["before"]["lots"] == [{"lot_no": "500", "kg": 153.0}]

    def test_powod_jest_OBOWIAZKOWY(self, db):
        _partia()
        p = _paleta()
        for zly in ("", "   ", "ok"):
            with pytest.raises(HTTPException) as e:
                usun_palete(p["pallet_no"], zly, "biuro")
            assert e.value.status_code == 400

    def test_drugie_zdjecie_odrzucone(self, db):
        _partia()
        p = _paleta()
        usun_palete(p["pallet_no"], "pomyłka operatora", "biuro")
        with pytest.raises(HTTPException) as e:
            usun_palete(p["pallet_no"], "jeszcze raz", "biuro")
        assert e.value.status_code == 409

    def test_nieznana_paleta_odrzucona(self, db):
        with pytest.raises(HTTPException) as e:
            usun_palete("PAL/99/08/26/9", "pomyłka operatora", "biuro")
        assert e.value.status_code == 404
