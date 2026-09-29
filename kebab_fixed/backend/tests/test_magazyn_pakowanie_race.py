"""Routing skanu kiosku przy wyścigu dwóch stanowisk — bez bazy.

Serwisy zapisu (`pack_unit_into_pallet`, `scan_unit_into_carton`) i odczyty
SQL są podmienione na atrapy nad słownikiem w pamięci; pula połączeń jest
zablokowana, więc przypadkowy dostęp do bazy wywraca test zamiast łączyć się.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import db as app_db
from app.services import magazyn_pakowanie_service as svc
from app.services import pallets_service, stock_cartons_service
from app.utils.unit_codes import unit_qr


@pytest.fixture(autouse=True)
def _bez_bazy(monkeypatch):
    def _zakaz():
        raise AssertionError("test jednostkowy nie może łączyć się z bazą")
    monkeypatch.setattr(app_db, "_get_pool", _zakaz)
    monkeypatch.setattr(app_db, "init_pool", _zakaz)


def _unit(uid="u1", **kw):
    return {"id": uid, "status": "produced", "client_name": "YALCIN", "recipe_id": "r1",
            "recipe_name": "KIRMIZI", "product_type_id": "p1", "tuleja": "", "weight_kg": 15,
            "carton_id": None, "pallet_id": None, "dispatch_id": None, **kw}


def _stock(cid, packed=0, target=2, carton_no=1):
    ln = {"id": f"{cid}-l1", "carton_id": cid, "recipe_id": "r1", "product_type_id": "p1",
          "packaging_name": "", "kg_per_unit": 15, "product_type_name": "UDO",
          "recipe_name": "KIRMIZI", "target_qty": target, "packed_qty": packed}
    return {"kind": "stock", "id": cid, "cartonNoInt": carton_no, "cartonNo": f"K{carton_no}",
            "clientName": "YALCIN", "_nazwy": ["YALCIN"], "orderNo": "", "palletNo": 0,
            "deliveryDate": "", "openedAt": "", "lines": [ln],
            "targetQty": target, "packedQty": packed}


def _order(pid, packed=0, target=2, carton_no=1):
    k = _stock(pid, packed, target, carton_no)
    return {**k, "kind": "order", "orderNo": "Z/1", "palletNo": 1}


class _Hala:
    """Stan „bazy" widziany przez routing: sztuki i kartony po zapisie."""

    def __init__(self, monkeypatch, unit, kontenery):
        self.units = {unit["id"]: dict(unit)}
        self.kontenery = kontenery
        self.po = {k["id"]: dict(k, lines=[dict(x) for x in k["lines"]]) for k in kontenery}
        self.numery = {k["id"]: k["cartonNoInt"] for k in kontenery}
        self.proby = []
        monkeypatch.setattr(svc, "_sztuka", lambda uid: dict(self.units[uid]) if uid in self.units else None)
        monkeypatch.setattr(svc, "otwarte_kontenery", lambda: [dict(k) for k in self.kontenery])
        monkeypatch.setattr(svc, "query_one", self._query_one)
        monkeypatch.setattr(svc, "query_all", self._query_all)
        monkeypatch.setattr(svc, "_linie_palet",
                            lambda ids: {i: self.po[i]["lines"] for i in ids if i in self.po})

    def _query_one(self, sql, params=()):
        cid = params[0]
        if "SELECT carton_no FROM" in sql:
            return {"carton_no": self.numery[cid]} if cid in self.numery else None
        if "FROM order_pallets p" in sql:
            k = self.po.get(cid)
            return {"id": cid, "pallet_no": 1, "carton_no": k["cartonNoInt"], "created_at": "",
                    "order_no": "Z/1", "client_name": "YALCIN", "delivery_date": ""} if k else None
        if "FROM stock_cartons" in sql:
            k = self.po.get(cid)
            return {"id": cid, "carton_no": k["cartonNoInt"], "client_name": "YALCIN",
                    "status": "packed", "created_at": ""} if k else None
        raise AssertionError(f"nieoczekiwany SQL: {sql}")

    def _query_all(self, sql, params=()):
        assert "stock_carton_lines" in sql, sql
        return self.po[params[0]]["lines"]

    def zapisz(self, cid, uid, pole):
        """Faktyczny zapis sztuki do kartonu `cid` (tak jak zrobiłaby transakcja)."""
        self.units[uid][pole] = cid
        self.units[uid]["status"] = "packed"
        ln = self.po[cid]["lines"][0]
        ln["packed_qty"] += 1


# ── Problem 1: wyścig duplikatu ───────────────────────────────────────────

def test_stock_idempotentny_sukces_to_ALREADY_nie_ACTIVE(monkeypatch):
    """Drugie stanowisko: sztuka odczytana jako produced, a zanim weszła
    blokada, pierwsze wpisało ją do TEGO kartonu → serwis zwraca `already`."""
    hala = _Hala(monkeypatch, _unit(), [_stock("c1")])

    def scan(cid, code):
        hala.proby.append(cid)
        hala.zapisz(cid, "u1", "carton_id")  # zapis „pierwszego" stanowiska
        return {"ok": True, "packedQty": 1, "targetQty": 2, "full": False, "already": True}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "ALREADY"
    assert w["sameCarton"] is True
    assert w["where"]
    assert w["container"] is None
    assert hala.proby == ["c1"]


