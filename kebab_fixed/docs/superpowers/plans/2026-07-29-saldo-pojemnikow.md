# Saldo pojemników — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozliczać pojemniki E2 i palety (H1 / inne) z kontrahentami — kaliber na przyjęciu i WZ, saldo per kontrahent, dokument „WZ na POJEMNIKI" i potwierdzenie salda za okres.

**Architecture:** Osobna księga `container_movements` ze znakowanym `qty` (dodatnie = przyjechało do nas, ujemne = wyjechało); saldo = `SUM(qty)`. Ruchy z przyjęć i WZ księgowane **różnicowo** (append-only `book_target`), żeby edycja i anulowanie dokumentu źródłowego nie wymagały nadpisywania historii. Tożsamość kontrahenta scalana po NIP w `container_partners`, bez ruszania tabel `suppliers` / `clients`.

**Tech Stack:** FastAPI + psycopg2 (backend, warstwy routes → services → db), React + TypeScript + Vite + Tailwind (frontend), pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-saldo-pojemnikow-design.md`

## Global Constraints

- Katalog roboczy: `/opt/kebab/kebab_new/kebab_fixed/` — NIE `/root/kebab_fixed_work/`.
- Warstwy backendu: `routes/` cienkie → `services/` logika → `db.py`. Bez `psycopg2.connect` w serwisach.
- Zapisy wielotabelowe w `with transaction() as conn:` i przez `cx_*` (nie `execute`).
- **Append-only:** korekta ruchu pojemników NIGDY nie nadpisuje ani nie kasuje wiersza — dopisuje różnicę.
- **Konwencja znaku (jedyna w całym systemie):** `qty > 0` = nośniki przyjechały DO NAS (my winni); `qty < 0` = wyjechały OD NAS (oni winni). Nie ma kolumny `direction`.
- **Zaokrąglenie pojemników: `ceil`**, nigdy `floor`. Niepełny pojemnik to nadal jeden fizyczny pojemnik.
- Rodzaje nośników (dokładnie te trzy stringi): `'e2'`, `'pallet_h1'`, `'pallet_other'`.
- Kalibry: `15.0`, `20.0`, `None` (niekalibrowany).
- Numer dokumentu pojemnikowego: `POJ/{seq}/{MM}/{RR}`, np. `POJ/7/07/26`.
- Testy DB wymagają `TEST_DATABASE_URL=postgresql://postgres:PASS@localhost:55437/kebab_mes_test`. **Bez tej zmiennej testy DB są cicho pomijane — zielony wynik bez niej nic nie znaczy.**
- Komunikaty błędów i etykiety UI po polsku.
- Nie deployować w ramach tego planu.

---

### Task 1: Czysta logika pojemników (`app/utils/containers.py`)

**Files:**
- Create: `backend/app/utils/containers.py`
- Test: `backend/tests/test_containers.py`

**Interfaces:**
- Consumes: nic (pierwszy task, zero zależności)
- Produces:
  - `ASSET_TYPES: tuple[str, ...]` = `("e2", "pallet_h1", "pallet_other")`
  - `ASSET_LABELS: dict[str, str]`
  - `CALIBERS: tuple[float | None, ...]` = `(15.0, 20.0, None)`
  - `containers_for_kg(kg: float, container_kg: float | None) -> int | None`
  - `prorate_containers(containers_total: int | None, kg_part: float, kg_total: float) -> int | None`
  - `normalize_nip(nip: str | None) -> str`
  - `normalize_name(name: str | None) -> str`
  - `format_container_doc_number(seq: int, year_month: str) -> str`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_containers.py`:

```python
"""Czysta logika pojemników — bez DB, bez I/O."""
import pytest

from app.utils.containers import (
    ASSET_TYPES,
    CALIBERS,
    containers_for_kg,
    format_container_doc_number,
    normalize_name,
    normalize_nip,
    prorate_containers,
)


# ── Przeliczenie kg → pojemniki ──────────────────────────────────────
def test_kaliber_15_dzieli_bez_reszty():
    assert containers_for_kg(300, 15) == 20


def test_kaliber_15_niepelny_pojemnik_liczy_sie_w_calosci():
    # 305 kg = 20 pełnych + 5 kg → 21 fizycznych pojemników (ceil, nie floor!)
    assert containers_for_kg(305, 15) == 21


def test_kaliber_20():
    assert containers_for_kg(300, 20) == 15
    assert containers_for_kg(310, 20) == 16


def test_niekalibrowany_nie_da_sie_wyliczyc():
    assert containers_for_kg(1000, None) is None


def test_zero_i_ujemne_kg_to_zero_pojemnikow():
    assert containers_for_kg(0, 15) == 0
    assert containers_for_kg(-5, 15) == 0


def test_kaliber_zerowy_traktowany_jak_niekalibrowany():
    assert containers_for_kg(100, 0) is None


def test_dostepne_kalibry():
    assert CALIBERS == (15.0, 20.0, None)
    assert ASSET_TYPES == ("e2", "pallet_h1", "pallet_other")


# ── Proporcja dla partii niekalibrowanej ─────────────────────────────
def test_prorate_polowa_partii_to_polowa_pojemnikow():
    assert prorate_containers(400, 3000, 6000) == 200


def test_prorate_bez_danych_zrodlowych():
    assert prorate_containers(None, 1, 2) is None
    assert prorate_containers(400, 1, 0) is None
    assert prorate_containers(400, 0, 6000) is None


def test_prorate_niezerowa_czesc_to_minimum_jeden_pojemnik():
    # 1 kg z 6000 kg → 0.07 pojemnika, ale fizycznie to nadal jeden pojemnik
    assert prorate_containers(400, 1, 6000) == 1


# ── Normalizacja tożsamości kontrahenta ──────────────────────────────
def test_normalize_nip_zdejmuje_myslniki_i_spacje():
    assert normalize_nip("513-006-44-78") == "5130064478"
    assert normalize_nip(" 513 006 44 78 ") == "5130064478"


def test_normalize_nip_pusty():
    assert normalize_nip(None) == ""
    assert normalize_nip("") == ""


def test_normalize_name_scala_biale_znaki_i_wielkosc():
    assert normalize_name("  FHUP   MAREK  Księżyc ") == "fhup marek księżyc"
    assert normalize_name(None) == ""


# ── Numeracja dokumentu ──────────────────────────────────────────────
def test_format_numeru_dokumentu():
    assert format_container_doc_number(7, "2607") == "POJ/7/07/26"
    assert format_container_doc_number(112, "2612") == "POJ/112/12/26"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_containers.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.utils.containers'`

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/utils/containers.py`:

```python
"""Czysta logika nośników zwrotnych — pojemników E2 i palet (bez I/O, bez DB).

Jedyne źródło prawdy dla:
  * rodzajów rozliczanych nośników i ich etykiet na druku,
  * kalibrów pojemnika E2 (15 kg / 20 kg / niekalibrowany),
  * przeliczenia kg → liczba pojemników,
  * normalizacji NIP i nazwy (scalanie dostawcy i odbiorcy w jednego partnera),
  * formatu numeru dokumentu „WZ na POJEMNIKI".
"""
from __future__ import annotations

import math
import re
from typing import Optional

# Rodzaje rozliczanych nośników. Kolejność = kolejność wierszy na druku.
ASSET_TYPES = ("e2", "pallet_h1", "pallet_other")

ASSET_LABELS = {
    "e2": "Ilość pojemników EURO2",
    "pallet_h1": "Ilość palet H1",
    "pallet_other": "Ilość palet innych",
}

# Dozwolone kalibry pojemnika. None = niekalibrowany (operator wpisuje sztuki
# ręcznie — dostawa nie ma jednolitego napełnienia).
CALIBERS = (15.0, 20.0, None)


def containers_for_kg(kg: float, container_kg: Optional[float]) -> Optional[int]:
    """Liczba pojemników E2 dla masy.

    ceil, NIE floor: niepełny pojemnik to nadal jeden fizyczny pojemnik.
    Do 2026-07-29 modal przyjęcia liczył floor, a wz_service ceil — przy
    saldzie ta niespójność gubiłaby jeden pojemnik na każdej niepełnej
    dostawie i saldo rozjeżdżałoby się od pierwszego dnia.

    Zwraca None, gdy kaliber nieznany (niekalibrowany) — wtedy liczbę
    pojemników podaje operator.
    """
    if container_kg is None or container_kg <= 0:
        return None
    if kg <= 0:
        return 0
    return math.ceil(kg / container_kg)


def prorate_containers(
    containers_total: Optional[int], kg_part: float, kg_total: float
) -> Optional[int]:
    """Podpowiedź liczby pojemników dla CZĘŚCI partii niekalibrowanej.

    Partia niekalibrowana ma tylko policzoną sumę pojemników na całości —
    przy wydaniu części masy skalujemy ją proporcjonalnie. Minimum 1, bo
    wydanie niezerowej masy zawsze zajmuje co najmniej jeden pojemnik.
    """
    if not containers_total or kg_total <= 0 or kg_part <= 0:
        return None
    return max(1, round(containers_total * kg_part / kg_total))


def normalize_nip(nip: Optional[str]) -> str:
    """NIP do porównań: same cyfry. '513-006-44-78' → '5130064478'."""
    return re.sub(r"\D", "", nip or "")


def normalize_name(name: Optional[str]) -> str:
    """Nazwa do porównań, gdy kontrahent nie ma NIP-u: małe litery,
    pojedyncze spacje, bez białych znaków na brzegach."""
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def format_container_doc_number(seq: int, year_month: str) -> str:
    """Numer dokumentu pojemnikowego: POJ/NN/MM/RR (wzorzec numeracji WZ).

    year_month = 'RRMM' (np. '2607').
    """
    yy, mm = year_month[:2], year_month[2:]
    return f"POJ/{seq}/{mm}/{yy}"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python3 -m pytest tests/test_containers.py -q`
Expected: PASS — 15 passed

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/utils/containers.py backend/tests/test_containers.py
git commit -m "feat(pojemniki): czysta logika kalibrów, normalizacji NIP i numeracji"
```

---

### Task 2: Schemat bazy (migracje)

**Files:**
- Modify: `backend/app/migrations.py` (dopisz na KOŃCU listy `_DDL`, przed zamykającym `]`)
- Modify: `backend/tests/conftest.py:30-40` (lista `_TRUNCATE`)
- Test: `backend/tests/test_containers_schema_db.py`

**Interfaces:**
- Consumes: nic
- Produces: tabele `container_partners`, `container_partner_links`, `container_docs`, `container_movements`; kolumny `raw_batches.container_kg` / `.containers_count` / `.pallets_h1` / `.pallets_other`; `wz_documents.pallets_h1` / `.pallets_other`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_containers_schema_db.py`:

```python
"""Schemat salda pojemników — sprawdza, że migracje FAKTYCZNIE się wykonały.

run_migrations() połyka błędy pojedynczych instrukcji (loguje warning i idzie
dalej), więc „migrations.done" w logu NIE dowodzi, że tabele powstały.
Ten test weryfikuje DANE, nie flagę.
"""
import pytest

from app.db import execute, query_one
from app.utils.ids import cuid, now_iso


def test_tabele_pojemnikowe_istnieja_i_przyjmuja_dane(db):
    pid = cuid()
    execute(
        "INSERT INTO container_partners (id, nip, name, address, created_at) "
        "VALUES (%s,%s,%s,%s,%s)",
        (pid, "5130064478", "FHUP MAREK KSIĘŻYC", "Rudawa", now_iso()))
    execute(
        "INSERT INTO container_movements "
        "(id, partner_id, asset_type, qty, source_type, source_id, movement_date, created_at) "
        "VALUES (%s,%s,'e2',400,'raw_batch','rb1',%s,%s)",
        (cuid(), pid, "2026-07-29", now_iso()))
    row = query_one(
        "SELECT COALESCE(SUM(qty),0) AS saldo FROM container_movements WHERE partner_id=%s",
        (pid,))
    assert int(row["saldo"]) == 400


def test_nip_jest_unikalny_ale_pusty_nip_nie_blokuje(db):
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
            (cuid(), "5130064478", "A", now_iso()))
    with pytest.raises(Exception):
        execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
                (cuid(), "5130064478", "B", now_iso()))
    # dwaj partnerzy bez NIP-u współistnieją
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,NULL,%s,%s)",
            (cuid(), "Bez NIP 1", now_iso()))
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,NULL,%s,%s)",
            (cuid(), "Bez NIP 2", now_iso()))


def test_nieznany_rodzaj_nosnika_odrzucony(db):
    pid = cuid()
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,NULL,%s,%s)",
            (pid, "X", now_iso()))
    with pytest.raises(Exception):
        execute(
            "INSERT INTO container_movements "
            "(id, partner_id, asset_type, qty, source_type, movement_date, created_at) "
            "VALUES (%s,%s,'skrzynka',1,'manual',%s,%s)",
            (cuid(), pid, "2026-07-29", now_iso()))


