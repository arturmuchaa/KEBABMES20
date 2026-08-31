from app.services.hdi_service import (
    _product_label,
    group_hdi_items,
    format_hdi_number,
    hdi_product_base,
    units_from_plan_lines,
)


def test_product_label():
    assert _product_label("KEBAB", 40.0) == "KEBAB 40KG"
    assert _product_label("KEBAB UDO", 30) == "KEBAB UDO 30KG"


def test_format_hdi_number():
    assert format_hdi_number(15, "2605") == "15/05/26"


def _u(pt="KEBAB", w=40, batch="326", pd="2026-05-29", shelf=365):
    return {"product_type_name": pt, "weight_kg": w, "batch_no": batch,
            "produced_date": pd, "shelf_life_days": shelf}


def test_group_two_products():
    items = group_hdi_items([_u(pt="KEBAB", w=40), _u(pt="KEBAB", w=30)])
    names = {i["name"] for i in items}
    assert names == {"KEBAB 40KG", "KEBAB 30KG"}
    assert all(i["qty"] == 1 for i in items)


def test_group_sums_and_batches():
    items = group_hdi_items([
        _u(w=40, batch="326", pd="2026-05-29"),
        _u(w=40, batch="326", pd="2026-05-29"),
        _u(w=40, batch="332", pd="2026-05-30"),
    ])
    assert len(items) == 1
    it = items[0]
    assert it["name"] == "KEBAB 40KG" and it["qty"] == 3 and it["kg"] == 120.0
    assert len(it["batches"]) == 2
    b = {x["partia"]: x for x in it["batches"]}
    assert "290526 326" in b and b["290526 326"]["qty"] == 2
    assert b["290526 326"]["termin"] == "29.05.2027"


def test_group_empty():
    assert group_hdi_items([]) == []


def test_group_sorted_by_weight_desc_within_recipe():
    units = (
        [_u(pt="GOLD KEBAB", w=15)] * 1
        + [_u(pt="GOLD KEBAB", w=50)] * 1
        + [_u(pt="GOLD KEBAB", w=30)] * 1
        + [_u(pt="GOLD KEBAB", w=40)] * 1
    )
    items = group_hdi_items(units)
    assert [i["name"] for i in items] == [
        "GOLD KEBAB 50KG", "GOLD KEBAB 40KG", "GOLD KEBAB 30KG", "GOLD KEBAB 15KG"]


def test_group_two_recipes_each_sorted_desc():
    units = [
        _u(pt="GOLD KEBAB", w=20), _u(pt="GOLD KEBAB", w=40),
        _u(pt="DROB KEBAB", w=10), _u(pt="DROB KEBAB", w=30),
    ]
    items = group_hdi_items(units)
    assert [i["name"] for i in items] == [
        "DROB KEBAB 30KG", "DROB KEBAB 10KG", "GOLD KEBAB 40KG", "GOLD KEBAB 20KG"]


def test_group_batches_sorted_by_qty_desc():
    units = (
        [_u(w=20, batch="325", pd="2026-05-30")] * 74
        + [_u(w=20, batch="332", pd="2026-05-29")] * 6
    )
    items = group_hdi_items(units)
    assert len(items) == 1
    batches = items[0]["batches"]
    assert [b["qty"] for b in batches] == [74, 6]
    assert batches[0]["partia"] == "300526 325"


def _line(qty_done=2, kg=40, recipe_id="r1", recipe_name="GOLD KEBAB",
          ba=None, sbn=None, pd="2026-05-27T11:43:47+00:00"):
    return {"qty_done": qty_done, "kg_per_unit": kg, "recipe_id": recipe_id,
            "recipe_name": recipe_name, "product_type_name": None,
            "batch_allocation": ba,
            "seasoned_batch_no": (sbn[0] if sbn else None),
            "seasoned_batch_nos": sbn, "progress_updated_at": pd}


def test_units_from_plan_lines_allocation_splits_pieces():
    lines = [_line(qty_done=30, kg=50,
                   ba={"349": {"pieces": 26}, "PP1": {"pieces": 4}},
                   sbn=["PP1", "349"])]
    units = units_from_plan_lines(lines, {"r1": 365})
    assert len(units) == 30
    assert sum(1 for u in units if u["batch_no"] == "349") == 26
    assert sum(1 for u in units if u["batch_no"] == "PP1") == 4
    assert all(u["product_type_name"] == "GOLD KEBAB" for u in units)
    assert all(u["weight_kg"] == 50 for u in units)
    assert all(u["produced_date"] == "2026-05-27" for u in units)
    assert all(u["shelf_life_days"] == 365 for u in units)


