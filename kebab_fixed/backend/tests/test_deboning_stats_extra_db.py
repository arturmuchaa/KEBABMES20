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


# ── Task 2: poprzedni okres, na żywo, furtki, korekty ─────────────────────────
from datetime import date  # noqa: E402

from app.services.deboning_stats_extra import previous_range  # noqa: E402


def _korekta(eid, reason, changes=None, at=f"{D}T12:00:00+01:00"):
    execute(
        "INSERT INTO deboning_entry_corrections (id, entry_id, by_subject, reason, changes, at)"
        " VALUES (%s,%s,'biuro',%s,%s::jsonb,%s)",
        (cuid(), eid, reason, json.dumps(changes or {}), at),
    )


def test_previous_range_dzis():
    assert previous_range("2026-11-28", "2026-11-28", date(2026, 11, 28), "10:00") == \
        ("2026-11-21", "2026-11-21", "10:00")


def test_previous_range_tydzien():
    assert previous_range("2026-11-22", "2026-11-28", date(2026, 11, 28), "10:00") == \
        ("2026-11-15", "2026-11-21", None)


def test_previous_range_wczoraj_bez_ciecia():
    assert previous_range("2026-11-27", "2026-11-27", date(2026, 11, 28), "10:00") == \
        ("2026-11-26", "2026-11-26", None)


def test_previous_tnie_do_godziny(db):
    _wpis(at="2026-11-21T09:00:00+01:00")
    _wpis(at="2026-11-21T14:00:00+01:00")
    assert deboning_stats("2026-11-21", "2026-11-21", until_time="10:00")["summary"]["quarters"] == 1
    assert deboning_stats("2026-11-21", "2026-11-21")["summary"]["quarters"] == 2


def test_previous_w_odpowiedzi(db):
    eid = _wpis(at="2026-11-13T09:00:00+01:00", kg_q=200, kg_m=128)
    _porcja(eid, 128, "auto", at="2026-11-13T10:00:00+01:00")
    _wpis(at="2026-11-20T09:00:00+01:00", kg_q=200, kg_m=132)
    p = deboning_stats("2026-11-20", "2026-11-20", extended=True)["previous"]
    assert (p["dateFrom"], p["dateTo"], p["untilTime"]) == ("2026-11-19", "2026-11-19", None)
    p7 = deboning_stats("2026-11-14", "2026-11-20", extended=True)["previous"]
    assert p7["kgQuarter"] == 200.0 and p7["yieldZs"] == 64.0 and p7["autoPct"] == 100.0


def test_live_tylko_gdy_dzis(db):
    s = deboning_stats(D, D, extended=True)
    assert s["live"] is None
    from datetime import datetime
    from zoneinfo import ZoneInfo
    dzis = datetime.now(ZoneInfo("Europe/Warsaw")).date().isoformat()
    _wpis(at=now_iso(), status="open", kg_m=0, completed=None)
    live = deboning_stats(dzis, dzis, extended=True)["live"]
    assert len(live["openTakes"]) == 1
    assert live["openTakes"][0]["workerName"] == "Jan Testowy"


def test_korekty_bez_furtki(db):
    eid = _wpis()
    _korekta(eid, "Pomyłka operatora", {"kgMeat": 130})
    _korekta(eid, "Ominięcie pasma wydajności (kod 0099)", {"yieldPct": 75})
    _korekta(eid, "Zatwierdzenie bilansu poza tolerancją (kod kierownika): x", {})
    _korekta("usuniety-1", "zły pracownik", {"usuniety": {"kgQuarter": 100}})
    s = deboning_stats(D, D, extended=True)
    assert s["corrections"] == {"edits": 1, "deleted": 1}
    assert s["overrides"]["total"] == 1
    assert s["overrides"]["byWorker"] == {"w1": 1}


def test_wydajnosc_miesiaca(db):
    """Miesiąc z ~3000 pobrań i porcjami liczy się poniżej 1,5 s (spec §B)."""
    import time
    _partia()
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, weigh_mode, status, created_at, completed_at)"
        " SELECT 'e'||g, 'rb-1', '850', 'w'||(g %% 25), 'Pracownik '||(g %% 25), 200, 130, 65, NULL,"
        " 'complete', t, t FROM generate_series(1, 3000) g,"
        " LATERAL (SELECT TIMESTAMPTZ '2026-10-01 06:00+02' + (g %% 30) * interval '1 day'"
        "                 + (g %% 10) * interval '1 hour' AS t) x"
    )
    execute(
        "INSERT INTO deboning_take_weighings (id, entry_id, kg_meat, weigh_mode, weighed_at)"
        " SELECT 'p'||e.id, e.id, 130, CASE WHEN random() < 0.05 THEN 'manual' ELSE 'auto' END,"
        " e.created_at + interval '1 hour' FROM deboning_entries e"
    )
    t0 = time.perf_counter()
    s = deboning_stats("2026-10-01", "2026-10-30", extended=True)
    dt = time.perf_counter() - t0
    assert s["summary"]["quarters"] == 3000
    assert dt < 1.5, f"{dt:.2f} s"


# ── Poprawki z przeglądu ─────────────────────────────────────────────────────
def test_previous_do_godziny_bez_pobran_skonczonych_pozniej(db):
    """Tydzień temu do 10:00 = tylko to, co do 10:00 było rozliczone — dziś pobrania
    w toku nie wchodzą (status), więc inaczej rano dziś zawsze wypadałoby gorzej."""
    _wpis(at="2026-11-21T09:00:00+01:00", completed="2026-11-21T11:00:00+01:00")
    _wpis(at="2026-11-21T08:00:00+01:00", completed="2026-11-21T09:30:00+01:00")
    assert deboning_stats("2026-11-21", "2026-11-21", until_time="10:00")["summary"]["quarters"] == 1


def test_korekta_palety_przez_biuro_to_office(db):
    _wpis()
    at = f"{D}T10:00:00+01:00"
    _palety("backs", [{"tareLabel": "E2", "net": 250, "weighedAt": at}])
    execute(
        "INSERT INTO byproduct_weighing_corrections (id, raw_batch_id, by_subject, reason, changes)"
        " VALUES (%s,'rb-1','biuro','dubel',%s::jsonb)",
        (cuid(), json.dumps({"action": "update", "kind": "backs", "weighedAt": at,
                             "before": {"tareLabel": "E2", "net": 300, "weighedAt": at},
                             "after": {"tareLabel": "E2", "net": 250, "weighedAt": at}})),
    )
    b = deboning_stats(D, D, extended=True)["weighing"]["backs"]
    assert b["auto"]["kg"] == 300.0
    assert b["office"]["kg"] == -50.0
