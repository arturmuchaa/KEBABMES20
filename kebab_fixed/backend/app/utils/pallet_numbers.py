"""Adres wydrukowanej kartki PAL|zamówienie|nr nie może być użyty ponownie."""
from app.db import cx_execute, cx_query_one


def reserve_pallet_numbers_cx(conn, order_id: str, *, allocate: bool = False) -> int:
    """Zapamiętaj najwyższy użyty numer, opcjonalnie nadaj następny.

    Wywołujący trzyma blokadę client_orders. Licznik przeżywa usunięcie
    ostatniej palety. Uwzględnia też adresy starych etykiet przeniesionych
    palet — samo MAX(order_pallets) ponownie zajęłoby adres aliasu.
    Bez migracji: pierwszy zapis inicjalizuje licznik z istniejących danych.
    """
    row = cx_query_one(conn, """
        SELECT COALESCE(MAX(n), 0) AS n FROM (
            SELECT pallet_no AS n FROM order_pallets WHERE order_id=%s
            UNION ALL SELECT pallet_no FROM orphan_pallets WHERE source_order_id=%s
            UNION ALL SELECT pallet_no FROM pallet_label_aliases WHERE order_id=%s
            UNION ALL SELECT target_pallet_no FROM pallet_label_aliases WHERE target_order_id=%s
        ) used_numbers""", (order_id,) * 4)
    key = f"pallet_no:{order_id}"
    cx_execute(conn, """INSERT INTO sequences (key, value) VALUES (%s,%s)
        ON CONFLICT (key) DO UPDATE SET value=GREATEST(sequences.value, EXCLUDED.value)""",
        (key, int(row["n"])))
    row = cx_query_one(conn, """UPDATE sequences SET value=value+%s
        WHERE key=%s RETURNING value""", (int(allocate), key))
    return int(row["value"])