def test_paleta_odmowa_przy_rownoczesnym_duplikacie_to_ALREADY_gdzie_lezy(monkeypatch):
    """Paleta: drugi zapis dostaje „już przypisana" — nie NO_PLACE i bez
    próby dopisania tej sztuki do kolejnych kartonów."""
    hala = _Hala(monkeypatch, _unit(), [_order("p1", carton_no=5), _stock("c2", carton_no=6)])
    hala.zapisz("p1", "u1", "pallet_id")  # inne stanowisko już ją spakowało
    stock_proby = []
    monkeypatch.setattr(pallets_service, "pack_unit_into_pallet",
                        lambda pid, code: {"ok": False, "reason": "Sztuka jest już przypisana"})
    def scan(cid, code):
        stock_proby.append(cid)
        return {"ok": True, "packedQty": 1, "targetQty": 2, "full": False}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    # Routing startuje ze starą migawką sztuki (produced, bez palety).
    stara = _unit()
    wolania = iter([stara])
    realna = svc._sztuka
    monkeypatch.setattr(svc, "_sztuka", lambda uid: next(wolania, None) or realna(uid))

    # Bez aktywnego: paleta p1 (niższy numer) jest pierwszym kandydatem.
    w = svc.skanuj_sztuke(unit_qr("u1"), None)
    assert w["result"] == "ALREADY"
    assert w["sameCarton"] is False
    assert w["where"]  # numer palety p1
    assert stock_proby == []


def test_stock_409_przez_duplikat_w_innym_kartonie_to_ALREADY(monkeypatch):
    hala = _Hala(monkeypatch, _unit(), [_stock("c1"), _stock("c2", carton_no=2)])
    stara = _unit()
    wolania = iter([stara])
    realna = svc._sztuka
    monkeypatch.setattr(svc, "_sztuka", lambda uid: next(wolania, None) or realna(uid))

    def scan(cid, code):
        hala.proby.append(cid)
        hala.zapisz("c2", "u1", "carton_id")
        raise HTTPException(409, "Sztuka jest już w innym kartonie")

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "ALREADY" and w["sameCarton"] is False
    assert hala.proby == ["c1"]


def test_ostatnie_miejsce_zajete_INNA_sztuka_probuje_nastepnego(monkeypatch):
    """Nie każde 409/odmowa to duplikat: sztuka dalej produced i wolna →
    routing idzie do kolejnego pasującego kartonu."""
    hala = _Hala(monkeypatch, _unit(), [_order("p1", packed=1, target=2, carton_no=1),
                                         _stock("c2", carton_no=2)])
    monkeypatch.setattr(pallets_service, "pack_unit_into_pallet",
                        lambda pid, code: {"ok": False, "reason": "Brak wolnej pozycji dla tej tulei"})

    def scan(cid, code):
        hala.zapisz(cid, "u1", "carton_id")
        return {"ok": True, "packedQty": 1, "targetQty": 2, "full": False}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "p1")
    assert w["result"] == "OTHER"
    assert w["container"]["id"] == "c2"
    assert w["container"]["packedQty"] == 1


def test_ostatnie_miejsce_zajete_i_brak_innego_to_NO_PLACE(monkeypatch):
    _Hala(monkeypatch, _unit(), [_stock("c1")])
    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton",
                        lambda cid, code: (_ for _ in ()).throw(
                            HTTPException(409, "Brak wolnej pozycji kartonu dla tej sztuki")))
    assert svc.skanuj_sztuke(unit_qr("u1"), "c1")["result"] == "NO_PLACE"


def test_status_produkcji_zmieniony_w_miedzyczasie_to_NOT_PRODUCED(monkeypatch):
    hala = _Hala(monkeypatch, _unit(), [_stock("c1")])

    def scan(cid, code):
        hala.units["u1"]["status"] = "shipped"
        raise HTTPException(409, "Sztuka musi być wyprodukowana")

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "NOT_PRODUCED" and w["status"] == "shipped"


def test_inny_blad_niz_409_dalej_leci(monkeypatch):
    _Hala(monkeypatch, _unit(), [_stock("c1")])
    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton",
                        lambda cid, code: (_ for _ in ()).throw(HTTPException(404, "brak")))
    with pytest.raises(HTTPException):
        svc.skanuj_sztuke(unit_qr("u1"), "c1")


# ── Problem 2: payload pełnego kartonu ────────────────────────────────────

def test_pelny_stock_payload_z_aktualnymi_liniami(monkeypatch):
    """Cel 1: po zapisie karton znika z otwartych — payload ma pokazać 1/1,
    także w lines[], a nie starą migawkę 0 + 1."""
    hala = _Hala(monkeypatch, _unit(), [_stock("c1", target=1)])

    def scan(cid, code):
        hala.zapisz(cid, "u1", "carton_id")
        hala.kontenery = []  # pełny → zniknął z otwartych
        return {"ok": True, "packedQty": 1, "targetQty": 1, "full": True}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "ACTIVE" and w["full"] is True
    assert w["container"]["packedQty"] == 1
    assert w["container"]["lines"][0]["packedQty"] == 1


