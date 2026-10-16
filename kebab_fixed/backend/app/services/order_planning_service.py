"""Read-only planning projection. Never writes stock, plans or order quantities.

Production reports and stock coverage are different measures. Only unposted
reports can reduce the stock-based gap; when their overlap with existing
coverage cannot be proven we return unknown, rather than add the same piece.
"""
from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.db import query_all
from app.services.material_requirements_service import meat_factor
from app.utils.product_key import klucz_wyrobu


def number(value):
    try:
        result = Decimal(str(value))
        return result if result.is_finite() and result >= 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def kg(value):
    return float(value.quantize(Decimal('.001'), rounding=ROUND_HALF_UP))


def technology(recipe, ingredients):
    """Inverse of calc_kg_output, NOT the deboning percentage or cached yield.

MES treats L as kg and omits g/ml. Do not quietly use a guessed density or
ignore a positive gram/millilitre ingredient in the new planner.
"""
    if not recipe or not ingredients:
        return None, 'Brak kompletnego składu receptury na 100 kg mięsa.'
    for ingredient in ingredients:
        amount = number(ingredient.get('qty_per_100kg'))
        if amount is None:
            return None, 'Nieprawidłowa ilość składnika receptury.'
        # Match the production calculator exactly, including its unit handling.
        unit = (ingredient.get('unit') or '').lower()
        if amount > 0 and unit not in ('kg', 'l'):
            return None, 'Składnik poza kg/L — uzysk wymaga weryfikacji technologicznej.'
        if unit == 'l' and amount > 0 and not ingredient.get('is_unlimited'):
            return None, 'Składnik w litrach bez potwierdzenia wody — nie znamy gęstości.'
    factor = Decimal(str(meat_factor(ingredients)))
    output = Decimal(100) * (1 + factor)
    declared = number(recipe.get('total_output_per_100kg'))
    if recipe.get('total_output_per_100kg') is not None and declared is None:
        return None, 'Nieprawidłowy uzysk zapisany w recepturze.'
    # The catalog's default 100 is NOT an explicit +0% yield. A conflicting
    # cached value is not silently trusted, even though production uses ingredients.
    if declared is not None and abs(declared - output) > Decimal('.01'):
        return None, 'Uzysk zapisany w recepturze różni się od sumy składników.'
    return output, None


def project_line(line, reports, recipe, ingredients, status):
    qty = max(0, int(line.get('qty') or 0))
    weight = number(line.get('kg_per_unit'))
    weight_issue = 'Brak prawidłowej dodatniej wagi sztuki.' if not weight else None
    weight = weight or Decimal(0)
    key = lambda r: klucz_wyrobu(r.get('recipe_id'), r.get('kg_per_unit'), r.get('product_type_id'), r.get('packaging_id'))
    valid, issue = [], weight_issue
    seen = set()
    for report in reports:
        if report.get('plan_status') == 'cancelled' or report['id'] in seen:
            continue
        seen.add(report['id'])
        if weight_issue:
            continue
        if number(report.get('kg_per_unit')) is None or key(report) != key(line):
            issue = 'Raport produkcji ma inny wariant niż pozycja zamówienia.'
        else:
            valid.append(report)
    reported = sum(max(0, int(r.get('qty_done') or 0)) for r in valid)
    unposted = sum(max(0, int(r.get('qty_done') or 0) - int(r.get('posted_qty') or 0)) for r in valid)
    production = None if issue else {
        'reported_qty': reported, 'reported_kg': kg(weight * reported),
        'remaining_qty': max(0, qty - reported),
        'remaining_kg': kg(weight * max(0, qty - reported)),
        'unposted_qty': unposted, 'source': 'linked_plan_reports',
    }
    covered = min(qty, max(0, int(line.get('qty_done') or 0)))
    remaining = max(0, qty - covered)
    basis = 'stock_and_documents'
    if status in ('done', 'cancelled'):
        remaining, issue = 0, None
        basis = 'closed_order'
    elif unposted and covered and remaining:
        remaining = None
        issue = 'Raport HMI i pokrycie magazynowe mogą obejmować te same sztuki. Uzgodnij przyjęcie produkcji przed mieszaniem.'
    elif unposted and not covered:
        remaining = max(0, qty - unposted)
        basis = 'unposted_plan_reports'
    if issue:
        remaining = None
    output, tech_issue = technology(recipe, ingredients)
    remaining_kg = weight * remaining if remaining is not None else None
    meat = remaining_kg * 100 / output if output and remaining_kg is not None else None
    # A completed order needs no new meat, even if its historical recipe is missing.
    if remaining == 0:
        meat = Decimal(0)
    mixing = {
        'remaining_qty': remaining,
        'remaining_kg': kg(remaining_kg) if remaining_kg is not None else None,
        'meat_kg': kg(meat) if meat is not None else None,
        'additives_kg': kg(remaining_kg - meat) if meat is not None else None,
        'output_per_100kg': float(output) if output else None,
        'growth_pct': float(output - 100) if output else None,
        'reason': issue or (tech_issue if remaining != 0 else None),
        'basis': basis, 'source': 'recipe_ingredients_per_100kg',
    }
    return production, mixing


def enrich_orders(orders):
    """Three bounded batch reads, independent of how many orders are selected."""
    if not orders:
        return orders
    ids = [o['id'] for o in orders]
    reports = query_all("""
        SELECT pl.id, pl.client_order_line_id, pl.recipe_id, pl.product_type_id,
               pl.packaging_id, pl.kg_per_unit, pl.qty_done, pp.status AS plan_status,
               COALESCE(s.qty, 0) AS posted_qty
        FROM production_plan_lines pl
        JOIN production_plans pp ON pp.id = pl.plan_id
        JOIN client_order_lines ol ON ol.id = pl.client_order_line_id
        LEFT JOIN LATERAL (
            SELECT SUM(qty) AS qty FROM finished_goods_sessions WHERE plan_line_id = pl.id
        ) s ON true
        WHERE ol.order_id = ANY(%s)
    """, (ids,))
    by_line = defaultdict(list)
    for report in reports:
        by_line[report['client_order_line_id']].append(report)
    recipe_ids = list({l.get('recipe_id') for o in orders for l in o['lines'] if l.get('recipe_id')})
    recipes = {r['id']: r for r in query_all(
        'SELECT id, total_output_per_100kg FROM recipes WHERE id = ANY(%s)', (recipe_ids,))} if recipe_ids else {}
    ingredients = defaultdict(list)
    if recipe_ids:
        for row in query_all("""
            SELECT ri.recipe_id, ri.qty_per_100kg, ri.unit,
                   COALESCE(i.is_unlimited, false) AS is_unlimited
            FROM recipe_ingredients ri LEFT JOIN ingredients i ON i.id = ri.ingredient_id
            WHERE ri.recipe_id = ANY(%s)
        """, (recipe_ids,)):
            ingredients[row['recipe_id']].append(row)
    for order in orders:
        for line in order['lines']:
            rid = line.get('recipe_id')
            line['production'], line['mixing'] = project_line(
                line, by_line[line['id']], recipes.get(rid), ingredients[rid], order.get('status'))
    return orders
