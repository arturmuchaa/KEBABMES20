from app.services.loading_service import aggregate_loaded_units, verify_wz_against_loaded


def _u(rid="r1", w=10.0, batch="353"):
    return {"recipe_id": rid, "weight_kg": w, "batch_no": batch}


def _wzl(rid="r1", kg=10.0, batch="353", qty=20, name="Gold2 10kg"):
    return {"recipe_id": rid, "kg_per_unit": kg, "batch_no": batch, "qty": qty, "name": name}


def test_aggregate_counts_per_recipe_weight_batch():
    agg = aggregate_loaded_units([_u(), _u(), _u(w=20.0)])
    assert agg[("r1", 10.0, "353")]["qty"] == 2
    assert agg[("r1", 20.0, "353")]["qty"] == 1


def test_verify_match_confirms():
    # Dokument 20 szt, załadowano 20 → potwierdzony, zero różnic
    loaded = aggregate_loaded_units([_u()] * 20)
    status, diff = verify_wz_against_loaded([_wzl(qty=20)], loaded)
    assert status == "potwierdzony"
    assert all(d["diff"] == 0 for d in diff)
    assert diff[0] == {"name": "Gold2 10kg", "batch_no": "353",
                       "doc_qty": 20, "loaded_qty": 20, "diff": 0}


def test_verify_short_load_is_rozjazd():
    # Scenariusz właściciela: dokument na 20, na auto weszło 18 → ROZJAZD −2.
    loaded = aggregate_loaded_units([_u()] * 18)
    status, diff = verify_wz_against_loaded([_wzl(qty=20)], loaded)
    assert status == "rozjazd"
    assert diff[0]["doc_qty"] == 20 and diff[0]["loaded_qty"] == 18 and diff[0]["diff"] == -2


def test_verify_extra_position_on_truck():
    # Na aucie pozycja, której nie ma na dokumencie → rozjazd z doc_qty=0
    loaded = aggregate_loaded_units([_u(), _u(rid="r2", w=30.0, batch="354")])
    status, diff = verify_wz_against_loaded([_wzl(qty=1)], loaded)
    assert status == "rozjazd"
    extra = next(d for d in diff if d["batch_no"] == "354")
    assert extra["doc_qty"] == 0 and extra["loaded_qty"] == 1 and extra["diff"] == 1


def test_verify_missing_position_not_loaded():
    # Dokument ma pozycję, która w ogóle nie wjechała → rozjazd −qty
    status, diff = verify_wz_against_loaded(
        [_wzl(qty=5), _wzl(rid="r2", kg=30.0, batch="354", qty=3, name="Zagros 30kg")],
        aggregate_loaded_units([_u()] * 5))
    assert status == "rozjazd"
    missing = next(d for d in diff if d["batch_no"] == "354")
    assert missing["loaded_qty"] == 0 and missing["diff"] == -3


def test_verify_aggregates_doc_lines_same_key():
    # Dwie linie dokumentu tej samej pozycji sumują się przed porównaniem
    loaded = aggregate_loaded_units([_u()] * 10)
    status, diff = verify_wz_against_loaded([_wzl(qty=6), _wzl(qty=4)], loaded)
    assert status == "potwierdzony" and diff[0]["doc_qty"] == 10
