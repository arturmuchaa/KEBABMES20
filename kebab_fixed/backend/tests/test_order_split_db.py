"""Podział zapisany na zamówieniu — musi przeżyć edycję.

Edycja zamówienia odtwarza pozycje (`_reconcile_lines_cx`). Gdy podział zginie,
powtórzy się historia znikających palet z sierpnia 2026.
"""
from app.db import execute, query_all
from app.models.orders import ClientOrderCreate
from app.services.order_split_service import podglad_podzialu, zapisz_podzial
from app.services.orders_service import get_order, update_order


def _slownik():
    execute("INSERT INTO clients (id, code, name, display_name) "
            "VALUES ('c1','YAL','YBM Gastro GmbH','YALCIN') ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO product_types (id, name) VALUES ('pt1','KEBAB UDO 100%%') "
            "ON CONFLICT (id) DO NOTHING")
    execute("INSERT INTO recipes (id, name, product_type_id) VALUES ('r1','KIRMIZI','pt1') "
            "ON CONFLICT (id) DO NOTHING")


def _zamowienie():
    execute("INSERT INTO client_orders (id, order_no, client_id, client_name, order_date, "
            " created_at, status) VALUES ('o1','YALCIN/Z/4/09/26','c1','YBM Gastro GmbH',"
            " '2026-09-08','2026-09-08 08:00:00+00','confirmed')")
    for lid, qty, kg in (("l1", 10, 30), ("l2", 20, 25)):
        execute("INSERT INTO client_order_lines (id, order_id, recipe_id, product_type_id, "
                " qty, kg_per_unit, total_kg) VALUES (%s,'o1','r1','pt1',%s,%s,%s)",
                (lid, qty, kg, qty * kg))


def test_podglad_nie_zapisuje_niczego(db):
    _slownik(); _zamowienie()
    p = podglad_podzialu("o1", 400.0)
    assert p["kg_fv"] > 0
    assert all(l["qty_invoice"] is None for l in get_order("o1")["lines"])


def test_zapis_utrwala_podzial_na_pozycjach(db):
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial == {"l1": 5, "l2": 10}


def test_podzial_PRZEZYWA_edycje_zamowienia(db):
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)
    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "l1", "recipe_id": "r1", "product_type_id": "pt1", "qty": 10, "kg_per_unit": 30},
            {"id": "l2", "recipe_id": "r1", "product_type_id": "pt1", "qty": 20, "kg_per_unit": 25},
        ]}))
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial == {"l1": 5, "l2": 10}, "edycja skasowała podział"


def test_reczna_korekta_pozycji_ma_pierwszenstwo(db):
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, {"l1": 8})
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial["l1"] == 8


def test_korekta_ponad_zamowiona_ilosc_jest_odrzucana(db):
    _slownik(); _zamowienie()
    try:
        zapisz_podzial("o1", 400.0, {"l1": 99})
        assert False, "przyjęto więcej sztuk na FV niż zamówiono"
    except Exception as e:
        assert "więcej" in str(e) or "99" in str(e)


def test_zamowienie_bez_podzialu_ma_puste_qty_invoice(db):
    _slownik(); _zamowienie()
    assert all(l["qty_invoice"] is None for l in get_order("o1")["lines"])


def test_podglad_mowi_czy_trafiono_w_cel(db):
    _slownik(); _zamowienie()                      # 300 + 500 = 800 kg
    assert podglad_podzialu("o1", 400.0)["trafiono"] is True
    assert podglad_podzialu("o1", 401.0)["trafiono"] is False


def test_korekta_reczna_zmienia_trafiono_i_odchylke_na_zapisany_stan(db):
    """Fix po review (runda 2, Task 8): `trafiono`/`odchylka` MUSZĄ opisywać
    ZAPISANY (skorygowany) podział, nie propozycję algorytmu sprzed korekty —
    inaczej biuro poprawia pozycję ręcznie, zapisuje i widzi „trafiono,
    odchyłka 0", choć zapisany podział jest o kilkadziesiąt kg obok celu.
    To dokładnie ta klasa błędu, przed którą broni się ten projekt: liczba
    na ekranie, która nie opisuje stanu w bazie."""
    _slownik(); _zamowienie()                      # 300 + 500 = 800 kg
    # Propozycja algorytmu na cel 400 trafia DOKŁADNIE: l1=5 (150kg), l2=10 (250kg).
    assert podglad_podzialu("o1", 400.0)["trafiono"] is True
    wynik = zapisz_podzial("o1", 400.0, {"l1": 8})  # ręcznie: l1 -> 8 szt (240kg)
    # Zapisany podział: l1=8*30=240kg + l2=10*25=250kg = 490kg, cel=400kg.
    assert wynik["kg_fv"] == 490.0
    assert wynik["odchylka"] == 90.0
    assert wynik["trafiono"] is False


