"""Zbiorcze ważenie ubocznych: ważenie w trakcie rozbioru (ensure_record),
domknięcie partii z przeliczeniem %, widoczność w statystykach biura.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from datetime import date, timedelta

from app.db import execute, query_one
from app.services.batch_byproducts_service import (
    ensure_record,
    finish_batch,
    get,
    pending,
    record,
    today_totals,
)
from app.services.deboning_service import deboning_stats
from app.utils.ids import now_iso, cuid


def _seed_batch_with_entries(batch_id="rb1", internal_no="800", quarter_each=100.0, n=2):
    execute(
        "INSERT INTO raw_batches "
        "(id, internal_batch_no, internal_batch_seq, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s)",
        (batch_id, internal_no, int(internal_no), "Dostawca", quarter_each * n, 0, now_iso()),
    )
    for i in range(n):
        execute(
            "INSERT INTO deboning_entries "
            "(id, raw_batch_id, raw_batch_no, worker_name, kg_quarter, kg_meat, yield_pct, created_at) "
            "VALUES (%s,%s,%s,'Jan',%s,%s,66.0, now())",
            (cuid(), batch_id, internal_no, quarter_each, quarter_each * 0.66),
        )


# ── Ważenie w trakcie rozbioru ────────────────────────────────────────
def test_ensure_record_bez_finished_at_i_poza_pending(db):
    _seed_batch_with_entries(internal_no="800")
    rec = ensure_record("rb1")
    assert rec["finishedAt"] is None
    assert rec["quarterKg"] == 200.0
    # partia NIE trafia na szare kafle — nadal aktywna
    assert all(p["rawBatchId"] != "rb1" for p in pending())


def test_finish_po_ensure_stempluje_i_przelicza_procent(db):
    _seed_batch_with_entries(internal_no="801", quarter_each=100.0, n=1)  # 100 kg
    ensure_record("rb1")
    record("rb1", "backs", 20.0, [])  # % liczony z częściowej bazy 100 kg
    # dochodzi druga sztuka — pełna ćwiartka 200 kg
    execute(
        "INSERT INTO deboning_entries "
        "(id, raw_batch_id, raw_batch_no, worker_name, kg_quarter, kg_meat, yield_pct, created_at) "
        "VALUES (%s,'rb1','801','Jan',100,66,66.0, now())",
        (cuid(),),
    )
    rec = finish_batch("rb1")
    assert rec["finishedAt"] is not None
    assert rec["quarterKg"] == 200.0
    assert rec["backsPct"] == 10.0  # przeliczone: 20/200, nie 20/100
    # teraz partia czeka na kości → pending
    assert any(p["rawBatchId"] == "rb1" for p in pending())


def test_weigh_zwraca_palety_do_doladowania(db):
    _seed_batch_with_entries(internal_no="802")
    ensure_record("rb1")
    pal = [{"tareLabel": "H1", "tareKg": 18, "containers": 10, "gross": 138, "net": 100}]
    rec = record("rb1", "backs", 100.0, pal)
    assert rec["backsPallets"] and rec["backsPallets"][0]["net"] == 100


# ── Widoczność w biurze / na HMI ──────────────────────────────────────
def test_stats_biura_widza_zbiorcze_grzbiety_i_kosci(db):
    _seed_batch_with_entries(internal_no="803")
    finish_batch("rb1")
    record("rb1", "backs", 40.0, [])
    record("rb1", "bones", 30.0, [])
    today = date.today().isoformat()
    stats = deboning_stats(today, today)
    assert stats["summary"]["kgBacks"] == 40.0
    assert stats["summary"]["kgBones"] == 30.0


def test_stats_by_batch_z_dostawca_ubocznymi_i_ubytkiem(db):
    """Tabela „uzysk per partia" w biurze: zbiorcze grzbiety/kości doliczone
    per partia, dostawca z raw_batches, ubytek = bilans masy."""
    _seed_batch_with_entries(internal_no="806")  # 200 kg ćw., 132 kg mięsa
    finish_batch("rb1")
    record("rb1", "backs", 40.0, [])
    record("rb1", "bones", 20.0, [])
    today = date.today().isoformat()
    stats = deboning_stats(today, today)
    row = next(b for b in stats["byBatch"] if b["batchNo"] == "806")
    assert row["supplierName"] == "Dostawca"
    assert row["kgBacks"] == 40.0 and row["kgBones"] == 20.0
    assert row["backsPct"] == 20.0 and row["bonesPct"] == 10.0
    # ubytek: 200 − 132 − 40 − 20 = 8 kg = 4%
    assert row["missingKg"] == 8.0 and row["missingPct"] == 4.0
    assert stats["summary"]["missingKg"] == 8.0
    # NADWYŻKA (realny towar > deklaracja dostawcy) nie jest przycinana do
    # zera — doważenie kości ponad bilans robi missing ujemny
    record("rb1", "bones", 40.0, [])  # 200 − 132 − 40 − 40 = −12
    stats = deboning_stats(today, today)
    row = next(b for b in stats["byBatch"] if b["batchNo"] == "806")
    assert row["missingKg"] == -12.0
    assert stats["summary"]["missingKg"] == -12.0


def test_kafelek_zostaje_dopoki_bilans_masy_sie_nie_domyka(db):
    """Zważona połowa grzbietów + kości NIE zdejmuje kafla — mięso+kości+
    grzbiety musi pokryć ćwiartkę (prod 2026-07-09)."""
    # 200 kg ćwiartki, 132 kg mięsa → uboczne ~68 kg
    _seed_batch_with_entries(internal_no="805", quarter_each=100.0, n=2)
    finish_batch("rb1")
    record("rb1", "backs", 20.0, [])   # połowa grzbietów
    record("rb1", "bones", 15.0, [])   # trochę kości — obie frakcje "done"
    p = [x for x in pending() if x["rawBatchId"] == "rb1"]
    assert p, "kafelek nie może zniknąć — brakuje ~33 kg ubocznych"
    assert p[0]["missingKg"] > 30
    assert p[0]["balanced"] is False
    # doważenie reszty domyka bilans, ale partia z DZISIEJSZĄ aktywnością
    # NIE znika samoczynnie — zostaje jako „zważona ✓" do przywrócenia
    record("rb1", "backs", 40.0, [])
    record("rb1", "bones", 27.0, [])
    p = [x for x in pending() if x["rawBatchId"] == "rb1"]
    assert p and p[0]["balanced"] is True
    # dopiero po dniu (brak dzisiejszej aktywności) zbalansowana partia
    # schodzi z kafli; niedoważona zostałaby (grupa 1 bez filtra daty)
    execute(
        "UPDATE batch_byproducts SET finished_at = finished_at - INTERVAL '1 day', "
        "backs_at = backs_at - INTERVAL '1 day', bones_at = bones_at - INTERVAL '1 day' "
        "WHERE raw_batch_id='rb1'"
    )
    assert not [x for x in pending() if x["rawBatchId"] == "rb1"]


def test_today_totals_sumuje_dzisiejsze_wazenia(db):
    _seed_batch_with_entries(internal_no="804")
    ensure_record("rb1")
    record("rb1", "backs", 55.5, [])
    t = today_totals()
    assert t["backsKg"] == 55.5
    assert t["bonesKg"] == 0.0


# ── Partia rozbierana i ważona przez KILKA DNI (prod 411, 13–14.07.2026) ──
def test_uboczne_licza_sie_w_dniu_wazenia_palety_a_nie_zakonczenia_partii(db):
    """Rekord ubocznych jest JEDEN na partię i ma JEDEN znacznik czasu, więc
    raport wrzucał całe grzbiety/kości do dnia zakończenia partii. Partia 411
    (rozbiór 13.07 + 14.07, kości ważone w obu dniach) dała 13.07 bez kości,
    a 14.07 bilans masy 137% wejścia — biuro widziało „zdublowane kości".
    Każda paleta niesie własny weighedAt i liczy się w SWOIM dniu."""
    _seed_batch_with_entries(internal_no="810", quarter_each=350.0, n=2)  # 700 kg
    ensure_record("rb1")
    pal1 = {"tareLabel": "H1", "tareKg": 18, "containers": 7, "gross": 118, "net": 100}
    record("rb1", "bones", 100.0, [pal1])
    # cofnij ważenie o dobę — tak wyglądała partia po pierwszym dniu rozbioru
    execute(
        "UPDATE batch_byproducts SET bones_at = bones_at - INTERVAL '1 day', "
        "bones_pallets = jsonb_set(bones_pallets, '{0,weighedAt}', "
        "  to_jsonb(((now() - INTERVAL '1 day') AT TIME ZONE 'UTC')::text)) "
        "WHERE raw_batch_id='rb1'"
    )
    # dzień 2: kreator doładowuje palety z rekordu i wysyła SUMĘ narastającą
    prev = get("rb1")["bonesPallets"]
    pal2 = {"tareLabel": "H1", "tareKg": 18, "containers": 2, "gross": 38, "net": 20}
    record("rb1", "bones", 120.0, prev + [pal2])
    finish_batch("rb1")

    today = date.today()
    yday = (today - timedelta(days=1)).isoformat()
    assert deboning_stats(yday, yday)["summary"]["kgBones"] == 100.0
    assert deboning_stats(today.isoformat(), today.isoformat())["summary"]["kgBones"] == 20.0
    # zakres obejmujący oba dni nadal daje pełną partię (nic nie ginie)
    assert deboning_stats(yday, today.isoformat())["summary"]["kgBones"] == 120.0


def test_zbiorcze_wazenie_wyklucza_per_wpisowe_z_raportu(db):
    """Jedno źródło prawdy na (partia, frakcja). Ręczne „Zakończenie partii"
    na HMI zapisywało grzbiety/kości i do deboning_entries, i do
    batch_byproducts — raport SUMOWAŁ oba źródła, więc pokazywał 2× tyle."""
    _seed_batch_with_entries(internal_no="811")  # 200 kg ćwiartki, 2 wpisy
    execute("UPDATE deboning_entries SET kg_backs=20, kg_bones=15 WHERE raw_batch_id='rb1'")
    finish_batch("rb1")
    record("rb1", "backs", 40.0, [])  # ta sama waga, zbiorczo na partię
    record("rb1", "bones", 30.0, [])

    today = date.today().isoformat()
    s = deboning_stats(today, today)
    assert s["summary"]["kgBacks"] == 40.0  # nie 80
    assert s["summary"]["kgBones"] == 30.0  # nie 60
    row = next(b for b in s["byBatch"] if b["batchNo"] == "811")
    assert row["kgBacks"] == 40.0 and row["kgBones"] == 30.0


# ── Loty ABP a doważanie po wydaniu WZ (prod 411/kości, 13–14.07.2026) ──
def _open_lot_stan(kind="bones"):
    return query_one(
        "SELECT COALESCE(SUM(kg),0) AS kg, COALESCE(SUM(containers_available),0) AS c "
        "FROM byproduct_lots WHERE raw_batch_id='rb1' AND kind=%s AND status='open'",
        (kind,),
    )


def test_wazenie_po_wydaniu_calego_lotu_nie_odtwarza_wydanych_kg(db):
    """Partia 411/kości: 13.07 zważono 1027,5 kg → lot; WZ wydała go w całości
    (kg=0, 'shipped'). 14.07 doważono paletę, a kreator wysłał SUMĘ NARASTAJĄCĄ
    1225 kg → record() wstawiał NOWY lot na pełne 1225 kg, mimo że 1027,5 kg
    fizycznie wyjechało. Magazyn ABP zawyżał, a po anulowaniu starej WZ (lot
    wraca na stan) partia miała 2252,5 kg przy realnych 1225 kg."""
    _seed_batch_with_entries(internal_no="813", quarter_each=3500.0, n=2)
    ensure_record("rb1")
    p1 = {"tareLabel": "H1", "tareKg": 18, "containers": 74, "gross": 1045.5, "net": 1027.5}
    record("rb1", "bones", 1027.5, [p1])
    lot = query_one(
        "SELECT id FROM byproduct_lots WHERE raw_batch_id='rb1' AND kind='bones' AND status='open'"
    )
    assert float(_open_lot_stan()["kg"]) == 1027.5
    # WZ wydaje cały lot — dokładnie to robi wz_service (kg→0, status 'shipped')
    execute(
        "UPDATE byproduct_lots SET kg=0, containers_available=0, status='shipped' WHERE id=%s",
        (lot["id"],),
    )
    # 14.07: kolejna paleta — kreator wysyła sumę narastającą całej frakcji
    p2 = {"tareLabel": "H1", "tareKg": 18, "containers": 14, "gross": 243.5, "net": 197.5}
    record("rb1", "bones", 1225.0, [p1, p2])

    stan = _open_lot_stan()
    assert float(stan["kg"]) == 197.5   # na magazynie tylko to, co dowieziono
    assert int(stan["c"]) == 14
    # rekord ważenia nadal zna PEŁNĄ wagę frakcji (raport, procenty, bilans)
    assert get("rb1")["bonesKg"] == 1225.0


def test_wazenie_po_czesciowym_wydaniu_zostawia_reszte(db):
    """WZ zabrała część lotu — doważenie dokłada tylko nadwyżkę ponad wydane."""
    _seed_batch_with_entries(internal_no="814", quarter_each=500.0, n=2)
    ensure_record("rb1")
    p1 = {"tareLabel": "H1", "tareKg": 18, "containers": 10, "gross": 138, "net": 100}
    record("rb1", "bones", 100.0, [p1])
    lot = query_one(
        "SELECT id FROM byproduct_lots WHERE raw_batch_id='rb1' AND kind='bones' AND status='open'"
    )
    # WZ wydaje 30 kg / 3 pojemniki — lot zostaje OTWARTY z resztą
    execute("UPDATE byproduct_lots SET kg=70, containers_available=7 WHERE id=%s", (lot["id"],))
    p2 = {"tareLabel": "H1", "tareKg": 18, "containers": 2, "gross": 38, "net": 20}
    record("rb1", "bones", 120.0, [p1, p2])

    stan = _open_lot_stan()
    assert float(stan["kg"]) == 90.0  # 120 zważone − 30 wydane
    assert int(stan["c"]) == 9        # 12 pojemników − 3 wydane


def test_kolejne_wazenie_bez_wydania_zastepuje_lot_pelna_suma(db):
    """Zabezpieczenie odwrotnej strony: bez żadnego wydania doważenie ma dać
    lot na PEŁNĄ sumę narastającą (nie wolno niczego odjąć)."""
    _seed_batch_with_entries(internal_no="815", quarter_each=500.0, n=2)
    ensure_record("rb1")
    p1 = {"tareLabel": "H1", "tareKg": 18, "containers": 10, "gross": 138, "net": 100}
    record("rb1", "bones", 100.0, [p1])
    p2 = {"tareLabel": "H1", "tareKg": 18, "containers": 2, "gross": 38, "net": 20}
    record("rb1", "bones", 120.0, [p1, p2])

    stan = _open_lot_stan()
    assert float(stan["kg"]) == 120.0
    assert int(stan["c"]) == 12
    assert query_one(
        "SELECT COUNT(*) AS n FROM byproduct_lots WHERE raw_batch_id='rb1' AND kind='bones'"
    )["n"] == 1  # stary lot podmieniony, nie zdublowany


def test_per_wpisowe_uboczne_bez_zbiorczego_wazenia_nadal_licza_sie(db):
    """Odwrotna strona reguły: partia BEZ zbiorczego ważenia (stare HMI /
    tablet) musi nadal pokazywać uboczne z wpisów — nie wolno ich zgubić."""
    _seed_batch_with_entries(internal_no="812")
    execute("UPDATE deboning_entries SET kg_backs=20, kg_bones=15 WHERE raw_batch_id='rb1'")
    today = date.today().isoformat()
    s = deboning_stats(today, today)
    assert s["summary"]["kgBacks"] == 40.0
    assert s["summary"]["kgBones"] == 30.0
