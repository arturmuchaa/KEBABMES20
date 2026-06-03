from app.utils.unit_codes import validate_loose_dispatch, group_units_for_out


def _u(status="produced", client="Zagros", dispatch_id=None, batch_no="B1",
       w=40, rc="R1", pd="2026-06-01"):
    return {"status": status, "client_name": client, "dispatch_id": dispatch_id,
            "batch_no": batch_no, "weight_kg": w, "recipe_id": rc, "produced_date": pd}


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


def test_group_two_batches():
    units = [_u(batch_no="B1", w=40, pd="2026-06-01"),
             _u(batch_no="B1", w=40, pd="2026-06-01"),
             _u(batch_no="B2", w=30, pd="2026-06-02")]
    g = group_units_for_out(units)
    assert g[("2026-06-01", "B1", "R1")] == {"count": 2, "kg": 80.0}
    assert g[("2026-06-02", "B2", "R1")] == {"count": 1, "kg": 30.0}


def test_group_same_batch_diff_weight():
    units = [_u(batch_no="B1", w=40), _u(batch_no="B1", w=20)]
    g = group_units_for_out(units)
    assert g[("2026-06-01", "B1", "R1")] == {"count": 2, "kg": 60.0}


def test_group_empty():
    assert group_units_for_out([]) == {}
