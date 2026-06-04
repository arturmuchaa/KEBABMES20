from app.services.zebra_labels_service import _zpl_escape, merge_zpl, unit_zpl_values


def test_escape_removes_zpl_control_chars():
    assert _zpl_escape("a^b~c") == "a b c"
    assert _zpl_escape(None) == ""


def test_merge_replaces_known_and_strips_unknown():
    zpl = "^FD[[QR]]^FS ^FD[[PARTIA]]^FS ^FD[[NIEZNANY]]^FS"
    out = merge_zpl(zpl, {"QR": "U|abc", "PARTIA": "030626"})
    assert "U|abc" in out
    assert "030626" in out
    assert "[[" not in out  # nieznane usunięte


def test_merge_repeated_placeholder():
    out = merge_zpl("[[WAGA]]-[[WAGA]]", {"WAGA": "40"})
    assert out == "40-40"


def test_merge_escapes_values():
    out = merge_zpl("[[KLIENT]]", {"KLIENT": "Zag^ros"})
    assert "^" not in out  # znak sterujący ZPL usunięty z wartości
    assert "Zag ros" in out


def test_unit_zpl_values_core():
    unit = {"qr_code": "U|abc", "batch_no": "030626333",
            "produced_date": "2026-06-01", "weight_kg": 40,
            "client_name": "Zagros", "product_type_id": "P1"}
    recipe = {"name": "Kebab wołowy", "shelf_life_days": 365, "product_type_name": "Kebab"}
    v = unit_zpl_values(unit, recipe)
    assert v["QR"] == "U|abc"
    assert v["PARTIA"] == "030626333"
    assert v["DATA_PROD"] == "01.06.2026"
    assert v["DATA_MROZ"] == "01.06.2026"
    assert v["BEST_BEFORE"] == "01.06.2027"   # +365 dni
    assert v["KLIENT"] == "Zagros"
    assert v["RECEPTURA"] == "Kebab wołowy"
    assert v["PRODUKT"] == "Kebab"
    assert v["NETTO"] == v["WAGA"]
    assert v["WAGA"] in ("40", "40,0")


def test_unit_zpl_values_blank_date():
    v = unit_zpl_values({"qr_code": "U|x", "produced_date": ""}, {"shelf_life_days": 5})
    assert v["DATA_PROD"] == ""
    assert v["BEST_BEFORE"] == ""
