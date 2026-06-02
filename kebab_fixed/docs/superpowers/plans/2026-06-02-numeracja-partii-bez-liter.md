# Numeracja partii bez liter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Numer partii nadawany na przyjęciu (goły, bez litery) ciągnie się przez rozbiór i mieszanie; partie łączone dostają `PP{n}`; kebab dostaje `ddmmrr <numer wsadu>`, rozbijany per partia dla wąskiego recall.

**Architecture:** Cała logika formatowania/walidacji numerów trafia do nowego, czystego, bezstanowego modułu `app/utils/batch_numbers.py` (testowalnego jednostkowo). Serwisy (`raw_batches`, `deboning`, `mixing`, `seasoned_meat`, `finished_goods`) tylko wołają te funkcje zamiast inline-owych f-stringów. Oddzielny skrypt jednorazowy czyści starą bazę i resetuje sekwencje.

**Tech Stack:** Python 3 / FastAPI / psycopg2 / PostgreSQL; testy pure-logic w `pytest`; frontend React/TS (minimalne zmiany kosmetyczne).

**Spec:** `docs/superpowers/specs/2026-06-02-numeracja-partii-bez-liter-design.md`

---

## Struktura plików

- **Create:** `backend/app/utils/batch_numbers.py` — czyste funkcje numeracji (jedyne źródło formatów/regex).
- **Create:** `backend/tests/test_batch_numbers.py` — testy jednostkowe modułu.
- **Create:** `backend/tests/__init__.py`, `backend/pytest.ini` — minimalna infrastruktura testowa.
- **Create:** `backend/cleanup_legacy_batches.py` — jednorazowy skrypt czyszczący (ręczny, VPS).
- **Modify:** `backend/requirements_pg.txt` — dodać `pytest` (dev).
- **Modify:** `backend/app/services/raw_batches_service.py` — walidacja + format gołego numeru.
- **Modify:** `backend/app/services/deboning_service.py:156` — `meat_lot_no` = numer partii surowca.
- **Modify:** `backend/app/services/mixing_service.py:441-457` — single→goły, multi→`PP{n}`.
- **Modify:** `backend/app/services/seasoned_meat_service.py:144-147,313` — j.w. + fallback regex.
- **Modify:** `backend/app/services/finished_goods_service.py` — numer kebaba `ddmmrr <wsad>` + dedup per partia.
- **Modify:** `src/features/raw-batches/types.ts` — komentarze przykładów `R171/R308` → `330`.

---

## Task 1: Czysty moduł numeracji + infrastruktura testowa

**Files:**
- Create: `backend/pytest.ini`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_batch_numbers.py`
- Create: `backend/app/utils/batch_numbers.py`
- Modify: `backend/requirements_pg.txt`

- [ ] **Step 1: Dodaj pytest do zależności**

W `backend/requirements_pg.txt` dopisz na końcu:

```
pytest>=8.0.0
```

Zainstaluj: `cd backend && pip3 install pytest>=8.0.0`

- [ ] **Step 2: Utwórz `backend/pytest.ini`**

```ini
[pytest]
testpaths = tests
python_files = test_*.py
addopts = -q
```

- [ ] **Step 3: Utwórz pusty `backend/tests/__init__.py`**

```python
```

- [ ] **Step 4: Napisz failing testy `backend/tests/test_batch_numbers.py`**

```python
import pytest

from app.utils.batch_numbers import (
    parse_reception_no,
    format_reception_no,
    combined_batch_no,
    is_combined,
    kebab_batch_no,
)


# --- parse_reception_no ----------------------------------------------------
def test_parse_reception_no_accepts_bare_digits():
    assert parse_reception_no("344") == 344


def test_parse_reception_no_strips_whitespace():
    assert parse_reception_no("  344  ") == 344


def test_parse_reception_no_blank_returns_none():
    assert parse_reception_no("") is None
    assert parse_reception_no("   ") is None
    assert parse_reception_no(None) is None


def test_parse_reception_no_rejects_letters():
    with pytest.raises(ValueError):
        parse_reception_no("R344")
    with pytest.raises(ValueError):
        parse_reception_no("abc")


