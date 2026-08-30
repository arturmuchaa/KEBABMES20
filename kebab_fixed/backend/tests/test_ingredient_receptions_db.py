"""Przyjęcie DDFiP — przyprawy, dodatki, opakowania (instrukcja 1.3 oPRP).

Osobna ścieżka od surowca pochodzenia zwierzęcego, bo księga tak ją prowadzi:
własna instrukcja 1.3, własna karta 1.3.1 i własna seria numerów „DF/1/08"
(litera odróżnia ją od numeru przyjęcia mięsa „1/08").

Najważniejsza różnica wobec przyjęcia surowca: dostawę ODRZUCONĄ też się
rejestruje. Instrukcja mówi wprost — „Pomimo braku fizycznego przyjęcia (…)
należy takie zdarzenie zarejestrować w karcie przyjęcia, gdyż posłużyć ono
może w przyszłości do oceny dostawców".
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.ingredients import IngredientReceptionCreate
from app.services.ingredients_service import (
    create_ingredient_reception,
    get_ingredient_reception,
    list_ingredient_receptions,
    next_ddfip_number,
)
from app.utils.ids import cuid, now_iso


def _seed():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup-berg','BERG','BERG PRZYPRAWY','5130064481',true,%s) "
            "ON CONFLICT (id) DO NOTHING", (now_iso(),))
    for iid, name, unit, cat in [
        ("ing-sol",    "Sól",            "kg", "other"),
        ("ing-mix",    "Mieszanka KEBAB", "kg", "spice_mix"),
        ("ing-folia",  "Folia stretch",  "szt", "other"),
    ]:
        execute("INSERT INTO ingredients (id, code, name, unit, is_unlimited, "
                "category, active, created_at) VALUES (%s,%s,%s,%s,false,%s,true,%s) "
                "ON CONFLICT (id) DO NOTHING", (iid, iid.upper(), name, unit, cat, now_iso()))


def _dto(**kw):
    base = dict(
        receivedDate="2026-08-30",
        supplierId="sup-berg",
        documentNo="FV 123/2026",
        doneBy="Anna",
        lines=[
            dict(ingredientId="ing-mix", qty=50.0, batchNo="L2026/08",
                 expiryDate="2027-08-01", pricePerUnit=12.5),
            dict(ingredientId="ing-sol", qty=25.0, batchNo="S-77",
                 expiryDate="2028-01-01", pricePerUnit=2.0),
        ],
    )
    base.update(kw)
    return IngredientReceptionCreate.model_validate(base)


class TestNumeracja:
    def test_pierwsza_dostawa_miesiaca_to_DF_1(self, db):
        _seed()
        out = create_ingredient_reception(_dto())
        assert out["reception"]["reception_no"] == "DF/1/08"

    def test_numer_rosnie_w_miesiacu_i_resetuje_z_nowym(self, db):
        _seed()
        assert create_ingredient_reception(_dto())["reception"]["reception_no"] == "DF/1/08"
        assert create_ingredient_reception(_dto())["reception"]["reception_no"] == "DF/2/08"
        wrzesien = create_ingredient_reception(_dto(receivedDate="2026-09-02"))
        assert wrzesien["reception"]["reception_no"] == "DF/1/09"

    def test_seria_ddfip_nie_zderza_sie_z_seria_miesa(self, db):
        # Numer przyjęcia mięsa to „1/08". Gdyby obie serie dzieliły licznik,
        # karta 1.3.1 zaczynałaby się od numeru zależnego od dostaw wołowiny.
        _seed()
        assert create_ingredient_reception(_dto())["reception"]["reception_seq"] == 1

    def test_numer_mozna_wpisac_recznie(self, db):
        _seed()
        out = create_ingredient_reception(_dto(receptionNo="DF/7/08"))
        assert out["reception"]["reception_no"] == "DF/7/08"
        # Kolejny auto-numer nie może cofnąć się pod wystawiony ręcznie.
        assert create_ingredient_reception(_dto())["reception"]["reception_no"] == "DF/8/08"

    def test_duplikat_numeru_odrzucony(self, db):
        _seed()
        create_ingredient_reception(_dto(receptionNo="DF/3/08"))
        with pytest.raises(HTTPException) as exc:
            create_ingredient_reception(_dto(receptionNo="DF/3/08"))
        assert exc.value.status_code == 409

    def test_podpowiedz_numeru_nie_rezerwuje(self, db):
        _seed()
        assert next_ddfip_number("2026-08-30")["nextNo"] == "DF/1/08"
        assert next_ddfip_number("2026-08-30")["nextNo"] == "DF/1/08"
        create_ingredient_reception(_dto())
        assert next_ddfip_number("2026-08-30")["nextNo"] == "DF/2/08"

    def test_numer_musi_miec_litere(self, db):
        _seed()
        with pytest.raises(HTTPException):
            create_ingredient_reception(_dto(receptionNo="3/08"))

    def test_miesiac_numeru_musi_zgadzac_sie_z_data(self, db):
        _seed()
        with pytest.raises(HTTPException):
            create_ingredient_reception(_dto(receptionNo="DF/1/07"))


class TestDostawaPrzyjeta:
    def test_pozycje_ladują_na_magazynie_przypraw(self, db):
        _seed()
        out = create_ingredient_reception(_dto())
        loty = query_all("SELECT * FROM ingredient_stock WHERE reception_id=%s "
                         "ORDER BY ingredient_id", (out["reception"]["id"],))
        assert [float(l["qty_available"]) for l in loty] == [50.0, 25.0]
        assert [l["batch_no"] for l in loty] == ["L2026/08", "S-77"]

    def test_lot_pamieta_dostawce_i_dokument(self, db):
        # Bez tego nie da się odtworzyć, od kogo przyszła partia przyprawy —
        # instrukcja 1.3 wymienia „brak identyfikowalności partii" jako zagrożenie.
        _seed()
        out = create_ingredient_reception(_dto())
        lot = query_one("SELECT * FROM ingredient_stock WHERE reception_id=%s LIMIT 1",
                        (out["reception"]["id"],))
        assert lot["supplier_id"] == "sup-berg"
        assert lot["invoice_no"] == "FV 123/2026"

    def test_przyjecie_zostawia_ruch_magazynowy(self, db):
        _seed()
        out = create_ingredient_reception(_dto())
        lot = query_one("SELECT id FROM ingredient_stock WHERE reception_id=%s LIMIT 1",
                        (out["reception"]["id"],))
        ruch = query_one("SELECT * FROM stock_movements WHERE batch_id=%s", (lot["id"],))
        assert ruch is not None and ruch["movement_type"] == "IN"

    def test_asortyment_skladany_z_pozycji(self, db):
        # Kolumna (c) karty 1.3.1. Instrukcja dopuszcza nazwę potoczną, więc
        # bierzemy nazwy składników tak, jak stoją w kartotece.
        _seed()
        out = create_ingredient_reception(_dto())
        assert out["reception"]["assortment"] == "Mieszanka KEBAB, Sól"

    def test_asortyment_bez_powtorzen(self, db):
        _seed()
        out = create_ingredient_reception(_dto(lines=[
            dict(ingredientId="ing-sol", qty=10.0, batchNo="A"),
            dict(ingredientId="ing-sol", qty=15.0, batchNo="B"),
        ]))
        assert out["reception"]["assortment"] == "Sól"
        # …ale DWA loty, bo to dwie różne partie dostawcy.
        loty = query_all("SELECT * FROM ingredient_stock WHERE reception_id=%s",
                         (out["reception"]["id"],))
        assert len(loty) == 2


class TestDostawaOdrzucona:
    """Ocena N: nic nie wchodzi na magazyn, ale wpis w rejestrze zostaje."""

    def test_odrzucona_nie_tworzy_lotow(self, db):
        _seed()
        out = create_ingredient_reception(_dto(decision="N", visualCheck="N",
                                               notes="Rozerwane worki"))
        assert query_all("SELECT * FROM ingredient_stock WHERE reception_id=%s",
                         (out["reception"]["id"],)) == []

    def test_odrzucona_nie_rusza_stanu_magazynu(self, db):
        _seed()
        create_ingredient_reception(_dto(decision="N"))
        assert query_all("SELECT * FROM ingredient_stock") == []

    def test_odrzucona_zostaje_w_rejestrze_z_asortymentem_i_powodem(self, db):
        # To jest cały sens rejestrowania odmowy — ocena dostawców.
        _seed()
        create_ingredient_reception(_dto(decision="N", visualCheck="N",
                                         notes="Rozerwane worki"))
        rej = list_ingredient_receptions()
        assert len(rej) == 1
        assert rej[0]["decision"] == "N"
        assert rej[0]["assortment"] == "Mieszanka KEBAB, Sól"
        assert rej[0]["notes"] == "Rozerwane worki"

    def test_odrzucona_zjada_numer_z_serii(self, db):
        # Odmowa to zdarzenie, nie pomyłka pisarska — numer jest zużyty.
        _seed()
        create_ingredient_reception(_dto(decision="N"))
        assert create_ingredient_reception(_dto())["reception"]["reception_no"] == "DF/2/08"


class TestWalidacja:
    def test_dostawca_musi_byc_z_kartoteki(self, db):
        # Instrukcja 1.3: „weryfikacja czy dostawca znajduje się na liście
        # zakwalifikowanych przez zakład podmiotów".
        _seed()
        with pytest.raises(HTTPException) as exc:
            create_ingredient_reception(_dto(supplierId="kogo-nie-ma"))
        assert exc.value.status_code == 400

    def test_dostawa_przyjeta_musi_miec_pozycje(self, db):
        _seed()
        with pytest.raises(HTTPException):
            create_ingredient_reception(_dto(lines=[]))

    def test_odrzucona_tez_musi_powiedziec_czego_dotyczyla(self, db):
        _seed()
        with pytest.raises(HTTPException):
            create_ingredient_reception(_dto(decision="N", lines=[]))

    def test_nieznana_ocena_odrzucona(self, db):
        _seed()
        with pytest.raises(HTTPException):
            create_ingredient_reception(_dto(decision="X"))


class TestRejestr:
    def test_rejestr_daje_pozycje_pod_dokumentem(self, db):
        _seed()
        create_ingredient_reception(_dto())
        [rec] = list_ingredient_receptions()
        assert [l["ingredient_name"] for l in rec["lines"]] == ["Mieszanka KEBAB", "Sól"]

    def test_rejestr_filtruje_po_miesiacu_karty(self, db):
        _seed()
        create_ingredient_reception(_dto())
        create_ingredient_reception(_dto(receivedDate="2026-09-02"))
        sierpien = list_ingredient_receptions(date_from="2026-08-01", date_to="2026-08-31")
        assert [r["reception_no"] for r in sierpien] == ["DF/1/08"]

    def test_rejestr_sortuje_po_DACIE_dostawy_nie_po_numerze(self, db):
        # Numer idzie kolejnością WPISYWANIA, a biuro szuka po tym, co
        # przyjechało ostatnio. Dokument DF/2/08 wpisany później, ale z datą
        # wcześniejszą, ma stać NIŻEJ.
        _seed()
        create_ingredient_reception(_dto(receivedDate="2026-08-30"))   # DF/1/08
        create_ingredient_reception(_dto(receivedDate="2026-08-12"))   # DF/2/08
        assert [r["reception_no"] for r in list_ingredient_receptions()] == ["DF/1/08", "DF/2/08"]

    def test_w_obrebie_jednego_dnia_najnowszy_numer_na_gorze(self, db):
        _seed()
        create_ingredient_reception(_dto(receivedDate="2026-08-30"))   # DF/1/08
        create_ingredient_reception(_dto(receivedDate="2026-08-30"))   # DF/2/08
        assert [r["reception_no"] for r in list_ingredient_receptions()] == ["DF/2/08", "DF/1/08"]


class TestOpakowania:
    """Karta 1.3.1 nazywa się „Rejestr przyjęcia OPAKOWAŃ, przypraw i dodatków
    technologicznych" — folia i tuleje należą do niej tak samo jak przyprawa.

    Idą jednak na INNY magazyn: `packaging`, który nie jest lotowy (pozycje
    scalają się po nazwie). Dlatego pozycję WYBIERA się z magazynu, a nie
    wpisuje z ręki: literówka nie podniosłaby alarmu, tylko po cichu
    założyła drugi wiersz i rozbiła stan na dwa. Ślad po konkretnej dostawie
    zostaje w wierszu dokumentu.
    """

    def _folia(self, nazwa="Folia stretch 500", stan=0.0):
        """Pozycja magazynu założona WCZEŚNIEJ — tak, jak robi to biuro."""
        pid = cuid()
        execute("INSERT INTO packaging (id, code, name, type, unit, kg_initial, "
                "kg_available, kg_used, created_at) "
                "VALUES (%s,%s,%s,'opakowanie','szt',%s,%s,0,%s)",
                (pid, f"PAK-{pid[:4]}", nazwa, stan, stan, now_iso()))
        return pid

    def _dto_folia(self, packaging_id, **kw):
        base = dict(
            receivedDate="2026-08-30",
            supplierId="sup-berg",
            documentNo="FV 900/2026",
            lines=[dict(kind="packaging", packagingId=packaging_id, qty=120.0,
                        batchNo="F-1", expiryDate="2029-01-01")],
        )
        base.update(kw)
        return IngredientReceptionCreate.model_validate(base)

    def test_dostawa_doklada_do_wybranej_pozycji(self, db):
        _seed()
        pid = self._folia(stan=50.0)
        create_ingredient_reception(self._dto_folia(pid))
        pkg = query_one("SELECT * FROM packaging WHERE id=%s", (pid,))
        assert pkg["kg_available"] == 170.0

    def test_druga_dostawa_nie_robi_drugiej_pozycji(self, db):
        _seed()
        pid = self._folia()
        create_ingredient_reception(self._dto_folia(pid))
        create_ingredient_reception(self._dto_folia(pid, lines=[
            dict(kind="packaging", packagingId=pid, qty=80.0),
        ]))
        pozycje = query_all("SELECT * FROM packaging WHERE LOWER(name)=LOWER('Folia stretch 500')")
        assert len(pozycje) == 1, "magazyn opakowań scala po nazwie, nie robi lotów"
        assert pozycje[0]["kg_available"] == 200.0

    def test_wiersz_dokumentu_pamieta_partie_i_termin_z_TEJ_dostawy(self, db):
        _seed()
        pid = self._folia()
        out = create_ingredient_reception(self._dto_folia(pid))
        wiersz = query_one("SELECT * FROM ingredient_reception_packaging "
                           "WHERE reception_id=%s", (out["reception"]["id"],))
        assert wiersz["packaging_name"] == "Folia stretch 500"
        assert wiersz["qty"] == 120.0
        assert wiersz["batch_no"] == "F-1"
        assert wiersz["expiry_date"] == "2029-01-01"

    def test_ruch_magazynowy_wskazuje_na_dokument_nie_na_dostawce(self, db):
        _seed()
        pid = self._folia()
        out = create_ingredient_reception(self._dto_folia(pid))
        ruchy = query_all(
            "SELECT * FROM stock_movements WHERE product_type='packaging' "
            "AND source_type='ingredient_reception' AND source_id=%s",
            (out["reception"]["id"],))
        assert len(ruchy) == 1
        assert ruchy[0]["movement_type"] == "IN"
        assert ruchy[0]["qty"] == 120.0

    def test_jedno_auto_moze_przywiezc_przyprawe_I_folie(self, db):
        _seed()
        pid = self._folia("Karton 5 kg")
        out = create_ingredient_reception(_dto(lines=[
            dict(ingredientId="ing-mix", qty=50.0, batchNo="L1"),
            dict(kind="packaging", packagingId=pid, qty=300.0),
        ]))
        assert out["reception"]["assortment"] == "Mieszanka KEBAB, Karton 5 kg"
        assert sorted(l["kind"] for l in out["lines"]) == ["ingredient", "packaging"]
        # Każda pozycja na SWOIM magazynie — przyprawa nie ląduje w opakowaniach.
        assert query_one("SELECT count(*) c FROM ingredient_stock "
                         "WHERE reception_id=%s", (out["reception"]["id"],))["c"] == 1
        assert query_one("SELECT kg_available FROM packaging "
                         "WHERE id=%s", (pid,))["kg_available"] == 300.0

    def test_odmowa_nie_doklada_opakowan_do_magazynu(self, db):
        _seed()
        pid = self._folia(stan=10.0)
        create_ingredient_reception(self._dto_folia(pid, decision="N",
                                                   notes="uszkodzona paleta"))
        assert query_one("SELECT kg_available FROM packaging WHERE id=%s",
                         (pid,))["kg_available"] == 10.0
        assert query_all("SELECT * FROM ingredient_reception_packaging") == []

    def test_opakowania_NIE_da_sie_wpisac_z_reki(self, db):
        _seed()
        with pytest.raises(HTTPException) as e:
            create_ingredient_reception(self._dto_folia("", lines=[
                dict(kind="packaging", qty=10.0),
            ]))
        assert e.value.status_code == 400
        # Komunikat ma prowadzić tam, gdzie pozycję się zakłada.
        assert "Magazynie tulei" in e.value.detail

    def test_nieznane_opakowanie_zatrzymuje_CALY_dokument(self, db):
        _seed()
        with pytest.raises(HTTPException):
            create_ingredient_reception(_dto(lines=[
                dict(ingredientId="ing-mix", qty=50.0),
                dict(kind="packaging", packagingId="nie-ma-takiego", qty=10.0),
            ]))
        # Nic z tego auta nie weszło — ani przyprawa, ani numer z serii.
        assert query_all("SELECT * FROM ingredient_receptions") == []
        assert query_all("SELECT * FROM ingredient_stock") == []

    def test_dokument_oddaje_obie_pozycje_pod_etykiety(self, db):
        _seed()
        pid = self._folia("Tuleja 60")
        out = create_ingredient_reception(_dto(lines=[
            dict(ingredientId="ing-sol", qty=25.0, batchNo="S-77"),
            dict(kind="packaging", packagingId=pid, qty=500.0, batchNo="T-9"),
        ]))
        doc = get_ingredient_reception(out["reception"]["id"])
        assert [l["ingredient_name"] for l in doc["lines"]] == ["Sól", "Tuleja 60"]
        assert [l["kind"] for l in doc["lines"]] == ["ingredient", "packaging"]
        assert [l["unit"] for l in doc["lines"]] == ["kg", "szt"]
