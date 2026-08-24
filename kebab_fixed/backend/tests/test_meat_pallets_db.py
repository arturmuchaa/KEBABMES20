"""Ważenie zbiorcze mięsa: paleta to OPIS, nie ruch magazynowy.

Mięso jest na stanie od rozbioru — ten ekran tylko zapisuje, co na czym leży,
żeby operator masowania wiedział, co zabiera do masownicy.
Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import query_all, query_one
from app.models.meat_pallets import MeatPalletCreate
from app.services.meat_pallets_service import create_pallet, get_pallet


def _dto(**over):
    baza = {
        "targetKg": 600, "stackKg": None, "kgNet": 600, "containers": 30,
        "carrierLabel": "H1", "carrierKg": 18, "operator": "ANATOLII",
        "productionDate": "2026-08-14", "expiryDate": "2026-08-19",
        "lots": [{"lotNo": "475", "kg": 420}, {"lotNo": "476", "kg": 180}],
    }
    baza.update(over)
    return MeatPalletCreate.model_validate(baza)


def test_zapis_palety_ze_skladem(db):
    out = create_pallet(_dto())

    assert out["pallet_no"].startswith("PAL/14/08/26")
    lots = query_all(
        "SELECT lot_no, kg FROM meat_pallet_lots WHERE pallet_id=%s ORDER BY seq",
        (out["id"],))
    assert [(l["lot_no"], float(l["kg"])) for l in lots] == [("475", 420.0), ("476", 180.0)]


def test_numer_palety_rosnie_w_obrebie_dnia(db):
    """Numeracja jak sesje rozbioru: pierwsza dziś bez indeksu, kolejne /2, /3."""
    a = create_pallet(_dto())
    b = create_pallet(_dto())
    assert a["pallet_no"] == "PAL/14/08/26"
    assert b["pallet_no"] == "PAL/14/08/26/2"


def test_suma_skladu_musi_sie_zgadzac_z_waga(db):
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(lots=[{"lotNo": "475", "kg": 100}]))
    assert err.value.status_code == 400
    assert query_one("SELECT COUNT(*) AS n FROM meat_pallets")["n"] == 0


def test_paleta_NIE_rusza_stanu_magazynowego(db):
    """Regresja: to ma być wyłącznie opis. Każdy ruch tutaj byłby podwójnym
    księgowaniem mięsa, które jest na stanie już od rozbioru."""
    create_pallet(_dto())
    assert query_one("SELECT COUNT(*) AS n FROM stock_movements")["n"] == 0


def test_odczyt_po_numerze_do_dodruku(db):
    out = create_pallet(_dto())
    rec = get_pallet(out["pallet_no"])
    assert float(rec["kg_net"]) == 600.0
    assert [l["lot_no"] for l in rec["lots"]] == ["475", "476"]


def test_nieznana_paleta_daje_404(db):
    with pytest.raises(HTTPException) as err:
        get_pallet("PAL/01/01/26/9")
    assert err.value.status_code == 404


def test_paleta_bez_skladu_nie_przechodzi(db):
    """Etykieta bez partii nie mówi masowni nic — a po to ten ekran jest."""
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(lots=[]))
    assert err.value.status_code == 400


# ── Strażnik partii ───────────────────────────────────────────────────────────
#
# Ważenie zbiorcze nie rusza stanu magazynowego, więc do 2026-08-14 nic nie
# pilnowało, ile z danej partii już zeszło na palety: z partii o wydajności
# 2 353 kg dało się zważyć 10 ton. Limitem jest wydajność partii z rozbioru.

def _lot(lot_no: str, kg_initial: float):
    from app.db import execute
    execute(
        "INSERT INTO meat_stock (id, lot_no, kg_initial, kg_available, created_at) "
        "VALUES (%s,%s,%s,%s, now())",
        (f"ms-{lot_no}", lot_no, kg_initial, kg_initial),
    )


def test_paleta_ponad_wydajnosc_partii_odrzucona(db):
    _lot("475", 300.0)
    _lot("476", 300.0)
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto())          # 420 kg z partii 475, która dała 300
    assert "475" in err.value.detail
    assert "kolejnej partii" in err.value.detail


def test_druga_paleta_liczy_to_co_juz_zwazono(db):
    """Limit jest kumulatywny — inaczej każda kolejna paleta startowałaby
    od pełnej wydajności partii."""
    _lot("475", 500.0)
    _lot("476", 500.0)
    create_pallet(_dto(kgNet=600, lots=[{"lotNo": "475", "kg": 420},
                                        {"lotNo": "476", "kg": 180}]))
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(kgNet=200, lots=[{"lotNo": "475", "kg": 200}]))
    assert "475" in err.value.detail          # zostało 80 kg, nie 500


def test_reszta_schodzi_na_kolejna_partie(db):
    """Scenariusz z hali: partia się kończy, ogon palety bierze następną."""
    _lot("475", 500.0)
    _lot("476", 500.0)
    create_pallet(_dto(kgNet=600, lots=[{"lotNo": "475", "kg": 420},
                                        {"lotNo": "476", "kg": 180}]))
    out = create_pallet(_dto(kgNet=200, lots=[{"lotNo": "475", "kg": 80},
                                              {"lotNo": "476", "kg": 120}]))
    assert out["pallet_no"].startswith("PAL/14/08/26")


def test_partia_spoza_magazynu_miesa_nie_blokuje(db):
    """Mięso przyjęte z zewnątrz i stare dane nie mają lotu z rozbioru —
    brak wiersza to brak wiedzy, nie zero kilogramów."""
    out = create_pallet(_dto())
    assert out["pallet_no"].startswith("PAL/14/08/26")


# ── Partia, z której NIC nie zważono ──────────────────────────────────────
#
# 24.08.2026 paleta PAL/24/08/26/19 zapisała się na partię 505, której ćwiartka
# była NIETKNIĘTA (4860 kg przyjęte, 4860 dostępne, zero mięsa w locie).
# Strażnik jej nie zatrzymał, bo brak lotu w magazynie mięsa traktował jako
# „nie wiem", a nie „zero" — reguła słuszna dla mięsa z zewnątrz, ale nie dla
# partii, która stoi w chłodni nierozebrana.

def _cwiartka(nr: str, kg: float = 4000.0, kg_available: float | None = None):
    from app.db import execute
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, kg_received, kg_available, status) "
        "VALUES (%s,%s,%s,%s,'active')",
        (f"rb-{nr}", nr, kg, kg if kg_available is None else kg_available),
    )


def test_paleta_z_partii_bez_zwazonego_miesa_odrzucona(db):
    """Ćwiartka jest, ale nikt jej nie rozebrał — mięsa fizycznie nie ma."""
    _cwiartka("505")
    with pytest.raises(HTTPException) as err:
        create_pallet(_dto(kgNet=100, lots=[{"lotNo": "505", "kg": 100}]))
    assert "505" in err.value.detail


def test_partia_w_trakcie_rozbioru_dalej_dziala(db):
    """Uszczelnienie nie może zablokować normalnej pracy: partia z lotem
    mięsa rozlicza się limitem jak dotąd."""
    _cwiartka("506")
    _lot("506", 500.0)
    out = create_pallet(_dto(kgNet=200, lots=[{"lotNo": "506", "kg": 200}]))
    assert out["pallet_no"].startswith("PAL/")


def test_mieso_spoza_magazynu_nadal_nie_jest_blokowane(db):
    """Numer, którego NIE MA wśród ćwiartek (mięso z zewnątrz, stare dane),
    zostaje brakiem wiedzy — blokowanie go zatrzymałoby legalne ważenia."""
    out = create_pallet(_dto(kgNet=100, lots=[{"lotNo": "ZEWN-1", "kg": 100}]))
    assert out["pallet_no"].startswith("PAL/")
