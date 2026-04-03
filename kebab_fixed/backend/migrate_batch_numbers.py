#!/usr/bin/env python3
"""
Migracja numerów partii mięsa przyprawionego: PW-2026-xxx → MP{seq} / MPP{n}

Algorytm nazewnictwa:
  MP{seq}  — z jednej ćwiartki (R{seq} → M{seq} → MP{seq})
  MPP{n}   — z kilku ćwiartek połączonych

Uruchom JEDNORAZOWO na VPS:
  python3 /opt/kebab/app/backend/migrate_batch_numbers.py
"""
import os, re
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

def extract_seq_from_batch_no(batch_no: str):
    """Wyciąga sekwencję z numeru partii, np. 'R172' → 172"""
    m = re.search(r'(\d+)$', batch_no or '')
    return int(m.group(1)) if m else None

def get_seqs_from_raw_batch_nos(cur, sm_id: str):
    """
    Ścieżka 1: raw_batch_nos w seasoned_meat — tablica ['R172', ...]
    Ścieżka 2: przez deboning_entries → meat_stock → raw_batches
    Ścieżka 3: przez mixing_order_lots
    """
    # Ścieżka 1: raw_batch_nos bezpośrednio w seasoned_meat
    cur.execute("SELECT raw_batch_nos, mixing_order_no FROM seasoned_meat WHERE id=%s", (sm_id,))
    sm = cur.fetchone()
    if not sm:
        return []

    raw_batch_nos = sm.get('raw_batch_nos') or []
    if raw_batch_nos:
        seqs = []
        for rbn in raw_batch_nos:
            s = extract_seq_from_batch_no(str(rbn))
            if s and s not in seqs:
                seqs.append(s)
        if seqs:
            return seqs

    # Ścieżka 2: source_deboning_ids → deboning_entries → meat_stock → raw_batches
    cur.execute("SELECT source_deboning_ids FROM seasoned_meat WHERE id=%s", (sm_id,))
    sm2 = cur.fetchone()
    deb_ids = sm2.get('source_deboning_ids') or [] if sm2 else []
    if deb_ids:
        placeholders = ','.join(['%s'] * len(deb_ids))
        cur.execute(f"""
            SELECT DISTINCT rb.internal_batch_seq
            FROM deboning_entries de
            LEFT JOIN meat_stock ms ON ms.deboning_session_id = de.id
            LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
            WHERE de.id IN ({placeholders}) AND rb.internal_batch_seq IS NOT NULL
        """, tuple(deb_ids))
        seqs = [r['internal_batch_seq'] for r in cur.fetchall() if r['internal_batch_seq']]
        if seqs:
            return seqs

    # Ścieżka 3: mixing_order_lots → meat_stock → raw_batches
    order_no = sm.get('mixing_order_no')
    if order_no:
        cur.execute("SELECT id FROM mixing_orders WHERE order_no=%s", (order_no,))
        mo = cur.fetchone()
        if mo:
            cur.execute("""
                SELECT DISTINCT rb.internal_batch_seq
                FROM mixing_order_lots mol
                LEFT JOIN meat_stock ms ON ms.id = mol.meat_stock_id
                LEFT JOIN raw_batches rb ON rb.id = ms.raw_batch_id
                WHERE mol.order_id = %s AND rb.internal_batch_seq IS NOT NULL
                  AND mol.kg_planned > 0
            """, (mo['id'],))
            seqs = [r['internal_batch_seq'] for r in cur.fetchall() if r['internal_batch_seq']]
            if seqs:
                return seqs

    return []


def main():
    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    # Pobierz wszystkie partie z starym formatem PW-xxxx
    cur.execute("""
        SELECT id, batch_no, mixing_order_no, raw_batch_nos
        FROM seasoned_meat
        WHERE batch_no LIKE 'PW-%'
        ORDER BY batch_no
    """)
    old_batches = cur.fetchall()

    if not old_batches:
        print("Brak partii do migracji (brak PW-xxxx).")
        conn.close()
        return

    print(f"Znaleziono {len(old_batches)} partii do przemianowania:\n")

    # Pobierz aktualną wartość mixed_seq
    cur.execute("SELECT value FROM sequences WHERE key='mixed_seq'")
    row = cur.fetchone()
    mixed_seq = (row['value'] if row else 0)

    renamed = []
    for batch in old_batches:
        old_no   = batch['batch_no']
        sm_id    = batch['id']

        seqs = get_seqs_from_raw_batch_nos(cur, sm_id)

        if len(seqs) == 1:
            new_no = f"MP{seqs[0]}"
        elif len(seqs) > 1:
            mixed_seq += 1
            new_no = f"MPP{mixed_seq}"
        else:
            # Nie można ustalić — fallback
            mixed_seq += 1
            new_no = f"MPP{mixed_seq}"
            print(f"  ⚠ {old_no} → {new_no}  (brak danych ćwiartki — fallback)")

        # Sprawdź kolizje
        cur.execute("SELECT id FROM seasoned_meat WHERE batch_no=%s AND id!=%s", (new_no, sm_id))
        if cur.fetchone():
            mixed_seq += 1
            new_no = f"MPP{mixed_seq}"
            print(f"  ⚠ Kolizja! Używam {new_no}")

        renamed.append((old_no, new_no, sm_id))
        raw_label = ', '.join(f"R{s}" for s in seqs) if seqs else '?'
        print(f"  {old_no}  →  {new_no}  (ćwiartki: {raw_label})")

    print(f"\nZatwierdź zmianę {len(renamed)} rekordów? (tak/nie): ", end="", flush=True)
    answer = input().strip().lower()
    if answer not in ('tak', 't', 'yes', 'y'):
        print("Anulowano.")
        conn.close()
        return

    # Wykonaj zmianę
    for old_no, new_no, sm_id in renamed:
        cur.execute("UPDATE seasoned_meat SET batch_no=%s WHERE id=%s", (new_no, sm_id))
        cur.execute("UPDATE mixing_sessions SET batch_no=%s WHERE batch_no=%s", (new_no, old_no))
        cur.execute("""
            UPDATE production_plan_lines
            SET seasoned_batch_no = %s WHERE seasoned_batch_no = %s
        """, (new_no, old_no))
        cur.execute("""
            UPDATE production_plan_lines
            SET seasoned_batch_nos = array_replace(seasoned_batch_nos, %s, %s)
            WHERE %s = ANY(seasoned_batch_nos)
        """, (old_no, new_no, old_no))
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
