"""Pokrycie zamówienia zapasem magazynowym (produkcja "na magazyn" sprzed
zamówienia) — czysta logika porcjowania i budowy linii dokumentów."""
from app.services.order_stock_service import (
    _key,
    compute_shortfalls,
    portion_stock_rows,
    produced_by_key_from_plan_lines,
)
from app.services.hdi_service import units_from_stock_portions
from app.services.wz_service import build_stock_wz_lines
from app.utils.batch_numbers import kebab_batch_wsad


ORDER_LINES = [{"recipe_id": "r1", "kg_per_unit": 40, "qty": 18}]


def _fg(**kw):
    row = {"id": "fg1", "batch_no": "120626 364", "recipe_id": "r1",
           "recipe_name": "Gold2", "product_type_name": "Kebab drobiowy",
           "kg_per_unit": 40, "qty": 18, "qty_available": 18,
           "qty_shipped": 0, "client_order_no": "", "client_name": "",
           "product_type_id": "", "packaging_id": "",
           "produced_date": "2026-06-12"}
    row.update(kw)
    return row


def test_shortfall_is_ordered_minus_plan_production():
    produced = produced_by_key_from_plan_lines(
        [{"recipe_id": "r1", "kg_per_unit": 40, "qty_done": 10}])
    assert compute_shortfalls(ORDER_LINES, produced) == {_key("r1", 40.0): 8}


def test_no_shortfall_when_plan_covers_order():
    produced = produced_by_key_from_plan_lines(
        [{"recipe_id": "r1", "kg_per_unit": 40, "qty_done": 18}])
    assert compute_shortfalls(ORDER_LINES, produced) == {}


def test_cartoned_units_reduce_shortfall():
    order_lines = [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}]
    cartoned = {_key("r1", 10.0): 20}  # 20 szt już w kartonie pod to zamówienie
    short = compute_shortfalls(order_lines, {}, cartoned)
    assert short == {_key("r1", 10.0): 30}


def test_cartoned_plus_produced_cover_fully():
    order_lines = [{"recipe_id": "r1", "kg_per_unit": 10.0, "qty": 50}]
    produced = {_key("r1", 10.0): 30}
    cartoned = {_key("r1", 10.0): 20}
    assert compute_shortfalls(order_lines, produced, cartoned) == {}


def test_stock_only_order_fully_covered_from_stock():
    # Scenariusz z produkcji: 18 szt "na magazyn", potem zamówienie na 18.
    short = compute_shortfalls(ORDER_LINES, {})
    portions = portion_stock_rows(short, [_fg()], "ZAGROS/Z/1/06/26")
    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("fg1", 18)]


def test_portion_respects_qty_available_not_qty():
    # Część zapasu już wydana ręcznym WZ — do pokrycia tylko dostępne.
    portions = portion_stock_rows(
        {_key("r1", 40.0): 18}, [_fg(qty_available=5, qty_shipped=13)], "Z1")
    assert [(p["take"]) for p in portions] == [5]


def test_sztuki_wydane_na_TO_zamowienie_widac_na_pozniejszym_dokumencie():
    # Po WZ rozchód wyzerował qty_available — HDI/CMR wystawiane PO WZ nadal
    # muszą widzieć te sztuki, bo pojechały z tym zamówieniem.
    row = _fg(id="a", client_order_no="Z1", qty_available=0, qty_shipped=18)
    portions = portion_stock_rows({_key("r1", 40.0): 18}, [row], "Z1", {"a": 18})
    assert [(p["take"]) for p in portions] == [18]


def test_sztuki_sprzedane_KOMUS_INNEMU_nie_wchodza_na_dokument():
    """TRUVA: 30 szt. jej wyrobu poszło ręcznym WZ do innego nabywcy — HDI dla
    TRUVY nie może ich wykazać, bo ona ich nie dostała. Rozchód zdejmuje wtedy
    stempel (patrz `zdejmij_stempel_obcej_sprzedazy`), więc wiersz zostaje bez
    przypisania i bez wpisu w mapie wydań."""
    row = _fg(id="a", client_order_no="", qty_available=0, qty_shipped=30)
    assert portion_stock_rows({_key("r1", 40.0): 30}, [row], "Z1") == []