def test_kolumny_kalibru_na_przyjeciu_i_palet_na_wz(db):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, kg_received, kg_available, "
        "container_kg, containers_count, pallets_h1, pallets_other, created_at) "
        "VALUES ('rb-cal','900',6000,6000,15,400,10,2,%s)", (now_iso(),))
    r = query_one("SELECT container_kg, containers_count, pallets_h1, pallets_other "
                  "FROM raw_batches WHERE id='rb-cal'")
    assert float(r["container_kg"]) == 15.0
    assert r["containers_count"] == 400
    assert r["pallets_h1"] == 10
    assert r["pallets_other"] == 2

    execute(
        "INSERT INTO wz_documents (id, number, year_month, pallets_h1, pallets_other) "
        "VALUES ('wz-cal','WZ/1/07/26','2607',3,1)")
    w = query_one("SELECT pallets_h1, pallets_other FROM wz_documents WHERE id='wz-cal'")
    assert w["pallets_h1"] == 3
    assert w["pallets_other"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_containers_schema_db.py -q
```
Expected: FAIL — `relation "container_partners" does not exist`

(Jeśli zamiast FAIL widzisz `skipped` — `TEST_DATABASE_URL` nie działa. Napraw to najpierw, inaczej cały plan jest testowany na ślepo.)

- [ ] **Step 3: Dopisz DDL na końcu listy `_DDL` w `backend/app/migrations.py`**

Wstaw tuż przed zamykającym `]` listy `_DDL`:

```python
    # ── Saldo pojemników (2026-07-29) ────────────────────────────────
    # Kartoteka tożsamości: dostawca i odbiorca o TYM SAMYM NIP-ie to jeden
    # partner, więc mają jedno saldo. `suppliers`/`clients` zostają nietknięte
    # — to warstwa wyłącznie na potrzeby nośników zwrotnych.
    """CREATE TABLE IF NOT EXISTS container_partners (
        id         TEXT PRIMARY KEY,
        nip        TEXT,
        name       TEXT NOT NULL,
        address    TEXT DEFAULT '',
        active     BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_container_partners_nip "
    "ON container_partners(nip) WHERE nip IS NOT NULL AND nip <> ''",
    """CREATE TABLE IF NOT EXISTS container_partner_links (
        partner_id TEXT NOT NULL REFERENCES container_partners(id),
        ref_type   TEXT NOT NULL,
        ref_id     TEXT NOT NULL,
        PRIMARY KEY (ref_type, ref_id)
    )""",
    # UWAGA KOLEJNOŚCI: container_docs MUSI powstać przed container_movements
    # (FK doc_id). Migracje wykonują się po kolei, a błąd pojedynczej
    # instrukcji jest tylko logowany — odwrotna kolejność dałaby CICHĄ awarię
    # widoczną dopiero przy pierwszym zapisie.
    """CREATE TABLE IF NOT EXISTS container_docs (
        id               TEXT PRIMARY KEY,
        number           TEXT NOT NULL,
        seq              INTEGER NOT NULL DEFAULT 0,
        year_month       TEXT NOT NULL DEFAULT '',
        partner_id       TEXT NOT NULL REFERENCES container_partners(id),
        partner_snapshot JSONB DEFAULT '{}',
        seller           JSONB DEFAULT '{}',
        doc_date         DATE NOT NULL,
        driver           TEXT DEFAULT '',
        vehicle          TEXT DEFAULT '',
        lines            JSONB DEFAULT '[]',
        balance_after    JSONB DEFAULT '{}',
        status           TEXT NOT NULL DEFAULT 'wystawiony',
        notes            TEXT DEFAULT '',
        created_by       TEXT,
        created_at       TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_container_docs_partner ON container_docs(partner_id)",
    "CREATE INDEX IF NOT EXISTS idx_container_docs_ym ON container_docs(year_month)",
    # Księga nośników. qty ZE ZNAKIEM: dodatnie = przyjechało do nas (my
    # winni), ujemne = wyjechało od nas (oni winni). Saldo = SUM(qty).
    """CREATE TABLE IF NOT EXISTS container_movements (
        id            TEXT PRIMARY KEY,
        partner_id    TEXT NOT NULL REFERENCES container_partners(id),
        asset_type    TEXT NOT NULL,
        qty           INTEGER NOT NULL,
        source_type   TEXT NOT NULL,
        source_id     TEXT,
        doc_id        TEXT REFERENCES container_docs(id),
        movement_date DATE NOT NULL,
        confirmed     BOOLEAN NOT NULL DEFAULT false,
        note          TEXT DEFAULT '',
        created_by    TEXT,
        created_at    TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT container_movements_asset_ck
            CHECK (asset_type = ANY (ARRAY['e2','pallet_h1','pallet_other']))
    )""",
    "CREATE INDEX IF NOT EXISTS idx_container_mov_partner "
    "ON container_movements(partner_id, asset_type)",
    "CREATE INDEX IF NOT EXISTS idx_container_mov_source "
    "ON container_movements(source_type, source_id)",
    "CREATE INDEX IF NOT EXISTS idx_container_mov_date ON container_movements(movement_date)",
    # Kaliber i nośniki na przyjęciu surowca. container_kg NULL = niekalibrowany
    # (containers_count wpisuje wtedy operator).
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS container_kg NUMERIC(6,2)",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS containers_count INTEGER",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS pallets_h1 INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE raw_batches ADD COLUMN IF NOT EXISTS pallets_other INTEGER NOT NULL DEFAULT 0",
    # Palety na dokumencie WZ. Palety są na POZIOMIE DOKUMENTU (transport wiezie
    # N palet łącznie), pojemniki zostają na pozycjach (wynikają z masy partii).
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS pallets_h1 INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE wz_documents ADD COLUMN IF NOT EXISTS pallets_other INTEGER NOT NULL DEFAULT 0",
```

- [ ] **Step 4: Dopisz nowe tabele do `_TRUNCATE` w `backend/tests/conftest.py`**

W liście `_TRUNCATE` (linia ~30) dodaj na POCZĄTKU (przed `"kpi_monthly_snapshots"`), żeby CASCADE nie zostawiał sierot:

```python
    "container_movements", "container_docs", "container_partner_links", "container_partners",
```

- [ ] **Step 5: Zastosuj migracje na bazie testowej i uruchom test**

```bash
cd backend
DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -c "from app.migrations import run_migrations; run_migrations()"
TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_containers_schema_db.py -q
```
Expected: PASS — 4 passed

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/migrations.py backend/tests/conftest.py backend/tests/test_containers_schema_db.py
git commit -m "feat(pojemniki): schemat — partnerzy, ruchy, dokumenty, kaliber na przyjęciu"
```

---

### Task 3: Kartoteka partnerów (`container_partners_service.py`)

**Files:**
- Create: `backend/app/services/container_partners_service.py`
- Test: `backend/tests/test_container_partners_db.py`

**Interfaces:**
- Consumes: `app.utils.containers.normalize_nip`, `.normalize_name` (Task 1); tabele z Task 2
- Produces:
  - `resolve_partner(conn, ref_type: str, ref_id: str) -> str` — `ref_type` ∈ `{'supplier','client'}`
  - `resolve_partner_by_nip(conn, nip: str, name: str, address: str = "") -> str`
  - `get_partner(partner_id: str) -> dict` — z kluczem `roles: list[str]`
  - `list_partners() -> list[dict]`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_container_partners_db.py`:

```python
"""Tożsamość kontrahenta pojemnikowego — scalanie dostawcy i odbiorcy po NIP."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one, transaction
from app.services.container_partners_service import (
    get_partner,
    resolve_partner,
    resolve_partner_by_nip,
)
from app.utils.ids import now_iso


def _seed_supplier(sid="sup1", nip="513-006-44-78", name="KOKO Sp. z o.o."):
    execute(
        "INSERT INTO suppliers (id, code, name, nip, address, city, active, created_at) "
        "VALUES (%s,%s,%s,%s,'Dunajewskiego 83','Rudawa',true,%s)",
        (sid, sid.upper(), name, nip, now_iso()))


def _seed_client(cid="cli1", nip="5130064478", name="KOKO SP Z O O"):
    execute(
        "INSERT INTO clients (id, code, name, nip, address, city, active, created_at) "
        "VALUES (%s,%s,%s,%s,'Dunajewskiego 83','Rudawa',true,%s)",
        (cid, cid.upper(), name, nip, now_iso()))


def test_dostawca_i_odbiorca_o_tym_samym_nip_to_JEDEN_partner(db):
    _seed_supplier()
    _seed_client()
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup1")
        b = resolve_partner(conn, "client", "cli1")
    assert a == b, "NIP identyczny po normalizacji → musi być jedno saldo"
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_powtorne_wywolanie_nie_tworzy_duplikatu(db):
    _seed_supplier()
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup1")
        b = resolve_partner(conn, "supplier", "sup1")
    assert a == b
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_bez_nip_dopasowanie_po_znormalizowanej_nazwie(db):
    _seed_supplier(sid="sup2", nip="", name="  Ubojnia   Rolnicza ")
    _seed_client(cid="cli2", nip="", name="UBOJNIA ROLNICZA")
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup2")
        b = resolve_partner(conn, "client", "cli2")
    assert a == b
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_bez_nip_rozne_nazwy_to_rozni_partnerzy(db):
    _seed_supplier(sid="sup3", nip="", name="Ubojnia A")
    _seed_client(cid="cli3", nip="", name="Ubojnia B")
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup3")
        b = resolve_partner(conn, "client", "cli3")
    assert a != b


def test_firma_z_nip_nie_scala_sie_z_bezimiennym_wpisem_bez_nip(db):
    _seed_supplier(sid="sup4", nip="1111111111", name="KOKO")
    _seed_client(cid="cli4", nip="", name="KOKO")
    with transaction() as conn:
        a = resolve_partner(conn, "supplier", "sup4")
        b = resolve_partner(conn, "client", "cli4")
    assert a != b, "brak NIP-u nie może przykleić się do firmy z NIP-em"


def test_partner_spoza_kartoteki_po_samym_nip(db):
    with transaction() as conn:
        a = resolve_partner_by_nip(conn, "513-006-44-78", "KOKO", "Rudawa")
        b = resolve_partner_by_nip(conn, "5130064478", "KOKO inaczej zapisane")
    assert a == b


def test_nieznany_typ_kontrahenta_odrzucony(db):
    with pytest.raises(HTTPException) as e:
        with transaction() as conn:
            resolve_partner(conn, "przewoznik", "x1")
    assert e.value.status_code == 400


def test_nieistniejacy_kontrahent_to_404(db):
    with pytest.raises(HTTPException) as e:
        with transaction() as conn:
            resolve_partner(conn, "supplier", "nie-ma-takiego")
    assert e.value.status_code == 404


def test_get_partner_zwraca_role(db):
    _seed_supplier()
    _seed_client()
    with transaction() as conn:
        pid = resolve_partner(conn, "supplier", "sup1")
        resolve_partner(conn, "client", "cli1")
    p = get_partner(pid)
    assert p["roles"] == ["client", "supplier"]
    assert p["nip"] == "5130064478"
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_container_partners_db.py -q
```
Expected: FAIL — `No module named 'app.services.container_partners_service'`

- [ ] **Step 3: Write implementation**

Create `backend/app/services/container_partners_service.py`:

```python
"""Kartoteka kontrahentów pojemnikowych — JEDNA tożsamość dla dostawcy
i odbiorcy tej samej firmy (scalanie po NIP).

`suppliers` i `clients` zostają nietknięte: to warstwa tożsamości wyłącznie
na potrzeby salda nośników zwrotnych. Fuzja tamtych tabel dotknęłaby przyjęć,
zamówień, WZ, HDI i CMR — nieproporcjonalne ryzyko do rozwiązywanego problemu.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one
from app.logging_config import get_logger
from app.utils.containers import normalize_name, normalize_nip
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

# ref_type → tabela źródłowa. Rozszerzenie o kolejny typ wymaga TYLKO wpisu tutaj.
_SOURCE_TABLES = {"supplier": "suppliers", "client": "clients"}


def _find_or_create(conn, *, nip: str, name: str, address: str = "") -> str:
    """Partner po NIP-ie, a gdy NIP pusty — po znormalizowanej nazwie
    WYŁĄCZNIE wśród partnerów też bez NIP-u (firma z NIP-em ma już swoją
    tożsamość i nie wolno do niej przykleić anonimowego wpisu)."""
    if nip:
        row = cx_query_one(conn, "SELECT id FROM container_partners WHERE nip=%s", (nip,))
        if row:
            return row["id"]
    else:
        target = normalize_name(name)
        for row in cx_query_all(
            conn, "SELECT id, name FROM container_partners WHERE COALESCE(nip,'')=''"
        ):
            if normalize_name(row["name"]) == target:
                return row["id"]

    pid = cuid()
    cx_execute(
        conn,
        "INSERT INTO container_partners (id, nip, name, address, created_at) "
        "VALUES (%s,%s,%s,%s,%s)",
        (pid, nip or None, (name or "").strip() or "(bez nazwy)", address or "", now_iso()))
    logger.info("containers.partner.created", extra={"partner_id": pid, "nip": nip})
    return pid


def resolve_partner(conn, ref_type: str, ref_id: str) -> str:
    """Id partnera pojemnikowego dla dostawcy/odbiorcy z kartoteki.
    Tworzy partnera, gdy jeszcze nie istnieje."""
    table = _SOURCE_TABLES.get(ref_type)
    if not table or not ref_id:
        raise HTTPException(400, "Nieznany typ kontrahenta")

    link = cx_query_one(
        conn,
        "SELECT partner_id FROM container_partner_links WHERE ref_type=%s AND ref_id=%s",
        (ref_type, ref_id))
    if link:
        return link["partner_id"]

    src = cx_query_one(conn, f"SELECT * FROM {table} WHERE id=%s", (ref_id,))
    if not src:
        raise HTTPException(404, "Kontrahent nie istnieje")

    address = ", ".join(p for p in [src.get("address") or "", src.get("city") or ""] if p)
    pid = _find_or_create(
        conn,
        nip=normalize_nip(src.get("nip")),
        name=src.get("display_name") or src.get("name") or "",
        address=address)
    cx_execute(
        conn,
        "INSERT INTO container_partner_links (partner_id, ref_type, ref_id) VALUES (%s,%s,%s) "
        "ON CONFLICT (ref_type, ref_id) DO NOTHING",
        (pid, ref_type, ref_id))
    return pid


def resolve_partner_by_nip(conn, nip: str, name: str, address: str = "") -> str:
    """Partner dla kontrahenta spoza kartoteki — ręczne WZ podaje samego
    kupującego (nazwa + NIP w nagłówku), bez id klienta."""
    return _find_or_create(conn, nip=normalize_nip(nip), name=name, address=address)


def get_partner(partner_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM container_partners WHERE id=%s", (partner_id,))
    if not row:
        raise HTTPException(404, "Kontrahent pojemnikowy nie istnieje")
    roles = [r["ref_type"] for r in query_all(
        "SELECT DISTINCT ref_type FROM container_partner_links WHERE partner_id=%s",
        (partner_id,))]
    return {**row, "roles": sorted(roles)}


def list_partners() -> List[Dict[str, Any]]:
    """Lista partnerów z rolami. Role z podzapytania, NIE z JOIN-a — JOIN
    zwielokrotniłby wiersze przy partnerze będącym i dostawcą, i odbiorcą."""
    return query_all(
        """SELECT p.*,
                  (SELECT ARRAY_AGG(DISTINCT l.ref_type)
                     FROM container_partner_links l WHERE l.partner_id = p.id) AS roles
           FROM container_partners p
           WHERE p.active
           ORDER BY p.name""")
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_container_partners_db.py -q
```
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/container_partners_service.py backend/tests/test_container_partners_db.py
git commit -m "feat(pojemniki): kartoteka partnerów scalana po NIP"
```

---

### Task 4: Księga i saldo (`container_ledger_service.py`)

**Files:**
- Create: `backend/app/services/container_ledger_service.py`
- Test: `backend/tests/test_container_ledger_db.py`

**Interfaces:**
- Consumes: `ASSET_TYPES` (Task 1), tabele (Task 2), `resolve_partner_by_nip` (Task 3)
- Produces:
  - `book_target(conn, *, partner_id, asset_type, source_type, source_id, target_qty, movement_date, doc_id=None, note="", confirmed=False, created_by=None) -> int`
  - `book_assets(conn, *, partner_id, source_type, source_id, targets: dict[str,int], movement_date, doc_id=None, note="", confirmed=False, created_by=None) -> dict[str,int]`
  - `partner_balance_cx(conn, partner_id: str) -> dict[str,int]`
  - `balances(q: str = "", nonzero: bool = False) -> list[dict]`
  - `movements(partner_id="", date_from="", date_to="", unconfirmed_only=False) -> list[dict]`
  - `pending_groups(partner_id="") -> list[dict]`
  - `correct_group(partner_id, source_type, source_id, targets: dict[str,int], confirm: bool) -> dict`
  - `create_manual_movement(partner_id, asset_type, qty, movement_date, note="") -> dict`
  - `statement(partner_id, date_from, date_to) -> dict`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_container_ledger_db.py`:

```python
"""Księga nośników: znak, księgowanie różnicowe, saldo, wyciąg za okres."""
import pytest
from fastapi import HTTPException

from app.db import query_all, query_one, transaction
from app.services.container_ledger_service import (
    balances,
    book_assets,
    book_target,
    correct_group,
    create_manual_movement,
    partner_balance_cx,
    pending_groups,
    statement,
)
from app.utils.ids import cuid, now_iso


def _partner(name="KOKO", nip="5130064478") -> str:
    from app.db import execute
    pid = cuid()
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
            (pid, nip or None, name, now_iso()))
    return pid


# ── book_target: różnicowo i idempotentnie ───────────────────────────
def test_pierwsze_ksiegowanie_dopisuje_pelna_wartosc(db):
    pid = _partner()
    with transaction() as conn:
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb1", target_qty=400, movement_date="2026-07-29")
    assert delta == 400
    assert query_one("SELECT COUNT(*) AS n FROM container_movements")["n"] == 1


def test_powtorne_ksiegowanie_tej_samej_wartosci_nic_nie_dopisuje(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                    source_id="rb1", target_qty=400, movement_date="2026-07-29")
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb1", target_qty=400, movement_date="2026-07-29")
    assert delta == 0
    assert query_one("SELECT COUNT(*) AS n FROM container_movements")["n"] == 1


def test_korekta_dopisuje_roznice_i_NIE_rusza_starego_wiersza(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                    source_id="rb1", target_qty=400, movement_date="2026-07-29")
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb1", target_qty=380, movement_date="2026-07-30")
    assert delta == -20
    rows = query_all("SELECT qty FROM container_movements ORDER BY created_at, qty DESC")
    assert [int(r["qty"]) for r in rows] == [400, -20], "historia musi zostać w całości"
    assert query_one("SELECT COALESCE(SUM(qty),0) AS s FROM container_movements")["s"] == 380


def test_wyzerowanie_zrodla_domyka_saldo_do_zera(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="wz",
                    source_id="wz1", target_qty=-100, movement_date="2026-07-29")
        book_target(conn, partner_id=pid, asset_type="e2", source_type="wz",
                    source_id="wz1", target_qty=0, movement_date="2026-07-29")
        assert partner_balance_cx(conn, pid)["e2"] == 0


def test_nieznany_nosnik_odrzucony(db):
    pid = _partner()
    with pytest.raises(HTTPException) as e:
        with transaction() as conn:
            book_target(conn, partner_id=pid, asset_type="skrzynka", source_type="manual",
                        source_id=None, target_qty=1, movement_date="2026-07-29")
    assert e.value.status_code == 400


def test_zrodla_nie_mieszaja_sie_ze_soba(db):
    pid = _partner()
    with transaction() as conn:
        book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                    source_id="rb1", target_qty=400, movement_date="2026-07-29")
        delta = book_target(conn, partner_id=pid, asset_type="e2", source_type="raw_batch",
                            source_id="rb2", target_qty=100, movement_date="2026-07-29")
    assert delta == 100, "drugie przyjęcie liczy się od zera, nie od salda rb1"
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 500


# ── Znak i saldo ─────────────────────────────────────────────────────
def test_dostawa_plus_zwrot_daje_zero(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400, "pallet_h1": 10}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="doc1",
                    targets={"e2": -400, "pallet_h1": -10}, movement_date="2026-07-30",
                    confirmed=True)
        bal = partner_balance_cx(conn, pid)
    assert bal == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}


def test_book_assets_traktuje_brakujacy_klucz_jak_zero(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-29")
        assert partner_balance_cx(conn, pid) == {"e2": 400, "pallet_h1": 0, "pallet_other": 0}


def test_balances_nie_zwielokrotnia_sum_przy_wielu_rolach(db):
    from app.db import execute
    pid = _partner()
    execute("INSERT INTO container_partner_links (partner_id, ref_type, ref_id) "
            "VALUES (%s,'supplier','s1'), (%s,'client','c1')", (pid, pid))
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-29")
    rows = balances()
    assert len(rows) == 1
    assert rows[0]["e2"] == 400, "JOIN po rolach nie może podwoić sumy"
    assert sorted(rows[0]["roles"]) == ["client", "supplier"]


def test_balances_nonzero_pomija_rozliczonych(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="d1",
                    targets={"e2": -400}, movement_date="2026-07-30")
    assert balances(nonzero=True) == []
    assert len(balances()) == 1


# ── Do rozliczenia: grupy i korekta z biura ──────────────────────────
def test_pending_groups_pokazuje_tylko_niepotwierdzone(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="wz", source_id="wz1",
                    targets={"e2": -60}, movement_date="2026-07-29")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="d1",
                    targets={"e2": 60}, movement_date="2026-07-30", confirmed=True)
    groups = pending_groups(pid)
    assert len(groups) == 1
    assert groups[0]["sourceType"] == "wz"
    assert groups[0]["assets"]["e2"] == -60


def test_correct_group_koryguje_i_potwierdza(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="wz", source_id="wz1",
                    targets={"e2": -60}, movement_date="2026-07-29")
    correct_group(pid, "wz", "wz1", {"e2": -58, "pallet_h1": -2}, confirm=True)
    with transaction() as conn:
        assert partner_balance_cx(conn, pid) == {"e2": -58, "pallet_h1": -2, "pallet_other": 0}
    assert pending_groups(pid) == []
    assert query_one("SELECT COUNT(*) AS n FROM container_movements WHERE asset_type='e2'")["n"] == 2


def test_reczny_ruch_ze_znakiem(db):
    pid = _partner()
    create_manual_movement(pid, "e2", -25, "2026-07-29", "zwrot kierowcy bez dokumentu")
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == -25


