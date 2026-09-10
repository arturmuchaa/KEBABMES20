"""Trasy podziału wysyłki — podgląd, zapis, komplet dokumentów, anulowanie.

Funkcje routera wołamy WPROST, nie przez `TestClient`: `auth_middleware`
(`app/main.py:59`) odcina surowe żądania i każdy taki test byłby czerwony na
401, a nie na tym, co sprawdza. Ten sam wzorzec co
`tests/test_containers_routes.py` — moduł trasy importujemy i wołamy jak
zwykły kod, a fixture `db` dokłada prawdziwą bazę tam, gdzie trasa realnie
zapisuje dokumenty.
"""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.models.cmr import CmrForm
from app.routes import cmr as cmr_route
from app.routes import hdi as hdi_route
from app.routes import order_split as route
from app.services import cmr_service, hdi_service, loading_service
from app.utils.zakres import sprawdz_zakres
from tests.conftest_split import _przygotuj_bez_podzialu, _przygotuj_z_podzialem


# ── Podgląd i zapis podziału ──────────────────────────────────────


def test_podglad_zwraca_tabele_podzialu(db):
    _przygotuj_bez_podzialu()
    out = route.podglad_podzialu("o1", route.CelPodzialu(cel_kg=300))
    assert out["kg_fv"] > 0
    assert len(out["lines"]) == 2


def test_podglad_niczego_nie_zapisuje(db):
    """Biuro ogląda tabelę zanim zatwierdzi — podgląd nie może ruszyć pozycji."""
    _przygotuj_bez_podzialu()
    route.podglad_podzialu("o1", route.CelPodzialu(cel_kg=300))
    assert query_one("SELECT qty_invoice FROM client_order_lines "
                     "WHERE id='o1-l1'")["qty_invoice"] is None


def test_zapis_podzialu(db):
    _przygotuj_bez_podzialu()
    out = route.zapisz_podzial("o1", route.ZapisPodzialu(cel_kg=300))
    assert out["kg_fv"] == 300.0
    assert query_one("SELECT qty_invoice FROM client_order_lines "
                     "WHERE id='o1-l1'")["qty_invoice"] == 11


def test_zapis_przepisuje_reczne_korekty_pozycji(db):
    """Klasa błędu z `test_wz_route_contract`: cienka trasa gubi pole z body.
    Bez `per_line` ręczna poprawka biura znika i podział wraca do wyliczenia."""
    _przygotuj_bez_podzialu()
    out = route.zapisz_podzial(
        "o1", route.ZapisPodzialu(cel_kg=300, per_line={"o1-l1": 4}))
    assert out["kg_fv"] == 125.0            # 4 szt. * 25 kg + 1 szt. * 25 kg


