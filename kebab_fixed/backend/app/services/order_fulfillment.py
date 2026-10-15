"""Read-only kilogram projection of the canonical order coverage.

This is NOT gross production: coverage can include pooled stock, manual WZ
and the existing closed-order convention. Never add plan, pallet or carton
quantities to it (they describe the same goods at different stages).
"""
from decimal import Decimal


def line_fulfillment(line: dict) -> dict:
    kg = Decimal(str(line.get("kg_per_unit") or 0))
    qty = max(0, int(line.get("qty") or 0))
    delivered = min(qty, max(0, int(line.get("qty_delivered") or 0)))
    stock = min(qty - delivered, max(0, int(line.get("qty_stock") or 0)))
    return {
        "ordered_kg": float(kg * qty),
        "stock_kg": float(kg * stock),
        "delivered_kg": float(kg * delivered),
        "covered_kg": float(kg * (stock + delivered)),
        "remaining_kg": float(kg * (qty - stock - delivered)),
    }


def attach_fulfillment(order: dict) -> dict:
    """Project already allocated quantities, without redistributing on selection."""
    totals = {key: Decimal(0) for key in line_fulfillment({})}
    for line in order["lines"]:
        line["fulfillment"] = line_fulfillment(line)
        for key, value in line["fulfillment"].items():
            totals[key] += Decimal(str(value))
    order["fulfillment"] = {key: float(value) for key, value in totals.items()}
    order["coverage_basis"] = (
        "closed_order" if order.get("status") == "done" else "stock_and_documents"
    )
    return order