def test_parse_reception_no_rejects_zero_and_negative():
    with pytest.raises(ValueError):
        parse_reception_no("0")
    with pytest.raises(ValueError):
        parse_reception_no("-5")


# --- format_reception_no ---------------------------------------------------
def test_format_reception_no_is_bare_string():
    assert format_reception_no(344) == "344"


# --- combined_batch_no / is_combined --------------------------------------
def test_combined_batch_no():
    assert combined_batch_no(1) == "PP1"
    assert combined_batch_no(27) == "PP27"


def test_is_combined():
    assert is_combined("PP1") is True
    assert is_combined("344") is False
    assert is_combined("") is False


# --- kebab_batch_no --------------------------------------------------------
def test_kebab_batch_no_single_batch():
    assert kebab_batch_no("2026-06-02", "344") == "020626 344"


def test_kebab_batch_no_combined_batch():
    assert kebab_batch_no("2026-06-02", "PP1") == "020626 PP1"


def test_kebab_batch_no_accepts_date_object():
    from datetime import date
    assert kebab_batch_no(date(2026, 6, 2), "344") == "020626 344"
```

- [ ] **Step 5: Uruchom testy — mają FAILować (brak modułu)**

Run: `cd backend && python3 -m pytest tests/test_batch_numbers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.utils.batch_numbers'`

- [ ] **Step 6: Zaimplementuj `backend/app/utils/batch_numbers.py`**

```python
"""Czysta logika numeracji partii (bez I/O, bez DB).

Jedyne źródło prawdy dla formatów numerów partii w całym systemie:

  * przyjęcie / rozbiór / mieszanie pojedyncze → goły numer, np. "344"
  * mieszanie/produkcja łączona              → "PP{n}", np. "PP1"
  * kebab                                    → "ddmmrr <numer wsadu>",
                                               np. "020626 344" / "020626 PP1"
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Optional, Union

_BARE_NO_RE = re.compile(r"^\d+$")


def parse_reception_no(raw: Optional[str]) -> Optional[int]:
    """Waliduje ręcznie wpisany numer partii na przyjęciu.

    Zwraca int gdy podano poprawny goły numer (>= 1), ``None`` gdy puste
    (auto-numerowanie), albo rzuca ``ValueError`` gdy format zły.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if not _BARE_NO_RE.match(s):
        raise ValueError("Numer partii musi być liczbą, np. 344")
    val = int(s)
    if val < 1:
        raise ValueError("Numer partii musi być >= 1")
    return val


def format_reception_no(seq: int) -> str:
    """Numer partii przyjęcia = goły numer sekwencji."""
    return str(seq)


def combined_batch_no(n: int) -> str:
    """Numer partii łączonej (kilka partii zmieszanych fizycznie)."""
    return f"PP{n}"


def is_combined(batch_no: Optional[str]) -> bool:
    """Czy dany numer to partia łączona (prefiks PP)."""
    return bool(batch_no) and batch_no.startswith("PP")


def _ddmmrr(produced_date: Union[str, date, datetime]) -> str:
    if isinstance(produced_date, str):
        d = datetime.strptime(produced_date[:10], "%Y-%m-%d").date()
    elif isinstance(produced_date, datetime):
        d = produced_date.date()
    else:
        d = produced_date
    return d.strftime("%d%m%y")


def kebab_batch_no(produced_date: Union[str, date, datetime], batch_no: str) -> str:
    """Numer kebaba = 'ddmmrr <numer wsadu>' (np. '020626 344')."""
    return f"{_ddmmrr(produced_date)} {batch_no}"
```

- [ ] **Step 7: Uruchom testy — mają PRZEJŚĆ**