def test_zapis_bez_korekty_trafia_tak_samo_jak_podglad(db):
    """Regresja: bez ręcznej korekty `trafiono`/`odchylka` po przeliczeniu
    mają wyjść IDENTYCZNE jak w podglądzie — przeliczenie po zapisie nie ma
    prawa zmienić wyniku, gdy nic nie zostało poprawione ręcznie."""
    _slownik(); _zamowienie()
    wynik = zapisz_podzial("o1", 400.0, None)
    assert wynik["trafiono"] is True
    assert wynik["odchylka"] == 0.0


def test_zmniejszenie_ilosci_przycina_qty_invoice(db):
    """Fix round 1 (recenzja): qty=10, qty_invoice=8, edycja zmniejsza qty do 3.

    Bez przycięcia qty_invoice zostaje 8 > 3, a Task 4 (WZ) liczy część na
    WZ jako qty - qty_invoice = 3 - 8 = -5 sztuk — ujemna pozycja na
    dokumencie handlowym.
    """
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, {"l1": 8})
    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "l1", "recipe_id": "r1", "product_type_id": "pt1", "qty": 3, "kg_per_unit": 30},
            {"id": "l2", "recipe_id": "r1", "product_type_id": "pt1", "qty": 20, "kg_per_unit": 25},
        ]}))
    l1 = next(l for l in get_order("o1")["lines"] if l["id"] == "l1")
    assert l1["qty_invoice"] == 3, "qty_invoice nie może być większe niż nowe qty"


def test_usunieta_pozycja_zabiera_swoj_podzial(db):
    """Pozycja naprawdę usunięta z edycji zabiera swój wiersz i podział;
    podział pozostałych pozycji zostaje nietknięty."""
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)               # {"l1": 5, "l2": 10}
    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "l2", "recipe_id": "r1", "product_type_id": "pt1", "qty": 20, "kg_per_unit": 25},
        ]}))
    lines = get_order("o1")["lines"]
    assert [l["id"] for l in lines] == ["l2"]
    assert lines[0]["qty_invoice"] == 10


def test_nowa_pozycja_ma_puste_qty_invoice(db):
    """Pozycja dopisana przy edycji jest NOWA — nie dziedziczy podziału
    po sąsiadach, dostaje qty_invoice=NULL jak każde nowe zamówienie."""
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)
    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"id": "l1", "recipe_id": "r1", "product_type_id": "pt1", "qty": 10, "kg_per_unit": 30},
            {"id": "l2", "recipe_id": "r1", "product_type_id": "pt1", "qty": 20, "kg_per_unit": 25},
            {"recipe_id": "r1", "product_type_id": "pt1", "qty": 5, "kg_per_unit": 10},
        ]}))
    lines = get_order("o1")["lines"]
    nowa = next(l for l in lines if float(l["kg_per_unit"]) == 10.0)
    assert nowa["qty_invoice"] is None


def test_dopasowanie_po_tozsamosci_zachowuje_podzial(db):
    """Formularz starszego klienta nie wysyła `id` pozycji — dopasowanie
    zapasowe po tożsamości produktu musi też zachować podział."""
    _slownik(); _zamowienie()
    zapisz_podzial("o1", 400.0, None)               # {"l1": 5, "l2": 10}
    update_order("o1", ClientOrderCreate.model_validate({
        "client_id": "c1", "order_date": "2026-09-08",
        "lines": [
            {"recipe_id": "r1", "product_type_id": "pt1", "qty": 10, "kg_per_unit": 30},
            {"recipe_id": "r1", "product_type_id": "pt1", "qty": 20, "kg_per_unit": 25},
        ]}))
    podzial = {l["id"]: l["qty_invoice"] for l in get_order("o1")["lines"]}
    assert podzial == {"l1": 5, "l2": 10}, "dopasowanie po tożsamości zgubiło podział"
