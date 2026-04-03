#!/usr/bin/env python3
"""
Migracja numerów partii mięsa przyprawionego: PW-2026-xxx → MP{seq} / MPP{n}
Uruchom JEDNORAZOWO na VPS:
  python3 /opt/kebab/app/backend/migrate_batch_numbers.py
"""
import os, sys
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://kebab_user:kebab_pass@localhost:5432/kebab_mes"
)

def parse_url(url):
    from urllib.parse import urlparse
    r = urlparse(url)
    return r.username, r.password, r.hostname, r.port or 5432, r.path.lstrip('/')

def get_conn():
    u, pw, h, port, db = parse_url(DATABASE_URL)
    return psycopg2.connect(host=h, port=port, user=u, password=pw, dbname=db)

def main():
    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Pobierz wszystkie partie z starym formatem PW-xxxx
    cur.execute("""
        SELECT sm.id, sm.batch_no, sm.mixing_order_no
        FROM seasoned_meat sm
        WHERE sm.batch_no LIKE 'PW-%'
        ORDER BY sm.batch_no
    """)
    old_batches = cur.fetchall()

    if not old_batches:
        print("Brak partii do migracji (brak PW-xxxx).")
        conn.close()
        return

    print(f"Znaleziono {len(old_batches)} partii do przemianowania:")

    # Pobierz aktualną wartość mixed_seq
    cur.execute("SELECT value FROM sequences WHERE key='mixed_seq'")
    row = cur.fetchone()
    mixed_seq = (row['value'] if row else 0)

    renamed = []
    for batch in old_batches:
        old_no   = batch['batch_no']
        order_no = batch['mixing_order_no']

        new_no = None

        if order_no:
            # Znajdź zlecenie masowania
            cur.execute("SELECT id FROM mixing_orders WHERE order_no=%s", (order_no,))
            mo = cur.fetchone()
            if mo:
                # Pobierz seqs ćwiartek użytych w tym zleceniu
                cur.execute("""
                    SELECT DISTINCT rb.internal_batch_seq
                    FROM mixing_order_lots mol
                    LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                    LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                    WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
                """, (mo['id'],))
                seqs = [r['internal_batch_seq'] for r in cur.fetchall() if r['internal_batch_seq']]
                if len(seqs) == 1:
                    new_no = f"MP{seqs[0]}"
                elif len(seqs) > 1:
                    mixed_seq += 1
                    new_no = f"MPP{mixed_seq}"

        if not new_no:
            # Fallback: nie możemy ustalić seq — używamy MPP
            mixed_seq += 1
            new_no = f"MPP{mixed_seq}"

        renamed.append((old_no, new_no, batch['id']))
        print(f"  {old_no}  →  {new_no}")

    print("\nZatwierdź zmianę? (tak/nie): ", end="", flush=True)
    answer = input().strip().lower()
    if answer not in ('tak', 't', 'yes', 'y'):
        print("Anulowano.")
        conn.close()
        return

    # Wykonaj zmianę
    for old_no, new_no, batch_id in renamed:
        # seasoned_meat
        cur.execute("UPDATE seasoned_meat SET batch_no=%s WHERE id=%s", (new_no, batch_id))
        # mixing_sessions
        cur.execute("UPDATE mixing_sessions SET batch_no=%s WHERE batch_no=%s", (new_no, old_no))
        # production_plan_lines (seasoned_batch_no i tablice)
        cur.execute("""
            UPDATE production_plan_lines
            SET seasoned_batch_no = %s
            WHERE seasoned_batch_no = %s
        """, (new_no, old_no))
        cur.execute("""
            UPDATE production_plan_lines
            SET seasoned_batch_nos = array_replace(seasoned_batch_nos, %s, %s)
            WHERE %s = ANY(seasoned_batch_nos)
        """, (old_no, new_no, old_no))
        # finished_goods
        cur.execute("""
            UPDATE finished_goods
            SET seasoned_batch_nos = array_replace(seasoned_batch_nos, %s, %s)
            WHERE %s = ANY(seasoned_batch_nos)
        """, (old_no, new_no, old_no))

    # Zaktualizuj mixed_seq
    cur.execute("""
        INSERT INTO sequences (key, value) VALUES ('mixed_seq', %s)
        ON CONFLICT (key) DO UPDATE SET value = %s
    """, (mixed_seq, mixed_seq))

    conn.commit()
    print(f"\n✓ Przemianowano {len(renamed)} partii.")
    conn.close()

if __name__ == '__main__':
    main()