Run: `cd backend && python3 -m pytest tests/test_batch_numbers.py -v`
Expected: PASS (11 testów)

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/batch_numbers.py backend/tests backend/pytest.ini backend/requirements_pg.txt
git commit -m "feat(numeracja): czysty moduł batch_numbers + testy"
```

---

## Task 2: Przyjęcie — goły numer partii

**Files:**
- Modify: `backend/app/services/raw_batches_service.py`

- [ ] **Step 1: Dodaj import i usuń stary regex**

W `raw_batches_service.py` na górze dodaj do importów z `app.utils`:

```python
from app.utils.batch_numbers import (
    format_reception_no,
    parse_reception_no,
)
```

Usuń linię `13`:

```python
_BATCH_NO_RE = re.compile(r"^R(\d+)$")
```

(jeśli `import re` nie jest już nigdzie używany w pliku — usuń też ten import).

- [ ] **Step 2: Zmień `next_batch_number()` na goły numer**

Zamień ciało (linie ~18-27) na:

```python
def next_batch_number() -> Dict[str, Any]:
    row = query_one("SELECT value FROM sequences WHERE key='batch_seq'")
    next_val = (int(row["value"]) if row else 171) + 1
    no = format_reception_no(next_val)
    return {
        "nextNo": no,
        "seq": next_val,
        "suggestedBatchNo": no,
        "suggestedSeq": next_val,
        "note": "Numer zostanie potwierdzony przy zapisie",
    }
```

- [ ] **Step 3: Zmień walidację i format w `create_batch()`**

Zamień blok walidacji (linie ~57-66):

```python
    custom_no = (dto.internal_batch_no or "").strip().upper()
    if custom_no:
        match = _BATCH_NO_RE.match(custom_no)
        if not match:
            raise HTTPException(400, "Numer partii musi mieć format R<liczba>, np. R308")
        custom_seq = int(match.group(1))
        if custom_seq < 1:
            raise HTTPException(400, "Numer partii musi być >= R1")
    else:
        custom_seq = None
```

na:

```python
    try:
        custom_seq = parse_reception_no(dto.internal_batch_no)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    custom_no = format_reception_no(custom_seq) if custom_seq is not None else ""
```

- [ ] **Step 4: Zmień format auto-numeru**

W gałęzi auto-numerowania (linia ~100) zamień:

```python
            internal_no = f"R{seq}"
```

na:

```python
            internal_no = format_reception_no(seq)
```

- [ ] **Step 5: Weryfikacja (pure logic regression + lint)**

Run: `cd backend && python3 -m pytest tests/ -q && python3 -c "import app.services.raw_batches_service"`
Expected: testy PASS, import bez błędów składni.

- [ ] **Step 6: Weryfikacja ręczna API (jeśli działa lokalna baza)**

Run (z uruchomionym backendem): `curl -s localhost:8000/api/raw-batches/next-number`
Expected: `suggestedBatchNo` to goły numer (np. `"172"`), bez `R`.

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/raw_batches_service.py
git commit -m "feat(numeracja): goły numer partii na przyjęciu (bez R)"
```

---

## Task 3: Rozbiór — ten sam numer co partia surowca

**Files:**
- Modify: `backend/app/services/deboning_service.py:156`

- [ ] **Step 1: Zmień `meat_lot_no`**

W `deboning_service.py` linia ~156 zamień:

```python
        meat_lot_no = f"M{batch['internal_batch_seq']}"
```

na:

```python
        # Numer mięsa po rozbiorze = ten sam numer co partia surowca (bez litery).
        meat_lot_no = batch["internal_batch_no"]
```

- [ ] **Step 2: Weryfikacja składni**

Run: `cd backend && python3 -c "import app.services.deboning_service"`
Expected: brak błędu.

- [ ] **Step 3: Weryfikacja ręczna (jeśli baza lokalna)**

Po rozbiorze partii `172`: `SELECT lot_no FROM meat_stock WHERE raw_batch_no='172';`
Expected: `lot_no = '172'`.

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/deboning_service.py
git commit -m "feat(numeracja): rozbiór zachowuje numer partii surowca"
```

---

## Task 4: Mieszanie/przyprawianie — goły numer lub PP{n}

**Files:**
- Modify: `backend/app/services/mixing_service.py:441-457`
- Modify: `backend/app/services/seasoned_meat_service.py:144-147,313`

- [ ] **Step 1: Import w `mixing_service.py`**

Dodaj do importów:

```python
from app.utils.batch_numbers import combined_batch_no
```

- [ ] **Step 2: Zmień nadawanie numeru w `mixing_service.py` (~451-457)**

Zamień:

```python
            if len(seqs) == 1:
                batch_no = f"MP{seqs[0]}"
            else:
                batch_no = f"MPP{next_seq('mixed_seq')}"
