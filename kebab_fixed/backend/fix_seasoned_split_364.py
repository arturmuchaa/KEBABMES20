"""Jednorazowa korekta: rozdziel zlany wiersz seasoned_meat batch_no='364'
na partie per (recipe_id, dzień). Idempotentny. Uruchom RĘCZNIE na prod:

    set -a; . /opt/kebab/config/.env; set +a
    cd /opt/kebab/app/backend && python3 fix_seasoned_split_364.py
"""
from app.db import transaction, cx_query_one, cx_query_all, cx_execute
from app.services.seasoned_meat_service import split_seasoned_sessions
from app.utils.ids import cuid

BATCH_NO = "364"


def main():
    with transaction() as conn:
        rows = cx_query_all(
            conn, "SELECT * FROM seasoned_meat WHERE batch_no=%s ORDER BY created_at", (BATCH_NO,)
        )
        if len(rows) == 0:
            print(f"Brak wiersza batch_no={BATCH_NO} — nic do zrobienia.")
            return
        if len(rows) > 1:
            print(f"batch_no={BATCH_NO} już rozdzielony ({len(rows)} wierszy) — pomijam (idempotentne).")
            return

        orig = rows[0]
        kg_used_total = float(orig.get("kg_used") or 0)
        mat_id = orig.get("material_type_id")
        mat_name = orig.get("material_name")
        expiry = orig.get("expiry_date")

        sessions = cx_query_all(
            conn,
            """
            SELECT mo.recipe_id, mo.recipe_name,
                   ms.started_at::date::text AS day, ms.kg_output
            FROM mixing_sessions ms
            JOIN mixing_orders mo ON mo.id = ms.order_id
            WHERE ms.batch_no = %s
            """,
            (BATCH_NO,),
        )
        if not sessions:
            print("Brak sesji dla 364 — nie mogę odtworzyć podziału. Przerywam.")
            return

        groups = split_seasoned_sessions(sessions, kg_used_total)

        # Asercja spójności kg przed zapisem
        sum_prod = round(sum(g["kg_produced"] for g in groups), 3)
        sum_avail = round(sum(g["kg_available"] for g in groups), 3)
        orig_prod = round(float(orig.get("kg_produced") or 0), 3)
        orig_avail = round(float(orig.get("kg_available") or 0), 3)
        assert sum_prod == orig_prod, f"kg_produced nie zgadza się: {sum_prod} != {orig_prod}"
        assert sum_avail == orig_avail, f"kg_available nie zgadza się: {sum_avail} != {orig_avail}"

        # Pierwsza (najstarsza, FEFO) grupa → UPDATE oryginalnego wiersza (zachowanie id)
        first, rest = groups[0], groups[1:]
        cx_execute(
            conn,
            """
            UPDATE seasoned_meat
            SET recipe_id=%s, recipe_name=%s, production_day=%s,
                kg_produced=%s, kg_available=%s, kg_used=%s
            WHERE id=%s
            """,
            (first["recipe_id"], first["recipe_name"], first["production_day"],
             first["kg_produced"], first["kg_available"], first["kg_used"], orig["id"]),
        )
        # Pozostałe grupy → INSERT nowe wiersze (ten sam batch_no, inny dzień/recept)
        for g in rest:
            cx_execute(
                conn,
                """
                INSERT INTO seasoned_meat
                    (id, batch_no, recipe_id, recipe_name, mixing_order_no,
                     kg_produced, kg_available, kg_used, machine_id,
                     expiry_date, status, material_type_id, material_name,
                     production_day, created_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,%s,'available',%s,%s,%s, (%s::date)::timestamptz)
                """,
                (cuid(), BATCH_NO, g["recipe_id"], g["recipe_name"], orig.get("mixing_order_no") or "",
                 g["kg_produced"], g["kg_available"], g["kg_used"],
                 expiry, mat_id, mat_name, g["production_day"], g["production_day"]),
            )
        print(f"Rozdzielono 364 na {len(groups)} partii: "
              + ", ".join(f'{g["recipe_name"]}/{g["production_day"]}={g["kg_available"]}kg' for g in groups))


if __name__ == "__main__":
    main()