def test_rows_for_other_recipe_or_weight_skipped():
    rows = [_fg(id="a", recipe_id="r2"), _fg(id="b", kg_per_unit=30),
            _fg(id="c")]
    portions = portion_stock_rows({_key("r1", 40.0): 18}, rows, "Z1")
    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("c", 18)]


def test_partial_coverage_across_rows_in_order():
    rows = [_fg(id="a", qty=10, qty_available=10),
            _fg(id="b", qty=10, qty_available=10)]
    portions = portion_stock_rows({_key("r1", 40.0): 14}, rows, "Z1")
    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("a", 10), ("b", 4)]


def test_build_stock_wz_lines_carry_full_batch_and_stock_id():
    lines = build_stock_wz_lines([{"fg": _fg(), "take": 18}])
    assert lines == [{
        "name": "Kebab drobiowy Gold2 40kg", "qty": 18, "unit": "szt",
        "batch_no": "120626 364", "price": None, "value": None,
        "stock_type": "fg", "stock_id": "fg1", "recipe_id": "r1",
        "kg_per_unit": 40, "total_kg": 720,
    }]


def test_hdi_units_use_bare_wsad_and_produced_date():
    units = units_from_stock_portions(
        [{"fg": _fg(), "take": 2}], {"r1": 30})
    assert len(units) == 2
    u = units[0]
    # Goły wsad — group_hdi_items odtworzy '120626 364' z produced_date.
    assert u["batch_no"] == "364"
    assert u["produced_date"] == "2026-06-12"
    assert u["shelf_life_days"] == 30
    # Nazwa pozycji HDI = RODZAJ + RECEPTURA (od 29.08.2026). Sama receptura
    # scalała na dokumencie dwa różne rodzaje zrobione na tej samej recepturze.
    assert u["product_type_name"] == "Kebab drobiowy Gold2"
    assert u["weight_kg"] == 40


def test_hdi_units_biora_nazwe_rodzaju_z_dokumentow():
    # Rodzaj nazywa się po składzie, a klient ma widzieć nazwę handlową.
    units = units_from_stock_portions(
        [{"fg": _fg(product_type_id="t-mix", product_type_name="KEBAB MIX 95/5",
                    recipe_name="KIRMIZI"), "take": 1}],
        {"r1": 30}, {"t-mix": "KEBAB MIX"})
    assert units[0]["product_type_name"] == "KEBAB MIX KIRMIZI"


def test_kebab_batch_wsad_strips_date_prefix_idempotently():
    assert kebab_batch_wsad("120626 364") == "364"
    assert kebab_batch_wsad("120626 PM1") == "PM1"
    assert kebab_batch_wsad("364") == "364"
    assert kebab_batch_wsad("PP2") == "PP2"
    assert kebab_batch_wsad("") == ""
    assert kebab_batch_wsad(None) == ""


# ── Rodzaj: 95/5 to nie UDO 100 % ─────────────────────────────────────────

def _linia(pt, qty=60, kg=25.0):
    return {"recipe_id": "r1", "kg_per_unit": kg, "product_type_id": pt, "qty": qty}


def test_zapas_innego_rodzaju_nie_pokrywa_pozycji():
    """WZ wystawiony z KIRMIZI 95/5 na pozycję KIRMIZI UDO 100 %."""
    short = compute_shortfalls([_linia("udo")], {})
    rows = [_fg(id="a", kg_per_unit=25.0, qty=30, qty_available=30,
                product_type_id="95-5")]

    assert portion_stock_rows(short, rows, "Z1") == []


def test_zapas_wlasciwego_rodzaju_pokrywa():
    short = compute_shortfalls([_linia("udo")], {})
    rows = [_fg(id="a", kg_per_unit=25.0, qty=30, qty_available=30,
                product_type_id="udo")]

    assert [(p["fg"]["id"], p["take"]) for p in portion_stock_rows(short, rows, "Z1")] == [("a", 30)]


def test_zapas_bez_rodzaju_nadal_pokrywa():
    """Wyroby sprzed dodania rodzaju do formularza — nie gubimy ich."""
    short = compute_shortfalls([_linia("udo")], {})
    rows = [_fg(id="a", kg_per_unit=25.0, qty=30, qty_available=30, product_type_id="")]

    assert [(p["take"]) for p in portion_stock_rows(short, rows, "Z1")] == [30]


