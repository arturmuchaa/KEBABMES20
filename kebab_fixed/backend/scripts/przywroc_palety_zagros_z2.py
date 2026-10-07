"""Jednorazowo: palety usuniętego ZAGROS/Z/2/10/26 wracają do poczekalni.

07.10.2026 biuro usunęło ZAGROS/Z/2/10/26 (6 rozpisanych palet z wydrukowanymi
kartkami) i założyło Z/3. Usunięcie skasowało wtedy palety kaskadą — przed
wdrożeniem poczekalni palet. Dane z kopii auto-kebab_mes-20261007-023151:
zamówienie 019727c2d99e4514b595, klient 891350199e3d440ba335, wszystkie
pozycje KIRMIZI / KEBAB UDO 100% / METAL 65CM.

Skrypt wstawia te palety do `orphan_pallets` z ORYGINALNYMI id i numerami
(stare kartki PAL|019727c2d99e4514b595|<nr>) i od razu próbuje przypiąć je do
otwartych zamówień odbiorcy (`attach_to_pool_cx`). Czego nie da się przypiąć,
zostaje w poczekalni (widać w biurze).

Uruchomienie (z katalogu backend/, na serwerze):
    python3 scripts/przywroc_palety_zagros_z2.py            # na sucho
    python3 scripts/przywroc_palety_zagros_z2.py --zapisz   # zapis
"""
import json
import sys

sys.path.insert(0, ".")

from app.db import cx_execute, cx_query_one, transaction  # noqa: E402
from app.services.pallet_transfer_service import attach_to_pool_cx  # noqa: E402

ORDER_ID = "019727c2d99e4514b595"
ORDER_NO = "ZAGROS/Z/2/10/26"
CLIENT_ID = "891350199e3d440ba335"
CREATED = "2026-10-05 15:50:01.719807+00"
SPEC = {"recipe_id": "0e99ac68ef784c8c9a03", "recipe_name": "KIRMIZI",
        "product_type_id": "8e97d04467a24338b78c", "product_type_name": "KEBAB UDO 100%",
        "packaging_id": "a0eecc79d0e74a3585f8", "packaging_name": "METAL 65CM"}
PALETY = [  # (id, nr, karton, kg, szt)
    ("a1c8592ec1764f20b9d2", 1, 317, 30.0, 30),
    ("467c2219a6f14c0bbaac", 2, 359, 50.0, 15),
    ("232566a985924aebb546", 3, 360, 40.0, 20),
    ("dc6016dc43204b8caaba", 4, 361, 30.0, 30),
    ("041384f7c23f4f59bdaf", 5, 362, 20.0, 40),
    ("72927066148b4f8e82e7", 6, 363, 15.0, 60),
]


def main(zapisz: bool) -> None:
    class Wycofaj(Exception):
        pass

    try:
        with transaction() as conn:
            if cx_query_one(conn, "SELECT 1 FROM client_orders WHERE id=%s", (ORDER_ID,)):
                raise SystemExit("Zamówienie Z/2 istnieje — nic do odzyskania.")
            for pid, nr, karton, kg, szt in PALETY:
                if cx_query_one(conn, "SELECT 1 FROM order_pallets WHERE id=%s", (pid,)):
                    raise SystemExit(f"Paleta {pid} już jest w order_pallets — przerwano.")
                cx_execute(
                    conn,
                    """INSERT INTO orphan_pallets
                         (id, source_order_id, source_order_no, client_id, client_name, pallet_no,
                          carton_no, notes, status, created_at, items, reason)
                       VALUES (%s,%s,%s,%s,'ZAGROS',%s,%s,'','created',%s,%s::jsonb,
                               'usunięcie zamówienia (odzyskane z kopii)')
                       ON CONFLICT (id) DO NOTHING""",
                    (pid, ORDER_ID, ORDER_NO, CLIENT_ID, nr, karton, CREATED,
                     json.dumps([{**SPEC, "kg_per_unit": kg, "qty": szt}])))
            moved = attach_to_pool_cx(conn, CLIENT_ID)
            for m in moved:
                o = cx_query_one(conn, "SELECT o.order_no FROM order_pallets p JOIN client_orders o "
                                       "ON o.id=p.order_id WHERE p.id=%s", (m["palletId"],))
                print(f"  {ORDER_NO} P{m['fromPalletNo']} (karton {m['cartonNo']}) → "
                      f"{o['order_no']} P{m['palletNo']}")
            zostaje = cx_query_one(conn, "SELECT string_agg('P' || pallet_no, ', ' ORDER BY pallet_no) AS p "
                                         "FROM orphan_pallets WHERE source_order_id=%s", (ORDER_ID,))
            print(f"  w poczekalni zostaje: {zostaje['p'] or '—'}")
            if not zapisz:
                raise Wycofaj()
    except Wycofaj:
        print("NA SUCHO — nic nie zapisano (uruchom z --zapisz).")
        return
    print("ZAPISANO.")


if __name__ == "__main__":
    main("--zapisz" in sys.argv)
