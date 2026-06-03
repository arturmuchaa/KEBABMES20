from app.utils.unit_codes import validate_pack_to_pallet, pallet_line_key

P1R1_40 = ("P1", "R1", 40.0)


def _unit(status="produced", client="Zagros", pt="P1", rc="R1", w=40, batch_no="B1"):
    return {"status": status, "client_name": client,
            "product_type_id": pt, "recipe_id": rc, "weight_kg": w, "batch_no": batch_no}


def test_same_client_ok():
    ok, reason, key = validate_pack_to_pallet(
        _unit(client="Zagros"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 5})
    assert ok is True and reason == "" and key == P1R1_40


def test_stock_unit_wildcard_ok():
    for c in ("na magazyn", "", "STAN", "MAGAZYN"):
        ok, reason, _ = validate_pack_to_pallet(
            _unit(client=c), pallet_client="Zagros",
            planned_by_key={P1R1_40: 20}, packed_by_key={})
        assert ok is True, f"stock client {c!r} powinien wejść"


def test_stock_pallet_accepts_any():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(client="Zagros"), pallet_client="na magazyn",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is True


def test_client_match_case_insensitive():
    ok, _, _ = validate_pack_to_pallet(
        _unit(client="zagros "), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is True


def test_different_client_rejected():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(client="Kowalski"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "klient" in reason.lower()


def test_wrong_product_or_weight():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(w=30), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and ("produkt" in reason.lower() or "waga" in reason.lower())


def test_not_produced():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="planned"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "produkcj" in reason.lower()


def test_already_packed():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(status="packed"), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={})
    assert ok is False and "spakowan" in reason.lower()


def test_position_full():
    ok, reason, _ = validate_pack_to_pallet(
        _unit(), pallet_client="Zagros",
        planned_by_key={P1R1_40: 20}, packed_by_key={P1R1_40: 20})
    assert ok is False and ("pełna" in reason.lower() or "pelna" in reason.lower())


def test_different_batches_allowed():
    plan = {P1R1_40: 20}
    ok1, _, k1 = validate_pack_to_pallet(
        _unit(batch_no="B1"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 0})
    ok2, _, k2 = validate_pack_to_pallet(
        _unit(batch_no="B2"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 1})
    assert ok1 is True and ok2 is True and k1 == k2


def test_combine_stock_and_fresh():
    # główny scenariusz: 5 ze stanu (na magazyn) + nowa sztuka klienta Zagros do palety Zagros
    plan = {P1R1_40: 40}
    ok_stock, _, _ = validate_pack_to_pallet(
        _unit(client="na magazyn"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 0})
    ok_fresh, _, _ = validate_pack_to_pallet(
        _unit(client="Zagros"), pallet_client="Zagros", planned_by_key=plan, packed_by_key={P1R1_40: 1})
    assert ok_stock is True and ok_fresh is True


def test_pallet_line_key_rounds_weight():
    assert pallet_line_key("P1", "R1", 40.0001) == ("P1", "R1", 40.0)
