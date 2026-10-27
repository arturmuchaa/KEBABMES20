from copy import deepcopy

import pytest
from fastapi import HTTPException

from app.services import zebra_labels_service as raw
from app.services import zebra_designer_service as designer
from app.services import label_templates_service as templates
from app.services.label_unit_selection import select_existing_units, one_copy, has_unit_qr, validate_template_binding


@pytest.mark.parametrize("ids", ["", ",", "a,", "a,a", "foreign"])
def test_invalid_selection_never_falls_back_to_whole_batch(ids):
    with pytest.raises(HTTPException):
        select_existing_units([{"id": "a"}], ids)


def test_selection_preserves_existing_records_and_order():
    units = [{"id": "a", "qr_code": "U|a"}, {"id": "b", "qr_code": "U|b"}]
    assert select_existing_units(units, None) is units
    assert select_existing_units(units, "b")[0] is units[1]
    assert select_existing_units(units, "b,a") == units


def test_only_a_real_dynamic_qr_qualifies_and_print_quantity_is_one():
    assert has_unit_qr("^XA^FO0,0^BQN,2,4^FDLA,[[QR]]^FS^XZ")
    assert not has_unit_qr("^XA^FD[[QR]]^FS^XZ")
    assert not has_unit_qr("^XA^BQN,2,4^FDLA,STATIC^FS^XZ")
    result = one_copy("^XA^PQ100^FO0,0^FDtext^FS^PQ3,0,0,Y^XZ")
    assert result.count("^PQ") == 1
    assert "^PQ1,0,0,Y" in result
    with pytest.raises(HTTPException):
        one_copy("^XA^XZ^XA^XZ")


@pytest.fixture
def units():
    return [{"id": f"unit-{i}", "qr_code": f"U|unit-{i:04}", "batch_no": "401",
             "produced_date": "2026-10-15", "weight_kg": 20, "client_name": "VATAN", "recipe_id": "recipe"} for i in range(500)]


@pytest.mark.parametrize("service", [raw, designer])
def test_500_units_and_single_reprint_keep_qr_and_data_without_creating_units(monkeypatch, units, service):
    original = deepcopy(units)
    def one(sql, params=()):
        if "FROM clients" in sql:
            return {"name": "VATAN", "display_name": "VATAN"}
        if "FROM recipes" in sql:
            return {"name": "Kebab", "shelf_life_days": 365}
        if "FROM label_templates" in sql:
            return {"kind": "zpl", "zpl": "^XA^PQ100^FO0,0^BQN,2,4^FDLA,[[QR]]^FS^FO0,50^FD[[PARTIA]]^FS^XZ"}
        if "FROM zebra_label_designs" in sql:
            return {"background_zpl": "^XA^PQ100^XZ", "elements": [
                {"type": "qr", "x": 1, "y": 1, "value": "[[QR]]"},
                {"type": "text", "x": 1, "y": 30, "value": "[[PARTIA]]"},
            ]}
        raise AssertionError(sql)
    monkeypatch.setattr(service, "query_one", one)
    monkeypatch.setattr(templates, "query_one", one)
    monkeypatch.setattr(service, "query_all", lambda sql, params: units)
    def render(ids=None):
        if service is raw:
            return raw.render_zebra_labels("line", "VATAN", "recipe", ids)
        return designer.render_units("VATAN", "recipe", "line", ids)
    batch = render()
    assert batch["count"] == 500
    assert batch["zpl"].count("^XA") == 500
    assert batch["zpl"].count("^PQ1,0,0,Y") == 500
    assert "^PQ100" not in batch["zpl"]
    for unit in units:
        assert batch["zpl"].count(unit["qr_code"]) == 1
    reprint = render("unit-42")
    assert reprint["count"] == 1
    assert "U|unit-0042" in reprint["zpl"] and "^FD401^FS" in reprint["zpl"]
    assert reprint["zpl"].count("^XA") == 1
    assert units == original
    with pytest.raises(HTTPException):
        render("foreign-unit")
    units[1]["qr_code"] = units[0]["qr_code"]
    assert not render()["ok"]


@pytest.mark.parametrize("kind,expected", [("overlay", "pdf"), ("zpl", "zebra")])
def test_resolver_recognizes_legacy_zpl_templates(monkeypatch, kind, expected):
    monkeypatch.setattr(templates, "client_key_candidates", lambda value: [value])
    monkeypatch.setattr(templates, "query_one", lambda sql, params: None if "zebra_label_designs" in sql else {"kind": kind})
    assert templates.resolve_label_kind("VATAN", "recipe") == {"kind": expected}


def test_reprint_cannot_mix_clients_or_recipes():
    units = [{"recipe_id": "r1", "client_name": "VATAN"}]
    validate_template_binding(units, ["c1", "VATAN"], "r1")
    with pytest.raises(HTTPException):
        validate_template_binding(units, ["OTHER"], "r1")
    with pytest.raises(HTTPException):
        validate_template_binding(units, ["VATAN"], "r2")


@pytest.mark.parametrize("command", ["~JA", "^JUS", "^DFR:FILE", "^XGR:FILE", "^CC!", "^CT!", "^GFB,1,1,1,0", "^GFA,1,1,1,FFFF", "\x1bRESET"])
def test_production_and_sample_output_refuse_unknown_or_device_commands(command):
    with pytest.raises(HTTPException):
        one_copy(f"^XA{command}^XZ")


def test_a_commented_out_qr_does_not_qualify():
    assert not has_unit_qr("^XA^FX^BQN,2,4^FDLA,[[QR]]^FS^XZ")


@pytest.mark.parametrize("service", [raw, designer])
def test_missing_dynamic_qr_blocks_production_not_just_preview(monkeypatch, service, units):
    monkeypatch.setattr(templates, "client_key_candidates", lambda value: [value])
    monkeypatch.setattr(designer, "client_key_candidates", lambda value: [value])
    monkeypatch.setattr(service, "query_one", lambda sql, params: {
        "kind": "zpl", "zpl": "^XA^FO0,0^BQN,2,4^FDLA,STATIC^FS^XZ", "elements": [],
    })
    monkeypatch.setattr(service, "query_all", lambda sql, params: units)
    result = (raw.render_zebra_labels("line", "VATAN", "recipe") if service is raw
              else designer.render_units("VATAN", "recipe", "line"))
    assert result["ok"] is False
    assert "QR" in result["reason"]
    assert "zpl" not in result
