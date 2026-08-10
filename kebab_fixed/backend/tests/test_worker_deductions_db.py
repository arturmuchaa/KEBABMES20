"""Potrącenia oczekujące — dopisywane w dowolnym momencie, czekają na
rozliczenie. Do rozliczenia wchodzą TYLKO te z datą w jego zakresie.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.work_hours import WorkHoursDto
from app.models.workers import CreateSettlementDto, WorkerDeductionDto
from app.services.work_hours_service import upsert_hours
from app.services.workers_service import (
    cancel_worker_deduction,
    create_settlement,
    create_worker_deduction,
    list_worker_deductions,
    match_worker_by_name,
    bulk_settle,
    get_worker_days,
    undo_settlement,
)


def _worker(wid="w1", name="VADYM"):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,'WORKER_DEBONING',0.55,true) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_DEBONING', active=true",
        (wid, name),
    )


def _ded(**kw):
    base = dict(worker_id="w1", deduction_date="2026-08-03",
                description="Zaliczka", amount=100.0)
    base.update(kw)
    return create_worker_deduction(WorkerDeductionDto(**base))


def _deb_day(wid, day, kg):
    """Dzień rozbioru — podstawa akordowa dla testów zbiorczych."""
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, price_per_kg, created_at)"
        " VALUES ('rb-b','800',800,'D',10000,0,'used','mat-cwiartka','C',10,now())"
        " ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id,"
        " worker_name, kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,'rb-b','800',%s,'X',%s,%s,65,'complete',%s,%s)",
        (__import__('app.utils.ids', fromlist=['cuid']).cuid(), wid, kg, kg * 0.65,
         day + "T08:00:00+00:00", day + "T08:00:00+00:00"),
    )


def _settle(**kw):
    base = dict(worker_id="w1", date_from="2026-08-03", date_to="2026-08-09",
                work_dates=["2026-08-03"], kg_per_date={"2026-08-03": 1000.0},
                rate_per_kg=0.55)
    base.update(kw)
    return create_settlement(CreateSettlementDto(**base))


# ── Rejestr ───────────────────────────────────────────────────────────

def test_potracenie_powstaje_jako_oczekujace(db):
    _worker()
    row = _ded()
    assert row["status"] == "pending"
    assert row["amount"] == 100.0
    assert row["sourceType"] == "manual"


def test_lista_zwraca_oczekujace_po_dacie(db):
    _worker()
    _ded(deduction_date="2026-08-05", description="Druga")
    _ded(deduction_date="2026-08-03", description="Pierwsza")
    rows = list_worker_deductions("w1")
    assert [r["description"] for r in rows] == ["Pierwsza", "Druga"]


def test_zerowa_kwota_i_pusty_opis_odrzucone(db):
    _worker()
    with pytest.raises(HTTPException):
        _ded(amount=0)
    with pytest.raises(HTTPException):
        _ded(description="   ")


def test_anulowanie_znika_z_oczekujacych(db):
    _worker()
    row = _ded()
    cancel_worker_deduction(row["id"])
    assert list_worker_deductions("w1") == []
    assert len(list_worker_deductions("w1", status="cancelled")) == 1


# ── Konsumpcja przy rozliczeniu ───────────────────────────────────────

def test_potracenie_w_zakresie_trafia_na_pasek(db):
    _worker()
    d = _ded(deduction_date="2026-08-03", description="Zakup ćwiartki", amount=56.0)
    s = _settle(deduction_ids=[d["id"]])

    assert float(s["gross_amount"]) == 550.0
    assert float(s["deductions_total"]) == 56.0
    assert float(s["net_amount"]) == 494.0
    rows = query_all(
        "SELECT description, amount FROM settlement_deductions WHERE settlement_id=%s",
        (s["id"],),
    )
    assert [(r["description"], float(r["amount"])) for r in rows] == [("Zakup ćwiartki", 56.0)]
    after = query_one("SELECT status, settlement_id FROM worker_deductions WHERE id=%s", (d["id"],))
    assert after["status"] == "settled" and after["settlement_id"] == s["id"]


def test_potracenie_spoza_zakresu_odrzucone(db):
    _worker()
    d = _ded(deduction_date="2026-07-30")
    with pytest.raises(HTTPException) as exc:
        _settle(deduction_ids=[d["id"]])
    assert exc.value.status_code == 400
    assert query_one("SELECT status FROM worker_deductions WHERE id=%s", (d["id"],))["status"] == "pending"


def test_cudze_i_juz_rozliczone_potracenie_odrzucone(db):
    _worker("w1", "VADYM")
    _worker("w2", "DENYS")
    obce = create_worker_deduction(WorkerDeductionDto(
        worker_id="w2", deduction_date="2026-08-03", description="Obce", amount=10))
    with pytest.raises(HTTPException):
        _settle(deduction_ids=[obce["id"]])

    moje = _ded()
    _settle(deduction_ids=[moje["id"]])
    with pytest.raises(HTTPException):
        _settle(work_dates=["2026-08-04"], kg_per_date={"2026-08-04": 500.0},
                deduction_ids=[moje["id"]])


# ── Podstawa godzinowa ────────────────────────────────────────────────

def _gen(wid="wg", name="ADRIAN", rate=25.0, bonus=0.0, bonus_on=False):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, sunday_bonus_enabled,"
        " sunday_bonus_per_hour, active) VALUES (%s,%s,'WORKER_GENERAL',%s,%s,%s,true) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_GENERAL', active=true,"
        " rate_per_hour=EXCLUDED.rate_per_hour,"
        " sunday_bonus_enabled=EXCLUDED.sunday_bonus_enabled,"
        " sunday_bonus_per_hour=EXCLUDED.sunday_bonus_per_hour",
        (wid, name, rate, bonus_on, bonus),
    )


def test_rozliczenie_godzinowe_liczy_z_godzin(db):
    _gen()
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-03",
                              time_from="6:00", time_to="15:00"))
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-03"], hours_per_date={"2026-08-03": 9.0},
        rate_per_kg=0, rate_per_hour=25.0))

    assert s["basis"] == "hours"
    assert float(s["hours_total"]) == 9.0
    assert float(s["gross_amount"]) == 225.0
    assert float(s["kg_total"]) == 0


def test_akord_dziala_jak_dotad(db):
    """Regresja: ścieżka kilogramowa bez potrąceń nie zmienia zachowania."""
    _worker()
    s = _settle()
    assert s["basis"] == "kg"
    assert float(s["kg_total"]) == 1000.0
    assert float(s["gross_amount"]) == 550.0
    assert float(s["net_amount"]) == 550.0


# ── Premia niedzielna ─────────────────────────────────────────────────

def test_premia_niedzielna_tylko_za_niedziele(db):
    """9.08.2026 to niedziela, 3.08 poniedziałek. Dodatek +5 zł/h dotyka
    wyłącznie godzin niedzielnych: 9×25 + 8×25 + 8×5 = 465."""
    _gen(rate=25.0, bonus=5.0, bonus_on=True)
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-03", "2026-08-09"],
        hours_per_date={"2026-08-03": 9.0, "2026-08-09": 8.0},
        rate_per_kg=0, rate_per_hour=25.0))

    assert float(s["hours_total"]) == 17.0
    assert float(s["sunday_hours"]) == 8.0
    assert float(s["sunday_bonus_per_hour"]) == 5.0
    assert float(s["gross_amount"]) == 465.0


def test_pasek_niesie_godziny_od_do(db):
    """Pracownik ma widzieć na pasku, od której do której pracował —
    sama suma godzin nie pozwala mu sprawdzić dnia."""
    import json as _json
    _gen(rate=25.0)
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-03",
                              time_from="6:00", time_to="14:30"))
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-04",
                              time_from="6,5", time_to="15:00"))
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-03", "2026-08-04"],
        hours_per_date={"2026-08-03": 8.5, "2026-08-04": 8.5},
        rate_per_kg=0, rate_per_hour=25.0))

    detail = s["work_dates_detail"]
    if isinstance(detail, str):
        detail = _json.loads(detail)
    assert [d["time_from"] for d in detail] == ["6:00", "6:30"]
    assert [d["time_to"] for d in detail] == ["14:30", "15:00"]
    assert [d["hours"] for d in detail] == [8.5, 8.5]


def test_premia_wylaczona_nie_dolicza_nic(db):
    """Kwota zostaje na kartotece, ale przełącznik rządzi."""
    _gen(rate=25.0, bonus=5.0, bonus_on=False)
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-09"], hours_per_date={"2026-08-09": 8.0},
        rate_per_kg=0, rate_per_hour=25.0))

    assert float(s["sunday_bonus_per_hour"]) == 0
    assert float(s["gross_amount"]) == 200.0


def test_premia_nie_dotyczy_akordu(db):
    """Rozbiór płaci się od kilogramów — niedziela nic tu nie zmienia."""
    _worker()
    execute("UPDATE workers SET sunday_bonus_enabled=true, sunday_bonus_per_hour=5 "
            "WHERE id='w1'")
    s = _settle(work_dates=["2026-08-09"], kg_per_date={"2026-08-09": 1000.0})
    assert float(s["gross_amount"]) == 550.0
    assert float(s["sunday_hours"]) == 0


# ── Cofnięcie rozliczenia ─────────────────────────────────────────────

def test_cofniecie_odblokowuje_dni_i_kasuje_pasek(db):
    """Cofnięcie ma zostawić stan taki, jakby rozliczenia nie było —
    inaczej biuro musi wchodzić do bazy (tak było z testem Marcina)."""
    _worker()
    s = _settle()
    res = undo_settlement(s["id"])

    assert res["unlockedDays"] == 1
    assert query_all("SELECT 1 FROM payroll_settlements WHERE id=%s", (s["id"],)) == []
    assert query_all("SELECT 1 FROM settled_days WHERE settlement_id=%s", (s["id"],)) == []
    assert query_all("SELECT 1 FROM settlement_deductions WHERE settlement_id=%s", (s["id"],)) == []


def test_cofniecie_zwraca_potracenia_do_oczekujacych(db):
    """Potrącenie to realny dług — po cofnięciu ma wrócić do kolejki,
    a nie zniknąć razem z paskiem."""
    _worker()
    d = _ded(description="Zakup ćwiartki", amount=56.0)
    s = _settle(deduction_ids=[d["id"]])
    res = undo_settlement(s["id"])

    assert res["restoredDeductions"] == 1
    row = query_one("SELECT status, settlement_id FROM worker_deductions WHERE id=%s", (d["id"],))
    assert row["status"] == "pending"
    assert row["settlement_id"] is None
    assert [x["id"] for x in list_worker_deductions("w1")] == [d["id"]]


def test_po_cofnieciu_dzien_da_sie_rozliczyc_ponownie(db):
    _worker()
    s1 = _settle()
    undo_settlement(s1["id"])
    s2 = _settle()   # ten sam dzień — bez cofnięcia poleciałoby 400
    assert float(s2["gross_amount"]) == 550.0


def test_pozycja_dorazna_znika_razem_z_paskiem(db):
    """Pozycja wpisana ręcznie przy rozliczeniu nie ma wpisu w rejestrze,
    więc nie ma czego przywracać — nie może zostać sierotą."""
    from app.models.workers import SettlementDeductionDto
    _worker()
    s = _settle(deductions=[SettlementDeductionDto(description="zaliczka", amount=20)])
    res = undo_settlement(s["id"])
    assert res["restoredDeductions"] == 0
    assert query_all("SELECT 1 FROM settlement_deductions WHERE settlement_id=%s", (s["id"],)) == []


def test_cofniecie_nieistniejacego_to_404(db):
    with pytest.raises(HTTPException) as exc:
        undo_settlement("nie-ma-takiego")
    assert exc.value.status_code == 404


# ── Dopasowanie odbiorcy WZ ───────────────────────────────────────────

def _czysta_kartoteka():
    """`workers` nie jest w _TRUNCATE (inne testy seedują je przez ON CONFLICT
    i na tym polegają), a dopasowanie po nazwie patrzy na WSZYSTKICH aktywnych.
    Bez czystego startu cudzy „VADYM" z sąsiedniego pliku robi z jednego
    trafienia dwa i test kłamie."""
    execute("DELETE FROM workers")


def test_dopasowanie_po_nazwie_bez_nipu(db):
    _czysta_kartoteka()
    _worker("w1", "VADYM")
    assert match_worker_by_name("vadym", "")["workerId"] == "w1"
    assert match_worker_by_name("  VADYM ", "")["workerId"] == "w1"


def test_nip_wyklucza_dopasowanie(db):
    """Firma ma NIP — nawet gdy nazywa się jak pracownik, to nie on."""
    _czysta_kartoteka()
    _worker("w1", "VADYM")
    assert match_worker_by_name("VADYM", "5130201509") is None


def test_zarchiwizowany_nie_lapie_sie(db):
    _czysta_kartoteka()
    _worker("w1", "VADYM")
    execute("UPDATE workers SET active=false WHERE id='w1'")
    assert match_worker_by_name("VADYM", "") is None


def test_dwoch_o_tej_samej_nazwie_to_brak_dopasowania(db):
    _czysta_kartoteka()
    _worker("w1", "VADYM")
    execute(
        "INSERT INTO workers (id, name, role, active) "
        "VALUES ('w2','VADYM','WORKER_GENERAL',true)"
    )
    assert match_worker_by_name("VADYM", "") is None


# ── Rozliczenie zbiorcze ──────────────────────────────────────────────

def test_podglad_zbiorczy_nie_zapisuje_nic(db):
    """Zanim biuro rozliczy całą brygadę jednym kliknięciem, musi zobaczyć,
    co się wydarzy — podgląd nie może niczego zapisać."""
    execute("DELETE FROM workers")
    _worker("w1", "VADYM")
    _deb_day("w1", "2026-08-03", 1000)

    plan = bulk_settle("WORKER_DEBONING", "2026-08-03", "2026-08-09", dry_run=True)
    assert plan["workers"][0]["workerName"] == "VADYM"
    assert plan["workers"][0]["days"] == 1
    assert plan["totalNet"] == 550.0
    assert query_all("SELECT 1 FROM payroll_settlements") == []


def test_rozliczenie_zbiorcze_tworzy_paski_calej_grupie(db):
    execute("DELETE FROM workers")
    _worker("w1", "VADYM")
    _worker("w2", "DENYS")
    _deb_day("w1", "2026-08-03", 1000)
    _deb_day("w2", "2026-08-03", 2000)

    res = bulk_settle("WORKER_DEBONING", "2026-08-03", "2026-08-09", dry_run=False)
    assert res["settled"] == 2
    assert res["totalNet"] == 550.0 + 1100.0
    assert len(query_all("SELECT 1 FROM payroll_settlements")) == 2


def test_zbiorcze_pomija_bez_dni_i_juz_rozliczonych(db):
    execute("DELETE FROM workers")
    _worker("w1", "VADYM")
    _worker("w2", "DENYS")          # bez wpisów
    _deb_day("w1", "2026-08-03", 1000)
    bulk_settle("WORKER_DEBONING", "2026-08-03", "2026-08-09", dry_run=False)

    drugi = bulk_settle("WORKER_DEBONING", "2026-08-03", "2026-08-09", dry_run=False)
    assert drugi["settled"] == 0, "drugie kliknięcie nie może zdublować wypłat"
    assert len(query_all("SELECT 1 FROM payroll_settlements")) == 1


def test_zbiorcze_zabiera_potracenia_z_zakresu(db):
    execute("DELETE FROM workers")
    _worker("w1", "VADYM")
    _deb_day("w1", "2026-08-03", 1000)
    _ded(deduction_date="2026-08-04", description="Zakup", amount=56.0)

    res = bulk_settle("WORKER_DEBONING", "2026-08-03", "2026-08-09", dry_run=False)
    assert res["totalNet"] == 494.0
    assert list_worker_deductions("w1") == []


def test_zbiorcze_pomija_dzien_otwarty(db):
    """Niedomknięta zmiana weszłaby jako 0 h — pracownik dostałby za mało."""
    execute("DELETE FROM workers")
    _gen(wid="wg", name="ADRIAN", rate=25.0)
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-03",
                              time_from="6:00", time_to="15:00"))
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-04",
                              time_from="6:00"))          # otwarta

    res = bulk_settle("WORKER_GENERAL", "2026-08-03", "2026-08-09", dry_run=False)
    assert res["settled"] == 1
    assert res["workers"][0]["days"] == 1, "dzień otwarty zostaje na później"
    assert res["totalNet"] == 225.0


# ── Uznania (odwrotność potrącenia) ───────────────────────────────────

def _credit(**kw):
    base = dict(worker_id="w1", deduction_date="2026-08-03",
                description="Dodatek", amount=200.0, kind="credit")
    base.update(kw)
    return create_worker_deduction(WorkerDeductionDto(**base))


def test_uznanie_dokłada_do_wyplaty(db):
    """Uznanie działa jak potrącenie, tylko w drugą stronę."""
    _worker()
    c = _credit(amount=200.0)
    s = _settle(deduction_ids=[c["id"]])

    assert float(s["gross_amount"]) == 550.0
    assert float(s["net_amount"]) == 750.0, "uznanie ma DODAĆ, nie odjąć"
    assert float(s["deductions_total"]) == -200.0


def test_uznanie_i_potracenie_razem(db):
    _worker()
    d = _ded(description="Zaliczka", amount=100.0)
    c = _credit(description="Zwrot za paliwo", amount=30.0)
    s = _settle(deduction_ids=[d["id"], c["id"]])

    assert float(s["net_amount"]) == 550.0 - 100.0 + 30.0


def test_uznanie_wraca_do_kolejki_po_cofnieciu(db):
    _worker()
    c = _credit()
    s = _settle(deduction_ids=[c["id"]])
    undo_settlement(s["id"])

    rows = list_worker_deductions("w1")
    assert [r["kind"] for r in rows] == ["credit"]


def test_zbiorcze_uwzglednia_uznania(db):
    execute("DELETE FROM workers")
    _worker("w1", "VADYM")
    _deb_day("w1", "2026-08-03", 1000)
    _credit(amount=200.0)

    res = bulk_settle("WORKER_DEBONING", "2026-08-03", "2026-08-09", dry_run=False)
    assert res["totalNet"] == 750.0


# ── Zerowa stawka jest dozwolona ──────────────────────────────────────

def test_zbiorcze_rozlicza_takze_przy_zerowej_stawce(db):
    """Decyzja produktowa: stawkę zna tylko szef, a pasek ma pokazać
    pracownikowi PRZEPRACOWANE GODZINY. Zerowa stawka nie może blokować
    rozliczenia ani chować pracownika z listy."""
    execute("DELETE FROM workers")
    _gen(wid="wg", name="IWONA", rate=0.0)
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-03",
                              time_from="6:00", time_to="15:00"))

    plan = bulk_settle("WORKER_GENERAL", "2026-08-03", "2026-08-09", dry_run=True)
    assert [w["workerName"] for w in plan["workers"]] == ["IWONA"]
    assert plan["workers"][0]["units"] == 9.0

    done = bulk_settle("WORKER_GENERAL", "2026-08-03", "2026-08-09", dry_run=False)
    assert done["settled"] == 1
    s = query_one("SELECT hours_total, gross_amount FROM payroll_settlements "
                  "WHERE worker_id='wg'")
    assert float(s["hours_total"]) == 9.0, "godziny na pasku muszą być"
    assert float(s["gross_amount"]) == 0.0


# ── Premia sobotnia ───────────────────────────────────────────────────

def _gen2(wid="wg", name="ADRIAN", rate=25.0, sat=0.0, sun=0.0,
          pay_mode="hourly", rate_day=0.0):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, pay_mode, rate_per_day,"
        " sunday_bonus_enabled, sunday_bonus_per_hour,"
        " saturday_bonus_enabled, saturday_bonus_per_hour, active)"
        " VALUES (%s,%s,'WORKER_GENERAL',%s,%s,%s,%s,%s,%s,%s,true)"
        " ON CONFLICT (id) DO UPDATE SET role='WORKER_GENERAL', active=true,"
        " rate_per_hour=EXCLUDED.rate_per_hour, pay_mode=EXCLUDED.pay_mode,"
        " rate_per_day=EXCLUDED.rate_per_day,"
        " sunday_bonus_enabled=EXCLUDED.sunday_bonus_enabled,"
        " sunday_bonus_per_hour=EXCLUDED.sunday_bonus_per_hour,"
        " saturday_bonus_enabled=EXCLUDED.saturday_bonus_enabled,"
        " saturday_bonus_per_hour=EXCLUDED.saturday_bonus_per_hour",
        (wid, name, rate, pay_mode, rate_day, sun > 0, sun, sat > 0, sat),
    )


def test_premia_sobotnia_tylko_za_sobote(db):
    """8.08.2026 to sobota, 9.08 niedziela, 3.08 poniedziałek.
    8×25 + 8×25+8×4 (sob) + 8×25+8×6 (nd) = 600 + 32 + 48 = 680."""
    _gen2(rate=25.0, sat=4.0, sun=6.0)
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-03", "2026-08-08", "2026-08-09"],
        hours_per_date={"2026-08-03": 8.0, "2026-08-08": 8.0, "2026-08-09": 8.0},
        rate_per_kg=0, rate_per_hour=25.0))

    assert float(s["saturday_hours"]) == 8.0
    assert float(s["sunday_hours"]) == 8.0
    assert float(s["gross_amount"]) == 680.0
    import json as _j
    det = s["work_dates_detail"]
    det = _j.loads(det) if isinstance(det, str) else det
    flags = {d["work_date"]: (d["saturday"], d["sunday"]) for d in det}
    assert flags["2026-08-08"] == (True, False)
    assert flags["2026-08-09"] == (False, True)
    assert flags["2026-08-03"] == (False, False)


def test_premia_sobotnia_niezalezna_od_niedzielnej(db):
    """Sama sobota włączona — niedziela ma iść po stawce podstawowej."""
    _gen2(rate=25.0, sat=5.0, sun=0.0)
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-08", "2026-08-09"],
        hours_per_date={"2026-08-08": 10.0, "2026-08-09": 10.0},
        rate_per_kg=0, rate_per_hour=25.0))

    assert float(s["saturday_hours"]) == 10.0
    assert float(s["sunday_bonus_per_hour"]) == 0
    assert float(s["gross_amount"]) == 20 * 25 + 10 * 5


# ── Dniówka (myjący: 150 zł za dzień obecności) ───────────────────────

def test_dniowka_placi_za_dni_obecnosci(db):
    _gen2(wid="wd", name="MYJACY", rate=0.0, pay_mode="daily", rate_day=150.0)
    for d in ("2026-08-03", "2026-08-04", "2026-08-05"):
        upsert_hours(WorkHoursDto(worker_id="wd", work_date=d, status="work"))

    days = get_worker_days("wd", "2026-08-03", "2026-08-09")
    assert len(days) == 3
    assert all(d["present"] is True and d["open"] is False for d in days)

    s = create_settlement(CreateSettlementDto(
        worker_id="wd", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-03", "2026-08-04", "2026-08-05"],
        days_per_date={"2026-08-03": 1, "2026-08-04": 1, "2026-08-05": 1},
        rate_per_kg=0, rate_per_day=150.0))

    assert s["basis"] == "daily"
    assert float(s["days_total"]) == 3
    assert float(s["gross_amount"]) == 450.0
    assert float(s["hours_total"]) == 0


def test_dniowka_nie_wymaga_godzin(db):
    """Myjący nie ma godzin — wpis bez czasów NIE może być 'otwarty',
    bo wtedy nigdy nie dałoby się go rozliczyć."""
    _gen2(wid="wd", name="MYJACY", pay_mode="daily", rate_day=150.0)
    upsert_hours(WorkHoursDto(worker_id="wd", work_date="2026-08-03", status="work"))
    day = get_worker_days("wd", "2026-08-03", "2026-08-09")[0]
    assert day["open"] is False


def test_dniowka_nieobecnosc_nie_placi(db):
    _gen2(wid="wd", name="MYJACY", pay_mode="daily", rate_day=150.0)
    upsert_hours(WorkHoursDto(worker_id="wd", work_date="2026-08-03", status="work"))
    upsert_hours(WorkHoursDto(worker_id="wd", work_date="2026-08-04", status="off"))

    res = bulk_settle("WORKER_GENERAL", "2026-08-03", "2026-08-09", dry_run=True)
    mine = [w for w in res["workers"] if w["workerName"] == "MYJACY"][0]
    assert mine["days"] == 1
    assert mine["unit"] == "dni"
    assert mine["gross"] == 150.0


def test_zbiorcze_rozlicza_dniowkowca(db):
    execute("DELETE FROM workers")
    _gen2(wid="wd", name="MYJACY", pay_mode="daily", rate_day=150.0)
    for d in ("2026-08-03", "2026-08-04"):
        upsert_hours(WorkHoursDto(worker_id="wd", work_date=d, status="work"))

    res = bulk_settle("WORKER_GENERAL", "2026-08-03", "2026-08-09", dry_run=False)
    assert res["settled"] == 1
    assert res["totalNet"] == 300.0