# ── Wyciąg za okres ──────────────────────────────────────────────────
def test_statement_saldo_otwarcia_plus_ruchy_rowna_sie_zamknieciu(db):
    pid = _partner()
    with transaction() as conn:
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb0",
                    targets={"e2": 100}, movement_date="2026-06-30")   # przed oknem
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400}, movement_date="2026-07-10")
        book_assets(conn, partner_id=pid, source_type="container_doc", source_id="d1",
                    targets={"e2": -350}, movement_date="2026-07-20")
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb2",
                    targets={"e2": 70}, movement_date="2026-08-05")    # po oknie
    st = statement(pid, "2026-07-01", "2026-07-31")
    assert st["opening"]["e2"] == 100
    assert st["closing"]["e2"] == 150
    assert len(st["movements"]) == 2
    assert [m["balanceAfter"]["e2"] for m in st["movements"]] == [500, 150]
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_container_ledger_db.py -q
```
Expected: FAIL — `No module named 'app.services.container_ledger_service'`

- [ ] **Step 3: Write implementation**

Create `backend/app/services/container_ledger_service.py`:

```python
"""Księga nośników zwrotnych — saldo pojemników E2 i palet per kontrahent.

KONWENCJA ZNAKU (jedyna, obowiązująca w całym systemie):
    qty > 0 — nośniki przyjechały DO NAS  (dostawa surowca)  → MY jesteśmy winni
    qty < 0 — nośniki wyjechały OD NAS    (WZ, zwrot pustych) → ONI są winni

Saldo = SUM(qty). Zero = rozliczone. Nie ma kolumny `direction` — kierunek to
znak, dzięki czemu saldo jest zwykłą sumą i nie da się go policzyć źle.

KSIĘGOWANIE RÓŻNICOWE: dokument źródłowy (przyjęcie, WZ) można edytować
i anulować, a inwariant „no data loss" zabrania kasowania i cichych
update'ów. Dlatego `book_target` doprowadza SUMĘ ruchów danego źródła do
zadanej wartości, DOPISUJĄC różnicę — historia zostaje w całości.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_all, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.utils.containers import ASSET_TYPES
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)

# Opis źródła ruchu na kartotece i wydruku wyciągu.
SOURCE_LABELS = {
    "raw_batch": "Przyjęcie surowca",
    "wz": "WZ towaru",
    "container_doc": "WZ na pojemniki",
    "manual": "Wpis ręczny",
}


def _zero_balance() -> Dict[str, int]:
    return {a: 0 for a in ASSET_TYPES}


# ── Księgowanie ──────────────────────────────────────────────────────
def book_target(
    conn,
    *,
    partner_id: str,
    asset_type: str,
    source_type: str,
    source_id: Optional[str],
    target_qty: int,
    movement_date: str,
    doc_id: Optional[str] = None,
    note: str = "",
    confirmed: bool = False,
    created_by: Optional[str] = None,
) -> int:
    """Doprowadza SUMĘ ruchów dla (source_type, source_id, asset_type) do
    `target_qty`, dopisując różnicę jako nowy wiersz. Zwraca dopisaną deltę.

    Idempotentne: powtórne wywołanie z tym samym `target_qty` zwraca 0
    i nie tworzy wiersza. Anulowanie źródła = wywołanie z `target_qty=0`.
    """
    if asset_type not in ASSET_TYPES:
        raise HTTPException(400, f"Nieznany rodzaj nośnika: {asset_type}")

    row = cx_query_one(
        conn,
        "SELECT COALESCE(SUM(qty),0) AS booked FROM container_movements "
        "WHERE source_type=%s AND source_id IS NOT DISTINCT FROM %s AND asset_type=%s",
        (source_type, source_id, asset_type))
    delta = int(target_qty) - int(row["booked"] or 0)
    if delta == 0:
        return 0

    cx_execute(
        conn,
        "INSERT INTO container_movements "
        "(id, partner_id, asset_type, qty, source_type, source_id, doc_id, "
        " movement_date, confirmed, note, created_by, created_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (cuid(), partner_id, asset_type, delta, source_type, source_id, doc_id,
         movement_date, confirmed, note, created_by, now_iso()))
    return delta


def book_assets(
    conn,
    *,
    partner_id: str,
    source_type: str,
    source_id: Optional[str],
    targets: Dict[str, int],
    movement_date: str,
    doc_id: Optional[str] = None,
    note: str = "",
    confirmed: bool = False,
    created_by: Optional[str] = None,
) -> Dict[str, int]:
    """`book_target` dla wszystkich trzech nośników naraz. Brakujący klucz
    w `targets` znaczy 0 — dzięki temu anulowanie to `targets={}`."""
    return {
        a: book_target(
            conn, partner_id=partner_id, asset_type=a, source_type=source_type,
            source_id=source_id, target_qty=int(targets.get(a) or 0),
            movement_date=movement_date, doc_id=doc_id, note=note,
            confirmed=confirmed, created_by=created_by)
        for a in ASSET_TYPES
    }


def partner_balance_cx(conn, partner_id: str) -> Dict[str, int]:
    """Saldo partnera per nośnik — w trwającej transakcji."""
    out = _zero_balance()
    for r in cx_query_all(
        conn,
        "SELECT asset_type, COALESCE(SUM(qty),0) AS saldo FROM container_movements "
        "WHERE partner_id=%s GROUP BY asset_type",
        (partner_id,)
    ):
        out[r["asset_type"]] = int(r["saldo"] or 0)
    return out


# ── Odczyty ──────────────────────────────────────────────────────────
def balances(q: str = "", nonzero: bool = False) -> List[Dict[str, Any]]:
    """Salda wszystkich partnerów per nośnik.

    Role pobierane PODZAPYTANIEM, nie JOIN-em: partner będący i dostawcą,
    i odbiorcą zwielokrotniłby wiersze i podwoił SUM(qty).
    """
    rows = query_all(
        """SELECT p.id, p.nip, p.name, p.address,
                  COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='e2'), 0)           AS e2,
                  COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_h1'), 0)    AS pallet_h1,
                  COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_other'), 0) AS pallet_other,
                  COUNT(m.id) FILTER (WHERE NOT m.confirmed)                         AS unconfirmed,
                  MAX(m.movement_date)                                               AS last_movement,
                  (SELECT ARRAY_AGG(DISTINCT l.ref_type)
                     FROM container_partner_links l WHERE l.partner_id = p.id)       AS roles
             FROM container_partners p
             LEFT JOIN container_movements m ON m.partner_id = p.id
            WHERE p.active
            GROUP BY p.id, p.nip, p.name, p.address
            ORDER BY p.name""")
    needle = (q or "").strip().lower()
    out = []
    for r in rows:
        rec = {
            "id": r["id"], "nip": r["nip"] or "", "name": r["name"],
            "address": r["address"] or "",
            "e2": int(r["e2"]), "pallet_h1": int(r["pallet_h1"]),
            "pallet_other": int(r["pallet_other"]),
            "unconfirmed": int(r["unconfirmed"] or 0),
            "last_movement": str(r["last_movement"] or "")[:10] or None,
            "roles": sorted(r["roles"] or []),
        }
        if nonzero and not (rec["e2"] or rec["pallet_h1"] or rec["pallet_other"]):
            continue
        if needle and needle not in f"{rec['name']} {rec['nip']}".lower():
            continue
        out.append(rec)
    return out


def movements(
    partner_id: str = "", date_from: str = "", date_to: str = "",
    unconfirmed_only: bool = False,
) -> List[Dict[str, Any]]:
    where, params = ["1=1"], []
    if partner_id:
        where.append("m.partner_id=%s"); params.append(partner_id)
    if date_from:
        where.append("m.movement_date >= %s"); params.append(date_from)
    if date_to:
        where.append("m.movement_date <= %s"); params.append(date_to)
    if unconfirmed_only:
        where.append("NOT m.confirmed")
    rows = query_all(
        "SELECT m.*, d.number AS doc_number FROM container_movements m "
        "LEFT JOIN container_docs d ON d.id = m.doc_id "
        f"WHERE {' AND '.join(where)} "
        "ORDER BY m.movement_date, m.created_at", params)
    return [_movement_dto(r) for r in rows]


def _movement_dto(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": r["id"], "partnerId": r["partner_id"], "assetType": r["asset_type"],
        "qty": int(r["qty"]), "sourceType": r["source_type"], "sourceId": r["source_id"],
        "sourceLabel": SOURCE_LABELS.get(r["source_type"], r["source_type"]),
        "docId": r.get("doc_id"), "docNumber": r.get("doc_number"),
        "movementDate": str(r["movement_date"])[:10],
        "confirmed": bool(r["confirmed"]), "note": r.get("note") or "",
    }


def pending_groups(partner_id: str = "") -> List[Dict[str, Any]]:
    """Źródła z co najmniej jednym NIEPOTWIERDZONYM ruchem — sekcja
    „Do rozliczenia". Grupujemy po źródle, nie po wierszu: biuro przegląda
    całe przyjęcie / całe WZ, a nie pojedynczy nośnik."""
    params: List[Any] = []
    where = "EXISTS (SELECT 1 FROM container_movements x WHERE x.source_type=m.source_type "
    where += "AND x.source_id IS NOT DISTINCT FROM m.source_id AND NOT x.confirmed)"
    if partner_id:
        where += " AND m.partner_id=%s"
        params.append(partner_id)
    rows = query_all(
        "SELECT m.partner_id, m.source_type, m.source_id, "
        "       MIN(m.movement_date) AS first_date, "
        "       COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='e2'),0) AS e2, "
        "       COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_h1'),0) AS pallet_h1, "
        "       COALESCE(SUM(m.qty) FILTER (WHERE m.asset_type='pallet_other'),0) AS pallet_other, "
        "       MIN(m.note) AS note "
        f"  FROM container_movements m WHERE {where} "
        " GROUP BY m.partner_id, m.source_type, m.source_id "
        " ORDER BY MIN(m.movement_date) DESC", params)
    return [{
        "partnerId": r["partner_id"], "sourceType": r["source_type"],
        "sourceId": r["source_id"] or "",
        "sourceLabel": SOURCE_LABELS.get(r["source_type"], r["source_type"]),
        "date": str(r["first_date"])[:10], "note": r["note"] or "",
        "assets": {"e2": int(r["e2"]), "pallet_h1": int(r["pallet_h1"]),
                   "pallet_other": int(r["pallet_other"])},
    } for r in rows]


# ── Zapisy z biura ───────────────────────────────────────────────────
def correct_group(
    partner_id: str, source_type: str, source_id: str,
    targets: Dict[str, int], confirm: bool = False,
) -> Dict[str, Any]:
    """Korekta liczb z biura: ustawia sumy nośników dla źródła (append-only
    delta) i opcjonalnie potwierdza całą grupę."""
    sid = source_id or None
    with transaction() as conn:
        book_assets(conn, partner_id=partner_id, source_type=source_type, source_id=sid,
                    targets=targets, movement_date=date.today().isoformat(),
                    note="Korekta biura", confirmed=confirm)
        if confirm:
            cx_execute(
                conn,
                "UPDATE container_movements SET confirmed=true "
                "WHERE source_type=%s AND source_id IS NOT DISTINCT FROM %s",
                (source_type, sid))
        bal = partner_balance_cx(conn, partner_id)
    logger.info("containers.group.corrected",
                extra={"partner_id": partner_id, "source_type": source_type})
    return {"balance": bal}


def create_manual_movement(
    partner_id: str, asset_type: str, qty: int, movement_date: str = "", note: str = "",
) -> Dict[str, Any]:
    """Ruch ręczny (`source_type='manual'`). `qty` ZE ZNAKIEM — dodatnie
    przyjechało do nas, ujemne wyjechało. Każdy taki wpis ma własne
    `source_id`, więc nigdy nie zlewa się z innym."""
    if asset_type not in ASSET_TYPES:
        raise HTTPException(400, f"Nieznany rodzaj nośnika: {asset_type}")
    if int(qty) == 0:
        raise HTTPException(400, "Ilość ruchu nie może być zerowa")
    mid = cuid()
    with transaction() as conn:
        book_target(conn, partner_id=partner_id, asset_type=asset_type,
                    source_type="manual", source_id=mid, target_qty=int(qty),
                    movement_date=movement_date or date.today().isoformat(),
                    note=note, confirmed=True)
        bal = partner_balance_cx(conn, partner_id)
    return {"id": mid, "balance": bal}


# ── Wyciąg za okres ──────────────────────────────────────────────────
def statement(partner_id: str, date_from: str, date_to: str) -> Dict[str, Any]:
    """Potwierdzenie salda: saldo otwarcia (wszystko PRZED `date_from`),
    ruchy w oknie z saldem narastająco, saldo zamknięcia."""
    if not partner_id:
        raise HTTPException(400, "Wskaż kontrahenta")
    partner = query_one("SELECT * FROM container_partners WHERE id=%s", (partner_id,))
    if not partner:
        raise HTTPException(404, "Kontrahent pojemnikowy nie istnieje")

    opening = _zero_balance()
    if date_from:
        for r in query_all(
            "SELECT asset_type, COALESCE(SUM(qty),0) AS s FROM container_movements "
            "WHERE partner_id=%s AND movement_date < %s GROUP BY asset_type",
            (partner_id, date_from)
        ):
            opening[r["asset_type"]] = int(r["s"] or 0)

    running = dict(opening)
    rows = []
    for m in movements(partner_id=partner_id, date_from=date_from, date_to=date_to):
        running[m["assetType"]] += m["qty"]
        rows.append({**m, "balanceAfter": dict(running)})

    return {
        "partner": {"id": partner["id"], "name": partner["name"],
                    "nip": partner["nip"] or "", "address": partner["address"] or ""},
        "from": date_from, "to": date_to,
        "opening": opening, "movements": rows, "closing": running,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_container_ledger_db.py -q
```
Expected: PASS — 15 passed

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/container_ledger_service.py backend/tests/test_container_ledger_db.py
git commit -m "feat(pojemniki): księga ruchów, saldo i księgowanie różnicowe"
```

---

### Task 5: Dokument „WZ na POJEMNIKI" (`container_docs_service.py`)

**Files:**
- Create: `backend/app/services/container_docs_service.py`
- Test: `backend/tests/test_container_docs_db.py`

**Interfaces:**
- Consumes: `format_container_doc_number`, `ASSET_TYPES` (Task 1); `resolve_partner` (Task 3); `book_assets`, `partner_balance_cx` (Task 4); `settings_service.get_company`
- Produces:
  - `create_doc(*, partner_id="", ref_type="", ref_id="", doc_date="", driver="", vehicle="", lines: list[dict], notes="", created_by=None) -> dict`
  - `get_doc(doc_id: str) -> dict`
  - `list_docs(partner_id: str = "") -> list[dict]`
  - `cancel_doc(doc_id: str) -> dict`
  - Kształt `lines` na wejściu: `[{"assetType": "e2", "inQty": 0, "outQty": 400}, ...]`
  - Kształt dokumentu na wyjściu: `{id, number, partner: {...}, seller: {...}, docDate, driver, vehicle, lines: [{assetType, label, inQty, outQty, balance}], balanceAfter, status, notes}`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_container_docs_db.py`:

```python
"""Dokument WZ na POJEMNIKI: numeracja, księgowanie, saldo, anulowanie."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one, transaction
from app.services.container_docs_service import cancel_doc, create_doc, get_doc, list_docs
from app.services.container_ledger_service import book_assets, partner_balance_cx
from app.utils.ids import cuid, now_iso


def _partner(name="KOKO", nip="5130064478") -> str:
    pid = cuid()
    execute("INSERT INTO container_partners (id, nip, name, created_at) VALUES (%s,%s,%s,%s)",
            (pid, nip or None, name, now_iso()))
    return pid


def _lines(e2_in=0, e2_out=0, h1_in=0, h1_out=0, other_in=0, other_out=0):
    return [
        {"assetType": "e2", "inQty": e2_in, "outQty": e2_out},
        {"assetType": "pallet_h1", "inQty": h1_in, "outQty": h1_out},
        {"assetType": "pallet_other", "inQty": other_in, "outQty": other_out},
    ]


def test_wydanie_domyka_dostawe_do_zera(db):
    pid = _partner()
    with transaction() as conn:  # dostawa: 400 pojemników + 10 palet przyjechało do nas
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb1",
                    targets={"e2": 400, "pallet_h1": 10}, movement_date="2026-07-28")
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", driver="Jan Kowalski",
                     vehicle="KR 12345", lines=_lines(e2_out=400, h1_out=10))
    assert doc["balanceAfter"] == {"e2": 0, "pallet_h1": 0, "pallet_other": 0}
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 0


def test_numeracja_rosnie_w_obrebie_miesiaca(db):
    pid = _partner()
    a = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=1))
    b = create_doc(partner_id=pid, doc_date="2026-07-30", lines=_lines(e2_out=1))
    assert a["number"].startswith("POJ/1/")
    assert b["number"].startswith("POJ/2/")


def test_saldo_na_dokumencie_jest_ZAMROZONE_w_chwili_wystawienia(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_in=100))
    assert doc["balanceAfter"]["e2"] == 100
    with transaction() as conn:  # późniejszy ruch nie może zmienić wydruku
        book_assets(conn, partner_id=pid, source_type="raw_batch", source_id="rb9",
                    targets={"e2": 500}, movement_date="2026-07-31")
    assert get_doc(doc["id"])["balanceAfter"]["e2"] == 100


def test_dostawa_i_zwrot_na_jednym_dokumencie(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_in=400, e2_out=380))
    assert doc["balanceAfter"]["e2"] == 20
    line = next(l for l in doc["lines"] if l["assetType"] == "e2")
    assert (line["inQty"], line["outQty"], line["balance"]) == (400, 380, 20)


def test_anulowanie_zeruje_ruchy_ale_zostawia_dokument(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=400))
    cancel_doc(doc["id"])
    with transaction() as conn:
        assert partner_balance_cx(conn, pid)["e2"] == 0
    after = get_doc(doc["id"])
    assert after["status"] == "anulowany"
    assert query_one("SELECT COUNT(*) AS n FROM container_docs")["n"] == 1


def test_ponowne_anulowanie_odrzucone(db):
    pid = _partner()
    doc = create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=5))
    cancel_doc(doc["id"])
    with pytest.raises(HTTPException) as e:
        cancel_doc(doc["id"])
    assert e.value.status_code == 409


def test_dokument_bez_zadnej_ilosci_odrzucony(db):
    pid = _partner()
    with pytest.raises(HTTPException) as e:
        create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines())
    assert e.value.status_code == 400


def test_partner_z_kartoteki_dostawcow(db):
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))
    doc = create_doc(ref_type="supplier", ref_id="sup1", doc_date="2026-07-29",
                     lines=_lines(e2_out=100))
    assert doc["partner"]["nip"] == "5130064478"
    assert query_one("SELECT COUNT(*) AS n FROM container_partners")["n"] == 1


def test_lista_dokumentow_partnera(db):
    pid = _partner()
    create_doc(partner_id=pid, doc_date="2026-07-29", lines=_lines(e2_out=1))
    create_doc(partner_id=pid, doc_date="2026-07-30", lines=_lines(e2_out=2))
    assert len(list_docs(pid)) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_container_docs_db.py -q
```
Expected: FAIL — `No module named 'app.services.container_docs_service'`

- [ ] **Step 3: Write implementation**

Create `backend/app/services/container_docs_service.py`:

```python
"""Dokument „WZ na POJEMNIKI" — zdarzenie transportowe z kontrahentem.

Jeden dokument obejmuje OBA kierunki naraz (kolumny „Dostawa / odbiór"
i „Zwrot"), bo kierowca zwykle przywozi pełne i zabiera puste w tym samym
kursie. Numeracja POJ/NN/MM/RR wzorowana na WZ (`wz_service._insert_wz`).

Saldo na dokumencie jest ZAMROŻONE w chwili wystawienia (`balance_after`) —
ponowny wydruk po kolejnych ruchach musi dać ten sam papier.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import cx_execute, cx_query_one, query_all, query_one, transaction
from app.logging_config import get_logger
from app.services.container_ledger_service import book_assets, partner_balance_cx
from app.services.container_partners_service import resolve_partner
from app.services.settings_service import get_company
from app.utils.containers import ASSET_LABELS, ASSET_TYPES, format_container_doc_number
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _seller_block() -> Dict[str, Any]:
    """Dane naszej firmy z Ustawień firmy — NIGDY nie hardcode'ujemy ich
    w kodzie ani na wydruku (instancja MES działa u wielu klientów)."""
    co = get_company()
    return {
        "name": co.get("name", ""),
        "address": co.get("address", ""),
        "postal_code": co.get("postal_code", ""),
        "city": co.get("city", ""),
        "nip": co.get("nip", ""),
        "phone": co.get("phone", ""),
    }


def _normalize_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, int]]:
    """Wejście → kanoniczne trzy wiersze w kolejności ASSET_TYPES."""
    by_type: Dict[str, Dict[str, int]] = {}
    for raw in lines or []:
        asset = raw.get("assetType") or raw.get("asset_type")
        if asset not in ASSET_TYPES:
            raise HTTPException(400, f"Nieznany rodzaj nośnika: {asset}")
        try:
            in_qty = int(raw.get("inQty") if raw.get("inQty") is not None else raw.get("in_qty") or 0)
            out_qty = int(raw.get("outQty") if raw.get("outQty") is not None else raw.get("out_qty") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "Ilości nośników muszą być liczbami całkowitymi")
        if in_qty < 0 or out_qty < 0:
            raise HTTPException(400, "Ilości nośników nie mogą być ujemne")
        by_type[asset] = {"asset_type": asset, "in_qty": in_qty, "out_qty": out_qty}
    out = [by_type.get(a, {"asset_type": a, "in_qty": 0, "out_qty": 0}) for a in ASSET_TYPES]
    if not any(l["in_qty"] or l["out_qty"] for l in out):
        raise HTTPException(400, "Dokument musi zawierać co najmniej jedną ilość")
    return out


def create_doc(
    *,
    partner_id: str = "",
    ref_type: str = "",
    ref_id: str = "",
    doc_date: str = "",
    driver: str = "",
    vehicle: str = "",
    lines: Optional[List[Dict[str, Any]]] = None,
    notes: str = "",
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Wystawia dokument i księguje ruchy (in − out per nośnik)."""
    norm = _normalize_lines(lines or [])
    day = (doc_date or date.today().isoformat())[:10]
    ym = f"{day[2:4]}{day[5:7]}"  # 'RRMM' z daty dokumentu

    with transaction() as conn:
        pid = partner_id or resolve_partner(conn, ref_type, ref_id)
        partner = cx_query_one(conn, "SELECT * FROM container_partners WHERE id=%s", (pid,))
        if not partner:
            raise HTTPException(404, "Kontrahent pojemnikowy nie istnieje")

        seq = int(cx_query_one(
            conn, "SELECT COALESCE(MAX(seq),0)+1 AS n FROM container_docs WHERE year_month=%s",
            (ym,))["n"])
        did = cuid()
        snapshot = {"id": pid, "name": partner["name"], "nip": partner["nip"] or "",
                    "address": partner["address"] or ""}
        cx_execute(
            conn,
            "INSERT INTO container_docs "
            "(id, number, seq, year_month, partner_id, partner_snapshot, seller, doc_date, "
            " driver, vehicle, lines, balance_after, status, notes, created_by, created_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'{}','wystawiony',%s,%s,%s)",
            (did, format_container_doc_number(seq, ym), seq, ym, pid,
             json.dumps(snapshot), json.dumps(_seller_block()), day,
             driver or "", vehicle or "", json.dumps(norm), notes or "",
             created_by, now_iso()))

        book_assets(
            conn, partner_id=pid, source_type="container_doc", source_id=did,
            targets={l["asset_type"]: l["in_qty"] - l["out_qty"] for l in norm},
            movement_date=day, doc_id=did, note="WZ na pojemniki", confirmed=True,
            created_by=created_by)

        # Saldo liczone PO zaksięgowaniu i zamrożone na dokumencie.
        bal = partner_balance_cx(conn, pid)
        cx_execute(conn, "UPDATE container_docs SET balance_after=%s WHERE id=%s",
                   (json.dumps(bal), did))

    logger.info("containers.doc.created", extra={"doc_id": did, "partner_id": pid})
    return get_doc(did)