def test_units_from_plan_lines_single_batch():
    lines = [_line(qty_done=40, kg=10, ba={"MP209": {"pieces": 40}}, sbn=["MP209"])]
    units = units_from_plan_lines(lines, {"r1": 365})
    assert len(units) == 40
    assert all(u["batch_no"] == "MP209" for u in units)


def test_units_from_plan_lines_no_allocation_uses_seasoned():
    lines = [_line(qty_done=5, kg=20, ba=None, sbn=["349"])]
    units = units_from_plan_lines(lines, {"r1": 0})
    assert len(units) == 5
    assert all(u["batch_no"] == "349" for u in units)


def test_units_from_plan_lines_skips_zero_done():
    assert units_from_plan_lines([_line(qty_done=0)], {}) == []


def test_units_allocation_mismatch_falls_back_to_qty_done():
    # allocation total (26) != qty_done (10) → single bucket of qty_done
    lines = [_line(qty_done=10, kg=20, ba={"349": {"pieces": 26}}, sbn=["349"])]
    units = units_from_plan_lines(lines, {"r1": 0})
    assert len(units) == 10
    assert all(u["batch_no"] == "349" for u in units)


def test_units_partial_production_grouped_to_hdi_items():
    # 40x10 done fully + 30x50 only 12 produced → HDI reflects actual produced
    lines = [
        _line(qty_done=40, kg=10, ba={"MP209": {"pieces": 40}}, sbn=["MP209"]),
        _line(qty_done=12, kg=50, ba=None, sbn=["349"]),
    ]
    items = group_hdi_items(units_from_plan_lines(lines, {"r1": 365}))
    by_name = {i["name"]: i for i in items}
    assert by_name["GOLD KEBAB 10KG"]["qty"] == 40
    assert by_name["GOLD KEBAB 50KG"]["qty"] == 12



# ── Rodzaj na pozycji HDI (zgłoszenie TRUVA, 29.08.2026) ────────────────────
#
# Dwa rodzaje na tej samej recepturze („KEBAB UDO 100%" i „KEBAB MIX 95/5"
# na KIRMIZI) schodziły na dokument jako jedna pozycja „KIRMIZI 25KG".

def test_product_base_laczy_rodzaj_z_receptura():
    assert hdi_product_base("KEBAB UDO 100%", "KIRMIZI") == "KEBAB UDO 100% KIRMIZI"
    assert hdi_product_base("KEBAB MIX", "KIRMIZI") == "KEBAB MIX KIRMIZI"


def test_product_base_nie_dubluje_nazwy():
    # Rodzaj „KEBAB YAPRAK" + receptura „YAPRAK" to nie „KEBAB YAPRAK YAPRAK".
    assert hdi_product_base("KEBAB YAPRAK", "YAPRAK") == "KEBAB YAPRAK"
    assert hdi_product_base("VATAN", "VATAN KEBAB") == "VATAN KEBAB"


def test_product_base_braki_danych():
    # Stare linie planu bez rodzaju zachowują się jak dotąd — sama receptura.
    assert hdi_product_base("", "KIRMIZI") == "KIRMIZI"
    assert hdi_product_base("KEBAB MIX", "") == "KEBAB MIX"


def _line_pt(product_type_id, product_type_name, recipe_name, qty=1, kg=25):
    return {"qty_done": qty, "kg_per_unit": kg, "recipe_id": "r1",
            "recipe_name": recipe_name, "product_type_id": product_type_id,
            "product_type_name": product_type_name, "batch_allocation": {},
            "seasoned_batch_no": "PP1", "seasoned_batch_nos": ["PP1"],
            "progress_updated_at": "2026-08-27"}


def test_dwa_rodzaje_tej_samej_receptury_to_dwie_pozycje():
    lines = [
        _line_pt("t-udo", "KEBAB UDO 100%", "KIRMIZI", qty=2),
        _line_pt("t-mix", "KEBAB MIX 95/5", "KIRMIZI", qty=3),
    ]
    doc_names = {"t-udo": "KEBAB UDO 100%", "t-mix": "KEBAB MIX"}
    items = group_hdi_items(units_from_plan_lines(lines, {"r1": 365}, doc_names))
    assert {i["name"]: i["qty"] for i in items} == {
        "KEBAB MIX KIRMIZI 25KG": 3,
        "KEBAB UDO 100% KIRMIZI 25KG": 2,
    }