```

na:

```python
            if len(seqs) == 1:
                batch_no = str(seqs[0])
            else:
                batch_no = combined_batch_no(next_seq("pp_seq"))
```

- [ ] **Step 3: Import w `seasoned_meat_service.py`**

Dodaj do importów:

```python
from app.utils.batch_numbers import combined_batch_no
```

- [ ] **Step 4: Zmień nadawanie numeru w `seasoned_meat_service.py` (~144-147)**

Zamień:

```python
        if len(seqs) == 1:
            batch_no = f"MP{seqs[0]}"
        else:
            batch_no = f"MPP{next_seq('mixed_seq')}"
```

na:

```python
        if len(seqs) == 1:
            batch_no = str(seqs[0])
        else:
            batch_no = combined_batch_no(next_seq("pp_seq"))
```

- [ ] **Step 5: Napraw fallback regex lineage (`seasoned_meat_service.py:313`)**

Zamień:

```python
        mp_match = re.match(r"^MP(\d+)$", batch.get("batch_no") or "")
        if mp_match:
            raw_seq = int(mp_match.group(1))
```

na:

```python
        # Goły numer partii (np. "344") == internal_batch_seq surowca.
        mp_match = re.match(r"^(\d+)$", batch.get("batch_no") or "")
        if mp_match:
            raw_seq = int(mp_match.group(1))
```

- [ ] **Step 6: Weryfikacja składni i testów**

Run: `cd backend && python3 -m pytest tests/ -q && python3 -c "import app.services.mixing_service, app.services.seasoned_meat_service"`
Expected: PASS + brak błędu importu.

- [ ] **Step 7: Weryfikacja ręczna (jeśli baza lokalna)**

Mieszanie jednej partii `172` → `SELECT batch_no FROM seasoned_meat ...` = `'172'`.
Mieszanie dwóch partii → `batch_no` zaczyna się od `PP`.

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/mixing_service.py backend/app/services/seasoned_meat_service.py
git commit -m "feat(numeracja): mieszanie — goły numer / PP{n} dla łączonych"
```

---

## Task 5: Kebab — numer ddmmrr + wsad, dedup per partia

**Files:**
- Modify: `backend/app/services/finished_goods_service.py`

**Kontekst:** `_process_finish_day_entry` (linie ~423-610) najpierw szuka istniejącego rekordu `finished_goods` (dedup po dacie/recepturze/opakowaniu/kliencie/kg), potem albo dolicza, albo tworzy nowy z wyliczonym `batch_no`. Po zmianie: `batch_no` liczymy NAJPIERW, a dedup robimy też po `batch_no` — żeby partie `344` i `345` z tego samego dnia nie scalały się w jeden rekord.

- [ ] **Step 1: Import**

Dodaj do importów w `finished_goods_service.py`:

```python
from app.utils.batch_numbers import combined_batch_no, kebab_batch_no
```

- [ ] **Step 2: Wydziel helper liczący numer kebaba**

Dodaj funkcję modułową (np. tuż przed `_process_finish_day_entry`):

```python
def _compute_kebab_batch_no(
    conn, produced_date: str, seasoned_batch_nos: List[str]
) -> str:
    """Numer kebaba.

    * 1 partia wsadowa → 'ddmmrr <numer wsadu>' (np. '020626 344').
    * >1 partii (fizycznie zmieszane w tych samych sztukach)
      → nowa partia łączona PP{n}, numer 'ddmmrr PP{n}'.
    """
    if seasoned_batch_nos and len(seasoned_batch_nos) == 1:
        return kebab_batch_no(produced_date, seasoned_batch_nos[0])
    pp = combined_batch_no(next_seq("pp_seq"))
    return kebab_batch_no(produced_date, pp)
```

- [ ] **Step 3: Policz `batch_no` przed dedupem i dołóż go do klucza `existing`**

