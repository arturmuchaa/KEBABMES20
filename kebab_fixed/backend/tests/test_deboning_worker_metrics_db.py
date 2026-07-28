"""Metryki pracownika w raporcie: obecność, powtarzalność i uzysk SKORYGOWANY
O PARTIĘ.

Korekta o partię istnieje po to, żeby ranking był sprawiedliwy: pracownik,
który dostał gorszy surowiec, nie może za to odpowiadać. Liczymy odchylenie
każdego wpisu od średniej JEGO partii, ważone kilogramami — to zdejmuje
wpływ jakości ćwiartki i zostawia samą robotę człowieka.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.deboning_service import deboning_stats
from app.utils.ids import cuid, now_iso


def _batch(bid, no):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, price_per_kg, created_at)"
        " VALUES (%s,%s,%s,'Dostawca',10000,0,'used','mat-cwiartka','Ćwiartka z kurczaka',10,%s)",
        (bid, no, int(no), now_iso()),
    )


def _entry(bid, no, worker, day, q, m):
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'complete',%s,%s)",
        (cuid(), bid, no, worker.lower(), worker, q, m, round(m / q * 100, 1),
         f"{day}T08:00:00+00:00", f"{day}T10:00:00+00:00"),
    )


def _w(stats, name):
    return next(w for w in stats["workers"] if w["workerName"] == name)


def test_obecnosc_liczy_dni_z_pobraniem_i_procent_dni_rozbiorowych(db):
    _batch("rb1", "600")
    _entry("rb1", "600", "OLHA", "2026-07-06", 100, 66)
    _entry("rb1", "600", "OLHA", "2026-07-07", 100, 66)
    _entry("rb1", "600", "IVAN", "2026-07-07", 100, 65)

    st = deboning_stats("2026-07-01", "2026-07-31")
    assert st["summary"]["prodDays"] == 2
    assert _w(st, "OLHA")["days"] == 2
    assert _w(st, "OLHA")["attendancePct"] == 100.0
    assert _w(st, "IVAN")["days"] == 1
    assert _w(st, "IVAN")["attendancePct"] == 50.0


def test_uzysk_skorygowany_o_partie_zdejmuje_wplyw_surowca(db):
    """Ten sam pracownik na SŁABEJ partii: względem zakładu wypada źle,
    względem swojej partii — dobrze. Bez tej kolumny ranking karałby za
    surowiec, którego nikt nie wybierał."""
    _batch("rb-dobra", "601")
    _batch("rb-slaba", "602")
    # Partia dobra: średnia 67%. Partia słaba: średnia 63%.
    _entry("rb-dobra", "601", "EVGHENII", "2026-07-06", 1000, 670)
    _entry("rb-slaba", "602", "ANATOLII", "2026-07-06", 1000, 640)   # +1 p.p. NAD swoją partię
    _entry("rb-slaba", "602", "IVAN", "2026-07-06", 1000, 620)       # −1 p.p. pod swoją partią

    st = deboning_stats("2026-07-01", "2026-07-31")
    a = _w(st, "ANATOLII")
    assert a["avgYield"] == 64.0
    assert a["avgYield"] < st["summary"]["avgYield"], "względem zakładu wypada poniżej"
    assert a["yieldVsBatchPp"] == 1.0, "względem swojej partii jest NAD średnią"
    assert _w(st, "IVAN")["yieldVsBatchPp"] == -1.0


def test_korekta_o_partie_wazona_kilogramami(db):
    """Duże pobranie waży w ocenie więcej niż małe — inaczej jeden odstający
    wpis na 50 kg przykryłby dzień pracy na 400 kg."""
    _batch("rb1", "603")
    _entry("rb1", "603", "OLHA", "2026-07-06", 900, 594)     # 66,0% — dzień pracy
    _entry("rb1", "603", "OLHA", "2026-07-06", 100, 60)      # 60,0% — jedna słaba sztuka
    _entry("rb1", "603", "IVAN", "2026-07-06", 1000, 646)    # 64,6%
    st = deboning_stats("2026-07-01", "2026-07-31")
    # Partia: 2000 kg → 1300 kg = 65,0%. Olha ważona kilogramami:
    # (+1,0 p.p. × 900 kg − 5,0 p.p. × 100 kg) / 1000 kg = +0,4 p.p.
    # Bez ważenia wyszłoby (66,0 + 60,0)/2 = 63,0%, czyli −2,0 p.p. —
    # jedna sztuka na 100 kg przykryłaby 900 kg dobrej roboty.
    assert _w(st, "OLHA")["yieldVsBatchPp"] == 0.4
    assert _w(st, "OLHA")["avgYield"] == 65.4
    assert _w(st, "IVAN")["yieldVsBatchPp"] == -0.4


def test_powtarzalnosc_to_rozrzut_dziennego_uzysku(db):
    """Stały 65,5% jest wart więcej niż średnia 65,5% skacząca 63–68 —
    rozrzut to sygnał o procesie, nie o pechu."""
    _batch("rb1", "604")
    for d, m in (("2026-07-06", 655), ("2026-07-07", 655), ("2026-07-08", 655)):
        _entry("rb1", "604", "STABILNY", d, 1000, m)
    for d, m in (("2026-07-06", 630), ("2026-07-07", 655), ("2026-07-08", 680)):
        _entry("rb1", "604", "SKACZACY", d, 1000, m)

    st = deboning_stats("2026-07-01", "2026-07-31")
    assert _w(st, "STABILNY")["yieldStdDev"] == 0.0
    assert _w(st, "SKACZACY")["yieldStdDev"] > 2.0


def test_jeden_dzien_pracy_nie_ma_powtarzalnosci(db):
    """Odchylenie z jednej próbki nie istnieje — None, nie zero (zero
    czytałoby się jako „idealnie stabilny")."""
    _batch("rb1", "605")
    _entry("rb1", "605", "DAWID", "2026-07-06", 500, 325)
    assert _w(deboning_stats("2026-07-01", "2026-07-31"), "DAWID")["yieldStdDev"] is None
