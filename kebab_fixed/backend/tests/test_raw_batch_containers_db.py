"""Przyjęcie surowca zasila saldo pojemników dostawcy."""
from app.db import execute, query_all, query_one, transaction
from app.models.raw_batches import RawBatchCreate, RawBatchUpdate
from app.services.container_ledger_service import partner_balance_cx
from app.services.container_partners_service import resolve_partner
from app.services.raw_batches_service import cancel_batch, create_batch, update_batch
from app.utils.ids import now_iso


def _bal(d, *keys):
    """Saldo zawężone do sprawdzanych nośników — od 2026-07-30 rodzajów jest
    siedem (siatka E1, europaleta…), więc porównywanie całego słownika
    psułoby testy przy każdym dodaniu rodzaju."""
    return {k: d[k] for k in (keys or ("e2", "pallet_h1", "pallet_other"))}



def _seed_supplier():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))


def _dto(**kw):
    base = dict(supplierId="sup1", supplierBatchNo="111634", kgReceived=6000.0,
                receivedDate="2026-07-29", slaughterDate="2026-07-28",
                expiryDate="2026-08-04", pricePerKg=5.0)
    base.update(kw)
    return RawBatchCreate.model_validate(base)


def _partner_id() -> str:
    with transaction() as conn:
        return resolve_partner(conn, "supplier", "sup1")


def test_kaliber_15_zapisuje_pojemniki_i_ksieguje_ruch(db):
    _seed_supplier()
    batch = create_batch(_dto(containerKg=15, palletsH1=10, palletsOther=2))
    row = query_one("SELECT container_kg, containers_count, pallets_h1, pallets_other "
                    "FROM raw_batches WHERE id=%s", (batch["id"],))
    assert row["containers_count"] == 400        # 6000 / 15
    assert row["pallets_h1"] == 10
    with transaction() as conn:
        assert _bal(partner_balance_cx(conn, _partner_id())) == {
            "e2": 400, "pallet_h1": 10, "pallet_other": 2}


def test_kaliber_20_liczy_mniej_pojemnikow(db):
    _seed_supplier()
    create_batch(_dto(containerKg=20))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 300


def test_niepelny_pojemnik_zaokraglany_w_gore(db):
    _seed_supplier()
    create_batch(_dto(kgReceived=6005.0, containerKg=15))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 401


def test_niekalibrowany_bierze_liczbe_od_operatora(db):
    _seed_supplier()
    b = create_batch(_dto(containerKg=None, containersCount=377))
    assert query_one("SELECT containers_count FROM raw_batches WHERE id=%s",
                     (b["id"],))["containers_count"] == 377
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 377


def test_reczna_liczba_wygrywa_z_wyliczeniem(db):
    _seed_supplier()
    create_batch(_dto(containerKg=15, containersCount=395))  # operator policzył fizycznie
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 395


def test_bez_kalibru_i_bez_liczby_nie_ma_ruchu(db):
    _seed_supplier()
    create_batch(_dto())
    assert query_all("SELECT id FROM container_movements") == []


def test_ruchy_startuja_jako_niepotwierdzone(db):
    _seed_supplier()
    create_batch(_dto(containerKg=15))
    rows = query_all("SELECT confirmed FROM container_movements WHERE asset_type='e2'")
    assert rows and all(not r["confirmed"] for r in rows)


def test_edycja_kg_przelicza_pojemniki_roznicowo(db):
    _seed_supplier()
    b = create_batch(_dto(containerKg=15))
    update_batch(b["id"], RawBatchUpdate.model_validate(
        {"kgReceived": 3000.0, "pricePerKg": 5.0, "containerKg": 15}))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 200
    qtys = [int(r["qty"]) for r in query_all(
        "SELECT qty FROM container_movements WHERE asset_type='e2' ORDER BY created_at, qty DESC")]
    assert qtys == [400, -200], "korekta dopisuje różnicę, nie nadpisuje"


def test_edycja_BEZ_pol_nosnikow_nie_zeruje_salda(db):
    """Regresja: EditRawBatchModal nie wysyła kalibru ani palet. Gdyby brak
    pola znaczył 'zero', każda edycja ceny kasowałaby saldo dostawcy."""
    _seed_supplier()
    b = create_batch(_dto(containerKg=15, palletsH1=10))
    update_batch(b["id"], RawBatchUpdate.model_validate(
        {"kgReceived": 6000.0, "pricePerKg": 7.5}))
    with transaction() as conn:
        assert _bal(partner_balance_cx(conn, _partner_id())) == {
            "e2": 400, "pallet_h1": 10, "pallet_other": 0}


def test_anulowanie_partii_zeruje_saldo(db):
    _seed_supplier()
    b = create_batch(_dto(containerKg=15, palletsH1=10))
    cancel_batch(b["id"])
    with transaction() as conn:
        assert _bal(partner_balance_cx(conn, _partner_id())) == {
            "e2": 0, "pallet_h1": 0, "pallet_other": 0}


# ── Rodzaje innych opakowań (2026-07-30) ─────────────────────────────
def test_siatka_e1_ma_wlasne_saldo(db):
    """Szumera przywiózł mięso w 91 pojemnikach E2 i 30 siatkach E1 —
    siatki nie mogą wpaść do wspólnego worka 'palety inne'."""
    _seed_supplier()
    create_batch(_dto(containersCount=91, palletsOther=30, palletsOtherKind="net_e1"))
    with transaction() as conn:
        bal = partner_balance_cx(conn, _partner_id())
    assert bal["e2"] == 91
    assert bal["net_e1"] == 30
    assert bal["pallet_other"] == 0, "siatki nie lądują w koszu"


def test_dwa_rodzaje_nie_sumuja_sie_ze_soba(db):
    _seed_supplier()
    create_batch(_dto(containersCount=91, palletsOther=30, palletsOtherKind="net_e1"))
    create_batch(_dto(containersCount=0, palletsOther=5, palletsOtherKind="pallet_euro"))
    with transaction() as conn:
        bal = partner_balance_cx(conn, _partner_id())
    assert bal["net_e1"] == 30 and bal["pallet_euro"] == 5


def test_brak_wyboru_rodzaju_ladu_je_w_koszu(db):
    _seed_supplier()
    create_batch(_dto(palletsOther=4))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["pallet_other"] == 4


def test_nieznany_rodzaj_nie_wysadza_zapisu(db):
    """Śmieciowa wartość z formularza nie może wywalić przyjęcia — ląduje
    w koszu, a operator poprawi to w kartotece."""
    _seed_supplier()
    create_batch(_dto(palletsOther=3, palletsOtherKind="krasnoludek"))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["pallet_other"] == 3
