"""Orkiestracja zapotrzebowania na surowiec (serwis, bez HTTP/auth).

Endpointy są cienką warstwą nad tymi funkcjami (routes/orders.py). API HTTP
wymaga sesji (middleware default-deny), a repo testuje logikę bez TestClient —
dlatego monkeypatchujemy ładowarki DB i testujemy orkiestrację bezpośrednio.
"""
import app.services.material_requirements_service as mrs

NAMES = {
    "mat-mieso-zs": "Mięso z/s",
    "mat-cwiartka": "Ćwiartka z kurczaka",
    "mat-filet-kurczak": "Filet z kurczaka",
}


def _patch_common(monkeypatch, *, ingredients=None, primary=None, fallback=None, yield_pct=70.0):
    monkeypatch.setattr(mrs, "material_names", lambda: NAMES)
    monkeypatch.setattr(mrs, "recipe_ingredients", lambda rid: ingredients or [])
    monkeypatch.setattr(mrs, "components_for", lambda pt, rid: (primary or [], fallback or []))
    import app.services.settings_service as ss
    monkeypatch.setattr(ss, "get_deboning_yield_pct", lambda: yield_pct)


def test_sum_by_raw_aggregates_across_lines():
    line_rows = [
        [{"raw_type_id": "mat-cwiartka", "raw_name": "Ćwiartka z kurczaka", "kg_raw": 100.0},
         {"raw_type_id": "mat-filet-kurczak", "raw_name": "Filet z kurczaka", "kg_raw": 30.0}],
        [{"raw_type_id": "mat-cwiartka", "raw_name": "Ćwiartka z kurczaka", "kg_raw": 40.0}],
    ]
    out = {r["raw_type_id"]: r["kg_raw"] for r in mrs._sum_by_raw(line_rows)}
    assert out == {"mat-cwiartka": 140.0, "mat-filet-kurczak": 30.0}


def test_preview_single_component_goes_to_cwiartka(monkeypatch):
    _patch_common(monkeypatch, yield_pct=50.0)  # brak składu → mięso z/s 100%
    data = mrs.preview_requirements(
        [{"qty": 10, "kg_per_unit": 4, "recipe_id": "", "product_type_id": ""}]
    )
    raw = {t["raw_type_id"]: t for t in data["totals_by_raw"]}
    # 40 kg output, brak dodatków → 40 kg mięsa z/s → ćwiartka 40/0.5 = 80
    assert raw["mat-cwiartka"]["kg_raw"] == 80.0
    assert data["yield_pct"] == 50.0


def test_preview_7030_splits_into_cwiartka_and_filet(monkeypatch):
    _patch_common(monkeypatch, yield_pct=50.0, primary=[
        {"materialTypeId": "mat-mieso-zs", "name": "Mięso z/s", "pct": 70},
        {"materialTypeId": "mat-filet-kurczak", "name": "Filet", "pct": 30},
    ])
    data = mrs.preview_requirements(
        [{"qty": 10, "kg_per_unit": 10, "recipe_id": "r1", "product_type_id": "pt1"}]
    )
    raw = {t["raw_type_id"]: t for t in data["totals_by_raw"]}
    # 100 kg output → 100 kg mięsa: 70 z/s → ćwiartka 140; 30 filet → 30
    assert raw["mat-cwiartka"]["kg_raw"] == 140.0
    assert raw["mat-filet-kurczak"]["kg_raw"] == 30.0


def test_summary_remaining_uses_qty_done_and_net_shortage_cascade(monkeypatch):
    # jedno otwarte zamówienie: 10 szt × 10 kg, 4 zrobione → reszta 6 szt = 60 kg output
    # brak składu → mięso z/s; yield 50%
    _patch_common(monkeypatch, yield_pct=50.0)
    import app.services.orders_service as os_
    monkeypatch.setattr(os_, "list_orders", lambda status: [{"id": "o1", "status": "new"}])
    monkeypatch.setattr(os_, "get_order", lambda oid: {
        "id": "o1",
        "lines": [{"qty": 10, "qty_done": 4, "kg_per_unit": 10,
                   "recipe_id": "r1", "product_type_id": "pt1"}],
    })
    # magazyn: 10 kg gotowego mięsa z/s + 5 kg ćwiartki
    monkeypatch.setattr(mrs, "_stock_by_type", lambda: {"mat-mieso-zs": 10.0, "mat-cwiartka": 5.0})

    data = mrs.requirements_summary()
    total = {t["raw_type_id"]: t["kg_raw"] for t in data["total"]}
    remaining = {t["raw_type_id"]: t["kg_raw"] for t in data["remaining"]}
    net = {s["raw_type_id"]: s for s in data["net_shortage"]}
    # total: 100 kg output → 100 kg mięsa z/s → ćwiartka 200
    assert total["mat-cwiartka"] == 200.0
    # remaining: 60 kg output → 60 kg mięsa z/s → ćwiartka 120
    assert remaining["mat-cwiartka"] == 120.0
    # net: potrzeba mięsa z/s 60, magazyn 10 → brak 50 → ćwiartka 100; minus 5 stanu = 95
    assert net["mat-cwiartka"]["kg_needed_raw"] == 100.0
    assert net["mat-cwiartka"]["kg_available"] == 5.0
    assert net["mat-cwiartka"]["kg_net_shortage"] == 95.0


def test_summary_skips_done_and_cancelled_orders(monkeypatch):
    _patch_common(monkeypatch, yield_pct=70.0)
    import app.services.orders_service as os_
    monkeypatch.setattr(os_, "list_orders", lambda status: [
        {"id": "done1", "status": "done"}, {"id": "cx1", "status": "cancelled"}])
    monkeypatch.setattr(os_, "get_order", lambda oid: (_ for _ in ()).throw(
        AssertionError("nie powinno czytać zamkniętych zamówień")))
    monkeypatch.setattr(mrs, "_stock_by_type", lambda: {})
    data = mrs.requirements_summary()
    assert data["total"] == [] and data["remaining"] == [] and data["net_shortage"] == []
