from app.services.zebra_designer_service import _mm_to_dots, _merge, design_to_zpl


def test_mm_to_dots():
    assert _mm_to_dots(25.4, 203) == 203
    assert _mm_to_dots(10, 300) == 118
    assert _mm_to_dots(0, 203) == 0


def test_merge_replaces_and_strips():
    assert _merge("[[WAGA]] kg", {"WAGA": "15"}) == "15 kg"
    assert _merge("x[[NIEZNANY]]y", {}) == "xy"


def test_merge_escapes_control():
    assert _merge("[[KLIENT]]", {"KLIENT": "A^B~C"}) == "A B C"


def test_design_to_zpl_header_footer():
    z = design_to_zpl({"width_mm": 100, "height_mm": 150, "dpi": 203, "elements": []}, {})
    assert z.startswith("^XA")
    assert "^CI28" in z
    assert "^PW799" in z   # 100mm @203dpi
    assert "^LL1199" in z  # 150mm @203dpi
    assert z.rstrip().endswith("^XZ")


def test_design_to_zpl_text():
    d = {"width_mm": 100, "height_mm": 150, "dpi": 203, "elements": [
        {"id": "1", "type": "text", "x": 10, "y": 10, "w": 80, "fontMm": 4, "align": "C", "value": "Waga [[WAGA]]"}]}
    z = design_to_zpl(d, {"WAGA": "15"})
    assert "^A0N," in z and "^FB" in z and ",C," in z
    assert "^FDWaga 15^FS" in z


def test_design_to_zpl_qr_and_box():
    d = {"width_mm": 100, "height_mm": 150, "dpi": 203, "elements": [
        {"id": "q", "type": "qr", "x": 5, "y": 5, "mag": 4, "value": "[[QR]]"},
        {"id": "b", "type": "box", "x": 0, "y": 0, "w": 50, "h": 20, "thickMm": 0.5}]}
    z = design_to_zpl(d, {"QR": "U|abc"})
    assert "^BQN,2,4^FDLA,U|abc^FS" in z
    assert "^GB" in z
