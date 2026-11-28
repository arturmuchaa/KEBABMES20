"""Statystyki rozbioru PROTRIMA (`extended=True`): skąd są kilogramy (waga /
ręcznie / nieznane / korekta biura), z/s vs b/s, ręczne ważenia.

Spec: docs/superpowers/specs/2026-11-28-rozbior-statystyki-pulpit-zaladunek-design.md.
Każdy kilogram z jednego źródła — suma trybów frakcji = kg frakcji w `summary`.
Testy DB — bez TEST_DATABASE_URL skip. Dane fikcyjne.
"""
import json

from app.db import execute
from app.services.deboning_service import deboning_stats
from app.utils.ids import cuid, now_iso

D = "2026-11-20"  # PL zima = UTC+1


def _partia(no="850", rb="rb-1"):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, created_at)"
        " VALUES (%s,%s,%s,'Dostawca Testowy',1000,800,'active','mat-cwiartka',"
        " 'Ćwiartka z kurczaka',%s) ON CONFLICT (id) DO NOTHING",
        (rb, no, int(no), now_iso()),
    )


def _wpis(eid=None, kg_q=200, kg_m=132, at=f"{D}T08:00:00+01:00", mode=None,
          worker=("w1", "Jan Testowy"), no="850", rb="rb-1", meat_type="zs",
          status="complete", completed=None):
    eid = eid or cuid()
    _partia(no, rb)
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, weigh_mode, meat_type, status, created_at, completed_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (eid, rb, no, worker[0], worker[1], kg_q, kg_m, kg_m / kg_q * 100 if kg_q else 0,
         mode, meat_type, status, at, completed or at),
    )
    return eid


def _porcja(eid, kg, mode="auto", at=f"{D}T09:00:00+01:00", meat_type="zs"):
    execute(
        "INSERT INTO deboning_take_weighings (id, entry_id, kg_meat, weigh_mode, weighed_at, meat_type)"
        " VALUES (%s,%s,%s,%s,%s,%s)",
        (cuid(), eid, kg, mode, at, meat_type),
    )


def _palety(kind, pallets, no="850", rb="rb-1", quarter=200):
    _partia(no, rb)
    kg = sum(p["net"] for p in pallets)
    execute(
        f"INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, quarter_kg, {kind}_kg, {kind}_pallets)"
        f" VALUES (%s,%s,%s,%s,%s::jsonb) ON CONFLICT (raw_batch_id) DO UPDATE"
        f" SET {kind}_kg=EXCLUDED.{kind}_kg, {kind}_pallets=EXCLUDED.{kind}_pallets",
        (rb, no, quarter, kg, json.dumps(pallets)),
    )


def _suma(fr):
    return round(fr["auto"]["kg"] + fr["manual"]["kg"] + fr["unknown"]["kg"] + fr["office"]["kg"], 1)


def test_bez_extended_odpowiedz_bez_nowych_kluczy(db):
    _wpis()
    s = deboning_stats(D, D)
    assert "weighing" not in s and "manualList" not in s and "meatByType" not in s["summary"]


def test_porcje_auto_i_manual_mieso(db):
    eid = _wpis(kg_m=132)
    _porcja(eid, 100, "auto")
    _porcja(eid, 32, "manual")
    w = deboning_stats(D, D, extended=True)["weighing"]
    assert w["meat"]["auto"] == {"n": 1, "kg": 100.0}
    assert w["meat"]["manual"] == {"n": 1, "kg": 32.0}
    assert w["autoPct"] == 75.8
    assert w["manualCount"] == 1


def test_weigh_mode_null_to_unknown(db):
    _wpis(kg_m=132, mode=None)
    w = deboning_stats(D, D, extended=True)["weighing"]
    assert w["meat"]["unknown"]["kg"] == 132.0
    assert w["autoPct"] is None


def test_wpis_bez_porcji_z_trybem(db):
    _wpis(kg_m=132, mode="manual")
    w = deboning_stats(D, D, extended=True)["weighing"]
    assert w["meat"]["manual"] == {"n": 1, "kg": 132.0}


def test_mieso_z_rozliczenia_nie_liczone_dwa_razy(db):
    eid = _wpis(kg_m=132)
    _porcja(eid, 132, "auto")
    execute(
        "INSERT INTO deboning_settlement_weighings (id, entry_id, kind, kg_net, weigh_mode, weighed_by,"
        " weighed_at, original_payload) VALUES (%s,%s,'meat',132,'auto','kiosk',%s,'{}')",
        (cuid(), eid, f"{D}T09:00:00+01:00"),
    )
    s = deboning_stats(D, D, extended=True)
    assert _suma(s["weighing"]["meat"]) == s["summary"]["kgMeat"] == 132.0
    assert s["weighing"]["meat"]["auto"]["kg"] == 132.0