W `_process_finish_day_entry`, PRZED zapytaniem `existing = cx_query_one(...)`
(linia ~445) dodaj:

```python
    batch_no = _compute_kebab_batch_no(conn, today, entry.seasoned_batch_nos or [])
```

Następnie w zapytaniu `existing` dołóż warunek `batch_no` i parametr. Zamień blok:

```python
    existing = cx_query_one(
        conn,
        """
        SELECT * FROM finished_goods
        WHERE produced_date = %s
          AND recipe_id = %s
          AND COALESCE(packaging_id,'') = %s
          AND COALESCE(client_name,'') = %s
          AND kg_per_unit = %s
        FOR UPDATE
        """,
        (
            today,
            entry.recipe_id,
            entry.packaging_id or "",
            entry.client_name or "",
            entry.kg_per_unit,
        ),
    )
```

na:

```python
    existing = cx_query_one(
        conn,
        """
        SELECT * FROM finished_goods
        WHERE produced_date = %s
          AND batch_no = %s
          AND recipe_id = %s
          AND COALESCE(packaging_id,'') = %s
          AND COALESCE(client_name,'') = %s
          AND kg_per_unit = %s
        FOR UPDATE
        """,
        (
            today,
            batch_no,
            entry.recipe_id,
            entry.packaging_id or "",
            entry.client_name or "",
            entry.kg_per_unit,
        ),
    )
```

**Uwaga dot. PP:** dla partii łączonej `_compute_kebab_batch_no` zużywa nowy
`pp_seq` przy każdym wywołaniu. Ponieważ liczymy `batch_no` raz na wejściu do
funkcji (przed dedupem), w obrębie jednego wpisu jest spójnie. Dwa osobne
wpisy łączone tego samego dnia dostaną różne `PP{n}` — to poprawne (osobne
fizyczne mieszania = osobne partie łączone).

- [ ] **Step 4: Usuń starą strategię nazewnictwa w gałęzi `else` (tworzenie nowego rekordu)**

W gałęzi `else` (tworzenie nowego rekordu, linie ~528-587) usuń CAŁY blok
liczenia `batch_no` (od komentarza `# Strategia nazewnictwa:` aż do
`batch_no = f"PP{seq}"` w pod-gałęzi `else`), ponieważ `batch_no` jest już
policzone w Step 3. Zostaw `item = cx_execute_returning(...)` używające
zmiennej `batch_no`.

Konkretnie usuń fragment zaczynający się od:

```python
        # Strategia nazewnictwa:
        # 1) Pojedyncze seasoned ze 1 raw batch     → P{raw_seq}/{n}   (np. P171/1)
```

a kończący na:

```python
        else:
            # Brak źródła albo wiele źródeł — globalny licznik
            seq = next_seq("finished_goods_seq")
            batch_no = f"PP{seq}"
```

(cały ten blok znika — `batch_no` pochodzi teraz z góry funkcji).

- [ ] **Step 5: Zaktualizuj `create_finished_good` (ręczne tworzenie, ~287-292)**

Zamień:

```python
    seq = next_seq("finished_goods_seq")
    default_batch_no = f"P{seq}"
    qty = int(dto.qty)
    kg_per_unit = float(dto.kg_per_unit)
    total_kg = round(qty * kg_per_unit, 3)
    batch_no = dto.batch_no or default_batch_no
    produced_date = dto.produced_date or datetime.now().date().isoformat()
```

na:

```python
    qty = int(dto.qty)
    kg_per_unit = float(dto.kg_per_unit)
    total_kg = round(qty * kg_per_unit, 3)
    produced_date = dto.produced_date or datetime.now().date().isoformat()
    if dto.batch_no:
        batch_no = dto.batch_no
    else:
        batch_no = kebab_batch_no(
            produced_date,
            (dto.seasoned_batch_nos[0]
             if dto.seasoned_batch_nos and len(dto.seasoned_batch_nos) == 1
             else combined_batch_no(next_seq("pp_seq"))),
        )
```

- [ ] **Step 6: Weryfikacja składni i testów pure**

