from app.utils.unit_codes import validate_pack_to_pallet, pallet_line_key

# planned_by_key: {key: planowana liczba szt}; packed_by_key: {key: już spakowane}
P1R1_40 = ("P1", "R1", 40.0)


def _unit(status="produced", order_id="O1", pt="P1", rc="R1", w=40):
    return {"status": status, "order_id": order_id,
            "product_type_id": pt, "recipe_id": rc, "weight_kg": w}


def test_ok_when_matches_and_free():
    ok, reason, key = validate_pack_to_pallet(
        _unit(), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 5})
    assert ok is True and reason == "" and key == P1R1_40


def test_different_order():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(order_id="O2"), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "zamówienia" in reason.lower()


def test_wrong_product_or_weight():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(w=30), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and ("produkt" in reason.lower() or "waga" in reason.lower())


def test_not_produced():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="planned"), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "produkcj" in reason.lower()


def test_already_packed():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="packed"), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "spakowan" in reason.lower()


def test_position_full():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(), pallet_order_id="O1",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 20})
    assert ok is False and ("pełna" in reason.lower() or "pelna" in reason.lower())


def test_different_batches_allowed():
    key = P1R1_40
    plan = {key: 20}
    u1 = {**_unit(), "batch_no": "B1"}
    u2 = {**_unit(), "batch_no": "B2"}
    ok1, _, k1 = validate_pack_to_pallet(u1, "O1", plan, {key: 0})
    ok2, _, k2 = validate_pack_to_pallet(u2, "O1", plan, {key: 1})
    assert ok1 is True and ok2 is True and k1 == k2


def test_pallet_line_key_rounds_weight():
    assert pallet_line_key("P1", "R1", 40.0001) == ("P1", "R1", 40.0)