def test_produkcja_z_planu_odejmuje_sie_od_wlasciwego_rodzaju():
    produced = produced_by_key_from_plan_lines(
        [{"recipe_id": "r1", "kg_per_unit": 25.0, "product_type_id": "udo", "qty_done": 10}])

    short = compute_shortfalls([_linia("udo"), _linia("95-5")], produced)

    assert short == {_key("r1", 25.0, "udo"): 50, _key("r1", 25.0, "95-5"): 60}


def test_nazwa_pozycji_wz_niesie_rodzaj():
    """Na dokumencie „KIRMIZI 25kg" to i MIX 95/5, i UDO 100 % — nie do
    odróżnienia po wydaniu."""
    lines = build_stock_wz_lines([
        {"fg": _fg(id="a", recipe_name="KIRMIZI", product_type_name="KEBAB MIX 95/5",
                   kg_per_unit=25), "take": 30},
        {"fg": _fg(id="b", recipe_name="KIRMIZI", product_type_name="KEBAB UDO 100%",
                   kg_per_unit=25), "take": 30},
    ])

    assert [l["name"] for l in lines] == [
        "KEBAB MIX 95/5 KIRMIZI 25kg", "KEBAB UDO 100% KIRMIZI 25kg"]


def test_klon_po_rozchodzie_wchodzi_na_dokument():
    """Rozchód WZ dzieli wiersz: oryginal zostaje, a wydane sztuki ida do
    NOWEGO wiersza ostemplowanego zamowieniem. Pozycja WZ wskazuje id
    oryginalu, wiec klona nie da sie rozpoznac po mapie wydan — poznajemy go
    po stemplu (biuro, 27.08.2026: HDI spadlo z 477 na 169 szt.)."""
    klon = _fg(id="klon", client_order_no="Z1", qty=50, qty_available=0, qty_shipped=50)

    portions = portion_stock_rows({_key("r1", 40.0): 50}, [klon], "Z1")

    assert [(p["fg"]["id"], p["take"]) for p in portions] == [("klon", 50)]


def test_stempel_INNEGO_zamowienia_nie_wchodzi_po_wysylce():
    """Sztuki wydane pod cudzym zamowieniem nie moga wejsc na ten dokument."""
    obcy = _fg(id="obcy", client_order_no="Z2", qty=50, qty_available=0, qty_shipped=50)

    assert portion_stock_rows({_key("r1", 40.0): 50}, [obcy], "Z1") == []


# ── Tuleja ────────────────────────────────────────────────────────────────

def test_zapas_na_innej_tulei_nie_wchodzi_na_dokument():
    """METAL 65 to nie 80 cm — dokument nie może podmienić tulei."""
    short = compute_shortfalls(
        [{"recipe_id": "r1", "kg_per_unit": 30.0, "packaging_id": "t-80cm", "qty": 15}], {})
    rows = [_fg(id="a", kg_per_unit=30.0, qty=15, qty_available=15, packaging_id="t-metal65")]

    assert portion_stock_rows(short, rows, "Z1") == []


def test_zapas_na_tej_samej_tulei_pokrywa():
    short = compute_shortfalls(
        [{"recipe_id": "r1", "kg_per_unit": 30.0, "packaging_id": "t-metal65", "qty": 15}], {})
    rows = [_fg(id="a", kg_per_unit=30.0, qty=15, qty_available=15, packaging_id="t-metal65")]

    assert [(p["take"]) for p in portion_stock_rows(short, rows, "Z1")] == [15]


def test_FEFO_wazniejsze_niz_dokladnosc_opisu():
    """Wiersz bez wpisanej tulei pasuje do każdej (stare dane), więc jeśli
    leży dłużej — wychodzi pierwszy. FEFO to reguła żywnościowa i nie
    ustępuje dokładności opisu."""
    short = compute_shortfalls(
        [{"recipe_id": "r1", "kg_per_unit": 30.0, "packaging_id": "t-metal65", "qty": 10}], {})
    rows = [_fg(id="starszy-bez-tulei", kg_per_unit=30.0, qty=10, qty_available=10, packaging_id=""),
            _fg(id="mlodszy-metal65", kg_per_unit=30.0, qty=10, qty_available=10, packaging_id="t-metal65")]

    wziete = {p["fg"]["id"]: p["take"] for p in portion_stock_rows(short, rows, "Z1")}
    assert wziete == {"starszy-bez-tulei": 10}
