#!/usr/bin/env python3
"""JEDNORAZOWE czyszczenie starych danych produkcyjnych — czysty start.

Usuwa cały łańcuch: kebab → masowanie → rozbiór → surowiec, wraz z ruchami
magazynowymi, i ustawia sekwencje tak, by następna partia dostała numer 344.

URUCHOM RĘCZNIE NA VPS:
  python3 /opt/kebab/app/backend/cleanup_legacy_batches.py

Operacja NIEODWRACALNA. Wymaga potwierdzenia 'tak'.
"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://kebab_user:kebab_pass@localhost:5432/kebab_mes",
)

# Kolejność = od „liści" do „korzenia" (respektuje klucze obce).
# Uwaga: w schemacie nie ma tabeli deboning_sessions — sesje rozbioru to
# production_sessions (process_type='deboning'). raw_batch_history
# referencjonuje raw_batches, więc musi być usunięta przed nią.
DELETE_ORDER = [
    "finished_goods_sessions",
    "finished_goods",
    "mixing_order_lots",
    "mixing_sessions",
    "seasoned_meat",
    "mixing_orders",
    "meat_stock",
    "deboning_entries",
    "raw_batch_history",
    "production_sessions",
    "raw_batches",
    "stock_movements",
]

# Sekwencje: batch_seq=343 → następna partia 344; reszta wyzerowana.
# Nazwy zgodne z init_db.py: batch_seq, deboning_seq, mixing_seq,
# seasoned_seq, finished_goods_seq, mixed_seq.
SEQUENCES = {
    "batch_seq": 343,
    "deboning_seq": 0,
    "mixing_seq": 0,
    "seasoned_seq": 0,
    "finished_goods_seq": 0,
    "mixed_seq": 0,
}


def parse_url(url):
    from urllib.parse import urlparse
    r = urlparse(url)
    return r.username, r.password, r.hostname, r.port or 5432, r.path.lstrip("/")


def get_conn():
    u, pw, h, port, db = parse_url(DATABASE_URL)
    return psycopg2.connect(host=h, port=port, user=u, password=pw, dbname=db)


def table_exists(cur, name):
    cur.execute(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name=%s",
        (name,),
    )
    return cur.fetchone() is not None


def main():
    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    print("=== Podgląd liczby rekordów do usunięcia ===")
    counts = {}
    for t in DELETE_ORDER:
        if not table_exists(cur, t):
            print(f"  (pomijam — brak tabeli {t})")
            continue
        cur.execute(f"SELECT count(*) AS n FROM {t}")
        counts[t] = cur.fetchone()["n"]
        print(f"  {t}: {counts[t]}")

    print("\nSekwencje po resecie:")
    for k, v in SEQUENCES.items():
        nxt = v + 1 if k == "batch_seq" else "—"
        print(f"  {k} = {v}   (następny numer: {nxt})")

    print("\nUWAGA: operacja NIEODWRACALNA. Wpisz 'tak' aby kontynuować: ", end="", flush=True)
    if input().strip().lower() not in ("tak", "t", "yes", "y"):
        print("Anulowano.")
        conn.close()
        return

    for t in DELETE_ORDER:
        if t in counts:
            cur.execute(f"DELETE FROM {t}")
            print(f"  ✓ wyczyszczono {t}")

    for k, v in SEQUENCES.items():
        cur.execute(
            """
            INSERT INTO sequences (key, value) VALUES (%s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (k, v),
        )
    print("  ✓ zresetowano sekwencje (batch_seq=343 → następna partia 344)")

    conn.commit()
    print("\n✓ Gotowe. Czysty start.")
    conn.close()


if __name__ == "__main__":
    main()