def test_bez_mapy_nazw_dokumentowych_idzie_nazwa_rodzaju():
    lines = [_line_pt("t-mix", "KEBAB MIX 95/5", "KIRMIZI", qty=1)]
    items = group_hdi_items(units_from_plan_lines(lines, {"r1": 365}))
    assert items[0]["name"] == "KEBAB MIX 95/5 KIRMIZI 25KG"


# ─── Nazwa pozycji per odbiorca: rodzaj / receptura / obie ────────────
#
# POLAT (31.08.2026, HDI 20/08): „na HDI ustaw tylko rodzaj i kg", a nazwa
# receptury „BEYAZ AFIYET" ma u niego schodzić jako samo „BEYAZ". TRUVA chce
# odwrotnie — rodzaj ORAZ recepturę, żeby odróżnić dwa wyroby zrobione
# z jednej receptury. Dlatego tryb stoi w kartotece odbiorcy.

def test_product_base_tryb_sam_rodzaj():
    assert hdi_product_base("KEBAB UDO", "BEYAZ AFIYET", "type") == "KEBAB UDO"
    assert hdi_product_base("KEBAB YAPRAK", "SHAORMA TRUVA + AROMAT", "type") == "KEBAB YAPRAK"


def test_product_base_tryb_sama_receptura():
    assert hdi_product_base("KEBAB UDO", "BEYAZ AFIYET", "recipe") == "BEYAZ AFIYET"


def test_product_base_brakujacy_czlon_nie_zostawia_pustej_nazwy():
    """Stara linia planu bez rodzaju (albo wyrób bez receptury) nie może
    zostawić pozycji bez nazwy."""
    assert hdi_product_base("", "KIRMIZI", "type") == "KIRMIZI"
    assert hdi_product_base("KEBAB MIX", "", "recipe") == "KEBAB MIX"


def test_nieznany_tryb_zachowuje_sie_jak_domyslny():
    assert hdi_product_base("KEBAB UDO", "KIRMIZI", "cokolwiek") == "KEBAB UDO KIRMIZI"


def test_tryb_sam_rodzaj_scala_dwie_receptury_tego_samego_rodzaju():
    """Skoro receptury nie ma w nazwie, dwie receptury jednego rodzaju i wagi
    to dla odbiorcy JEDNA pozycja — partie zostają rozpisane pod nią."""
    lines = [
        _line_pt("t-udo", "KEBAB UDO 100%", "BEYAZ AFIYET", qty=2, kg=20),
        _line_pt("t-udo", "KEBAB UDO 100%", "KIRMIZI", qty=3, kg=20),
    ]
    items = group_hdi_items(
        units_from_plan_lines(lines, {"r1": 365}, {"t-udo": "KEBAB UDO"}, "type"))
    assert {i["name"]: i["qty"] for i in items} == {"KEBAB UDO 20KG": 5}


def test_wlasna_nazwa_receptury_odbiorcy_wchodzi_do_pozycji():
    """U POLATA „BEYAZ AFIYET" ma schodzić jako samo „BEYAZ"."""
    lines = [_line_pt("t-udo", "KEBAB UDO 100%", "BEYAZ AFIYET", qty=2, kg=20)]
    items = group_hdi_items(units_from_plan_lines(
        lines, {"r1": 365}, {"t-udo": "KEBAB UDO"}, "type_recipe", {"r1": "BEYAZ"}))
    assert items[0]["name"] == "KEBAB UDO BEYAZ 20KG"


def test_wlasna_nazwa_receptury_dziala_tez_w_trybie_samej_receptury():
    lines = [_line_pt("t-udo", "KEBAB UDO 100%", "BEYAZ AFIYET", qty=2, kg=20)]
    items = group_hdi_items(units_from_plan_lines(
        lines, {"r1": 365}, {"t-udo": "KEBAB UDO"}, "recipe", {"r1": "BEYAZ"}))
    assert items[0]["name"] == "BEYAZ 20KG"


def test_bez_ustawien_odbiorcy_nazwa_jest_jak_dotad():
    lines = [_line_pt("t-udo", "KEBAB UDO 100%", "BEYAZ AFIYET", qty=2, kg=20)]
    items = group_hdi_items(units_from_plan_lines(lines, {"r1": 365}, {"t-udo": "KEBAB UDO"}))
    assert items[0]["name"] == "KEBAB UDO BEYAZ AFIYET 20KG"