Run: `cd backend && python3 -m pytest tests/ -q && python3 -c "import app.services.finished_goods_service"`
Expected: PASS + brak błędu importu.

- [ ] **Step 7: Weryfikacja ręczna (jeśli baza lokalna)**

- Produkcja z jednej partii `172`, data dziś → `batch_no` = `'<ddmmrr> 172'`.
- Dwa osobne wpisy (`172`, `173`) tego samego dnia → dwa rekordy
  (`<ddmmrr> 172`, `<ddmmrr> 173`).
- Wpis z dwoma wsadami → `'<ddmmrr> PP<n>'`.

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/finished_goods_service.py
git commit -m "feat(numeracja): kebab ddmmrr <wsad>, dedup per partia, PP dla zmieszanych"
```

---

## Task 6: Frontend — kosmetyka komentarzy/przykładów

**Files:**
- Modify: `src/features/raw-batches/types.ts`

- [ ] **Step 1: Zaktualizuj komentarze przykładów**

W `types.ts` zamień komentarz przy `internalBatchNo` (linia ~23):

```typescript
  readonly internalBatchNo:  string   // "R171" — nadawany przez backend, read-only
```

na:

```typescript
  readonly internalBatchNo:  string   // np. "344" — nadawany przez backend, read-only
```

oraz (linia ~71):

```typescript
  internalBatchNo?: string   // user może wpisać własny np. "R308"; backend zsynchronizuje batch_seq
```

na:

```typescript
  internalBatchNo?: string   // user może wpisać własny np. "344"; backend zsynchronizuje batch_seq
```

- [ ] **Step 2: Weryfikacja typów**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit 2>&1 | head`
Expected: brak nowych błędów typów związanych z tą zmianą.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/raw-batches/types.ts
git commit -m "docs(frontend): przykłady numerów partii bez prefiksu R"
```

---

## Task 7: Skrypt czyszczący starą bazę (ręczny, VPS)

**Files:**
- Create: `backend/cleanup_legacy_batches.py`

**Uwaga:** Skrypt jest DESTRUKCYJNY i uruchamiany WYŁĄCZNIE ręcznie na VPS po
deployu kodu. NIE jest częścią automatycznego startu/migracji.

- [ ] **Step 1: Utwórz `backend/cleanup_legacy_batches.py`**

```python
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
DELETE_ORDER = [
    "finished_goods_sessions",
    "finished_goods",
    "mixing_order_lots",
    "mixing_sessions",
    "seasoned_meat",
    "mixing_orders",
    "meat_stock",
    "deboning_entries",
    "deboning_sessions",
    "raw_batches",
    "stock_movements",
]

# Sekwencje: batch_seq=343 → następna partia 344; reszta wyzerowana.
SEQUENCES = {
    "batch_seq": 343,
    "pp_seq": 0,
    "mixed_seq": 0,
    "finished_goods_seq": 0,
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
```

- [ ] **Step 2: Weryfikacja składni**

Run: `cd backend && python3 -c "import ast; ast.parse(open('cleanup_legacy_batches.py').read()); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/cleanup_legacy_batches.py
git commit -m "chore(numeracja): skrypt czyszczący starą bazę (ręczny, VPS)"
```

- [ ] **Step 4: (Wykonanie na VPS — NIE w ramach implementacji)**

Po deployu, ręcznie na VPS, po potwierdzeniu z właścicielem:
`python3 /opt/kebab/app/backend/cleanup_legacy_batches.py` → wpisać `tak`.

---

## Notatki dot. weryfikacji końcowej

Przed uznaniem za zakończone (skill verification-before-completion):
- `cd backend && python3 -m pytest tests/ -v` → wszystkie PASS.
- `python3 -c "import app.main"` → backend importuje się bez błędów.
- `npx tsc --noEmit` → brak nowych błędów TS.
- Przegląd: żaden serwis nie tworzy już numeru przez `f"R..."`, `f"M..."`,
  `f"MP..."`, `f"MPP..."`, `f"P{seq}"` (poza paletami `pallets_service.py`,
  które są osobną dziedziną i celowo NIE są ruszane).
