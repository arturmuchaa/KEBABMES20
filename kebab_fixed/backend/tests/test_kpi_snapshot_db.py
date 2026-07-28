"""Miesięczne migawki KPI — fundament strony trendów w raporcie dla prezesa.

Powód istnienia: raport zarządczy musi pokazywać to, co pokazał W CHWILI
zamknięcia miesiąca. Korekty rozbioru wchodzą wstecz (storno, zmiana partii,
korekty biurowe), więc liczenie trendu na żywo zmieniałoby historię pod
prezesem — lipiec wydrukowany 1 sierpnia i ten sam lipiec wydrukowany we
wrześniu podawałyby inne liczby.

Drugi powód, ważniejszy: BRAK poprzedniego miesiąca musi być widoczny jako
brak, a nie jako zero czy zmyślona zmiana. Dane rozbioru zaczynają się
7 lipca 2026 — „+0,3 p.p. vs czerwiec" nie istnieje i raport nie ma prawa
takiej liczby wydrukować.

Testy DB — bez TEST_DATABASE_URL skip.
"""
from app.db import execute, query_one
from app.utils.ids import cuid, now_iso


def _seed_workers():
    # workers nie są czyszczone przez fixture `db` — seed musi być idempotentny.
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg) VALUES "
        "('w-olha','Olha','rozbior',0.55), ('w-anat','Anatoli','rozbior',0.55) "
        "ON CONFLICT (id) DO NOTHING"
    )


def _seed_batch(bid, no, supplier, kg=1000.0, price=10.0):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, price_per_kg, created_at)"
        " VALUES (%s,%s,%s,%s,%s,0,'used','mat-cwiartka','Ćwiartka z kurczaka',%s,%s)",
        (bid, no, int(no), supplier, kg, price, now_iso()),
    )


def _seed_entry(bid, no, at_utc, kg_quarter, kg_meat, worker="w-olha"):
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id,"
        " worker_name, kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,%s,%s,%s,'Olha',%s,%s,%s,'complete',%s,%s)",
        (cuid(), bid, no, worker, kg_quarter, kg_meat,
         round(kg_meat / kg_quarter * 100, 1), at_utc, at_utc),
    )


def _seed_month():
    """Lipiec: dwie partie, dwóch dostawców, jeden gorszy o 2 p.p."""
    _seed_workers()
    _seed_batch("rb-a", "500", "DOBRY SP. Z O.O.", kg=1000.0, price=10.0)
    _seed_batch("rb-b", "501", "SLABY SP. Z O.O.", kg=1000.0, price=10.0)
    _seed_entry("rb-a", "500", "2026-07-06T08:00:00+00:00", 1000.0, 660.0)
    _seed_entry("rb-b", "501", "2026-07-20T08:00:00+00:00", 1000.0, 640.0)


def test_migawka_liczy_kpi_miesiaca(db):
    from app.services.kpi_snapshot_service import build_month_kpi
    _seed_month()
    k = build_month_kpi("2026-07")
    assert k["yearMonth"] == "2026-07"
    assert k["kgQuarter"] == 2000.0
    assert k["kgMeat"] == 1300.0
    assert k["avgYield"] == 65.0
    assert k["batches"] == 2
    assert k["entries"] == 2


def test_migawka_niesie_wartosc_01_pp_uzysku_w_zlotowkach(db):
    """Liczba, która przekłada uzysk na pieniądze bez znajomości cen
    sprzedaży: 0,1 p.p. z 2000 kg ćwiartki = 2 kg mięsa × koszt 1 kg."""
    from app.services.kpi_snapshot_service import build_month_kpi
    _seed_month()
    k = build_month_kpi("2026-07")
    assert k["meatCostPerKg"] is not None
    expected = round(2000.0 * 0.001 * k["meatCostPerKg"], 2)
    assert k["yieldPointValuePln"] == expected


def test_migawka_rozbija_dostawcow(db):
    """Najmocniejsza liczba raportu: dostawca gorszy o 1 p.p. to przy skali
    zakładu kilkanaście tysięcy złotych miesięcznie."""
    from app.services.kpi_snapshot_service import build_month_kpi
    _seed_month()
    sup = {s["name"]: s for s in build_month_kpi("2026-07")["suppliers"]}
    assert set(sup) == {"DOBRY SP. Z O.O.", "SLABY SP. Z O.O."}
    assert sup["DOBRY SP. Z O.O."]["avgYield"] == 66.0
    assert sup["SLABY SP. Z O.O."]["avgYield"] == 64.0
    # Odchylenie od średniej zakładu przeliczone na złotówki (ze znakiem).
    assert sup["SLABY SP. Z O.O."]["deltaPln"] < 0
    assert sup["DOBRY SP. Z O.O."]["deltaPln"] > 0


