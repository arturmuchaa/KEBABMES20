"""Praca w parze — normalizacja tempa (kg/h) w statystykach rozbioru.

Część brygady rozbiera we DWOJE, a wpisy idą na JEDNO nazwisko. Surowe kg/h
takiego stanowiska jest wtedy dwukrotnie zawyżone: Anatolii pokazywał 214
kg/h przy 104 kg/h Olgi, co wyglądało jak dwukrotnie szybsza praca, a było
po prostu dwoma parami rąk (lipiec 2026). Wielkość obsady stanowiska
ustawia się w panelu pracowników.

UWAGA: uzysk i kilogramy zostają BEZ ZMIAN — obsada wpływa wyłącznie na
tempo. Akord płaci się za kilogramy i tego ta zmiana nie rusza.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.deboning_service import deboning_stats
from app.utils.ids import cuid, now_iso


def _worker(wid, name, crew_size=1):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, crew_size) "
        "VALUES (%s,%s,'rozbior',0.55,%s) "
        "ON CONFLICT (id) DO UPDATE SET crew_size=EXCLUDED.crew_size",
        (wid, name, crew_size),
    )


def _batch(bid, no):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq, supplier_name,"
        " kg_received, kg_available, status, material_type_id, material_name, price_per_kg, created_at)"
        " VALUES (%s,%s,%s,'Dostawca',10000,0,'used','mat-cwiartka','Ćwiartka z kurczaka',10,%s)",
        (bid, no, int(no), now_iso()),
    )


def _entry(bid, no, wid, name, at, q, m):
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id, worker_name,"
        " kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'complete',%s,%s)",
        (cuid(), bid, no, wid, name, q, m, round(m / q * 100, 1), at, at),
    )


def _w(stats, name):
    return next(w for w in stats["workers"] if w["workerName"] == name)


def test_tempo_pary_dzieli_sie_na_liczbe_osob(db):
    """Dwie osoby na jednym nazwisku: 400 kg mięsa w godzinę to 200 kg/h
    NA OSOBĘ, a nie 400 — inaczej para wygląda na dwa razy szybszą."""
    _worker("w-para", "ANATOLII", crew_size=2)
    _worker("w-solo", "OLHA", crew_size=1)
    _batch("rb1", "700")
    _entry("rb1", "700", "w-para", "ANATOLII", "2026-07-06T08:00:00+00:00", 600, 400)
    _entry("rb1", "700", "w-solo", "OLHA", "2026-07-06T08:00:00+00:00", 300, 200)

    st = deboning_stats("2026-07-01", "2026-07-31")
    assert _w(st, "ANATOLII")["kgPerHour"] == 200.0
    assert _w(st, "OLHA")["kgPerHour"] == 200.0, "solo bez zmian"
    assert _w(st, "ANATOLII")["crewSize"] == 2
    assert _w(st, "OLHA")["crewSize"] == 1


def test_obsada_nie_rusza_kilogramow_ani_uzysku(db):
    """Akord płaci się za kilogramy, a uzysk to stosunek — obsada nie ma
    prawa ich dotknąć, inaczej zmiana ustawienia w biurze ruszyłaby płace."""
    _worker("w-para", "ANATOLII", crew_size=2)
    _batch("rb1", "701")
    _entry("rb1", "701", "w-para", "ANATOLII", "2026-07-06T08:00:00+00:00", 600, 400)

    w = _w(deboning_stats("2026-07-01", "2026-07-31"), "ANATOLII")
    assert w["kgQuarter"] == 600.0
    assert w["kgMeat"] == 400.0
    assert w["avgYield"] == 66.7


def test_brak_ustawienia_to_praca_pojedyncza(db):
    """Domyślnie każdy pracuje sam — włączenie pary jest świadomą decyzją
    biura, nie czymś, co system zgaduje."""
    _worker("w-x", "NOWY")
    _batch("rb1", "702")
    _entry("rb1", "702", "w-x", "NOWY", "2026-07-06T08:00:00+00:00", 300, 200)
    w = _w(deboning_stats("2026-07-01", "2026-07-31"), "NOWY")
    assert w["crewSize"] == 1
    assert w["kgPerHour"] == 200.0


def test_tempo_zakladu_liczy_sie_po_glowach_a_nie_po_stanowiskach(db):
    """Skoro para to dwie osoby, łączne kg/h zakładu też musi dzielić przez
    faktyczną liczbę rąk — inaczej KPI „tempo" rośnie od samego przepisania
    kogoś na parę."""
    _worker("w-para", "ANATOLII", crew_size=2)
    _worker("w-solo", "OLHA", crew_size=1)
    _batch("rb1", "703")
    _entry("rb1", "703", "w-para", "ANATOLII", "2026-07-06T08:00:00+00:00", 600, 400)
    _entry("rb1", "703", "w-solo", "OLHA", "2026-07-06T08:00:00+00:00", 300, 200)

    st = deboning_stats("2026-07-01", "2026-07-31")
    # 600 kg mięsa w jednej godzinie, trzy pary rąk → 200 kg/h na osobę.
    assert st["summary"]["kgPerHour"] == 200.0
    assert st["summary"]["headcount"] == 3
    assert st["summary"]["workers"] == 2, "stanowisk nadal dwa"
