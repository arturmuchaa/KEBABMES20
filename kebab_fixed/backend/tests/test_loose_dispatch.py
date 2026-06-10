from app.services.wz_service import build_goods_wz_lines
from app.utils.unit_codes import validate_loose_dispatch, group_units_by_goods


def _u(status="produced", client="Zagros", dispatch_id=None, batch_no="B1",
       w=40, rc="R1", pd="2026-06-01", goods_id="G1"):
    return {"status": status, "client_name": client, "dispatch_id": dispatch_id,
            "batch_no": batch_no, "weight_kg": w, "recipe_id": rc, "produced_date": pd,
            "source_finished_goods_id": goods_id}


def test_loose_ok_same_client():
    ok, reason = validate_loose_dispatch(_u(client="Zagros"), "Zagros")
    assert ok is True and reason == ""


def test_loose_stock_wildcard():
    for c in ("na magazyn", "", "STAN"):
        ok, _ = validate_loose_dispatch(_u(client=c), "Zagros")
        assert ok is True, f"{c!r} powinien wejść"


def test_loose_planned():
    ok, reason = validate_loose_dispatch(_u(status="planned"), "Zagros")
    assert ok is False and "produkcj" in reason.lower()


def test_loose_packed():
    ok, reason = validate_loose_dispatch(_u(status="packed"), "Zagros")
    assert ok is False and "palet" in reason.lower()


def test_loose_shipped():
    ok, reason = validate_loose_dispatch(_u(status="shipped"), "Zagros")
    assert ok is False and "wydana" in reason.lower()


def test_loose_already_on_dispatch():
    ok, reason = validate_loose_dispatch(_u(dispatch_id="d1"), "Zagros")
    assert ok is False and "wydani" in reason.lower()


def test_loose_wrong_client():
    ok, reason = validate_loose_dispatch(_u(client="Kowalski"), "Zagros")
    assert ok is False and "klient" in reason.lower()


def test_group_by_goods_two_products():
    units = [_u(goods_id="G1", w=40), _u(goods_id="G1", w=40), _u(goods_id="G2", w=30)]
    groups, unlinked = group_units_by_goods(units)
    assert groups["G1"] == {"count": 2, "kg": 80.0}
    assert groups["G2"] == {"count": 1, "kg": 30.0}
    assert unlinked == []


def test_group_by_goods_separates_unlinked():
    # Sztuka bez linku (dzień niezamknięty) NIE może wejść do rozchodu —
    # wraca osobno, wydanie ma ją odrzucić. Zero zgadywania po partii.
    linked = _u(goods_id="G1")
    orphan = _u(goods_id=None)
    groups, unlinked = group_units_by_goods([linked, orphan])
    assert groups == {"G1": {"count": 1, "kg": 40.0}}
    assert unlinked == [orphan]


def test_group_by_goods_empty():
    assert group_units_by_goods([]) == ({}, [])


def _fg(id="G1", batch="100626 353", recipe="GOLD KEBAB", kgpu=40.0, avail=20):
    return {"id": id, "batch_no": batch, "recipe_id": "R1", "recipe_name": recipe,
            "product_type_name": "KEBAB", "qty_available": avail, "kg_per_unit": kgpu}


def test_goods_wz_lines_full_batch_and_kg():
    # Partia na dokumencie = pełna partia WYROBU (ddmmrr partia), nie partia mięsa;
    # kg_per_unit/total_kg dołączone → uzupełnianie cen liczy za kg.
    lines = build_goods_wz_lines([{"goods": _fg(), "count": 10}])
    assert lines == [{
        "name": "GOLD KEBAB", "qty": 10, "unit": "szt", "batch_no": "100626 353",
        "price": None, "value": None, "stock_type": "fg", "stock_id": "G1",
        "kg_per_unit": 40.0, "total_kg": 400.0,
    }]


def test_goods_wz_lines_sorted_and_no_kg_when_unknown():
    lines = build_goods_wz_lines([
        {"goods": _fg(id="G2", batch="100626 354", recipe="Zagros", kgpu=0), "count": 5},
        {"goods": _fg(id="G1", batch="100626 353", recipe="GOLD KEBAB"), "count": 1},
    ])
    assert [l["name"] for l in lines] == ["GOLD KEBAB", "Zagros"]
    assert "total_kg" not in lines[1]  # kg_per_unit=0 → bez wagi, cena za szt