def test_zamkniety_miesiac_nie_zmienia_sie_po_korekcie(db):
    """SEDNO: korekta wchodzi wstecz, ale prezes ma zobaczyć to, co
    podpisał. Zamknięty lipiec zostaje lipcem z chwili zamknięcia."""
    from app.services.kpi_snapshot_service import close_month, get_month_kpi
    _seed_month()
    close_month("2026-07", closed_by="biuro")
    execute("UPDATE deboning_entries SET kg_meat = 100 WHERE raw_batch_no = '501'")

    k = get_month_kpi("2026-07")
    assert k["closed"] is True
    assert k["kgMeat"] == 1300.0, "zamknięty miesiąc przeliczył się po korekcie"


def test_ponowne_zamkniecie_jest_idempotentne_a_force_przelicza(db):
    """Domyślnie zamknięcie nie rusza istniejącej migawki (można bezpiecznie
    wołać z raportu). Świadome przeliczenie po korekcie: force=True."""
    from app.services.kpi_snapshot_service import close_month
    _seed_month()
    close_month("2026-07", closed_by="biuro")
    execute("UPDATE deboning_entries SET kg_meat = 600 WHERE raw_batch_no = '501'")

    assert close_month("2026-07")["kgMeat"] == 1300.0
    assert close_month("2026-07", force=True, closed_by="biuro")["kgMeat"] == 1260.0


def test_biezacy_miesiac_jest_na_zywo_i_oznaczony_jako_niezamkniety(db):
    """Miesiąc w toku musi się przeliczać (prezes patrzy w środku miesiąca),
    ale raport ma go opisać jako niedomknięty."""
    from app.services.kpi_snapshot_service import get_month_kpi
    _seed_month()
    k = get_month_kpi("2026-07", today="2026-07-28")
    assert k["closed"] is False
    execute("UPDATE deboning_entries SET kg_meat = 600 WHERE raw_batch_no = '501'")
    assert get_month_kpi("2026-07", today="2026-07-28")["kgMeat"] == 1260.0


def test_brak_poprzedniego_miesiaca_to_None_a_nie_zero(db):
    """Bez czerwca nie wolno wydrukować „+0,3 p.p. vs czerwiec". Delta ma
    być pusta, a raport ma to napisać wprost."""
    from app.services.kpi_snapshot_service import list_kpi_months
    _seed_month()
    months = list_kpi_months(today="2026-07-28")
    assert [m["yearMonth"] for m in months] == ["2026-07"]
    assert months[0]["deltaYieldPp"] is None
    assert months[0]["deltaMeatCostPerKg"] is None


def test_delta_liczy_sie_dopiero_gdy_sa_dwa_miesiace(db):
    from app.services.kpi_snapshot_service import close_month, list_kpi_months
    _seed_workers()
    _seed_batch("rb-cz", "400", "DOBRY SP. Z O.O.", kg=1000.0, price=10.0)
    _seed_entry("rb-cz", "400", "2026-06-10T08:00:00+00:00", 1000.0, 650.0)
    close_month("2026-06", closed_by="biuro")
    _seed_month()

    months = {m["yearMonth"]: m for m in list_kpi_months(today="2026-07-28")}
    assert months["2026-06"]["deltaYieldPp"] is None      # brak maja
    assert months["2026-07"]["deltaYieldPp"] == 0.0       # 65,0 − 65,0


def test_ensure_closed_months_domyka_tylko_zakonczone_miesiace(db):
    """Backfill przy wejściu w raport: lipiec (bieżący) zostaje otwarty,
    czerwiec się domyka. Idempotentnie — drugi przebieg nic nie robi."""
    from app.services.kpi_snapshot_service import ensure_closed_months
    _seed_workers()
    _seed_batch("rb-cz", "400", "DOBRY SP. Z O.O.", kg=1000.0, price=10.0)
    _seed_entry("rb-cz", "400", "2026-06-10T08:00:00+00:00", 1000.0, 650.0)
    _seed_month()

    assert ensure_closed_months(today="2026-07-28") == ["2026-06"]
    assert ensure_closed_months(today="2026-07-28") == []
    assert query_one("SELECT count(*) n FROM kpi_monthly_snapshots")["n"] == 1


def test_miesiac_bez_rozbioru_nie_tworzy_pustej_migawki(db):
    """Pusty miesiąc w trendzie wyglądałby jak zapaść produkcji."""
    from app.services.kpi_snapshot_service import ensure_closed_months
    _seed_month()
    assert "2026-05" not in ensure_closed_months(today="2026-07-28")
