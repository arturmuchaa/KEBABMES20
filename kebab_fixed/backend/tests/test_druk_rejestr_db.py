"""Rejestr wydruków — co, kto, gdzie i kiedy wydrukowano.

TRUVA/Z/2/11/26 (19.11.2026): nie było widać, czy kartki palet P14 i P15
w ogóle wydrukowano, więc mroźnia nie miała czego zeskanować.
Testy DB wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip.
"""
import pytest
from fastapi import HTTPException

from app.db import execute
from app.services import druk_rejestr_service as rejestr
from app.services.pallets_service import list_pallets


def _zamowienie_z_paletami(oid="o_druk", n=3):
    execute("INSERT INTO client_orders (id, order_no) VALUES (%s,%s)", (oid, "ZAM/" + oid))
    execute("INSERT INTO client_order_lines (id, order_id, qty, kg_per_unit, total_kg) VALUES (%s,%s,30,25,750)",
            (oid + "_l", oid))
    ids = []
    for i in range(1, n + 1):
        pid = f"{oid}_p{i}"
        execute("INSERT INTO order_pallets (id, order_id, pallet_no, carton_no) VALUES (%s,%s,%s,%s)",
                (pid, oid, i, 900 + i))
        ids.append(pid)
    return oid, ids


def _wpis(**kw):
    w = {"rodzaj": "kartki-palet", "tytul": "Kartki palet", "kopie": 1, "drukarka": "bizhub", "zasobnik": "Zasobnik 3"}
    w.update(kw)
    return w


def test_zapis_i_lista_dla_zamowienia(db):
    oid, (p1, p2, _) = _zamowienie_z_paletami()
    rejestr.zapisz(_wpis(orderId=oid, palletIds=[p1, p2], komputer="BIURO-1"), "am")
    wpisy = rejestr.lista(oid)
    assert len(wpisy) == 1
    w = wpisy[0]
    assert w["operator"] == "am" and w["komputer"] == "BIURO-1"
    assert sorted(w["pallet_ids"]) == sorted([p1, p2])
    assert w["zasobnik"] == "Zasobnik 3" and w["kopie"] == 1


def test_ponowny_klientId_nie_dubluje(db):
    oid, (p1, _, _) = _zamowienie_z_paletami()
    rejestr.zapisz(_wpis(orderId=oid, palletIds=[p1], klientId="k-1"), "am")
    rejestr.zapisz(_wpis(orderId=oid, palletIds=[p1], klientId="k-1"), "am")
    assert len(rejestr.lista(oid)) == 1


def test_list_pallets_niesie_ostatni_wydruk(db):
    oid, (p1, p2, p3) = _zamowienie_z_paletami()
    rejestr.zapisz(_wpis(orderId=oid, palletIds=[p1], klientId="a"), "am")
    execute("UPDATE print_log SET at='2026-11-19 10:00+00' WHERE id='a'")
    rejestr.zapisz(_wpis(orderId=oid, palletIds=[p1, p2], klientId="b"), "olek")
    execute("UPDATE print_log SET at='2026-11-19 11:40+00' WHERE id='b'")
    po = {p["id"]: p for p in list_pallets(oid)}
    assert po[p1]["liczba_wydrukow"] == 2
    assert po[p1]["ostatni_wydruk_at"].startswith("2026-11-19T11:40")
    assert po[p1]["ostatni_wydruk_kto"] == "olek"
    assert po[p2]["liczba_wydrukow"] == 1
    assert po[p3]["ostatni_wydruk_at"] is None and po[p3]["liczba_wydrukow"] == 0


def test_wydruk_czesci_palet(db):
    oid, (p1, p2, _) = _zamowienie_z_paletami()
    rejestr.zapisz(_wpis(orderId=oid, palletIds=[p2]), "am")
    po = {p["id"]: p for p in list_pallets(oid)}
    assert po[p1]["ostatni_wydruk_at"] is None
    assert po[p2]["ostatni_wydruk_at"] is not None


def test_post_bez_rodzaju_400(db):
    with pytest.raises(HTTPException) as e:
        rejestr.zapisz(_wpis(rodzaj=""), "am")
    assert e.value.status_code == 400
