"""Frozen inputs for the existing A4 v1 renderer, not an alternative PDF engine.

Keep the original sheet/slot on a single-piece reprint. The document is rendered
again by the versioned legacy frontend; this is NOT a stored final PDF artifact.
"""
import math
from datetime import date

from fastapi import HTTPException

VERSION = 'legacy-a4-v1'
MAX_A4_UNITS = 200
MAX_TEMPLATE_BYTES = 32 * 1024 * 1024
TEXT_FIELDS = ('prod_date', 'freeze_date', 'best_before', 'batch_no', 'weight', 'org_code')


def finite(value) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def validate_template(template: dict) -> int:
    per_sheet = template.get('labels_per_sheet', 2)
    if type(per_sheet) is not int or not 1 <= per_sheet <= 20:
        raise HTTPException(422, 'Nieprawidłowa liczba etykiet na arkuszu A4')
    for key, prefixes in (
        ('background_pdf', ('data:application/pdf;base64,',)),
        ('background_data', tuple(f'data:image/{kind};base64,' for kind in ('png', 'jpeg', 'webp'))),
    ):
        asset = template.get(key) or ''
        if not isinstance(asset, str) or (asset and not asset.startswith(prefixes)):
            raise HTTPException(422, 'Historia A4 wymaga osadzonego PDF/PNG/JPEG/WebP, nie zewnętrznego adresu URL')
        if len(asset.encode('utf-8')) > MAX_TEMPLATE_BYTES:
            raise HTTPException(413, 'Tło A4 przekracza limit 32 MiB')
    positions = template.get('field_positions') or {}
    overrides = template.get('slot_field_positions') or {}
    offsets = template.get('slot_offsets') or []
    calib = template.get('print_calib') or {}
    if not isinstance(positions, dict) or not isinstance(overrides, dict) or not isinstance(offsets, list) or not isinstance(calib, dict):
        raise HTTPException(422, 'Nieprawidłowa konfiguracja układu A4')
    for fields in (positions, *overrides.values()):
        if not isinstance(fields, dict):
            raise HTTPException(422, 'Nieprawidłowe nadpisanie slotu A4')
        for key in ('qr', *TEXT_FIELDS):
            field = fields.get(key)
            if field is not None and (not isinstance(field, dict) or any(not finite(field.get(k)) for k in ('x', 'y', 'size')) or field['size'] <= 0):
                raise HTTPException(422, f'Nieprawidłowa pozycja lub rozmiar pola A4: {key}')
    if any(not isinstance(o, dict) or any(not finite(o.get(k)) for k in ('dx', 'dy')) for o in offsets):
        raise HTTPException(422, 'Nieprawidłowe przesunięcia slotów A4')
    if any(not finite(calib[k]) for k in ('dxMm', 'dyMm', 'scale') if k in calib and calib[k] is not None) or (calib.get('scale') is not None and calib['scale'] <= 0):
        raise HTTPException(422, 'Nieprawidłowa kalibracja A4')
    return per_sheet


def context(template: dict, recipe: dict, client: dict, org_code: str | None, count: int) -> dict:
    per_sheet = validate_template(template)
    if count > MAX_A4_UNITS:
        raise HTTPException(413, f'Jedno zadanie A4 może zawierać do {MAX_A4_UNITS} sztuk. Wybierz mniejszą paczkę.')
    if not client:
        raise HTTPException(422, 'Nie znaleziono klienta — nie można ustalić nadzoru HALAL')
    halal = bool(client.get('halal_supervision'))
    if halal and not (org_code or '').strip():
        raise HTTPException(422, 'Wpisz kod nadzoru HALAL przed przygotowaniem wydruku')
    if any(ord(c) < 32 for c in (org_code or '')):
        raise HTTPException(422, 'Kod nadzoru zawiera niedozwolone znaki sterujące')
    days = recipe.get('shelf_life_days') if recipe.get('shelf_life_days') is not None else 5
    if type(days) is not int or not 0 <= days <= 36500:
        raise HTTPException(422, 'Nieprawidłowa trwałość produktu')
    return {'rendererVersion': VERSION, 'shelfLifeDays': days,
            'orgCode': org_code or '', 'halal': halal, 'labelsPerSheet': per_sheet}


def item(unit: dict, template: dict, ordinal: int, per_sheet: int) -> dict:
    slot = ordinal % per_sheet
    fp = template.get('field_positions') or {}
    override = (template.get('slot_field_positions') or {}).get(str(slot), {})
    qr = override.get('qr') if override.get('qr') is not None else fp.get('qr')
    if not isinstance(qr, dict) or any(not finite(qr.get(k)) for k in ('x', 'y', 'size')) or qr['size'] <= 0:
        raise HTTPException(422, f'Slot {slot + 1} wymaga prawidłowej pozycji i rozmiaru QR')
    # Never use the browser's clock on a historical reprint. Missing production
    # dates are a data error, not permission to silently change the batch date.
    produced = str(unit.get('produced_date') or (unit.get('produced_at') or ''))[:10]
    try:
        date.fromisoformat(produced)
    except ValueError as exc:
        raise HTTPException(422, 'Brak prawidłowej daty produkcji sztuki — nie użyto daty dzisiejszej') from exc
    weight = float(unit.get('weight_kg') or 0)
    if not math.isfinite(weight) or weight < 0:
        raise HTTPException(422, 'Nieprawidłowa masa sztuki')
    return {'unit': {
        'id': unit['id'], 'qrCode': unit['qr_code'], 'status': unit['status'],
        'clientName': unit.get('client_name') or '', 'recipeId': unit.get('recipe_id') or '',
        'productTypeId': unit.get('product_type_id') or '', 'tuleja': unit.get('tuleja') or '',
        'weightKg': weight, 'batchNo': unit.get('batch_no') or '',
        'producedDate': produced,
    }, 'placement': {'sheet': ordinal // per_sheet, 'slot': slot}}