def test_czyszczenie_podzialu(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    route.wyczysc_podzial("o1")
    linie = query_all("SELECT qty_invoice FROM client_order_lines WHERE order_id='o1'")
    assert [l["qty_invoice"] for l in linie] == [None, None]


# ── Komplet dokumentów ────────────────────────────────────────────


def test_komplet_dokumentow_zwraca_numery(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    dane = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    assert dane["wm"]["number"].startswith("WM/")
    assert dane["wz"]["number"].startswith("WZ/")
    assert len(dane["cmr"]) == 2
    assert dane["hdi_calosc"]["number"]
    assert dane["hdi_fv"]["number"]


def test_komplet_daje_HDI_na_pelne_kilogramy_mimo_wczesniejszego_WM(db):
    """Same numery to za mało. W kolejności wymuszonej przez `split/documents`
    HDI powstaje PO WM, a WM zeruje `finished_goods.qty_available` — kandydatów
    do `stock_portions_for_order` trzeba wtedy odzyskać z kompensacji
    `wydane_wg_wiersza` (WZ z `source_type='order'`, a WM nim jest). Gdyby ta
    kompensacja przestała działać, komplet wyszedłby z HDI na 0 kg albo na
    ułamek towaru — i nikt by tego nie zauważył, bo numery się wystawią."""
    _przygotuj_z_podzialem(cel_kg=300.0)          # 800 kg całości, 300 na fakturę
    dane = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    assert float(dane["hdi_calosc"]["totals"]["kg"]) == 800.0
    assert float(dane["hdi_fv"]["totals"]["kg"]) == 300.0
    assert int(dane["hdi_calosc"]["totals"]["qty"]) == 32
    assert int(dane["hdi_fv"]["totals"]["qty"]) == 12


def test_komplet_bez_hdi_do_faktury(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    dane = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=False))
    assert dane["hdi_fv"] is None
    assert len(query_all("SELECT id FROM hdi_documents")) == 1


def test_komplet_dzieli_kilogramy_miedzy_dokumenty(db):
    _przygotuj_z_podzialem(cel_kg=300.0)          # 800 kg całości, 300 na fakturę
    dane = route.wystaw_komplet("o1", route.KompletDokumentow())
    assert dane["wm"]["kg"] == 800.0
    assert dane["wz"]["kg"] == 500.0
    assert dane["cmr"][0]["payload"]["gross_kg"] == 800.0
    assert dane["cmr"][1]["payload"]["gross_kg"] == 300.0


def test_komplet_buduje_oba_cmr_z_tego_samego_formularza(db):
    """Jeden kierowca, jedno auto, dwa listy — różni je WYŁĄCZNIE zakres."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    dane = route.wystaw_komplet(
        "o1", route.KompletDokumentow(cmr=CmrForm(plate="KR 12345")))
    assert [c["scope"] for c in dane["cmr"]] == ["calosc", "fv"]
    assert all(c["payload"]["carrier"]["plate"] == "KR 12345" for c in dane["cmr"])


def test_komplet_wpisuje_numery_HDI_w_zalaczniki_obu_CMR(db):
    """Ta sama klasa defektu co pusty numer rejestracyjny na drugim HDI:
    CMR cytuje w polu „załączniki" numer HDI SWOJEGO wariantu, a w kolejności
    z planu powstaje PRZED nim. Bez przeliczenia po HDI oba listy pojechałyby
    z kierowcą z pustym załącznikiem."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    dane = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    zalaczniki = [c["payload"]["attachments"]["hdi_number"] for c in dane["cmr"]]
    assert zalaczniki == [dane["hdi_calosc"]["number"], dane["hdi_fv"]["number"]]
    assert all(zalaczniki)


def test_komplet_rusza_magazyn_dokladnie_raz(db):
    """Reguła całego projektu: sześć papierów, JEDEN rozchód — z WM."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    dane = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    zrodla = {r["source_id"] for r in query_all(
        "SELECT source_id FROM stock_movements WHERE product_type='finished_goods'")}
    assert zrodla == {dane["wm"]["id"]}


def test_dwuklik_nie_pali_drugiego_numeru(db):
    """Jeden przycisk wystawia sześć dokumentów, a numer HDI raz nadany jest
    SPALONY — drugie kliknięcie nie ma prawa zrobić drugiego kompletu."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    a = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    b = route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    assert b["wm"]["number"] == a["wm"]["number"]
    assert b["wz"]["number"] == a["wz"]["number"]
    assert [c["number"] for c in b["cmr"]] == [c["number"] for c in a["cmr"]]
    assert b["hdi_calosc"]["number"] == a["hdi_calosc"]["number"]
    assert b["hdi_fv"]["number"] == a["hdi_fv"]["number"]
    assert len(query_all("SELECT id FROM wz_documents")) == 2
    assert len(query_all("SELECT id FROM cmr_documents")) == 2
    assert len(query_all("SELECT id FROM hdi_documents")) == 2


def test_komplet_bez_podzialu_jest_odrzucony(db):
    """Zamówienie bez podziału zachowuje się jak dziś — komplet nie powstaje."""
    _przygotuj_bez_podzialu()
    with pytest.raises(HTTPException) as exc:
        route.wystaw_komplet("o1", route.KompletDokumentow())
    assert exc.value.status_code == 400


# ── Anulowanie kompletu ───────────────────────────────────────────


def test_anulowanie_kompletu_zwraca_towar(db):
    """Bez tej trasy jedno omyłkowe kliknięcie blokuje zamówienie na amen:
    zwykłego WZ już nie wystawisz, a `cancel_wz` odrzuca dokumenty z podziału."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    route.wystaw_komplet("o1", route.KompletDokumentow())
    out = route.anuluj_komplet("o1")
    assert len(out["documents"]) == 2
    assert int(query_one("SELECT qty_available FROM finished_goods "
                         "WHERE id='f1'")["qty_available"]) == 30


def test_anulowanie_bez_dokumentow_mowi_wprost(db):
    _przygotuj_z_podzialem(cel_kg=300.0)
    with pytest.raises(HTTPException) as exc:
        route.anuluj_komplet("o1")
    assert exc.value.status_code == 404


# ── Jeden słownik wariantów dla wszystkich dokumentów ─────────────


def test_zakres_pusty_znaczy_calosc():
    """Query param bez wartości dociera do serwisu jako None. Dopóki każdy
    serwis normalizował go po swojemu, to samo żądanie działało dla HDI
    i wywracało się na 400 dla CMR."""
    assert sprawdz_zakres(None, "CMR") == "calosc"
    assert sprawdz_zakres(None, "HDI") == "calosc"


def test_zakres_obcina_biale_znaki():
    assert sprawdz_zakres("  fv  ", "CMR") == "fv"
    assert sprawdz_zakres("  fv  ", "HDI") == "fv"


def test_zakres_wz_odrzucany_regula_gdy_dokument_go_nie_zna():
    with pytest.raises(HTTPException) as exc:
        sprawdz_zakres("wz", "HDI", komunikat_wz=hdi_service.KOMUNIKAT_BEZ_HDI_NA_WZ)
    assert exc.value.status_code == 400
    assert "wz" in exc.value.detail.lower()


def test_zakres_nieznany_daje_400():
    with pytest.raises(HTTPException) as exc:
        sprawdz_zakres("polowa", "CMR")
    assert exc.value.status_code == 400
    assert "polowa" in exc.value.detail


# ── Zakres na istniejących trasach CMR/HDI ────────────────────────


def test_trasa_cmr_przekazuje_zakres(monkeypatch):
    """Biuro musi móc dołożyć POJEDYNCZY dokument po wystawieniu kompletu."""
    seen = {}
    monkeypatch.setattr(cmr_route.svc, "generate_cmr",
                        lambda oid, form, scope: seen.update(oid=oid, scope=scope) or {})
    cmr_route.generate(order_id="o1", scope="fv")
    assert seen == {"oid": "o1", "scope": "fv"}


def test_trasa_cmr_bez_zakresu_dziala_jak_dotad(monkeypatch):
    seen = {}
    monkeypatch.setattr(cmr_route.svc, "generate_cmr",
                        lambda oid, form, scope: seen.update(scope=scope) or {})
    cmr_route.generate(order_id="o1")
    assert seen == {"scope": "calosc"}


def test_trasa_hdi_przekazuje_zakres(monkeypatch):
    seen = {}
    monkeypatch.setattr(hdi_route.svc, "generate_hdi",
                        lambda oid, scope: seen.update(oid=oid, scope=scope) or {})
    hdi_route.generate(order_id="o1", scope="fv")
    assert seen == {"oid": "o1", "scope": "fv"}


def test_trasa_hdi_bez_zakresu_dziala_jak_dotad(monkeypatch):
    seen = {}
    monkeypatch.setattr(hdi_route.svc, "generate_hdi",
                        lambda oid, scope: seen.update(scope=scope) or {})
    hdi_route.generate(order_id="o1")
    assert seen == {"scope": "calosc"}


# ── Załadunek stempluje auto na obu dokumentach ───────────────────


def test_zaladunek_stempluje_auto_na_OBU_hdi(db):
    """Po tych trasach zamówienie ma DWA HDI na tym samym aucie. Stempel tylko
    na wariancie `calosc` zostawiał drugi dokument z pustym numerem rejestracyjnym
    na WYDRUKOWANYM papierze — czego biuro już nie poprawi."""
    _przygotuj_z_podzialem(cel_kg=300.0)
    route.wystaw_komplet("o1", route.KompletDokumentow(hdi_fv=True))
    loading_service._ensure_hdi("o1", "KR 12345")
    numery = [r["header"].get("reg_number") for r in query_all(
        "SELECT header FROM hdi_documents WHERE order_id='o1' ORDER BY seq")]
    assert numery == ["KR 12345", "KR 12345"]


# ── Wyścig o numer: dwa żądania w tym samym oknie ─────────────────
#
# `generate_cmr`/`generate_hdi` czytają istniejący dokument POZA transakcją,
# a potem długo budują treść (kilkanaście zapytań). Drugie żądanie potrafi
# w tym czasie zatwierdzić swój dokument — bez powtórnego odczytu TUŻ PRZED
# INSERT-em powstałby drugi papier z własnym numerem. Poniższe testy
# podstawiają „rywala" dokładnie w tym oknie: łatka na funkcję numerującą
# (wołaną wewnątrz transakcji, tuż przed INSERT-em) wstawia cudzy dokument
# osobnym połączeniem, tak jak zrobiłoby to równoległe żądanie.


def _rywal_cmr(scope: str, number: str = "9/09/26"):
    execute(
        "INSERT INTO cmr_documents (id, number, seq, year_month, order_id, client_name, "
        " status, payload, issue_date, scope) "
        "VALUES ('cmr-rywal',%s,9,'2609','o1','YBM Gastro GmbH','wystawiony',"
        " '{}'::jsonb,'10.09.2026',%s)", (number, scope))


def _rywal_hdi(scope: str, number: str = "9/09/26"):
    execute(
        "INSERT INTO hdi_documents (id, number, seq, year_month, order_id, client_name, "
        " language, status, incomplete, header, items, totals, issue_date, scope) "
        "VALUES ('hdi-rywal',%s,9,'2609','o1','YBM Gastro GmbH','pl','wstepny',false,"
        " '{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'10.09.2026',%s)", (number, scope))


def test_cmr_nie_dubluje_dokumentu_gdy_rywal_zdazyl_pierwszy(db, monkeypatch):
    _przygotuj_z_podzialem(cel_kg=300.0)
    oryginal = cmr_service.format_cmr_number

    def _z_rywalem(seq, ym):
        _rywal_cmr("calosc")
        return oryginal(seq, ym)

    monkeypatch.setattr(cmr_service, "format_cmr_number", _z_rywalem)
    out = cmr_service.generate_cmr("o1", {}, scope="calosc")
    assert out["number"] == "9/09/26"
    assert len(query_all("SELECT id FROM cmr_documents")) == 1


def test_hdi_nie_pali_drugiego_numeru_gdy_rywal_zdazyl_pierwszy(db, monkeypatch):
    _przygotuj_z_podzialem(cel_kg=300.0)
    oryginal = hdi_service.format_hdi_number

    def _z_rywalem(seq, ym):
        _rywal_hdi("calosc")
        return oryginal(seq, ym)

    monkeypatch.setattr(hdi_service, "format_hdi_number", _z_rywalem)
    out = hdi_service.generate_hdi("o1", scope="calosc")
    assert out["number"] == "9/09/26"
    assert len(query_all("SELECT id FROM hdi_documents")) == 1