def test_pelny_order_2z2_przy_dwoch_operatorach(monkeypatch):
    """Migawka 0/2; w międzyczasie drugi operator dołożył sztukę, nasz zapis
    domknął karton → 2/2 i full, nie 1/2."""
    hala = _Hala(monkeypatch, _unit(), [_order("p1", packed=0, target=2)])
    hala.units["u2"] = _unit("u2")

    def pack(pid, code):
        hala.zapisz(pid, "u2", "pallet_id")  # drugie stanowisko
        hala.zapisz(pid, "u1", "pallet_id")  # nasz zapis
        hala.kontenery = []
        return {"ok": True, "packedQty": 2, "targetQty": 2, "palletStatus": "packed"}

    monkeypatch.setattr(pallets_service, "pack_unit_into_pallet", pack)
    w = svc.skanuj_sztuke(unit_qr("u1"), "p1")
    assert w["result"] == "ACTIVE" and w["full"] is True
    assert w["container"]["kind"] == "order"
    assert w["container"]["packedQty"] == 2 and w["container"]["targetQty"] == 2
    assert w["container"]["lines"][0]["packedQty"] == 2


def _zniknal_po_zapisie(hala, cid):
    """Odczyt po id po zapisie nie znajduje kartonu (stock ani order)."""
    hala.po.pop(cid)
    hala.numery.pop(cid)
    hala.kontenery = [k for k in hala.kontenery if k["id"] != cid]


def test_stock_zniknal_po_zapisie_ACTIVE_bez_starych_linii(monkeypatch):
    """Transakcja potwierdziła domknięcie 2/2, odczyt po id nic nie zwrócił →
    zapis zostaje ACTIVE, sumy z transakcji, bez nieaktualnego rozpisu."""
    hala = _Hala(monkeypatch, _unit(), [_stock("c1", packed=0, target=2)])

    def scan(cid, code):
        hala.zapisz(cid, "u1", "carton_id")
        _zniknal_po_zapisie(hala, cid)
        return {"ok": True, "packedQty": 2, "targetQty": 2, "full": True}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "ACTIVE" and w["full"] is True
    c = w["container"]
    assert c["id"] == "c1" and c["kind"] == "stock"
    assert c["packedQty"] == 2 and c["targetQty"] == 2
    assert c["lines"] == []
    assert c["detailsAvailable"] is False


def test_order_zniknal_po_zapisie_OTHER_bez_starych_linii(monkeypatch):
    """Paleta innego niż aktywny kartonu: zapis potwierdzony (palletStatus
    packed), odczyt po id pusty → OTHER zachowane, sumy z transakcji."""
    hala = _Hala(monkeypatch, _unit(client_name="DEMS"),
                 [_stock("c1", carton_no=1),
                  {**_order("p2", packed=0, target=2, carton_no=2),
                   "clientName": "DEMS", "_nazwy": ["DEMS"]}])

    def pack(pid, code):
        hala.zapisz(pid, "u1", "pallet_id")
        _zniknal_po_zapisie(hala, pid)
        return {"ok": True, "packedQty": 2, "targetQty": 2, "palletStatus": "packed"}

    monkeypatch.setattr(pallets_service, "pack_unit_into_pallet", pack)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "OTHER" and w["full"] is True
    c = w["container"]
    assert c["id"] == "p2" and c["kind"] == "order"
    assert c["packedQty"] == 2 and c["targetQty"] == 2
    assert c["lines"] == []
    assert c["detailsAvailable"] is False


def test_niepelny_nie_jest_full(monkeypatch):
    hala = _Hala(monkeypatch, _unit(), [_stock("c1", target=2)])

    def scan(cid, code):
        hala.zapisz(cid, "u1", "carton_id")
        return {"ok": True, "packedQty": 1, "targetQty": 2, "full": False}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["full"] is False and w["container"]["packedQty"] == 1


# ── ACTIVE vs OTHER bez regresji ──────────────────────────────────────────

def test_active_vs_other(monkeypatch):
    hala = _Hala(monkeypatch, _unit(client_name="DEMS"),
                 [_stock("c1", carton_no=1),
                  {**_stock("c2", carton_no=2), "clientName": "DEMS", "_nazwy": ["DEMS"]}])

    def scan(cid, code):
        hala.zapisz(cid, "u1", "carton_id")
        return {"ok": True, "packedQty": 1, "targetQty": 2, "full": False}

    monkeypatch.setattr(stock_cartons_service, "scan_unit_into_carton", scan)
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "OTHER" and w["container"]["id"] == "c2"


def test_juz_spakowana_przed_skanem_to_ALREADY_sameCarton(monkeypatch):
    _Hala(monkeypatch, _unit(carton_id="c1", status="packed"), [_stock("c1")])
    w = svc.skanuj_sztuke(unit_qr("u1"), "c1")
    assert w["result"] == "ALREADY" and w["sameCarton"] is True