def test_paleta_reczna_i_z_tara(db):
    _wpis()
    _palety("backs", [
        {"tareLabel": "E2", "net": 40, "weighedAt": f"{D}T10:00:00+01:00"},
        {"tareLabel": "ręcznie", "net": 10, "weighedAt": f"{D}T11:00:00+01:00"},
    ])
    s = deboning_stats(D, D, extended=True)
    b = s["weighing"]["backs"]
    assert b["auto"] == {"n": 1, "kg": 40.0}
    assert b["manual"] == {"n": 1, "kg": 10.0}
    assert _suma(b) == s["summary"]["kgBacks"]


def test_paleta_sprzed_lipca_unknown(db):
    d = "2026-07-01"
    _wpis(at=f"{d}T08:00:00+02:00")
    _palety("bones", [{"tareLabel": "E2", "net": 40, "weighedAt": f"{d}T10:00:00+02:00"}])
    b = deboning_stats(d, d, extended=True)["weighing"]["bones"]
    assert b["unknown"]["kg"] == 40.0 and b["auto"]["kg"] == 0.0


def test_paleta_pracownika_reczna(db):
    _wpis()
    _palety("backs", [{"tareLabel": "ręcznie", "net": 12, "weighingId": "sw1", "workerId": "w1",
                        "workerName": "Jan Testowy", "weighedAt": f"{D}T10:00:00+01:00"}])
    s = deboning_stats(D, D, extended=True)
    assert s["weighing"]["backs"]["manual"]["kg"] == 12.0
    jan = next(w for w in s["workers"] if w["workerId"] == "w1")
    assert jan["manualWeighings"] == 1 and jan["manualKg"] == 12.0


def test_korekta_biura_jako_office(db):
    eid = _wpis(kg_m=140)
    _porcja(eid, 132, "auto")
    m = deboning_stats(D, D, extended=True)["weighing"]["meat"]
    assert m["office"]["kg"] == 8.0
    assert m["auto"]["kg"] == 132.0


def test_wieczorne_pobranie_mieso_dzis_liczy_sie_wczoraj(db):
    eid = _wpis(at="2026-11-27T18:00:00+01:00", kg_m=120)
    _porcja(eid, 120, "manual", at="2026-11-28T07:00:00+01:00")
    w27 = deboning_stats("2026-11-27", "2026-11-27", extended=True)["weighing"]
    w28 = deboning_stats("2026-11-28", "2026-11-28", extended=True)["weighing"]
    assert w27["meat"]["manual"]["kg"] == 120.0
    assert w28["meat"]["manual"]["kg"] == 0.0


def test_zs_bs_proporcjonalnie(db):
    eid = _wpis(kg_q=200, kg_m=120)
    _porcja(eid, 90, "auto", meat_type="zs")
    _porcja(eid, 30, "auto", meat_type="bs")
    s = deboning_stats(D, D, extended=True)
    mt = s["summary"]["meatByType"]
    assert mt["zs"]["kgQuarter"] == 150.0 and mt["bs"]["kgQuarter"] == 50.0
    assert mt["zs"]["yieldPct"] == 60.0 and mt["bs"]["yieldPct"] == 60.0
    assert mt["zs"]["kgQuarter"] + mt["bs"]["kgQuarter"] == s["summary"]["kgQuarter"]


def test_wpis_bs_bez_porcji(db):
    _wpis(kg_q=60, kg_m=31, meat_type="bs")
    _wpis(kg_q=200, kg_m=130)
    mt = deboning_stats(D, D, extended=True)["summary"]["meatByType"]
    assert mt["bs"] == {"kgQuarter": 60.0, "kgMeat": 31.0, "yieldPct": 51.7}
    assert mt["zs"]["yieldPct"] == 65.0


def test_reczne_u_pracownika_i_lista(db):
    eid = _wpis(kg_m=132)
    _porcja(eid, 100, "auto", at=f"{D}T09:00:00+01:00")
    _porcja(eid, 32, "manual", at=f"{D}T09:30:00+01:00")
    s = deboning_stats(D, D, extended=True)
    jan = s["workers"][0]
    assert jan["manualWeighings"] == 1 and jan["weighings"] == 2 and jan["manualKg"] == 32.0
    assert s["manualList"][0]["fraction"] == "meat"
    assert s["manualList"][0]["kg"] == 32.0
    assert s["manualList"][0]["workerName"] == "Jan Testowy"
    assert s["manualList"][0]["batchNo"] == "850"