def _doc_dto(row: Dict[str, Any]) -> Dict[str, Any]:
    lines = row.get("lines")
    if not isinstance(lines, list):
        lines = json.loads(lines or "[]")
    bal = row.get("balance_after")
    if not isinstance(bal, dict):
        bal = json.loads(bal or "{}")
    snapshot = row.get("partner_snapshot")
    if not isinstance(snapshot, dict):
        snapshot = json.loads(snapshot or "{}")
    seller = row.get("seller")
    if not isinstance(seller, dict):
        seller = json.loads(seller or "{}")
    return {
        "id": row["id"], "number": row["number"], "status": row["status"],
        "partner": snapshot, "partnerId": row["partner_id"], "seller": seller,
        "docDate": str(row["doc_date"])[:10],
        "driver": row.get("driver") or "", "vehicle": row.get("vehicle") or "",
        "notes": row.get("notes") or "",
        "balanceAfter": {a: int(bal.get(a) or 0) for a in ASSET_TYPES},
        "lines": [{
            "assetType": l["asset_type"], "label": ASSET_LABELS[l["asset_type"]],
            "inQty": int(l["in_qty"]), "outQty": int(l["out_qty"]),
            "balance": int(bal.get(l["asset_type"]) or 0),
        } for l in lines],
    }


def get_doc(doc_id: str) -> Dict[str, Any]:
    row = query_one("SELECT * FROM container_docs WHERE id=%s", (doc_id,))
    if not row:
        raise HTTPException(404, "Dokument pojemnikowy nie istnieje")
    return _doc_dto(row)


def list_docs(partner_id: str = "") -> List[Dict[str, Any]]:
    if partner_id:
        rows = query_all("SELECT * FROM container_docs WHERE partner_id=%s "
                         "ORDER BY doc_date DESC, created_at DESC", (partner_id,))
    else:
        rows = query_all("SELECT * FROM container_docs ORDER BY doc_date DESC, created_at DESC")
    return [_doc_dto(r) for r in rows]


def cancel_doc(doc_id: str) -> Dict[str, Any]:
    """Anulowanie: ruchy dokumentu doprowadzone do zera, dokument ZOSTAJE
    w bazie ze statusem 'anulowany' (wzorzec cancel_wz — nie kasujemy)."""
    with transaction() as conn:
        row = cx_query_one(conn, "SELECT id, partner_id, status, doc_date "
                                 "FROM container_docs WHERE id=%s FOR UPDATE", (doc_id,))
        if not row:
            raise HTTPException(404, "Dokument pojemnikowy nie istnieje")
        if row["status"] == "anulowany":
            raise HTTPException(409, "Dokument jest już anulowany")
        book_assets(conn, partner_id=row["partner_id"], source_type="container_doc",
                    source_id=doc_id, targets={}, movement_date=str(row["doc_date"])[:10],
                    doc_id=doc_id, note="Anulowanie dokumentu", confirmed=True)
        cx_execute(conn, "UPDATE container_docs SET status='anulowany' WHERE id=%s", (doc_id,))
    logger.info("containers.doc.cancelled", extra={"doc_id": doc_id})
    return get_doc(doc_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_container_docs_db.py -q
```
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/container_docs_service.py backend/tests/test_container_docs_db.py
git commit -m "feat(pojemniki): dokument WZ na POJEMNIKI z numeracją i zamrożonym saldem"
```

---

### Task 6: Kaliber i nośniki na przyjęciu surowca

**Files:**
- Modify: `backend/app/models/raw_batches.py` (`RawBatchCreate`, `RawBatchUpdate`)
- Modify: `backend/app/services/raw_batches_service.py` (`create_batch:50`, `cancel_batch:258`, `update_batch:300`)
- Test: `backend/tests/test_raw_batch_containers_db.py`

**Interfaces:**
- Consumes: `containers_for_kg` (Task 1), `resolve_partner` (Task 3), `book_assets` (Task 4)
- Produces: `raw_batches` zapisuje `container_kg` / `containers_count` / `pallets_h1` / `pallets_other`; każde przyjęcie z niezerowymi nośnikami tworzy ruchy `source_type='raw_batch'`, `source_id=<id partii>`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_raw_batch_containers_db.py`:

```python
"""Przyjęcie surowca zasila saldo pojemników dostawcy."""
from app.db import execute, query_all, query_one, transaction
from app.models.raw_batches import RawBatchCreate, RawBatchUpdate
from app.services.container_ledger_service import partner_balance_cx
from app.services.container_partners_service import resolve_partner
from app.services.raw_batches_service import cancel_batch, create_batch, update_batch
from app.utils.ids import now_iso


def _seed_supplier():
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup1','SUP1','KOKO','5130064478',true,%s)", (now_iso(),))


def _dto(**kw):
    base = dict(supplierId="sup1", supplierBatchNo="111634", kgReceived=6000.0,
                receivedDate="2026-07-29", slaughterDate="2026-07-28",
                expiryDate="2026-08-04", pricePerKg=5.0)
    base.update(kw)
    return RawBatchCreate.model_validate(base)


def _partner_id() -> str:
    with transaction() as conn:
        return resolve_partner(conn, "supplier", "sup1")


def test_kaliber_15_zapisuje_pojemniki_i_ksieguje_ruch(db):
    _seed_supplier()
    batch = create_batch(_dto(containerKg=15, palletsH1=10, palletsOther=2))
    row = query_one("SELECT container_kg, containers_count, pallets_h1, pallets_other "
                    "FROM raw_batches WHERE id=%s", (batch["id"],))
    assert row["containers_count"] == 400        # 6000 / 15
    assert row["pallets_h1"] == 10
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id()) == {
            "e2": 400, "pallet_h1": 10, "pallet_other": 2}


def test_kaliber_20_liczy_mniej_pojemnikow(db):
    _seed_supplier()
    create_batch(_dto(containerKg=20))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 300


def test_niepelny_pojemnik_zaokraglany_w_gore(db):
    _seed_supplier()
    create_batch(_dto(kgReceived=6005.0, containerKg=15))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 401


def test_niekalibrowany_bierze_liczbe_od_operatora(db):
    _seed_supplier()
    b = create_batch(_dto(containerKg=None, containersCount=377))
    assert query_one("SELECT containers_count FROM raw_batches WHERE id=%s",
                     (b["id"],))["containers_count"] == 377
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 377


def test_reczna_liczba_wygrywa_z_wyliczeniem(db):
    _seed_supplier()
    create_batch(_dto(containerKg=15, containersCount=395))  # operator policzył fizycznie
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 395


def test_bez_kalibru_i_bez_liczby_nie_ma_ruchu(db):
    _seed_supplier()
    create_batch(_dto())
    assert query_all("SELECT id FROM container_movements") == []


def test_ruchy_startuja_jako_niepotwierdzone(db):
    _seed_supplier()
    create_batch(_dto(containerKg=15))
    rows = query_all("SELECT confirmed FROM container_movements WHERE asset_type='e2'")
    assert rows and all(not r["confirmed"] for r in rows)


def test_edycja_kg_przelicza_pojemniki_roznicowo(db):
    _seed_supplier()
    b = create_batch(_dto(containerKg=15))
    update_batch(b["id"], RawBatchUpdate.model_validate(
        {"kgReceived": 3000.0, "pricePerKg": 5.0}))
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id())["e2"] == 200
    qtys = [int(r["qty"]) for r in query_all(
        "SELECT qty FROM container_movements WHERE asset_type='e2' ORDER BY created_at, qty DESC")]
    assert qtys == [400, -200], "korekta dopisuje różnicę, nie nadpisuje"


def test_anulowanie_partii_zeruje_saldo(db):
    _seed_supplier()
    b = create_batch(_dto(containerKg=15, palletsH1=10))
    cancel_batch(b["id"])
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner_id()) == {
            "e2": 0, "pallet_h1": 0, "pallet_other": 0}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_raw_batch_containers_db.py -q
```
Expected: FAIL — `RawBatchCreate` nie przyjmuje `containerKg` / brak kolumn w wyniku

- [ ] **Step 3: Dodaj pola do `backend/app/models/raw_batches.py`**

W `RawBatchCreate`, po `invoice_no`, dodaj:

```python
    # Nośniki zwrotne — kaliber pojemnika (None = niekalibrowany, wtedy
    # containers_count wpisuje operator) i palety liczone ręcznie.
    container_kg: Optional[float] = Field(None, alias="containerKg", ge=0)
    containers_count: Optional[int] = Field(None, alias="containersCount", ge=0)
    pallets_h1: int = Field(0, alias="palletsH1", ge=0)
    pallets_other: int = Field(0, alias="palletsOther", ge=0)
```

W `RawBatchUpdate`, po `notes`, dodaj te same cztery pola, oraz do słownika `mapping` w `model_validate` dopisz:

```python
                "containerKg": "container_kg",
                "containersCount": "containers_count",
                "palletsH1": "pallets_h1",
                "palletsOther": "pallets_other",
```

- [ ] **Step 4: Podepnij księgowanie w `raw_batches_service.py`**

Na górze pliku, do importów:

```python
from app.services.container_ledger_service import book_assets
from app.services.container_partners_service import resolve_partner
from app.utils.containers import containers_for_kg
```

Dodaj prywatny helper (nad `create_batch`):

```python
def _book_batch_containers(conn, batch_row: Dict, dto) -> Optional[int]:
    """Zapisuje nośniki na partii i księguje je na saldzie DOSTAWCY.

    Dostawa przyjeżdża w pojemnikach dostawcy → znak DODATNI (my winni).
    Liczba wpisana ręcznie ma pierwszeństwo przed wyliczeniem z kalibru —
    operator, który fizycznie policzył pojemniki, wie lepiej niż wzór.
    Ruch startuje jako NIEPOTWIERDZONY: liczy się do salda, ale trafia
    do sekcji „Do rozliczenia" na przegląd biura.
    """
    kg = float(getattr(dto, "kg_received", 0) or 0)
    containers = dto.containers_count
    if containers is None:
        containers = containers_for_kg(kg, dto.container_kg)
    h1 = int(dto.pallets_h1 or 0)
    other = int(dto.pallets_other or 0)

    cx_execute(
        conn,
        "UPDATE raw_batches SET container_kg=%s, containers_count=%s, "
        "pallets_h1=%s, pallets_other=%s WHERE id=%s",
        (dto.container_kg, containers, h1, other, batch_row["id"]))
    batch_row.update(container_kg=dto.container_kg, containers_count=containers,
                     pallets_h1=h1, pallets_other=other)

    supplier_id = batch_row.get("supplier_id")
    if not supplier_id or not (containers or h1 or other):
        return containers
    partner_id = resolve_partner(conn, "supplier", supplier_id)
    book_assets(
        conn, partner_id=partner_id, source_type="raw_batch", source_id=batch_row["id"],
        targets={"e2": containers or 0, "pallet_h1": h1, "pallet_other": other},
        movement_date=str(batch_row.get("received_date") or date.today())[:10],
        note=f"Przyjęcie {batch_row.get('internal_batch_no') or ''}".strip())
    return containers
```

W `create_batch`, wewnątrz `with transaction() as conn:`, tuż po `create_stock_movement(...)` dla przyjęcia (linia ~148), dodaj:

```python
        # ── Saldo pojemników: dostawa przyjeżdża w nośnikach dostawcy ──
        _book_batch_containers(conn, row, dto)
```

W `cancel_batch`, wewnątrz transakcji, po oznaczeniu partii jako anulowanej, dodaj:

```python
        # Anulowana partia nie może wisieć na saldzie pojemników dostawcy.
        if row.get("supplier_id"):
            partner_id = resolve_partner(conn, "supplier", row["supplier_id"])
            book_assets(conn, partner_id=partner_id, source_type="raw_batch",
                        source_id=batch_id, targets={},
                        movement_date=str(row.get("received_date") or date.today())[:10],
                        note="Anulowanie przyjęcia")
```

W `update_batch`, wewnątrz transakcji, po UPDATE partii, dodaj:

```python
        # Zmiana kg zmienia liczbę pojemników — przeliczamy i księgujemy różnicę.
        _book_batch_containers(conn, updated, dto)
```

gdzie `updated` to wiersz partii po UPDATE. Jeśli `update_batch` nie ma jeszcze takiej zmiennej, pobierz go: `updated = cx_query_one(conn, "SELECT * FROM raw_batches WHERE id=%s", (batch_id,))`.

Upewnij się, że plik importuje `date` (`from datetime import date`) i `Optional`.

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_raw_batch_containers_db.py -q
```
Expected: PASS — 9 passed

- [ ] **Step 6: Uruchom cały pakiet testów, żeby nie rozbić przyjęć**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest -q
```
Expected: PASS — brak nowych błędów względem stanu sprzed zmiany

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/models/raw_batches.py backend/app/services/raw_batches_service.py \
        backend/tests/test_raw_batch_containers_db.py
git commit -m "feat(pojemniki): kaliber i palety na przyjęciu surowca zasilają saldo dostawcy"
```

---

### Task 7: Nośniki na WZ towaru (wydanie, edycja, anulowanie)

**Files:**
- Modify: `backend/app/services/wz_service.py` — `_insert_wz:159`, `create_manual_wz:240`, `update_wz_lines:445`, `cancel_wz:573`, `stock_raw:981`
- Test: `backend/tests/test_wz_containers_db.py`

**Zakres — świadome ograniczenie v1:** księgujemy nośniki TYLKO dla WZ ręcznych (`source_type='manual'`). WZ z zamówienia (`create_wz_from_order`) pomijamy, bo `update_wz_lines` i `cancel_wz` i tak odrzucają dokumenty niereczne — zaksięgowany ruch nie dałby się skorygować ani cofnąć. Palety pod wyrób gotowy z zamówień to osobna iteracja.

**Interfaces:**
- Consumes: `containers_for_kg`, `prorate_containers` (Task 1); `resolve_partner`, `resolve_partner_by_nip` (Task 3); `book_assets` (Task 4)
- Produces:
  - `_container_partner_for_buyer(conn, buyer: dict) -> str | None`
  - `_wz_container_targets(lines: list, pallets_h1, pallets_other) -> dict[str,int]` (wartości UJEMNE)
  - `_rebook_wz_containers(conn, wz_id: str, *, zero: bool = False) -> None`
  - `_insert_wz(...)` przyjmuje dodatkowo `pallets_h1: int = 0`, `pallets_other: int = 0`
  - `create_manual_wz(...)` przyjmuje dodatkowo `pallets_h1: int = 0`, `pallets_other: int = 0`
  - `stock_raw()` zwraca dla ćwiartki pojemniki z kalibru partii, a dla ubocznych dodatkowo `pallets`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_wz_containers_db.py`:

```python
"""WZ towaru zdejmuje nośniki z salda odbiorcy (znak ujemny)."""
from app.db import execute, query_all, transaction
from app.services.container_ledger_service import partner_balance_cx
from app.services.container_partners_service import resolve_partner_by_nip
from app.services.wz_service import cancel_wz, create_manual_wz, stock_raw, update_wz_lines
from app.utils.ids import now_iso

BUYER = {"name": "ODBIORCA SP. Z O.O.", "address": "Kraków", "nip": "1111111111"}


def _seed_raw_batch(bid="rb1", no="900", kg=6000.0, container_kg=15, containers=None):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, container_kg, "
        " containers_count, created_at) "
        "VALUES (%s,%s,'KOKO',%s,%s,'active','mat-cwiartka','Ćwiartka z kurczaka',%s,%s,%s)",
        (bid, no, kg, kg, container_kg, containers, now_iso()))


def _partner():
    with transaction() as conn:
        return resolve_partner_by_nip(conn, BUYER["nip"], BUYER["name"])


def _wz(containers=20, qty=300.0, h1=0, other=0):
    return create_manual_wz(
        buyer=BUYER,
        selections=[{"stock_type": "raw", "stock_id": "rb1", "name": "Ćwiartka",
                     "unit": "kg", "qty": qty, "price": 5.0, "batch_no": "900",
                     "containers": containers}],
        valued=True, pallets_h1=h1, pallets_other=other)


def test_wz_zdejmuje_nosniki_ze_znakiem_ujemnym(db):
    _seed_raw_batch()
    _wz(containers=20, h1=2)
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner()) == {
            "e2": -20, "pallet_h1": -2, "pallet_other": 0}


def test_edycja_pojemnikow_ksieguje_roznice(db):
    _seed_raw_batch()
    doc = _wz(containers=20)
    update_wz_lines(doc["id"], [{"index": 0, "containers": 18}])
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner())["e2"] == -18
    qtys = [int(r["qty"]) for r in query_all(
        "SELECT qty FROM container_movements WHERE asset_type='e2' ORDER BY created_at, qty")]
    assert qtys == [-20, 2], "korekta dopisuje różnicę, nie nadpisuje"


def test_anulowanie_wz_zwraca_nosniki_na_saldo(db):
    _seed_raw_batch()
    doc = _wz(containers=20, h1=2)
    cancel_wz(doc["id"])
    with transaction() as conn:
        assert partner_balance_cx(conn, _partner()) == {
            "e2": 0, "pallet_h1": 0, "pallet_other": 0}


def test_wz_bez_nosnikow_nie_tworzy_ruchow(db):
    _seed_raw_batch()
    _wz(containers=0)
    assert query_all("SELECT id FROM container_movements") == []


def test_odbiorca_z_kartoteki_scala_sie_z_dostawca_po_nip(db):
    _seed_raw_batch()
    execute("INSERT INTO suppliers (id, code, name, nip, active, created_at) "
            "VALUES ('sup9','SUP9','ODBIORCA SP. Z O.O.','111-111-11-11',true,%s)", (now_iso(),))
    from app.services.container_partners_service import resolve_partner
    with transaction() as conn:
        sup_partner = resolve_partner(conn, "supplier", "sup9")
    _wz(containers=20)
    with transaction() as conn:
        assert partner_balance_cx(conn, sup_partner)["e2"] == -20


# ── stock_raw: kaliber partii zamiast twardych 15 kg ─────────────────
def test_stock_raw_liczy_pojemniki_z_kalibru_partii(db):
    _seed_raw_batch(kg=6000.0, container_kg=20)
    row = next(r for r in stock_raw() if r["id"] == "rb1")
    assert row["containers"] == 300


def test_stock_raw_partia_niekalibrowana_proporcjonalnie(db):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, supplier_name, kg_received, "
        " kg_available, status, material_type_id, material_name, container_kg, "
        " containers_count, created_at) "
        "VALUES ('rb2','901','KOKO',6000,3000,'active','mat-cwiartka','Ćwiartka',"
        " NULL,400,%s)", (now_iso(),))
    row = next(r for r in stock_raw() if r["id"] == "rb2")
    assert row["containers"] == 200  # połowa masy → połowa pojemników


