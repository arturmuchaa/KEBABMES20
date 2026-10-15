from copy import deepcopy

import pytest

from app.services.order_fulfillment import attach_fulfillment, line_fulfillment
from app.services import orders_service as svc


@pytest.mark.parametrize("stock,delivered,remaining", [(0, 0, 10), (3, 2, 5), (10, 0, 0), (0, 10, 0)])
def test_kg_projection_separates_stock_and_deliveries(stock, delivered, remaining):
    result = line_fulfillment({"qty": 10, "kg_per_unit": "20.125", "qty_stock": stock, "qty_delivered": delivered})
    assert result == {"ordered_kg": 201.25, "stock_kg": stock * 20.125,
                      "delivered_kg": delivered * 20.125, "covered_kg": (stock + delivered) * 20.125,
                      "remaining_kg": remaining * 20.125}


def test_never_adds_reported_production_pallets_or_cartons_again():
    result = line_fulfillment({"qty": 10, "kg_per_unit": 20, "qty_stock": 3, "qty_delivered": 2,
                               "qty_done": 5, "packed_qty": 5, "qty_reported": 5})
    assert result["covered_kg"] == 100
    assert result["remaining_kg"] == 100


def test_overproduction_does_not_hide_shortage_of_another_variant():
    order = attach_fulfillment({"status": "confirmed", "lines": [
        {"qty": 2, "kg_per_unit": 20, "qty_stock": 8},
        {"qty": 3, "kg_per_unit": 30, "qty_stock": 1},
    ]})
    assert order["fulfillment"]["remaining_kg"] == 60
    assert order["fulfillment"]["ordered_kg"] == 130


def test_small_decimal_weights_sum_without_float_tails():
    order = attach_fulfillment({"lines": [{"qty": 1, "kg_per_unit": "0.1"}, {"qty": 1, "kg_per_unit": "0.2"}]})
    assert order["fulfillment"]["ordered_kg"] == 0.3
    assert order["fulfillment"]["remaining_kg"] == 0.3


def test_closed_convention_is_explicit_not_presented_as_production():
    order = attach_fulfillment({"status": "done", "lines": [{"qty": 1, "kg_per_unit": 40, "qty_delivered": 1}]})
    assert order["coverage_basis"] == "closed_order"
    assert order["fulfillment"]["stock_kg"] == 0
    assert "produced_kg" not in order["fulfillment"]


def test_list_hydrates_in_one_batch_without_per_order_queries(monkeypatch):
    orders = [{"id": str(i), "status": "confirmed"} for i in range(100)]
    lines = [{"id": f"l{i}", "order_id": str(i), "qty": 2, "kg_per_unit": 20} for i in range(100)]
    calls = []

    def query(sql, params=None):
        calls.append(sql)
        return deepcopy(lines if "client_order_lines" in sql else orders)

    monkeypatch.setattr(svc, "query_all", query)
    monkeypatch.setattr(svc, "_pokrycie_zamowien", lambda: {"0": {"l0": {"stan": 1, "wydane": 0}}})
    monkeypatch.setattr(svc, "query_one", lambda *a: pytest.fail("N+1 catalog lookup"))
    result = svc.list_orders(None)
    assert len(calls) == 2
    assert len(result) == 100
    assert result[0]["fulfillment"]["covered_kg"] == 20
    assert result[1]["fulfillment"]["remaining_kg"] == 40