def test_stock_raw_uboczne_maja_liczbe_palet(db):
    _seed_raw_batch()
    execute("INSERT INTO byproduct_lots (id, raw_batch_id, raw_batch_no, kind, kg, "
            " status, containers_available, created_at) "
            "VALUES ('lot1','rb1','900','bones',300,'open',12,%s)", (now_iso(),))
    # batch_byproducts ma raw_batch_id jako PRIMARY KEY i NIE ma kolumny created_at.
    execute("INSERT INTO batch_byproducts (raw_batch_id, raw_batch_no, bones_pallets) "
            "VALUES ('rb1','900','[{\"containers\":6},{\"containers\":6}]') "
            "ON CONFLICT (raw_batch_id) DO UPDATE SET bones_pallets=EXCLUDED.bones_pallets")
    row = next(r for r in stock_raw() if r["id"] == "lot1")
    assert row["containers"] == 12
    assert row["pallets"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_wz_containers_db.py -q
```
Expected: FAIL — `create_manual_wz() got an unexpected keyword argument 'pallets_h1'`

- [ ] **Step 3: Dodaj helpery nośników w `wz_service.py`**

Do importów na górze pliku:

```python
from app.services.container_ledger_service import book_assets
from app.services.container_partners_service import resolve_partner, resolve_partner_by_nip
from app.utils.containers import containers_for_kg, normalize_nip, prorate_containers
```

Nad `_insert_wz` dodaj:

```python
def _container_partner_for_buyer(conn, buyer: Dict[str, Any]) -> Optional[str]:
    """Partner pojemnikowy dla odbiorcy WZ: po kartotece klienta, gdy WZ
    wystawiono z listy, inaczej po NIP z nagłówka dokumentu (ręczne WZ
    podaje samego kupującego, bez id)."""
    cid = buyer.get("clientId") or buyer.get("client_id")
    if cid:
        return resolve_partner(conn, "client", str(cid))
    nip = normalize_nip(buyer.get("nip"))
    name = (buyer.get("name") or "").strip()
    if not nip and not name:
        return None
    return resolve_partner_by_nip(conn, nip, name, buyer.get("address") or "")


def _wz_container_targets(lines: List[Dict[str, Any]], pallets_h1, pallets_other) -> Dict[str, int]:
    """Nośniki wydane tym WZ-etem, ze znakiem UJEMNYM — jadą OD NAS."""
    e2 = 0
    for line in lines or []:
        try:
            e2 += int(line.get("containers") or 0)
        except (TypeError, ValueError):
            continue
    return {"e2": -e2, "pallet_h1": -int(pallets_h1 or 0), "pallet_other": -int(pallets_other or 0)}


def _rebook_wz_containers(conn, wz_id: str, *, zero: bool = False) -> None:
    """Przelicza ruchy nośników dokumentu z jego AKTUALNYCH pozycji.
    zero=True → doprowadza wszystkie nośniki do 0 (anulowanie).

    Wołane po każdej zmianie pozycji, bo księgowanie jest różnicowe —
    ustawiamy stan docelowy, a book_assets dopisuje samą różnicę."""
    row = cx_query_one(
        conn,
        "SELECT buyer_name, buyer_address, buyer_nip, lines, pallets_h1, pallets_other, "
        "       release_date, issued_date, number "
        "FROM wz_documents WHERE id=%s", (wz_id,))
    if not row:
        return
    partner_id = _container_partner_for_buyer(conn, {
        "name": row.get("buyer_name"), "address": row.get("buyer_address"),
        "nip": row.get("buyer_nip")})
    if not partner_id:
        return
    lines = row.get("lines")
    if not isinstance(lines, list):
        lines = json.loads(lines or "[]")
    targets = ({} if zero
               else _wz_container_targets(lines, row.get("pallets_h1"), row.get("pallets_other")))
    book_assets(
        conn, partner_id=partner_id, source_type="wz", source_id=wz_id, targets=targets,
        movement_date=str(row.get("release_date") or row.get("issued_date") or date.today())[:10],
        note=f"WZ {row.get('number') or ''}".strip())
```

- [ ] **Step 4: Przekaż palety przez `_insert_wz` i `create_manual_wz`**

W sygnaturze `_insert_wz` dodaj na końcu parametrów keyword: `pallets_h1: int = 0, pallets_other: int = 0`. W INSERT dopisz kolumny i wartości:

```python
        """INSERT INTO wz_documents
           (id, number, seq, year_month, source_type, source_id, seller,
            buyer_name, buyer_address, buyer_nip, valued, lines, total_value,
            place, issued_date, release_date, status, notes, currency, eur_rate,
            pallets_h1, pallets_other, created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'wstepny',%s,%s,%s,%s,%s,%s)
           RETURNING id""",
```
i do krotki parametrów, przed `now_iso()`: `int(pallets_h1 or 0), int(pallets_other or 0),`.

W `create_manual_wz` dodaj do sygnatury `pallets_h1: int = 0, pallets_other: int = 0`, przekaż je do `_insert_wz(..., pallets_h1=pallets_h1, pallets_other=pallets_other)`, a **na końcu bloku `with transaction() as conn:`** (po pętli po `selections`) dodaj:

```python
        # ── Saldo pojemników: nośniki jadą OD NAS (znak ujemny) ──
        _rebook_wz_containers(conn, wid)
```

- [ ] **Step 5: Podepnij edycję i anulowanie**

W `update_wz_lines`, po zapisaniu zmienionych `lines` do bazy (`UPDATE wz_documents SET lines=...`), a przed końcem transakcji:

```python
        _rebook_wz_containers(conn, wz_id)
```

W `cancel_wz`, po `UPDATE wz_documents SET status='anulowany'`:

```python
        _rebook_wz_containers(conn, wz_id, zero=True)
```

- [ ] **Step 6: Kaliber i palety w `stock_raw()`**

W zapytaniu o `raw_batches` (linia ~1002) dodaj do SELECT-a `container_kg, containers_count, kg_received`. Zastąp linię
`"containers": int(-(-kg // 15)) if kg > 0 else None,  # 15 kg/poj.`
wyliczeniem z kalibru partii:

```python
        # Pojemniki z KALIBRU partii (15/20 kg). Partia niekalibrowana nie ma
        # wzoru — skalujemy policzoną sumę proporcjonalnie do wydawanej masy.
        ck = r.get("container_kg")
        cont = containers_for_kg(kg, float(ck) if ck is not None else None)
        if cont is None:
            cont = prorate_containers(r.get("containers_count"), kg,
                                      float(r.get("kg_received") or 0))
```
i w budowanym słowniku użyj `"containers": cont,`.

W pętli po lotach ubocznych dodaj liczbę palet ważenia (kreator HMI zapisuje jedną pozycję na paletę):

```python
        pallets_list = b.get("backs_pallets") if b["kind"] == "backs" else b.get("bones_pallets")
```
i do słownika wyniku: `"pallets": len(pallets_list or []) or None,`.

Uwaga: zmienna `pallets` jest już używana kilka linii niżej w fallbacku `pallet_containers(pallets)` — nie nadpisuj jej, użyj nowej nazwy `pallets_list` i przekaż ją też do istniejącego fallbacku.

- [ ] **Step 7: Run test to verify it passes**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_wz_containers_db.py tests/test_wz_manual_lines.py -q
```
Expected: PASS — 8 nowych + istniejące WZ bez regresji

- [ ] **Step 8: Cały pakiet**

Run:
```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest -q
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/services/wz_service.py backend/tests/test_wz_containers_db.py
git commit -m "feat(pojemniki): WZ towaru zdejmuje nośniki z salda, kaliber partii w stock_raw"
```

---

### Task 8: API — modele, routes, rejestracja

**Files:**
- Create: `backend/app/models/containers.py`
- Create: `backend/app/routes/containers.py`
- Modify: `backend/app/main.py:133` (blok importów) i `:183` (pętla `include_router`)
- Test: `backend/tests/test_containers_routes.py`

**Interfaces:**
- Consumes: wszystkie serwisy z Tasks 3–5
- Produces: prefiks `/api/containers` (RBAC: domyślne `"office"` z `permission_for_path` — bez zmian w `permissions.py`)

| Metoda | Ścieżka |
|---|---|
| GET | `/api/containers/calibers` |
| GET | `/api/containers/balances?q=&nonzero=` |
| GET | `/api/containers/partners/{partner_id}` |
| GET | `/api/containers/movements?partnerId=&from=&to=&unconfirmed=` |
| GET | `/api/containers/pending?partnerId=` |
| POST | `/api/containers/movements` |
| PATCH | `/api/containers/groups` |
| GET | `/api/containers/docs?partnerId=` |
| POST | `/api/containers/docs` |
| GET | `/api/containers/docs/{doc_id}` |
| PATCH | `/api/containers/docs/{doc_id}/cancel` |
| GET | `/api/containers/statement?partnerId=&from=&to=` |

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_containers_routes.py`:

```python
"""Kontrakt routes pojemników — czysta warstwa API (bez DB, monkeypatch serwisów).

Auth middleware blokuje surowy TestClient, więc testujemy funkcje routera
bezpośrednio — tak jak pozostałe testy API w tym projekcie.
"""
from app.models.containers import ContainerDocCreate, ContainerGroupCorrect, ContainerMovementCreate
from app.routes import containers as route


def test_calibers_zwraca_15_20_i_niekalibrowany():
    out = route.list_calibers()
    assert [c["value"] for c in out] == ["15", "20", "none"]
    assert out[2]["kg"] is None
    assert out[0]["label"] == "15 kg"


def test_asset_types_w_odpowiedzi_kalibrow():
    out = route.list_calibers()
    assert all("label" in c and "kg" in c for c in out)


def test_doc_create_mapuje_camel_case():
    dto = ContainerDocCreate.model_validate({
        "partnerId": "p1", "docDate": "2026-07-29", "driver": "Jan", "vehicle": "KR 1",
        "lines": [{"assetType": "e2", "inQty": 400, "outQty": 0}], "notes": "uwaga",
    })
    assert dto.partner_id == "p1"
    assert dto.lines[0].asset_type == "e2"
    assert dto.lines[0].in_qty == 400


def test_group_correct_mapuje_camel_case():
    dto = ContainerGroupCorrect.model_validate({
        "partnerId": "p1", "sourceType": "wz", "sourceId": "wz1",
        "targets": {"e2": -58}, "confirm": True,
    })
    assert dto.source_type == "wz" and dto.confirm is True


def test_movement_create_przyjmuje_ujemna_ilosc():
    dto = ContainerMovementCreate.model_validate({
        "partnerId": "p1", "assetType": "e2", "qty": -25, "movementDate": "2026-07-29",
    })
    assert dto.qty == -25


def test_balances_przekazuje_filtry_do_serwisu(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.ledger, "balances",
                        lambda q="", nonzero=False: seen.update(q=q, nonzero=nonzero) or [])
    route.list_balances(q="koko", nonzero=True)
    assert seen == {"q": "koko", "nonzero": True}


def test_statement_przekazuje_zakres_dat(monkeypatch):
    seen = {}
    monkeypatch.setattr(route.ledger, "statement",
                        lambda pid, f, t: seen.update(pid=pid, f=f, t=t) or {})
    route.get_statement(partner_id="p1", date_from="2026-07-01", date_to="2026-07-31")
    assert seen == {"pid": "p1", "f": "2026-07-01", "t": "2026-07-31"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python3 -m pytest tests/test_containers_routes.py -q`
Expected: FAIL — `No module named 'app.models.containers'`

- [ ] **Step 3: Write `backend/app/models/containers.py`**

```python
"""DTO salda pojemników. Front wysyła camelCase, backend trzyma snake_case."""
from typing import Dict, List

from pydantic import BaseModel, ConfigDict, Field


class ContainerDocLine(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    asset_type: str = Field(..., alias="assetType")
    in_qty: int = Field(0, alias="inQty", ge=0)
    out_qty: int = Field(0, alias="outQty", ge=0)


class ContainerDocCreate(BaseModel):
    """Wystawienie „WZ na POJEMNIKI". Partner wskazany wprost (partnerId)
    albo przez kartotekę (refType + refId)."""

    model_config = ConfigDict(populate_by_name=True)

    partner_id: str = Field("", alias="partnerId")
    ref_type: str = Field("", alias="refType")   # 'supplier' | 'client'
    ref_id: str = Field("", alias="refId")
    doc_date: str = Field("", alias="docDate")
    driver: str = ""
    vehicle: str = ""
    lines: List[ContainerDocLine] = Field(default_factory=list)
    notes: str = ""


class ContainerGroupCorrect(BaseModel):
    """Korekta i potwierdzenie grupy ruchów jednego źródła (biuro)."""

    model_config = ConfigDict(populate_by_name=True)

    partner_id: str = Field(..., alias="partnerId", min_length=1)
    source_type: str = Field(..., alias="sourceType", min_length=1)
    source_id: str = Field("", alias="sourceId")
    targets: Dict[str, int] = Field(default_factory=dict)
    confirm: bool = False


class ContainerMovementCreate(BaseModel):
    """Ruch ręczny. qty ZE ZNAKIEM: dodatnie = przyjechało do nas."""

    model_config = ConfigDict(populate_by_name=True)

    partner_id: str = Field(..., alias="partnerId", min_length=1)
    asset_type: str = Field(..., alias="assetType", min_length=1)
    qty: int
    movement_date: str = Field("", alias="movementDate")
    note: str = ""
```

- [ ] **Step 4: Write `backend/app/routes/containers.py`**

```python
"""Saldo pojemników — API biura (RBAC: domyślne 'office')."""
from fastapi import APIRouter, Query

from app.models.containers import (
    ContainerDocCreate,
    ContainerGroupCorrect,
    ContainerMovementCreate,
)
from app.services import container_docs_service as docs
from app.services import container_ledger_service as ledger
from app.services import container_partners_service as partners
from app.utils.containers import CALIBERS

router = APIRouter(prefix="/api/containers", tags=["containers"])


@router.get("/calibers")
def list_calibers():
    """Słownik kalibrów dla formularzy. 'none' = niekalibrowany (operator
    wpisuje liczbę pojemników ręcznie)."""
    return [
        {"value": "none" if kg is None else str(int(kg)),
         "label": "niekalibrowany" if kg is None else f"{int(kg)} kg",
         "kg": kg}
        for kg in CALIBERS
    ]


@router.get("/balances")
def list_balances(q: str = Query(""), nonzero: bool = Query(False)):
    return ledger.balances(q=q, nonzero=nonzero)


@router.get("/pending")
def list_pending(partner_id: str = Query("", alias="partnerId")):
    return ledger.pending_groups(partner_id)


@router.get("/movements")
def list_movements(
    partner_id: str = Query("", alias="partnerId"),
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
    unconfirmed: bool = Query(False),
):
    return ledger.movements(partner_id=partner_id, date_from=date_from,
                            date_to=date_to, unconfirmed_only=unconfirmed)


@router.post("/movements")
def create_movement(dto: ContainerMovementCreate):
    return ledger.create_manual_movement(
        dto.partner_id, dto.asset_type, dto.qty, dto.movement_date, dto.note)


@router.patch("/groups")
def correct_group(dto: ContainerGroupCorrect):
    return ledger.correct_group(dto.partner_id, dto.source_type, dto.source_id,
                                dto.targets, dto.confirm)


@router.get("/statement")
def get_statement(
    partner_id: str = Query("", alias="partnerId"),
    date_from: str = Query("", alias="from"),
    date_to: str = Query("", alias="to"),
):
    return ledger.statement(partner_id, date_from, date_to)


# IMPORTANT: /docs przed /partners/{id}? — nie kolidują, ale trzymamy
# stały porządek: statyczne ścieżki nad parametrycznymi.
@router.get("/docs")
def list_docs(partner_id: str = Query("", alias="partnerId")):
    return docs.list_docs(partner_id)


@router.post("/docs")
def create_doc(dto: ContainerDocCreate):
    return docs.create_doc(
        partner_id=dto.partner_id, ref_type=dto.ref_type, ref_id=dto.ref_id,
        doc_date=dto.doc_date, driver=dto.driver, vehicle=dto.vehicle,
        lines=[l.model_dump(by_alias=True) for l in dto.lines], notes=dto.notes)


@router.get("/docs/{doc_id}")
def get_doc(doc_id: str):
    return docs.get_doc(doc_id)


@router.patch("/docs/{doc_id}/cancel")
def cancel_doc(doc_id: str):
    return docs.cancel_doc(doc_id)


@router.get("/partners/{partner_id}")
def get_partner(partner_id: str):
    """Kartoteka: dane partnera, saldo, ruchy, dokumenty, do rozliczenia."""
    partner = partners.get_partner(partner_id)
    bal = next((b for b in ledger.balances() if b["id"] == partner_id), None)
    return {
        "partner": partner,
        "balance": {a: (bal or {}).get(a, 0) for a in ("e2", "pallet_h1", "pallet_other")},
        "movements": ledger.movements(partner_id=partner_id),
        "pending": ledger.pending_groups(partner_id),
        "docs": docs.list_docs(partner_id),
    }
```

- [ ] **Step 5: Zarejestruj router w `backend/app/main.py`**

W bloku importów (linia ~133, po `byproducts,`) dodaj `containers,`. W pętli `for mod in (...)` (linia ~183, po `byproducts,`) dodaj `containers,`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && python3 -m pytest tests/test_containers_routes.py -q`
Expected: PASS — 7 passed

- [ ] **Step 7: Sprawdź, że aplikacja się podnosi**

Run: `cd backend && python3 -c "from app.main import create_app; app = create_app(); print([r.path for r in app.routes if '/containers' in r.path])"`
Expected: wypisane 12 ścieżek `/api/containers/...`

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/models/containers.py backend/app/routes/containers.py \
        backend/app/main.py backend/tests/test_containers_routes.py
git commit -m "feat(pojemniki): API biura — salda, ruchy, dokumenty, wyciąg"
```

---

### Task 9: Frontend — wspólna logika kalibrów + klient API

**Files:**
- Create: `src/lib/containers.ts`
- Create: `src/lib/containers.test.ts`
- Modify: `src/lib/api.ts` (dopisz `containersApi` na końcu pliku, obok `wzApi`)

**Interfaces:**
- Consumes: endpointy z Task 8
- Produces:
  - `CALIBER_OPTIONS: { value: CaliberValue; label: string; kg: number | null }[]`
  - `type CaliberValue = '15' | '20' | 'none'`
  - `containersForKg(kg: number, containerKg: number | null): number | null`
  - `caliberKg(value: CaliberValue): number | null`
  - `ASSET_LABELS: Record<AssetType, string>`, `type AssetType = 'e2' | 'pallet_h1' | 'pallet_other'`
  - `containersApi` — patrz Step 4

- [ ] **Step 1: Write the failing test**

Create `src/lib/containers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ASSET_LABELS, CALIBER_OPTIONS, caliberKg, containersForKg } from './containers'

describe('containersForKg', () => {
  it('dzieli bez reszty', () => {
    expect(containersForKg(300, 15)).toBe(20)
  })

  it('zaokrągla W GÓRĘ — niepełny pojemnik to nadal jeden pojemnik', () => {
    // Regresja: modal przyjęcia liczył floor i gubił jeden pojemnik na
    // każdej niepełnej dostawie.
    expect(containersForKg(305, 15)).toBe(21)
    expect(containersForKg(6005, 15)).toBe(401)
  })

  it('obsługuje kaliber 20 kg', () => {
    expect(containersForKg(300, 20)).toBe(15)
    expect(containersForKg(310, 20)).toBe(16)
  })

  it('niekalibrowany nie da się wyliczyć', () => {
    expect(containersForKg(1000, null)).toBeNull()
  })

  it('zero i wartości ujemne to zero pojemników', () => {
    expect(containersForKg(0, 15)).toBe(0)
    expect(containersForKg(-5, 15)).toBe(0)
  })
})

describe('caliberKg', () => {
  it('mapuje wartość selecta na kilogramy', () => {
    expect(caliberKg('15')).toBe(15)
    expect(caliberKg('20')).toBe(20)
    expect(caliberKg('none')).toBeNull()
  })
})

describe('słowniki', () => {
  it('ma trzy kalibry w stałej kolejności', () => {
    expect(CALIBER_OPTIONS.map(o => o.value)).toEqual(['15', '20', 'none'])
  })

  it('etykiety nośników zgodne z drukiem', () => {
    expect(ASSET_LABELS.e2).toBe('Ilość pojemników EURO2')
    expect(ASSET_LABELS.pallet_h1).toBe('Ilość palet H1')
    expect(ASSET_LABELS.pallet_other).toBe('Ilość palet innych')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/containers.test.ts`
Expected: FAIL — `Failed to resolve import "./containers"`

- [ ] **Step 3: Create `src/lib/containers.ts`**

```ts
/**
 * containers.ts — nośniki zwrotne (pojemniki E2, palety) po stronie UI.
 *
 * Lustro `backend/app/utils/containers.py`. Formularze przyjęcia i WZ muszą
 * podpowiadać DOKŁADNIE tę samą liczbę, którą zaksięguje backend — inaczej
 * operator widzi jedno, a saldo pokazuje drugie.
 */

export type AssetType = 'e2' | 'pallet_h1' | 'pallet_other'
export type CaliberValue = '15' | '20' | 'none'

export const ASSET_TYPES: AssetType[] = ['e2', 'pallet_h1', 'pallet_other']

export const ASSET_LABELS: Record<AssetType, string> = {
  e2: 'Ilość pojemników EURO2',
  pallet_h1: 'Ilość palet H1',
  pallet_other: 'Ilość palet innych',
}

/** Krótkie etykiety do tabel i kafelków (pełne idą na wydruk). */
export const ASSET_SHORT: Record<AssetType, string> = {
  e2: 'Pojemniki E2',
  pallet_h1: 'Palety H1',
  pallet_other: 'Palety inne',
}

export const CALIBER_OPTIONS: { value: CaliberValue; label: string; kg: number | null }[] = [
  { value: '15', label: '15 kg', kg: 15 },
  { value: '20', label: '20 kg', kg: 20 },
  { value: 'none', label: 'niekalibrowany', kg: null },
]

export function caliberKg(value: CaliberValue): number | null {
  return CALIBER_OPTIONS.find(o => o.value === value)?.kg ?? null
}

/**
 * Liczba pojemników dla masy.
 *
 * ceil, NIE floor — niepełny pojemnik to nadal jeden fizyczny pojemnik.
 * Zwraca null przy kalibrze nieznanym (niekalibrowany): wtedy liczbę
 * pojemników wpisuje operator.
 */
export function containersForKg(kg: number, containerKg: number | null): number | null {
  if (containerKg === null || containerKg <= 0) return null
  if (kg <= 0) return 0
  return Math.ceil(kg / containerKg)
}

/** Saldo dodatnie = mamy ich nośniki (my winni); ujemne = oni mają nasze. */
export function balanceTone(saldo: number): 'owed-by-us' | 'settled' | 'owed-to-us' {
  if (saldo > 0) return 'owed-by-us'
  if (saldo < 0) return 'owed-to-us'
  return 'settled'
}
```

- [ ] **Step 4: Dopisz `containersApi` na końcu `src/lib/api.ts`**

```ts
// ── Saldo pojemników ────────────────────────────────────────────────
export type ContainerAsset = 'e2' | 'pallet_h1' | 'pallet_other'

export interface ContainerBalanceRow {
  id: string; nip: string; name: string; address: string
  e2: number; pallet_h1: number; pallet_other: number
  unconfirmed: number; last_movement: string | null; roles: string[]
}

export interface ContainerMovement {
  id: string; partnerId: string; assetType: ContainerAsset; qty: number
  sourceType: string; sourceId: string | null; sourceLabel: string
  docId: string | null; docNumber: string | null
  movementDate: string; confirmed: boolean; note: string
}

export interface ContainerPendingGroup {
  partnerId: string; sourceType: string; sourceId: string; sourceLabel: string
  date: string; note: string
  assets: Record<ContainerAsset, number>
}

export interface ContainerDocLine {
  assetType: ContainerAsset; label: string; inQty: number; outQty: number; balance: number
}

export interface ContainerDoc {
  id: string; number: string; status: string
  partner: { id: string; name: string; nip: string; address: string }
  partnerId: string
  seller: { name: string; address: string; postal_code: string; city: string; nip: string; phone: string }
  docDate: string; driver: string; vehicle: string; notes: string
  balanceAfter: Record<ContainerAsset, number>
  lines: ContainerDocLine[]
}

export interface ContainerStatement {
  partner: { id: string; name: string; nip: string; address: string }
  from: string; to: string
  opening: Record<ContainerAsset, number>
  closing: Record<ContainerAsset, number>
  movements: (ContainerMovement & { balanceAfter: Record<ContainerAsset, number> })[]
}

export const containersApi = {
  calibers: () => get<{ value: string; label: string; kg: number | null }[]>('/containers/calibers'),
  balances: (opts?: { q?: string; nonzero?: boolean }) =>
    get<ContainerBalanceRow[]>(
      `/containers/balances?q=${encodeURIComponent(opts?.q ?? '')}&nonzero=${opts?.nonzero ? 'true' : 'false'}`),
  partner: (id: string) =>
    get<{
      partner: { id: string; name: string; nip: string; address: string; roles: string[] }
      balance: Record<ContainerAsset, number>
      movements: ContainerMovement[]
      pending: ContainerPendingGroup[]
      docs: ContainerDoc[]
    }>(`/containers/partners/${encodeURIComponent(id)}`),
  movements: (opts?: { partnerId?: string; from?: string; to?: string; unconfirmed?: boolean }) =>
    get<ContainerMovement[]>(
      `/containers/movements?partnerId=${encodeURIComponent(opts?.partnerId ?? '')}` +
      `&from=${opts?.from ?? ''}&to=${opts?.to ?? ''}&unconfirmed=${opts?.unconfirmed ? 'true' : 'false'}`),
  createMovement: (body: {
    partnerId: string; assetType: ContainerAsset; qty: number; movementDate?: string; note?: string
  }) => post<{ id: string; balance: Record<ContainerAsset, number> }>('/containers/movements', body),
  // Korekta z biura: NIE nadpisuje ruchu — backend dopisuje różnicę.
  correctGroup: (body: {
    partnerId: string; sourceType: string; sourceId: string
    targets: Partial<Record<ContainerAsset, number>>; confirm: boolean
  }) => patch<{ balance: Record<ContainerAsset, number> }>('/containers/groups', body),
  docs: (partnerId?: string) =>
    get<ContainerDoc[]>(`/containers/docs?partnerId=${encodeURIComponent(partnerId ?? '')}`),
  doc: (id: string) => get<ContainerDoc>(`/containers/docs/${encodeURIComponent(id)}`),
  createDoc: (body: {
    partnerId?: string; refType?: string; refId?: string
    docDate: string; driver?: string; vehicle?: string; notes?: string
    lines: { assetType: ContainerAsset; inQty: number; outQty: number }[]
  }) => post<ContainerDoc>('/containers/docs', body),
  cancelDoc: (id: string) =>
    patch<ContainerDoc>(`/containers/docs/${encodeURIComponent(id)}/cancel`, {}),
  statement: (partnerId: string, from: string, to: string) =>
    get<ContainerStatement>(
      `/containers/statement?partnerId=${encodeURIComponent(partnerId)}&from=${from}&to=${to}`),
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/containers.test.ts && npx tsc --noEmit`
Expected: PASS — 8 passed, brak błędów typów

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/lib/containers.ts src/lib/containers.test.ts src/lib/api.ts
git commit -m "feat(pojemniki): frontendowa logika kalibrów (ceil) i klient API"
```

---

### Task 10: Kaliber i palety w formularzu przyjęcia

**Files:**
- Modify: `src/features/raw-batches/types.ts:74` (`CreateRawBatchDto`)
- Modify: `src/features/raw-batches/hooks/useRawBatches.ts:161` (`emptyForm`)
- Modify: `src/features/raw-batches/components/CreateRawBatchModal.tsx` — usuń `KG_PER_CONTAINER` (linia 25) i przelicz kafelek (linie 79-80)

**Interfaces:**
- Consumes: `containersForKg`, `CALIBER_OPTIONS`, `caliberKg`, `CaliberValue` (Task 9); backend przyjmuje `containerKg` / `containersCount` / `palletsH1` / `palletsOther` (Task 6)
- Produces: `CreateRawBatchDto` z czterema nowymi polami

- [ ] **Step 1: Rozszerz `CreateRawBatchDto` w `src/features/raw-batches/types.ts`**

Do interfejsu `CreateRawBatchDto`, po `invoiceNo?`, dodaj:

```ts
  // Nośniki zwrotne — kaliber pojemnika i palety (saldo pojemników dostawcy)
  containerKg?:     number | null   // null = niekalibrowany
  containersCount?: number | null   // ręczna liczba; wygrywa z wyliczeniem
  palletsH1?:       number
  palletsOther?:    number
```

- [ ] **Step 2: Ustaw wartości domyślne w `emptyForm()` (`useRawBatches.ts:161`)**

```ts
function emptyForm(): CreateRawBatchDto {
  return {
    supplierId: '', supplierBatchNo: '', slaughterDate: '',
    receivedDate: todayIso(), expiryDate: '', kgReceived: 0, pricePerKg: 0, invoiceNo: '',
    // Domyślny kaliber zakładu to pojemnik 15 kg — 20 kg zdarza się przy filecie.
    containerKg: 15, containersCount: null, palletsH1: 0, palletsOther: 0,
  }
}
```

- [ ] **Step 3: Przepnij modal na wspólną logikę i dodaj pola**

W `CreateRawBatchModal.tsx`:

1. Usuń `const KG_PER_CONTAINER = 15` (linia 25).
2. Dodaj import: `import { CALIBER_OPTIONS, caliberKg, containersForKg, type CaliberValue } from '@/lib/containers'`.
3. Zastąp wyliczenia z linii 79-80:

```tsx
  const caliber: CaliberValue =
    form.containerKg === 15 ? '15' : form.containerKg === 20 ? '20' : 'none'
  const autoContainers = useMemo(
    () => containersForKg(totalKg, form.containerKg ?? null),
    [totalKg, form.containerKg])
  // Ręcznie wpisana liczba ma pierwszeństwo: operator, który fizycznie
  // policzył pojemniki, wie lepiej niż wzór z kalibru.
  const containers = form.containersCount ?? autoContainers
```

4. Usuń `remainderKg` i blok „+X reszty" (linie 264-268) — przy `ceil` reszta jest już wliczona w ostatni pojemnik i komunikat wprowadzałby w błąd.
5. Zastąp kartę „pojemników" (linie 260-270) kartą z selektorem kalibru i edytowalną liczbą:

```tsx
            <Card>
              <CardContent className="p-3 space-y-2">
                <Label className="text-[10px] font-bold uppercase tracking-wide">Kaliber pojemnika</Label>
                <Select
                  value={caliber}
                  onValueChange={(v: CaliberValue) => {
                    onFieldChange('containerKg', caliberKg(v))
                    // Zmiana kalibru unieważnia ręczną liczbę — poza trybem
                    // niekalibrowanym, gdzie tylko ona ma sens.
                    onFieldChange('containersCount', null)
                  }}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CALIBER_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number" min="0" step="1"
                  placeholder={autoContainers !== null ? String(autoContainers) : 'wpisz liczbę'}
                  value={form.containersCount ?? (autoContainers ?? '')}
                  onChange={e => onFieldChange(
                    'containersCount', e.target.value === '' ? null : parseInt(e.target.value) || 0)}
                  className="h-9 text-center text-lg font-black tabular-nums" />
                <CardDescription className="text-[10px] uppercase font-bold text-center">
                  pojemników
                </CardDescription>
              </CardContent>
            </Card>
```

6. W sekcji „Dodatkowe dane" (linie 296-314) dodaj trzecią i czwartą kolumnę — zmień `grid-cols-2` na `grid-cols-4` i dopisz:

```tsx
            <div className="space-y-1.5">
              <Label>Palety H1</Label>
              <Input type="number" min="0" step="1" value={form.palletsH1 ?? 0}
                onChange={e => onFieldChange('palletsH1', parseInt(e.target.value) || 0)} />
            </div>
            <div className="space-y-1.5">
              <Label>Palety inne</Label>
              <Input type="number" min="0" step="1" value={form.palletsOther ?? 0}
                onChange={e => onFieldChange('palletsOther', parseInt(e.target.value) || 0)} />
            </div>
```

- [ ] **Step 4: Weryfikacja typów i buildu**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: PASS — brak błędów typów, testy zielone, build przechodzi

- [ ] **Step 5: Ręczny smoke-test**

Uruchom `npm run dev`, otwórz Przyjęcie surowca → „Dodaj partię". Sprawdź:
- 6000 kg przy kalibrze 15 kg → **400** pojemników
- 6005 kg przy kalibrze 15 kg → **401** (nie 400 — to jest ta poprawka)
- kaliber 20 kg → 300
- „niekalibrowany" → pole puste, wpisujesz liczbę ręcznie
- zapis partii → na `/office/saldo-pojemnikow` (po Task 12) pojawia się saldo dostawcy

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/raw-batches/types.ts \
        src/features/raw-batches/hooks/useRawBatches.ts \
        src/features/raw-batches/components/CreateRawBatchModal.tsx
git commit -m "feat(pojemniki): wybór kalibru i palet na przyjęciu surowca"
```

---

### Task 11: Kaliber i palety na formularzu WZ

**Files:**
- Modify: `src/pages/office/WzNewPage.tsx` — typ wiersza (`:25`), mapowanie stanu (`:182`), `upd` (`:200`), `draftDoc` (`:234`), `submit` (`:266`), pole pojemników (`:587`)
- Modify: `src/lib/api.ts` — `wzApi.createManual` (dopisz `palletsH1` / `palletsOther`)

**Interfaces:**
- Consumes: `containersForKg`, `CALIBER_OPTIONS`, `caliberKg` (Task 9); `create_manual_wz(..., pallets_h1, pallets_other)` (Task 7)
- Produces: WZ wysyła palety na poziomie dokumentu i pojemniki per pozycja

- [ ] **Step 1: Rozszerz `wzApi.createManual` w `src/lib/api.ts`**

W obiekcie `body` funkcji `createManual` dodaj do typu:

```ts
    palletsH1?: number; palletsOther?: number;
```

- [ ] **Step 2: Dodaj kaliber do wiersza w `WzNewPage.tsx`**

Do interfejsu wiersza (linia ~25), obok `containersStr`, dodaj:

```ts
  caliberStr?: string   // '15' | '20' | 'none' — steruje podpowiedzią pojemników
```

W mapowaniu pozycji magazynowej na wiersz (linia ~182) dodaj `caliberStr: '15',`.

Rozszerz sygnaturę `upd` (linia ~200) o nowy klucz:

```ts
  const upd = (i: number, k: 'qtyStr' | 'priceStr' | 'containersStr' | 'caliberStr', v: string) =>
    setRows(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x))
```

- [ ] **Step 3: Przelicz pojemniki przy zmianie ilości lub kalibru**

Dodaj import: `import { CALIBER_OPTIONS, caliberKg, containersForKg, type CaliberValue } from '@/lib/containers'`.

Dodaj funkcję nad `draftDoc`:

```tsx
  // Zmiana kg lub kalibru przelicza podpowiedź pojemników. Operator może ją
  // nadpisać ręcznie — wpisana wartość zostaje do następnej zmiany kalibru.
  const setCaliber = (i: number, v: CaliberValue) =>
    setRows(rs => rs.map((r, j) => {
      if (j !== i) return r
      const auto = containersForKg(rowQty(r), caliberKg(v))
      return { ...r, caliberStr: v, containersStr: auto === null ? '' : String(auto) }
    }))
```

- [ ] **Step 4: Dodaj selektor kalibru obok pola pojemników (linia ~587)**

Tuż przed istniejącym `<Input value={r.containersStr ...}>` wstaw:

```tsx
                                  <select
                                    value={r.caliberStr ?? '15'}
                                    onChange={e => setCaliber(i, e.target.value as CaliberValue)}
                                    className="h-8 rounded border border-surface-4 bg-surface px-1 text-[11px]"
                                    title="Kaliber pojemnika — przelicza liczbę pojemników z kg">
                                    {CALIBER_OPTIONS.map(o => (
                                      <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                  </select>
```

- [ ] **Step 5: Dodaj palety na poziomie dokumentu**

Obok stanu `notes` dodaj:

```tsx
  const [palletsH1, setPalletsH1] = useState(0)
  const [palletsOther, setPalletsOther] = useState(0)
```

W sekcji nagłówka dokumentu (tam, gdzie `place` / `issuedDate`) dodaj dwa pola liczbowe z etykietami „Palety H1" i „Palety inne". Palety są **na dokumencie**, nie na pozycji — transport wiezie N palet łącznie, a nie N palet na każdą partię.

W `submit` (linia ~266) dopisz do payloadu `wzApi.createManual`:

```tsx
        palletsH1,
        palletsOther,
```

- [ ] **Step 6: Podpowiedz palety z ważeń ubocznych**

`stock_raw()` zwraca teraz przy grzbietach i kościach pole `pallets` (liczba palet ważenia z kreatora HMI — Task 7, Step 6). Podpowiedz z niego palety dokumentu, żeby operator nie liczył ich drugi raz. Podpowiedź działa tylko dopóki operator sam nie ruszył pola — wtedy jego wartość jest nadrzędna.

Obok stanu palet dodaj:

```tsx
  const [palletsTouched, setPalletsTouched] = useState(false)

  // Kości i grzbiety jadą na paletach policzonych już na wadze. Podpowiadamy
  // ich sumę, ale operator może ją poprawić — kreator HMI czasem rozjeżdża
  // się z tym, co fizycznie zabrał kierowca.
  const byproductPallets = useMemo(
    () => rows.reduce((s, r) => s + (r.stockType === 'byproduct'
      ? Number(raw.find(b => b.id === r.stockId)?.pallets ?? 0) : 0), 0),
    [rows, raw])

  useEffect(() => {
    if (!palletsTouched) setPalletsH1(byproductPallets)
  }, [byproductPallets, palletsTouched])
```

W polach „Palety H1" / „Palety inne" ustaw `onChange` tak, żeby zapisywał wartość **i** `setPalletsTouched(true)`.

- [ ] **Step 7: Weryfikacja**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 8: Ręczny smoke-test**

`npm run dev` → Dokumenty WZ → Nowy WZ. Dodaj pozycję ćwiartki 300 kg:
- kaliber 15 kg → 20 pojemników; przełącz na 20 kg → 15 pojemników
- wpisz ręcznie 18 → zostaje 18 aż do zmiany kalibru
- wystaw WZ → saldo odbiorcy na `/office/saldo-pojemnikow` schodzi na minus

- [ ] **Step 9: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/WzNewPage.tsx src/lib/api.ts
git commit -m "feat(pojemniki): kaliber per pozycja i palety dokumentu na WZ"
```

---

### Task 12: Strona „Saldo pojemników" — lista partnerów

**Files:**
- Create: `src/pages/office/ContainerBalancePage.tsx`
- Modify: `src/App.tsx` — trasa w bloku `/office` (obok `wz/nowy`, linia ~142)
- Modify: `src/layouts/OfficeSidebar.tsx` — pozycja w sekcji „Kontrahenci" (po „Dokumenty WZ", linia ~22) + import ikony `Boxes`

**Interfaces:**
- Consumes: `containersApi.balances` (Task 9), `ASSET_SHORT`, `balanceTone` (Task 9)
- Produces: trasa `/office/saldo-pojemnikow`; klik w wiersz nawiguje do `/office/saldo-pojemnikow/:partnerId` (strona z Task 13)

**Tokeny:** `surface` (biel), `surface-2/3/4`, `ink`, `ink-2..5`, `brand`. **Nie ma tokenu `surface-1`.** Kolor wyłącznie semantyczny: amber = my winni, emerald = rozliczone, red = oni winni.

- [ ] **Step 1: Create `src/pages/office/ContainerBalancePage.tsx`**

```tsx
/**
 * ContainerBalancePage — saldo nośników zwrotnych per kontrahent.
 *
 * Saldo dodatnie = mamy u siebie JEGO pojemniki (my jesteśmy winni).
 * Saldo ujemne  = on ma NASZE pojemniki (on jest winien). Zero = rozliczone.
 * Jeden znakowany licznik obsługuje oba kierunki — patrz
 * container_ledger_service (konwencja znaku).
 *
 * Dostawca i odbiorca o tym samym NIP-ie to JEDEN wiersz (scalanie po NIP
 * w container_partners), więc firma kupująca i sprzedająca ma jedno saldo.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, Search, AlertTriangle } from 'lucide-react'
import { containersApi, type ContainerBalanceRow } from '@/lib/api'
import { ASSET_SHORT, balanceTone } from '@/lib/containers'

type SortKey = 'name' | 'e2' | 'pallet_h1' | 'pallet_other' | 'last_movement'

const TONE_CLS: Record<ReturnType<typeof balanceTone>, string> = {
  'owed-by-us': 'text-amber-600',
  'settled': 'text-emerald-600',
  'owed-to-us': 'text-red-600',
}

function Saldo({ value }: { value: number }) {
  return (
    <span className={`tabular-nums font-bold ${TONE_CLS[balanceTone(value)]}`}>
      {value > 0 ? `+${value}` : value}
    </span>
  )
}

const ROLE_LABEL: Record<string, string> = { supplier: 'dostawca', client: 'odbiorca' }

export default function ContainerBalancePage() {
  const nav = useNavigate()
  const [rows, setRows] = useState<ContainerBalanceRow[]>([])
  const [q, setQ] = useState('')
  const [nonzero, setNonzero] = useState(true)
  const [sort, setSort] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    setLoading(true)
    containersApi.balances({ nonzero })
      .then(setRows)
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [nonzero])

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? rows.filter(r => `${r.name} ${r.nip}`.toLowerCase().includes(needle))
      : rows
    const dir = asc ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sort === 'name') return dir * a.name.localeCompare(b.name, 'pl')
      if (sort === 'last_movement') return dir * String(a.last_movement || '').localeCompare(String(b.last_movement || ''))
      return dir * (a[sort] - b[sort])
    })
  }, [rows, q, sort, asc])

  const th = (key: SortKey, label: string, right = false) => (
    <th
      onClick={() => { setSort(key); setAsc(sort === key ? !asc : true) }}
      className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-3
                  cursor-pointer select-none hover:text-ink ${right ? 'text-right' : 'text-left'}`}>
      {label}{sort === key ? (asc ? ' ↑' : ' ↓') : ''}
    </th>
  )

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-center gap-3">
        <Boxes size={20} className="text-ink-3" />
        <h1 className="text-lg font-bold text-ink">Saldo pojemników</h1>
        <span className="text-[12px] text-ink-4">
          dodatnie = mamy ich nośniki · ujemne = oni mają nasze
        </span>
      </header>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Szukaj po nazwie lub NIP…"
            className="w-full h-9 pl-8 pr-3 rounded border border-surface-4 bg-surface text-[13px]" />
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={nonzero} onChange={e => setNonzero(e.target.checked)} />
          tylko niezerowe
        </label>
      </div>

      {err && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{err}</div>}

      <div className="rounded border border-surface-4 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-3 border-b border-surface-4">
            <tr>
              {th('name', 'Kontrahent')}
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-3">NIP</th>
              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-ink-3">Rola</th>
              {th('e2', ASSET_SHORT.e2, true)}
              {th('pallet_h1', ASSET_SHORT.pallet_h1, true)}
              {th('pallet_other', ASSET_SHORT.pallet_other, true)}
              {th('last_movement', 'Ostatni ruch', true)}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {loading && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[13px] text-ink-4">Ładowanie…</td></tr>
            )}
            {!loading && view.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[13px] text-ink-4">
                Brak kontrahentów z saldem nośników.
              </td></tr>
            )}
            {view.map(r => (
              <tr key={r.id}
                  onClick={() => nav(`/office/saldo-pojemnikow/${r.id}`)}
                  className="cursor-pointer hover:bg-surface-2">
                <td className="px-3 py-2 text-[13px] font-medium text-ink">
                  {r.name}
                  {r.unconfirmed > 0 && (
                    <span title={`${r.unconfirmed} ruchów do przejrzenia`}
                          className="ml-2 inline-flex items-center gap-1 text-[11px] text-amber-600">
                      <AlertTriangle size={11} /> {r.unconfirmed}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-[12.5px] text-ink-3 tabular-nums">{r.nip || '—'}</td>
                <td className="px-3 py-2 text-[12px] text-ink-3">
                  {r.roles.map(x => ROLE_LABEL[x] || x).join(' + ') || '—'}
                </td>
                <td className="px-3 py-2 text-right"><Saldo value={r.e2} /></td>
                <td className="px-3 py-2 text-right"><Saldo value={r.pallet_h1} /></td>
                <td className="px-3 py-2 text-right"><Saldo value={r.pallet_other} /></td>
                <td className="px-3 py-2 text-right text-[12.5px] text-ink-3 tabular-nums">
                  {r.last_movement || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Dodaj trasy w `src/App.tsx`**

Do importów: `import ContainerBalancePage from '@/pages/office/ContainerBalancePage'`
oraz (przygotowanie pod Task 13): `import ContainerPartnerPage from '@/pages/office/ContainerPartnerPage'`.

W bloku tras `/office` (obok `wz/nowy`, linia ~142):

```tsx
        <Route path="saldo-pojemnikow"              element={<ContainerBalancePage />} />
        <Route path="saldo-pojemnikow/:partnerId"   element={<ContainerPartnerPage />} />
```

> Jeśli wykonujesz ten task przed Taskiem 13, tymczasowo pomiń drugą trasę i import `ContainerPartnerPage` — dodasz je w Tasku 13.

- [ ] **Step 3: Dodaj pozycję w `src/layouts/OfficeSidebar.tsx`**

Do importu z `lucide-react` dopisz `Boxes`. W sekcji `{ heading: 'Kontrahenci', items: [...] }`, po wpisie „Dokumenty WZ":

```tsx
    { to: '/office/saldo-pojemnikow', label: 'Saldo pojemników', icon: <Boxes size={16} /> },
```

- [ ] **Step 4: Weryfikacja**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/ContainerBalancePage.tsx src/App.tsx src/layouts/OfficeSidebar.tsx
git commit -m "feat(pojemniki): strona salda pojemników z listą kontrahentów"
```

---

### Task 13: Kartoteka kontrahenta + sekcja „Do rozliczenia"

**Files:**
- Create: `src/pages/office/ContainerPartnerPage.tsx`
- Modify: `src/App.tsx` (trasa `saldo-pojemnikow/:partnerId`, jeśli nie dodana w Tasku 12)

**Interfaces:**
- Consumes: `containersApi.partner`, `containersApi.correctGroup`, `containersApi.cancelDoc` (Task 9)
- Produces: strona kartoteki; przycisk „Nowy dokument" otwiera `ContainerDocModal` (Task 14) — do tego czasu zostaw handler `onNewDoc` jako `useState` sterujący flagą i pusty placeholder wstawiony w Tasku 14

- [ ] **Step 1: Create `src/pages/office/ContainerPartnerPage.tsx`**

```tsx
/**
 * ContainerPartnerPage — kartoteka nośników jednego kontrahenta.
 *
 * Trzy warstwy, od najpilniejszej:
 *   1. salda per nośnik,
 *   2. „Do rozliczenia" — ruchy z przyjęć i WZ, których biuro jeszcze nie
 *      przejrzało. System policzył je automatem (kaliber, ważenia HMI),
 *      więc czasem różnią się od tego, co fizycznie zabrał kierowca.
 *      Korekta DOPISUJE różnicę — nie nadpisuje historii.
 *   3. pełna historia ruchów i wystawionych dokumentów.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileText, Check, Printer, Plus } from 'lucide-react'
import {
  containersApi, type ContainerAsset, type ContainerDoc,
  type ContainerMovement, type ContainerPendingGroup,
} from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES, balanceTone } from '@/lib/containers'

const TONE_CLS = {
  'owed-by-us': 'text-amber-600',
  'settled': 'text-emerald-600',
  'owed-to-us': 'text-red-600',
} as const

interface PartnerData {
  partner: { id: string; name: string; nip: string; address: string; roles: string[] }
  balance: Record<ContainerAsset, number>
  movements: ContainerMovement[]
  pending: ContainerPendingGroup[]
  docs: ContainerDoc[]
}

/** Wiersz „Do rozliczenia": edycja liczb + potwierdzenie jednym przyciskiem. */
function PendingRow({ g, onSaved }: { g: ContainerPendingGroup; onSaved: () => void }) {
  // Wartości bezwzględne w polach — znak wynika z kierunku ruchu i nie jest
  // rzeczą operatora. Przy zapisie odtwarzamy go z pierwotnej wartości.
  const [vals, setVals] = useState<Record<ContainerAsset, string>>(() =>
    Object.fromEntries(ASSET_TYPES.map(a => [a, String(Math.abs(g.assets[a] ?? 0))])) as Record<ContainerAsset, string>)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async (confirm: boolean) => {
    setSaving(true); setErr('')
    try {
      const targets: Partial<Record<ContainerAsset, number>> = {}
      for (const a of ASSET_TYPES) {
        const n = parseInt(vals[a] || '0') || 0
        // Kierunek bierzemy z oryginału; gdy oryginał był zerowy, zakładamy
        // ten sam kierunek co reszta grupy (WZ wydaje, przyjęcie przyjmuje).
        const sign = (g.assets[a] ?? 0) < 0 || g.sourceType === 'wz' ? -1 : 1
        targets[a] = n * sign
      }
      await containersApi.correctGroup({
        partnerId: g.partnerId, sourceType: g.sourceType, sourceId: g.sourceId,
        targets, confirm,
      })
      onSaved()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="hover:bg-surface-2">
      <td className="px-3 py-2 text-[12.5px] text-ink-3 tabular-nums">{g.date}</td>
      <td className="px-3 py-2 text-[13px] text-ink">
        {g.sourceLabel}
        {g.note && <span className="ml-2 text-[11.5px] text-ink-4">{g.note}</span>}
      </td>
      {ASSET_TYPES.map(a => (
        <td key={a} className="px-2 py-1.5">
          <input
            type="number" min="0" step="1" value={vals[a]}
            onChange={e => setVals(v => ({ ...v, [a]: e.target.value }))}
            className="w-20 h-8 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums" />
        </td>
      ))}
      <td className="px-3 py-2 text-right">
        <button onClick={() => save(true)} disabled={saving}
          className="inline-flex items-center gap-1 rounded bg-ink px-2.5 py-1.5 text-[12px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
          <Check size={12} /> Potwierdź
        </button>
        {err && <div className="mt-1 text-[11px] text-red-600">{err}</div>}
      </td>
    </tr>
  )
}

export default function ContainerPartnerPage() {
  const { partnerId = '' } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<PartnerData | null>(null)
  const [err, setErr] = useState('')
  const [docOpen, setDocOpen] = useState(false)

  const load = useCallback(() => {
    containersApi.partner(partnerId).then(setData).catch(e => setErr(String(e?.message || e)))
  }, [partnerId])

  useEffect(() => { load() }, [load])

  if (err) return <div className="p-6 text-[13px] text-red-700">{err}</div>
  if (!data) return <div className="p-6 text-[13px] text-ink-4">Ładowanie…</div>

  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)

  return (
    <div className="p-6 space-y-5">
      <header className="flex items-start gap-3">
        <button onClick={() => nav('/office/saldo-pojemnikow')}
          className="mt-1 text-ink-4 hover:text-ink"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-ink">{data.partner.name}</h1>
          <div className="text-[12.5px] text-ink-3">
            {data.partner.nip ? `NIP ${data.partner.nip}` : 'bez NIP'}
            {data.partner.address ? ` · ${data.partner.address}` : ''}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDocOpen(true)}
            className="inline-flex items-center gap-1.5 rounded bg-ink px-3 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2">
            <Plus size={13} /> Nowy dokument
          </button>
          <a href={`/office/pojemniki/raport/druk?partnerId=${partnerId}&from=${monthAgo}&to=${today}`}
             target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">
            <Printer size={13} /> Potwierdzenie salda
          </a>
        </div>
      </header>

      {/* Salda */}
      <div className="grid grid-cols-3 gap-3">
        {ASSET_TYPES.map(a => {
          const v = data.balance[a] ?? 0
          return (
            <div key={a} className="rounded border border-surface-4 bg-surface p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-ink-4">{ASSET_SHORT[a]}</div>
              <div className={`mt-1 text-3xl font-black tabular-nums ${TONE_CLS[balanceTone(v)]}`}>
                {v > 0 ? `+${v}` : v}
              </div>
              <div className="text-[11.5px] text-ink-4">
                {v > 0 ? 'mamy ich nośniki' : v < 0 ? 'mają nasze nośniki' : 'rozliczone'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Do rozliczenia */}
      {data.pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">
            Do rozliczenia — sprawdź liczby policzone przez system
          </h2>
          <div className="rounded border border-amber-200 bg-amber-50/40 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-200">
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase text-ink-3">Data</th>
                  <th className="px-3 py-2 text-left text-[11px] font-bold uppercase text-ink-3">Źródło</th>
                  {ASSET_TYPES.map(a => (
                    <th key={a} className="px-2 py-2 text-right text-[11px] font-bold uppercase text-ink-3">
                      {ASSET_SHORT[a]}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {data.pending.map(g => (
                  <PendingRow key={`${g.sourceType}:${g.sourceId}`} g={g} onSaved={load} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Dokumenty */}
      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Dokumenty pojemnikowe</h2>
        <div className="rounded border border-surface-4 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-3 border-b border-surface-4">
              <tr>
                {['Numer', 'Data', 'Kierowca', 'Pojazd', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-[11px] font-bold uppercase text-ink-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {data.docs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-[13px] text-ink-4">Brak dokumentów.</td></tr>
              )}
              {data.docs.map(d => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 text-[13px] font-mono font-bold text-ink">{d.number}</td>
                  <td className="px-3 py-2 text-[12.5px] tabular-nums text-ink-3">{d.docDate}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-3">{d.driver || '—'}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-3">{d.vehicle || '—'}</td>
                  <td className="px-3 py-2 text-[12px]">
                    <span className={d.status === 'anulowany' ? 'text-red-600' : 'text-emerald-600'}>{d.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <a href={`/office/pojemniki/${d.id}/druk`} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink">
                      <FileText size={12} /> Druk
                    </a>
                    {d.status !== 'anulowany' && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Anulować dokument ${d.number}? Ruchy wrócą na saldo.`)) return
                          await containersApi.cancelDoc(d.id); load()
                        }}
                        className="ml-3 text-[12px] text-red-600 hover:text-red-700">Anuluj</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Historia ruchów */}
      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-3">Historia ruchów</h2>
        <div className="rounded border border-surface-4 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-3 border-b border-surface-4">
              <tr>
                {['Data', 'Źródło', 'Dokument', 'Nośnik', 'Ilość', 'Status'].map((h, i) => (
                  <th key={i} className={`px-3 py-2 text-[11px] font-bold uppercase text-ink-3 ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {data.movements.map(m => (
                <tr key={m.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2 text-[12.5px] tabular-nums text-ink-3">{m.movementDate}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-2">{m.sourceLabel}</td>
                  <td className="px-3 py-2 text-[12.5px] font-mono text-ink-3">{m.docNumber || '—'}</td>
                  <td className="px-3 py-2 text-[12.5px] text-ink-2">{ASSET_SHORT[m.assetType]}</td>
                  <td className={`px-3 py-2 text-right text-[13px] font-bold tabular-nums ${m.qty > 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {m.qty > 0 ? `+${m.qty}` : m.qty}
                  </td>
                  <td className="px-3 py-2 text-[11.5px] text-ink-4">
                    {m.confirmed ? 'potwierdzony' : 'do przejrzenia'}
                  </td>
                </tr>
              ))}
              {data.movements.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-[13px] text-ink-4">Brak ruchów.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {docOpen && (
        <ContainerDocModal
          partnerId={partnerId}
          balance={data.balance}
          onClose={() => setDocOpen(false)}
          onSaved={() => { setDocOpen(false); load() }} />
      )}
    </div>
  )
}
```

> Import `ContainerDocModal` dodajesz w Tasku 14. Jeśli wykonujesz Task 13 osobno, tymczasowo zastąp blok `{docOpen && …}` przez `{null}` i przywróć go w Tasku 14 — inaczej `tsc` zgłosi brak modułu.

- [ ] **Step 2: Weryfikacja**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/ContainerPartnerPage.tsx src/App.tsx
git commit -m "feat(pojemniki): kartoteka kontrahenta z sekcją do rozliczenia"
```

---

### Task 14: Modal wystawienia dokumentu

**Files:**
- Create: `src/components/containers/ContainerDocModal.tsx`
- Modify: `src/pages/office/ContainerPartnerPage.tsx` (import + przywrócenie bloku `{docOpen && …}`)

**Interfaces:**
- Consumes: `containersApi.createDoc` (Task 9)
- Produces: `ContainerDocModal({ partnerId, balance, onClose, onSaved })`

- [ ] **Step 1: Create `src/components/containers/ContainerDocModal.tsx`**

```tsx
/**
 * ContainerDocModal — wystawienie „WZ na POJEMNIKI".
 *
 * Jeden dokument obejmuje OBA kierunki: kierowca zwykle przywozi pełne
 * i zabiera puste w tym samym kursie. Podgląd salda pokazuje, gdzie
 * wyjdzie saldo po zapisie — celem zwykle jest zero.
 */
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { containersApi, type ContainerAsset } from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES, balanceTone } from '@/lib/containers'

const TONE_CLS = {
  'owed-by-us': 'text-amber-600',
  'settled': 'text-emerald-600',
  'owed-to-us': 'text-red-600',
} as const

type Qty = Record<ContainerAsset, string>
const emptyQty = (): Qty =>
  Object.fromEntries(ASSET_TYPES.map(a => [a, ''])) as Qty

interface Props {
  partnerId: string
  balance: Record<ContainerAsset, number>
  onClose: () => void
  onSaved: () => void
}

export function ContainerDocModal({ partnerId, balance, onClose, onSaved }: Props) {
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10))
  const [driver, setDriver] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [notes, setNotes] = useState('')
  const [inQ, setInQ] = useState<Qty>(emptyQty)
  const [outQ, setOutQ] = useState<Qty>(emptyQty)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const n = (s: string) => parseInt(s || '0') || 0

  const preview = useMemo(
    () => Object.fromEntries(
      ASSET_TYPES.map(a => [a, (balance[a] ?? 0) + n(inQ[a]) - n(outQ[a])])
    ) as Record<ContainerAsset, number>,
    [balance, inQ, outQ])

  const anyQty = ASSET_TYPES.some(a => n(inQ[a]) || n(outQ[a]))

  const save = async () => {
    setSaving(true); setErr('')
    try {
      await containersApi.createDoc({
        partnerId, docDate, driver, vehicle, notes,
        lines: ASSET_TYPES.map(a => ({ assetType: a, inQty: n(inQ[a]), outQty: n(outQ[a]) })),
      })
      onSaved()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const qtyInput = (v: string, set: (s: string) => void) => (
    <input type="number" min="0" step="1" value={v} onChange={e => set(e.target.value)}
      className="w-24 h-9 rounded border border-surface-4 bg-surface px-2 text-right text-[13px] tabular-nums" />
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-surface-4 bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-surface-3 px-5 py-3">
          <h2 className="text-[15px] font-bold text-ink">Nowy dokument pojemnikowy</h2>
          <button onClick={onClose} className="text-ink-4 hover:text-ink"><X size={18} /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase text-ink-4">Data</span>
              <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
                className="w-full h-9 rounded border border-surface-4 bg-surface px-2 text-[13px]" />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase text-ink-4">Kierowca</span>
              <input value={driver} onChange={e => setDriver(e.target.value)}
                className="w-full h-9 rounded border border-surface-4 bg-surface px-2 text-[13px]" />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-bold uppercase text-ink-4">Środek transportu</span>
              <input value={vehicle} onChange={e => setVehicle(e.target.value)}
                className="w-full h-9 rounded border border-surface-4 bg-surface px-2 text-[13px]" />
            </label>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-3">
                <th className="py-2 text-left text-[11px] font-bold uppercase text-ink-3">Nośnik</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Dostawa / odbiór</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Zwrot</th>
                <th className="py-2 text-right text-[11px] font-bold uppercase text-ink-3">Saldo po</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {ASSET_TYPES.map(a => (
                <tr key={a}>
                  <td className="py-2 text-[13px] text-ink">{ASSET_SHORT[a]}</td>
                  <td className="py-1.5 text-right">{qtyInput(inQ[a], v => setInQ(q => ({ ...q, [a]: v })))}</td>
                  <td className="py-1.5 text-right">{qtyInput(outQ[a], v => setOutQ(q => ({ ...q, [a]: v })))}</td>
                  <td className={`py-2 text-right text-[15px] font-black tabular-nums ${TONE_CLS[balanceTone(preview[a])]}`}>
                    {preview[a] > 0 ? `+${preview[a]}` : preview[a]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label className="block space-y-1">
            <span className="text-[11px] font-bold uppercase text-ink-4">Uwagi</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full rounded border border-surface-4 bg-surface px-2 py-1.5 text-[13px]" />
          </label>

          {err && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{err}</div>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-surface-3 px-5 py-3">
          <button onClick={onClose} disabled={saving}
            className="rounded border border-surface-4 px-3 py-2 text-[12.5px] font-medium text-ink hover:bg-surface-2">
            Anuluj
          </button>
          <button onClick={save} disabled={saving || !anyQty}
            className="rounded bg-ink px-4 py-2 text-[12.5px] font-medium text-surface hover:bg-ink-2 disabled:opacity-50">
            {saving ? 'Zapisywanie…' : 'Wystaw dokument'}
          </button>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Podepnij modal w `ContainerPartnerPage.tsx`**

Dodaj import `import { ContainerDocModal } from '@/components/containers/ContainerDocModal'` i przywróć blok `{docOpen && <ContainerDocModal ... />}` z Taska 13.

- [ ] **Step 3: Weryfikacja**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 4: Ręczny smoke-test**

`npm run dev` → Saldo pojemników → wejdź w kontrahenta z dodatnim saldem → „Nowy dokument" → wpisz w kolumnie „Zwrot" tyle, ile wynosi saldo → podgląd „Saldo po" pokazuje **0** → zapisz → saldo na liście = 0, dokument pojawia się z numerem `POJ/…`.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/components/containers/ContainerDocModal.tsx src/pages/office/ContainerPartnerPage.tsx
git commit -m "feat(pojemniki): modal wystawienia dokumentu z podglądem salda"
```

---

### Task 15: Druk „WZ na POJEMNIKI" — A4 poziomo, 2 kopie

**Files:**
- Create: `src/pages/office/ContainerDocPrintPage.tsx`
- Modify: `src/App.tsx` — trasa **poza** layoutem `/office` (obok `/office/arkusz-kontroli/druk`, linia ~118)

**Interfaces:**
- Consumes: `containersApi.doc` (Task 9); dane firmy z `doc.seller` (Task 5)
- Produces: trasa `/office/pojemniki/:id/druk`

**Wymagania druku:** A4 poziomo (297 × 210 mm), dwie identyczne kopie jedna pod drugą (po 105 mm), oznaczenia ORYGINAŁ / KOPIA, logo `/logo-ksiezyc-print.png`, kolumna „Saldo" = `balanceAfter` (narastająco po dokumencie). Dane sprzedawcy z `doc.seller` — **nigdy nie hardcode**.

- [ ] **Step 1: Create `src/pages/office/ContainerDocPrintPage.tsx`**

```tsx
/**
 * ContainerDocPrintPage — druk „WZ na POJEMNIKI" 1:1 z zakładowym drukiem.
 *
 * A4 POZIOMO, dwie identyczne kopie jedna pod drugą (po 105 mm) — kierowca
 * zabiera jedną, druga zostaje w zakładzie. Kolumna „Saldo" to saldo
 * NARASTAJĄCO po tym dokumencie (balance_after zamrożone przy wystawieniu),
 * więc ponowny wydruk po kolejnych ruchach daje ten sam papier.
 *
 * Dane sprzedawcy idą z dokumentu (snapshot get_company() z chwili
 * wystawienia) — MES działa u wielu klientów, więc nic tu nie jest wpisane
 * na sztywno.
 *
 * Samodzielna strona (wzór SanitaryCheckPrintPage):
 * /office/pojemniki/:id/druk — auto-print po załadowaniu (?pdf=1 wyłącza).
 */
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { containersApi, type ContainerDoc } from '@/lib/api'

function fmtD(iso: string): string {
  if (!iso) return ''
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

const S = {
  copy: {
    height: '105mm', boxSizing: 'border-box' as const, padding: '5mm 6mm',
    background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 10,
    breakInside: 'avoid' as const,
  },
  table: { width: '100%', height: '100%', borderCollapse: 'collapse' as const, tableLayout: 'fixed' as const },
  cell: { border: '1px solid #111', padding: '2mm 2.5mm', verticalAlign: 'top' as const },
  lbl: { fontSize: 9, fontWeight: 700, textDecoration: 'underline' as const },
  val: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  head: { border: '1px solid #111', padding: '1.5mm', textAlign: 'center' as const,
          fontWeight: 700, fontSize: 10, background: '#e8e8e8' },
  rowLbl: { border: '1px solid #111', padding: '1.5mm 2.5mm', fontWeight: 700,
            fontSize: 10, background: '#f2f2f2' },
  num: { border: '1px solid #111', padding: '1.5mm', textAlign: 'center' as const,
         fontSize: 14, fontWeight: 700 },
}

function Copy({ doc, mark }: { doc: ContainerDoc; mark: string }) {
  const s = doc.seller || ({} as ContainerDoc['seller'])
  const sellerAddr = [s.address, [s.postal_code, s.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ')
  return (
    <div style={S.copy}>
      <table style={S.table}>
        <colgroup>
          <col style={{ width: '26%' }} /><col style={{ width: '25%' }} />
          <col style={{ width: '25%' }} /><col style={{ width: '24%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td style={{ ...S.cell, textAlign: 'center' }} rowSpan={2}>
              <div style={S.lbl}>Dostawca:</div>
              <img src="/logo-ksiezyc-print.png" alt="" style={{ height: '7mm', margin: '1mm auto' }} />
              <div style={{ fontSize: 11, fontWeight: 700 }}>{s.name || ''}</div>
              <div style={{ fontSize: 9 }}>{sellerAddr}</div>
              <div style={{ fontSize: 9 }}>{s.nip ? `NIP ${s.nip}` : ''}</div>
              <div style={{ fontSize: 9 }}>{s.phone ? `tel.: ${s.phone}` : ''}</div>
            </td>
            <td style={S.cell} colSpan={2}>
              <span style={{ fontSize: 11, fontWeight: 700 }}>WZ na POJEMNIKI NR: </span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>{doc.number}</span>
              <span style={{ float: 'right', fontSize: 8, letterSpacing: 1 }}>{mark}</span>
              {doc.status === 'anulowany' && (
                <div style={{ fontSize: 11, fontWeight: 800, color: '#b00' }}>ANULOWANY</div>
              )}
            </td>
            <td style={S.cell} rowSpan={2}>
              <div style={S.lbl}>Odbiorca:</div>
              <div style={{ ...S.val, fontSize: 11 }}>{doc.partner?.name || ''}</div>
              <div style={{ fontSize: 9 }}>{doc.partner?.address || ''}</div>
              <div style={{ fontSize: 9 }}>{doc.partner?.nip ? `NIP ${doc.partner.nip}` : ''}</div>
            </td>
          </tr>
          <tr>
            <td style={S.cell}>
              <div style={S.lbl}>Data dostawy / odbioru:</div>
              <div style={S.val}>{fmtD(doc.docDate)}</div>
            </td>
            <td style={S.cell}>
              <div style={S.lbl}>Kierowca:</div>
              <div style={S.val}>{doc.driver || ''}</div>
            </td>
          </tr>
          <tr>
            <td style={S.cell}>
              <div style={S.lbl}>Środek transportu:</div>
              <div style={S.val}>{doc.vehicle || ''}</div>
            </td>
            <td style={S.head}>Dostawa / odbiór [szt.]</td>
            <td style={S.head}>Zwrot [szt.]</td>
            <td style={S.head}>Saldo</td>
          </tr>
          {doc.lines.map(l => (
            <tr key={l.assetType}>
              <td style={S.rowLbl}>
                {l.label}
                {l.assetType === 'pallet_other' && (
                  <div style={{ fontWeight: 400, fontSize: 8 }}>PCV/plastik/europaleta/drewno</div>
                )}
              </td>
              <td style={S.num}>{l.inQty || ''}</td>
              <td style={S.num}>{l.outQty || ''}</td>
              <td style={S.num}>{l.balance}</td>
            </tr>
          ))}
          <tr style={{ height: '18mm' }}>
            <td style={S.cell}><div style={S.lbl}>Podpis dostawcy:</div></td>
            <td style={S.cell} colSpan={2}>
              <div style={S.lbl}>Uwagi:</div>
              <div style={{ fontSize: 9, marginTop: 2 }}>{doc.notes || ''}</div>
            </td>
            <td style={S.cell}><div style={S.lbl}>Podpis odbiorcy:</div></td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export default function ContainerDocPrintPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const [doc, setDoc] = useState<ContainerDoc | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    containersApi.doc(id).then(setDoc).catch(e => setErr(String(e?.message || e)))
  }, [id])

  useEffect(() => {
    // ?pdf=1 → renderer headless robi zrzut sam, bez dialogu drukowania.
    if (doc && params.get('pdf') !== '1') setTimeout(() => window.print(), 300)
  }, [doc, params])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!doc) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        @media screen { body { background: #eee; } }
      `}</style>
      <Copy doc={doc} mark="ORYGINAŁ" />
      <Copy doc={doc} mark="KOPIA" />
    </>
  )
}
```

- [ ] **Step 2: Dodaj trasę w `src/App.tsx`**

Poza layoutem `/office`, obok pozostałych stron druku (linia ~118):

```tsx
      <Route path="/office/pojemniki/:id/druk" element={<ContainerDocPrintPage />} />
```
plus import `import ContainerDocPrintPage from '@/pages/office/ContainerDocPrintPage'`.

- [ ] **Step 3: Weryfikacja**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 4: Wizualna weryfikacja druku**

`npm run dev`, otwórz `/office/pojemniki/<id>/druk?pdf=1`, w podglądzie wydruku przeglądarki sprawdź:
- orientacja **pozioma**, **jedna** strona
- dwie kopie jedna pod drugą, żadna nie przechodzi na drugą stronę
- kolumna „Saldo" pokazuje `balanceAfter` (dla domkniętej dostawy: 0)
- logo widoczne, dane sprzedawcy zgodne z Ustawieniami firmy

Jeśli druga kopia spada na kolejną stronę, zmniejsz `S.copy.height` do `102mm` — margines `@page` jest zerowy, ale przeglądarki różnią się o ~1 mm.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/ContainerDocPrintPage.tsx src/App.tsx
git commit -m "feat(pojemniki): druk WZ na POJEMNIKI — A4 poziomo, 2 kopie"
```

---

### Task 16: Druk potwierdzenia salda za okres

**Files:**
- Create: `src/pages/office/ContainerStatementPrintPage.tsx`
- Modify: `src/App.tsx` — trasa obok pozostałych druków

**Interfaces:**
- Consumes: `containersApi.statement` (Task 9)
- Produces: trasa `/office/pojemniki/raport/druk?partnerId=&from=&to=` (linkowana z kartoteki, Task 13)

- [ ] **Step 1: Create `src/pages/office/ContainerStatementPrintPage.tsx`**

```tsx
/**
 * ContainerStatementPrintPage — potwierdzenie salda nośników za okres.
 *
 * A4 PIONOWO (nie poziomo jak dokument wydania): to zestawienie ruchów,
 * a pion mieści dwa razy więcej wierszy. Układ: saldo otwarcia → ruchy
 * z saldem narastająco → saldo zamknięcia → miejsce na podpisy obu stron.
 *
 * /office/pojemniki/raport/druk?partnerId=&from=&to= — auto-print (?pdf=1 wyłącza).
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { containersApi, type ContainerStatement } from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES } from '@/lib/containers'

function fmtD(iso: string): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

const S = {
  page: { padding: '10mm 12mm', background: '#fff', color: '#111',
          fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 10.5 },
  h1: { fontSize: 15, fontWeight: 800, margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10 },
  th: { border: '1px solid #999', background: '#efefef', padding: '2px 5px',
        fontWeight: 700, fontSize: 9.5 },
  td: { border: '1px solid #bbb', padding: '2px 5px' },
  num: { border: '1px solid #bbb', padding: '2px 5px', textAlign: 'right' as const,
         fontVariantNumeric: 'tabular-nums' as const },
  sum: { border: '1px solid #999', padding: '3px 5px', fontWeight: 800, background: '#f6f6f6' },
}

export default function ContainerStatementPrintPage() {
  const [params] = useSearchParams()
  const partnerId = params.get('partnerId') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const [st, setSt] = useState<ContainerStatement | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!partnerId) { setErr('Brak wskazanego kontrahenta'); return }
    containersApi.statement(partnerId, from, to)
      .then(setSt).catch(e => setErr(String(e?.message || e)))
  }, [partnerId, from, to])

  useEffect(() => {
    if (st && params.get('pdf') !== '1') setTimeout(() => window.print(), 300)
  }, [st, params])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!st) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  return (
    <div style={S.page}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        tr { break-inside: avoid; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <img src="/logo-ksiezyc-print.png" alt="" style={{ height: '10mm' }} />
        <div style={{ flex: 1 }}>
          <h1 style={S.h1}>Potwierdzenie salda pojemników i palet</h1>
          <div style={{ fontSize: 10 }}>
            Okres: <b>{fmtD(st.from)} – {fmtD(st.to)}</b>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>{st.partner.name}</div>
          <div>{st.partner.address}</div>
          <div>{st.partner.nip ? `NIP ${st.partner.nip}` : ''}</div>
        </div>
      </div>

      <table style={{ ...S.table, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: '18mm' }}>Data</th>
            <th style={S.th}>Źródło</th>
            <th style={{ ...S.th, width: '24mm' }}>Dokument</th>
            <th style={{ ...S.th, width: '22mm' }}>Nośnik</th>
            <th style={{ ...S.th, width: '16mm' }}>Zmiana</th>
            <th style={{ ...S.th, width: '18mm' }}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {ASSET_TYPES.map(a => (
            <tr key={`open-${a}`}>
              <td style={S.sum} colSpan={4}>Saldo otwarcia — {ASSET_SHORT[a]}</td>
              <td style={S.sum} />
              <td style={{ ...S.sum, textAlign: 'right' }}>{st.opening[a]}</td>
            </tr>
          ))}
          {st.movements.map(m => (
            <tr key={m.id}>
              <td style={S.td}>{fmtD(m.movementDate)}</td>
              <td style={S.td}>{m.sourceLabel}{m.note ? ` — ${m.note}` : ''}</td>
              <td style={S.td}>{m.docNumber || '—'}</td>
              <td style={S.td}>{ASSET_SHORT[m.assetType]}</td>
              <td style={S.num}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
              <td style={S.num}>{m.balanceAfter[m.assetType]}</td>
            </tr>
          ))}
          {st.movements.length === 0 && (
            <tr><td style={S.td} colSpan={6}>Brak ruchów w wybranym okresie.</td></tr>
          )}
          {ASSET_TYPES.map(a => (
            <tr key={`close-${a}`}>
              <td style={S.sum} colSpan={4}>Saldo zamknięcia — {ASSET_SHORT[a]}</td>
              <td style={S.sum} />
              <td style={{ ...S.sum, textAlign: 'right' }}>{st.closing[a]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 9, marginTop: 6, color: '#555' }}>
        Saldo dodatnie — nośniki kontrahenta znajdują się u wystawcy.
        Saldo ujemne — nośniki wystawcy znajdują się u kontrahenta.
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: '18mm' }}>
        {['Podpis wystawcy', 'Podpis kontrahenta'].map(t => (
          <div key={t} style={{ flex: 1, borderTop: '1px solid #111', paddingTop: 3, fontSize: 9 }}>{t}</div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Dodaj trasę w `src/App.tsx`**

```tsx
      <Route path="/office/pojemniki/raport/druk" element={<ContainerStatementPrintPage />} />
```
plus import. **Uwaga na kolejność:** ta trasa musi być zadeklarowana **przed** `/office/pojemniki/:id/druk`, żeby `raport` nie został potraktowany jako `:id`.

- [ ] **Step 3: Weryfikacja**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS

- [ ] **Step 4: Wizualna weryfikacja**

Otwórz `/office/pojemniki/raport/druk?partnerId=<id>&from=2026-07-01&to=2026-07-31&pdf=1`. Sprawdź: orientacja pionowa, saldo otwarcia + ruchy + saldo zamknięcia zgadzają się arytmetycznie, wiersze nie łamią się w poprzek stron.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/ContainerStatementPrintPage.tsx src/App.tsx
git commit -m "feat(pojemniki): druk potwierdzenia salda za okres z ruchem nośników"
```

---

### Task 17: Weryfikacja końcowa

**Files:** brak zmian w kodzie — wyłącznie uruchamianie i sprawdzanie.

- [ ] **Step 1: Pełny pakiet testów backendu**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" python3 -m pytest -q
```
Expected: PASS, **zero `skipped` wśród testów `*_db.py`**. Jeśli widzisz skipy — `TEST_DATABASE_URL` nie zadziałał i całość jest niezweryfikowana.

- [ ] **Step 2: Frontend**

Run:
```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx tsc --noEmit && npx vitest run && npm run build
```
Expected: PASS na wszystkich trzech

- [ ] **Step 3: Przejście end-to-end na dev**

`npm run dev`, po kolei:
1. Przyjęcie surowca 6005 kg, kaliber 15 kg, 10 palet H1 → zapis.
2. `/office/saldo-pojemnikow` → dostawca ma **+401** E2 i **+10** H1, ze znacznikiem „do przejrzenia".
3. Kartoteka dostawcy → „Do rozliczenia" → popraw E2 na 400 → „Potwierdź" → saldo 400, znacznik znika, w historii widnieją DWA ruchy (+401 i −1).
4. „Nowy dokument" → Zwrot: 400 E2 i 10 H1 → podgląd „Saldo po" = 0 → wystaw.
5. Druk dokumentu → A4 poziomo, dwie kopie, kolumna Saldo = 0.
6. „Potwierdzenie salda" za bieżący miesiąc → saldo otwarcia + ruchy = saldo zamknięcia.
7. Anuluj dokument → saldo wraca do +400, dokument zostaje ze statusem „anulowany".

- [ ] **Step 4: Sprawdź, czy nic nie zostało niescommitowane**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && git status --short`
Expected: brak zmian w `backend/` i `src/`

- [ ] **Step 5: Przed ewentualnym deployem (poza zakresem tego planu)**

Deploy jest **poza zakresem planu**. Gdy przyjdzie jego czas, obowiązkowo najpierw:
```bash
diff -rq /opt/kebab/app/backend/app /opt/kebab/kebab_new/kebab_fixed/backend/app | grep -i differ
```
Jeśli prod ma treść, której nie ma w repo — scommituj ją do `main` PRZED deployem, inaczej deploy ją nadpisze. Po deployu zweryfikuj **dane** (`SELECT` na `container_partners`), nie flagę `migrations.done` — `run_migrations()` połyka błędy pojedynczych instrukcji.

---

## Znane ograniczenia v1 (świadome)

1. **WZ z zamówienia nie księguje nośników** — tylko WZ ręczne. `update_wz_lines` i `cancel_wz` odrzucają dokumenty niereczne, więc ruch z WZ zamówieniowego nie dałby się skorygować ani cofnąć. Palety pod wyrób gotowy to osobna iteracja.
2. **Brak scalania partnerów bez NIP** — dwa wpisy o różnie zapisanych nazwach zostaną osobno. Strona salda je pokazuje, ale nie ma jeszcze przycisku „Scal z…".
3. **Brak wyceny nośników** — saldo jest ilościowe; obciążanie kontrahenta za braki poza zakresem.
