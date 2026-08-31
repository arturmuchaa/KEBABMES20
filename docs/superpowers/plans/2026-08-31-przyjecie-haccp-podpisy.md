# Kontrola HACCP przy przyjęciu + podpisy elektroniczne — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Karta HACCP 1.1.1 wypełnia się z MES w komplecie (kolumny a–m), a kolumny „Wykonał" i „Sprawdził" niosą prawdziwe podpisy elektroniczne składane PIN-em.

**Architecture:** Dane kontroli mieszkają w osobnej tabeli `reception_checks` (1:1 z przyjęciem), bo `PUT /api/receptions/{id}` przepisuje cały dokument i kolumny w `receptions` zostałyby wyzerowane przy edycji dostawy. Podpisy to ogólny mechanizm `(doc_type, doc_id, role)` z kopią obrazka i hashem podpisanej treści — zmiana danych po podpisie unieważnia podpis. Wzór podpisu rysuje się na HMI rozbioru pod kodem serwisowym 0099; akt podpisania odbywa się w biurze, z PIN-em podpisującego.

**Tech Stack:** FastAPI + psycopg2 (surowy SQL, migracje idempotentne w `app/migrations.py`), React 18 + TypeScript + Vite + Tailwind, vitest, pytest, Tauri (kiosk).

**Spec:** `docs/superpowers/specs/2026-08-31-przyjecie-haccp-podpisy-design.md`

## Global Constraints

- **Język:** komentarze w kodzie i cały interfejs po polsku. Kod pisze się w stylu otaczających plików — gęste komentarze „dlaczego", nie „co".
- **Migracje idempotentne:** każda instrukcja w `_DDL` musi przetrwać ponowne uruchomienie (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Nigdy `DROP` ani `ALTER TYPE` niszczącego dane.
- **`%` w SQL psycopg2 to placeholder** — w literałach podwajać (`%%`).
- **Testy DB wymagają PEŁNEGO URL-a:** `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test`. Bez tego `conftest.py` je **cicho pomija** i CI świeci na zielono mimo niedziałającego kodu.
- **Zero bibliotek zewnętrznych w komponencie podpisu.** CSP w Tauri jest restrykcyjne (nonce zabija inline skrypty, `window.open` zwraca `null`). `SignaturePad` stoi na gołym `<canvas>` i Pointer Events.
- **Progi temperatur pochodzą z `progPrzyjecia()`** w `src/features/raw-batches/storageState.ts` (mrożone ≤ −12 °C, czerwone ≤ +7 °C, drób ≤ +4 °C). Nie duplikować liczb.
- **Kolejność tras w FastAPI:** ścieżki stałe muszą stać **przed** `/{reception_id}`, inaczej `haccp-pending` zostanie zjedzone jako identyfikator (plik `routes/receptions.py` ma już taki komentarz przy `/next-number`).
- **`can_access` jest default-deny** — nowy prefiks bez wpisu w `auth/permissions.py` dostaje `"office"`. Kiosk (operator działu `rozbior`) **nie wejdzie** na taki endpoint.
- **Kiosk ma frontend wbudowany.** Zadania 12–13 nie dotrą na halę bez wydania: bump wersji + tag `rozbior-v10-*`.
- **Nowe tabele dopisać do `_TRUNCATE`** w `backend/tests/conftest.py`, inaczej dane przeciekają między testami.

---

## Struktura plików

### Backend

| Plik | Odpowiedzialność |
|---|---|
| `backend/app/migrations.py` (modyfikacja) | DDL trzech tabel i dwóch kolumn `workers` |
| `backend/app/models/reception_checks.py` (nowy) | DTO wpisu HACCP |
| `backend/app/services/reception_checks_service.py` (nowy) | odczyt/zapis wpisu, status kompletności, lista braków |
| `backend/app/services/signature_hash.py` (nowy) | **czysta** kanonizacja treści + sha256 — bez bazy, testowalna bez `TEST_DATABASE_URL` |
| `backend/app/models/signatures.py` (nowy) | DTO podpisu i wzoru |
| `backend/app/services/signatures_service.py` (nowy) | złożenie podpisu (PIN), unieważnianie, wzory, lista uprawnionych |
| `backend/app/routes/reception_checks.py` (nowy) | `/api/receptions/{id}/check`, `/api/receptions/haccp-pending` |
| `backend/app/routes/signatures.py` (nowy) | `/api/signatures`, `/api/signature-samples` |
| `backend/app/auth/permissions.py` (modyfikacja) | `/api/signature-samples` dostępne dla działu `rozbior` |
| `backend/app/main.py` (modyfikacja) | rejestracja dwóch routerów |
| `backend/app/models/workers.py`, `services/workers_service.py` (modyfikacja) | dwa uprawnienia podpisu |
| `backend/tests/conftest.py` (modyfikacja) | trzy nowe tabele w `_TRUNCATE` |

### Frontend

| Plik | Odpowiedzialność |
|---|---|
| `src/features/raw-batches/receptionCheck.ts` (nowy) | **czysta** logika: kompletność, przekroczenie progu, wymagalność działania korygującego |
| `src/features/raw-batches/components/ReceptionCheckCard.tsx` (nowy) | sekcja „Kontrola HACCP" w podglądzie dostawy |
| `src/features/signatures/SignaturePad.tsx` (nowy) | pole rysowania (canvas + Pointer Events) |
| `src/features/signatures/signatureImage.ts` (nowy) | **czyste** przycięcie do bounding boxa i wykrycie pustego rysunku |
| `src/features/signatures/SignDialog.tsx` (nowy) | dialog podpisu: osoba → PIN → podpisz |
| `src/features/signatures/SignatureSamplesScreen.tsx` (nowy) | ekran wzorów w menu serwisowym kiosku |
| `src/features/deboning/ServiceMenu.tsx` (modyfikacja) | kafel „Wzory podpisów" |
| `src/lib/api.ts` (modyfikacja) | `receptionChecksApi`, `signaturesApi` |
| `src/lib/receptionRegisterRows.ts` (modyfikacja) | kolumny f–m; typ komórki `Cell` |
| `src/pages/office/ReceptionRegisterPrintPage.tsx` (modyfikacja) | render komórki obrazkowej |
| `src/features/raw-batches/pages/ReceptionPreviewPage.tsx` (modyfikacja) | osadzenie sekcji HACCP |
| `src/features/raw-batches/components/RawBatchesTable.tsx` (modyfikacja) | znacznik stanu HACCP |
| `src/pages/office/DashboardPage.tsx` (modyfikacja) | kafel braków |
| `src/pages/office/WorkersPage.tsx` (modyfikacja) | dwa checkboxy uprawnień |

---

# FAZA 1 — dane i upomnienia

Po fazie 1 karta 1.1.1 drukuje kolumny a–k. Działa samodzielnie, bez podpisów.

## Task 1: Tabela `reception_checks` + serwis odczytu i zapisu

**Files:**
- Modify: `backend/app/migrations.py` (dopisać na końcu listy `_DDL`)
- Modify: `backend/tests/conftest.py:_TRUNCATE`
- Create: `backend/app/services/reception_checks_service.py`
- Test: `backend/tests/test_reception_checks_db.py`

**Interfaces:**
- Consumes: `app.db.{execute, query_one, query_all}`, `app.utils.ids.now_iso`
- Produces:
  - `get_check(reception_id: str) -> dict` — zawsze dict; brak wiersza = pusty szkic z `NULL`-ami
  - `save_check(reception_id: str, dto: ReceptionCheckIn) -> dict`
  - `check_status(check: dict) -> str` — `'brak' | 'niepelne' | 'komplet'`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_reception_checks_db.py`:

```python
"""Wpis kontroli HACCP przy przyjęciu (karta 1.1.1, kolumny f-k).

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
from app.db import execute, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services.reception_checks_service import get_check, save_check
from app.utils.ids import now_iso


def _seed_przyjecie(rid="rec-haccp-1"):
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,'7/08',7,'2026-08','2026-08-14','sup-1','KOKO',%s) "
        "ON CONFLICT (id) DO NOTHING",
        (rid, now_iso()),
    )
    return rid


def test_dostawa_bez_wpisu_daje_pusty_szkic_nie_blad(db):
    rid = _seed_przyjecie()
    check = get_check(rid)
    assert check["receptionId"] == rid
    assert check["visual"] is None
    assert check["tempChamber"] is None
    assert check["status"] == "brak"


def test_zapis_i_odczyt_wpisu(db):
    rid = _seed_przyjecie()
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "notes": "", "verdict": "K",
    }))
    check = get_check(rid)
    assert check["tempChamber"] == 2.5
    assert check["verdict"] == "K"
    assert check["status"] == "komplet"


def test_powtorny_zapis_aktualizuje_ten_sam_wiersz(db):
    rid = _seed_przyjecie()
    dto = {"visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
           "kgMatch": "bz", "verdict": "K"}
    save_check(rid, ReceptionCheckIn.model_validate(dto))
    save_check(rid, ReceptionCheckIn.model_validate({**dto, "tempMeat": 3.9}))
    assert query_one(
        "SELECT count(*) AS n FROM reception_checks WHERE reception_id=%s", (rid,)
    )["n"] == 1
    assert get_check(rid)["tempMeat"] == 3.9


def test_wpis_bez_kwalifikacji_jest_niepelny(db):
    rid = _seed_przyjecie()
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1, "kgMatch": "bz",
    }))
    assert get_check(rid)["status"] == "niepelne"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_reception_checks_db.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.reception_checks'`.

Jeśli zamiast FAIL zobaczysz `SKIPPED`, `TEST_DATABASE_URL` nie doszedł — testy nic nie sprawdzają. Popraw zmienną, zanim ruszysz dalej.

- [ ] **Step 3: Dopisz DDL do migracji**

Na końcu listy `_DDL` w `backend/app/migrations.py`:

```python
    # ── Kontrola HACCP przy przyjęciu (karta 1.1.1, kolumny f-k) ──
    #
    # OSOBNA tabela, nie kolumny w `receptions`: PUT /api/receptions/{id}
    # przepisuje CAŁY dokument dostawy, więc poprawka kilogramów zrobiona
    # formularzem bez sekcji HACCP wyzerowałaby zmierzoną temperaturę.
    # Wpis powstaje też PÓŹNIEJ niż dostawa (biuro uzupełnia go po pół
    # godziny) i docelowo w innym miejscu — przy rampie.
    """CREATE TABLE IF NOT EXISTS reception_checks (
        reception_id   TEXT PRIMARY KEY REFERENCES receptions(id) ON DELETE CASCADE,
        visual         TEXT,
        temp_chamber   NUMERIC(4,1),
        temp_meat      NUMERIC(4,1),
        kg_match       TEXT,
        notes          TEXT NOT NULL DEFAULT '',
        verdict        TEXT,
        nc_description TEXT NOT NULL DEFAULT '',
        nc_action      TEXT NOT NULL DEFAULT '',
        nc_at          TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL,
        updated_at     TIMESTAMPTZ NOT NULL
    )""",
```

- [ ] **Step 4: Dopisz tabelę do czyszczenia w testach**

W `backend/tests/conftest.py`, w liście `_TRUNCATE`, **przed** `"receptions"` (CASCADE i tak by ją złapał, ale jawny wpis czyta się lepiej):

```python
    # Kontrola HACCP dostawy — czyszczona razem z przyjęciami.
    "reception_checks",
```

- [ ] **Step 5: Napisz model DTO**

`backend/app/models/reception_checks.py`:

```python
"""Wpis kontroli HACCP dostawy — kolumny f-k karty 1.1.1.

Wszystkie pola są opcjonalne, bo przyjęcie zapisuje się jak dawniej,
a kontrolę biuro uzupełnia później (czasem po pół godziny).
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ReceptionCheckIn(BaseModel):
    model_config = ConfigDict(populate_by_name=True, validate_default=True)

    #: kol. f — ocena wizualna dostawy i książka mycia pojazdu: 'bz' | 'N'
    visual: Optional[str] = None
    #: kol. g/h — NAJWYŻSZY zmierzony odczyt, zgodnie z instrukcją 1.1
    temp_chamber: Optional[float] = Field(None, alias="tempChamber")
    temp_meat: Optional[float] = Field(None, alias="tempMeat")
    #: kol. i — zgodność kg z zamówieniem i dokumentami: 'bz' | 'N'
    kg_match: Optional[str] = Field(None, alias="kgMatch")
    notes: str = ""                                   # kol. j
    #: kol. k — kwalifikacja: 'K' przyjęta | 'N' odmowa przyjęcia
    verdict: Optional[str] = None
    nc_description: str = Field("", alias="ncDescription")
    nc_action: str = Field("", alias="ncAction")
    nc_at: Optional[str] = Field(None, alias="ncAt")
```

- [ ] **Step 6: Napisz serwis**

`backend/app/services/reception_checks_service.py`:

```python
"""Kontrola HACCP dostawy — kolumny f-k karty 1.1.1.

Wpis jest ZAWSZE opcjonalny: dostawa zapisuje się bez niego, a system
tylko przypomina o uzupełnieniu (żadnej blokady — dostawa o 6 rano nie
może czekać na kierownika).
"""
from typing import Any, Dict, Optional

from app.db import execute, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.utils.ids import now_iso

#: Pola, bez których karta 1.1.1 ma dziurę w wierszu.
_WYMAGANE = ("visual", "tempChamber", "tempMeat", "kgMatch", "verdict")


def _f(v: Any) -> Optional[float]:
    return None if v is None else float(v)


def _pusty(reception_id: str) -> Dict[str, Any]:
    return {
        "receptionId": reception_id, "visual": None, "tempChamber": None,
        "tempMeat": None, "kgMatch": None, "notes": "", "verdict": None,
        "ncDescription": "", "ncAction": "", "ncAt": None,
        "updatedAt": None,
    }


def check_status(check: Dict[str, Any]) -> str:
    """'brak' — nic nie wpisano; 'niepelne' — brakuje pola; 'komplet'."""
    wypelnione = [k for k in _WYMAGANE if check.get(k) not in (None, "")]
    if not wypelnione:
        return "brak"
    return "komplet" if len(wypelnione) == len(_WYMAGANE) else "niepelne"


def get_check(reception_id: str) -> Dict[str, Any]:
    """Wpis dostawy. Brak wiersza to stan NORMALNY, nie błąd — zwracamy
    pusty szkic, żeby formularz miał co pokazać i gdzie zapisać."""
    row = query_one(
        "SELECT * FROM reception_checks WHERE reception_id=%s", (reception_id,))
    out = _pusty(reception_id) if not row else {
        "receptionId": row["reception_id"],
        "visual": row["visual"],
        "tempChamber": _f(row["temp_chamber"]),
        "tempMeat": _f(row["temp_meat"]),
        "kgMatch": row["kg_match"],
        "notes": row["notes"] or "",
        "verdict": row["verdict"],
        "ncDescription": row["nc_description"] or "",
        "ncAction": row["nc_action"] or "",
        "ncAt": row["nc_at"].isoformat() if row["nc_at"] else None,
        "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
    }
    out["status"] = check_status(out)
    return out


def save_check(reception_id: str, dto: ReceptionCheckIn) -> Dict[str, Any]:
    """Zapis wpisu. UPSERT po kluczu głównym — jedna dostawa, jeden wpis."""
    teraz = now_iso()
    execute(
        """INSERT INTO reception_checks
             (reception_id, visual, temp_chamber, temp_meat, kg_match, notes,
              verdict, nc_description, nc_action, nc_at, created_at, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (reception_id) DO UPDATE SET
             visual=EXCLUDED.visual, temp_chamber=EXCLUDED.temp_chamber,
             temp_meat=EXCLUDED.temp_meat, kg_match=EXCLUDED.kg_match,
             notes=EXCLUDED.notes, verdict=EXCLUDED.verdict,
             nc_description=EXCLUDED.nc_description, nc_action=EXCLUDED.nc_action,
             nc_at=EXCLUDED.nc_at, updated_at=EXCLUDED.updated_at""",
        (reception_id, dto.visual, dto.temp_chamber, dto.temp_meat, dto.kg_match,
         dto.notes, dto.verdict, dto.nc_description, dto.nc_action, dto.nc_at,
         teraz, teraz),
    )
    return get_check(reception_id)
```

- [ ] **Step 7: Zbuduj schemat bazy testowej i uruchom testy**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -c "from app.migrations import run_migrations; run_migrations()"
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_reception_checks_db.py -v
```

Expected: 4 passed.

**UWAGA:** `run_migrations()` połyka błędy pojedynczych instrukcji i loguje je jako ostrzeżenia. Zweryfikuj, że tabela naprawdę powstała:

```bash
docker exec kebab-op psql -U postgres -d kebab_mes_test -c "\d reception_checks"
```

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/tests/conftest.py \
        kebab_fixed/backend/app/models/reception_checks.py \
        kebab_fixed/backend/app/services/reception_checks_service.py \
        kebab_fixed/backend/tests/test_reception_checks_db.py
git commit -m "feat(haccp): tabela i serwis kontroli HACCP przy przyjęciu"
```

---

## Task 2: API wpisu HACCP + lista braków

**Files:**
- Create: `backend/app/routes/reception_checks.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/reception_checks_service.py` (dopisać `pending`)
- Test: `backend/tests/test_reception_checks_db.py` (dopisać)

**Interfaces:**
- Consumes: `get_check`, `save_check`, `check_status` z Task 1
- Produces:
  - `GET /api/receptions/{reception_id}/check` → wpis (pusty szkic, gdy brak)
  - `PUT /api/receptions/{reception_id}/check` → zapisany wpis
  - `GET /api/receptions/haccp-pending?days=14` → `[{receptionId, receptionNo, supplierName, receivedDate, status}]`
  - `pending(days: int) -> list[dict]`

- [ ] **Step 1: Write the failing test**

Dopisz do `backend/tests/test_reception_checks_db.py`:

```python
from datetime import date, timedelta

from app.services.reception_checks_service import pending


def test_pending_pomija_dostawy_z_kompletem(db):
    wczoraj = (date.today() - timedelta(days=1)).isoformat()
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES ('rec-p1','1/08',1,'2026-08',%s,'sup-1','KOKO',%s),"
        "       ('rec-p2','2/08',2,'2026-08',%s,'sup-1','KOKO',%s)",
        (wczoraj, now_iso(), wczoraj, now_iso()),
    )
    save_check("rec-p1", ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.0, "tempMeat": 3.0,
        "kgMatch": "bz", "verdict": "K",
    }))
    braki = {r["receptionId"] for r in pending(14)}
    assert "rec-p1" not in braki
    assert "rec-p2" in braki


def test_pending_nie_siega_poza_okno_dni(db):
    dawno = (date.today() - timedelta(days=40)).isoformat()
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES ('rec-stare','9/07',9,'2026-07',%s,'sup-1','KOKO',%s)",
        (dawno, now_iso()),
    )
    assert all(r["receptionId"] != "rec-stare" for r in pending(14))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_reception_checks_db.py -v -k pending
```

Expected: FAIL — `ImportError: cannot import name 'pending'`.

- [ ] **Step 3: Dopisz `pending` do serwisu**

Na końcu `backend/app/services/reception_checks_service.py`:

```python
def pending(days: int = 14) -> list:
    """Dostawy bez kompletu HACCP z ostatnich `days` dni.

    Okno, nie cała historia: pulpit pokazuje STAN, nie archiwum — inaczej
    kafel od pierwszego dnia świeciłby setką starych dostaw, których nikt
    już nie uzupełni, i przestałby cokolwiek znaczyć.
    """
    rows = query_all(
        """SELECT r.id, r.reception_no, r.supplier_name, r.received_date,
                  c.visual, c.temp_chamber, c.temp_meat, c.kg_match, c.verdict
             FROM receptions r
             LEFT JOIN reception_checks c ON c.reception_id = r.id
            WHERE r.received_date >= CURRENT_DATE - %s::int
            ORDER BY r.received_date DESC, r.reception_seq DESC""",
        (days,),
    )
    out = []
    for r in rows:
        stan = check_status({
            "visual": r["visual"], "tempChamber": r["temp_chamber"],
            "tempMeat": r["temp_meat"], "kgMatch": r["kg_match"],
            "verdict": r["verdict"],
        })
        if stan == "komplet":
            continue
        out.append({
            "receptionId": r["id"],
            "receptionNo": r["reception_no"],
            "supplierName": r["supplier_name"] or "",
            "receivedDate": r["received_date"].isoformat() if r["received_date"] else "",
            "status": stan,
        })
    return out
```

Dopisz `query_all` do importu z `app.db` na górze pliku.

- [ ] **Step 4: Run test to verify it passes**

```bash
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_reception_checks_db.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Napisz trasy**

`backend/app/routes/reception_checks.py`:

```python
"""Kontrola HACCP dostawy — kolumny f-k karty 1.1.1.

Osobny router od `receptions`, bo to osobny byt: wpis powstaje po zapisaniu
dostawy i docelowo w innym miejscu (kiosk przy rampie).
"""
from fastapi import APIRouter, HTTPException, Query

from app.db import query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services import reception_checks_service as svc

router = APIRouter(prefix="/api/receptions", tags=["reception-checks"])


# UWAGA: /haccp-pending MUSI stać przed /{reception_id}/check — inaczej
# „haccp-pending" wpadnie jako identyfikator dostawy (ta sama pułapka co
# /next-number w routes/receptions.py).
@router.get("/haccp-pending")
def haccp_pending(days: int = Query(14, ge=1, le=365)):
    return svc.pending(days)


@router.get("/{reception_id}/check")
def get_check(reception_id: str):
    if not query_one("SELECT id FROM receptions WHERE id=%s", (reception_id,)):
        raise HTTPException(404, "Przyjęcie nie istnieje")
    return svc.get_check(reception_id)


@router.put("/{reception_id}/check")
def put_check(reception_id: str, dto: ReceptionCheckIn):
    if not query_one("SELECT id FROM receptions WHERE id=%s", (reception_id,)):
        raise HTTPException(404, "Przyjęcie nie istnieje")
    return svc.save_check(reception_id, dto)
```

- [ ] **Step 6: Zarejestruj router**

W `backend/app/main.py` — obok `receptions`:

```python
from app.routes import reception_checks
...
app.include_router(reception_checks.router)
```

Router `reception_checks` rejestruj **po** `receptions`; oba mają prefiks `/api/receptions`, a FastAPI dopasowuje trasy w kolejności rejestracji — `haccp-pending` nie może trafić w `receptions./{reception_id}`. Jeśli trafia, przenieś rejestrację `reception_checks` **przed** `receptions`.

- [ ] **Step 7: Sprawdź trasę ręcznie**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -c "
from app.main import app
for r in app.routes:
    if 'check' in getattr(r, 'path', '') or 'haccp' in getattr(r, 'path', ''):
        print(r.methods, r.path)
"
```

Expected: widoczne `/api/receptions/haccp-pending`, `/api/receptions/{reception_id}/check` (GET i PUT).

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/routes/reception_checks.py kebab_fixed/backend/app/main.py \
        kebab_fixed/backend/app/services/reception_checks_service.py \
        kebab_fixed/backend/tests/test_reception_checks_db.py
git commit -m "feat(haccp): API wpisu kontroli i lista dostaw bez kompletu"
```

---

## Task 3: Czysta logika wpisu po stronie frontu

**Files:**
- Create: `src/features/raw-batches/receptionCheck.ts`
- Test: `src/features/raw-batches/receptionCheck.test.ts`

**Interfaces:**
- Consumes: `progPrzyjecia` z `src/features/raw-batches/storageState.ts`
- Produces:
  - `type ReceptionCheck` — kształt odpowiedzi API
  - `checkStatus(c: ReceptionCheck): 'brak' | 'niepelne' | 'komplet'`
  - `tempExceeded(temp, category, state): boolean`
  - `needsCorrectiveAction(c: ReceptionCheck): boolean`
  - `checkIssues(c, category, state): string[]`

Moduł jest czysty — bez React i bez `fetch` — żeby dał się przetestować w vitest bez bazy i bez DOM.

- [ ] **Step 1: Write the failing test**

`src/features/raw-batches/receptionCheck.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  checkIssues, checkStatus, needsCorrectiveAction, tempExceeded,
  type ReceptionCheck,
} from './receptionCheck'

const pusty: ReceptionCheck = {
  receptionId: 'r1', visual: null, tempChamber: null, tempMeat: null,
  kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null,
}
const komplet: ReceptionCheck = {
  ...pusty, visual: 'bz', tempChamber: 2.5, tempMeat: 3.1,
  kgMatch: 'bz', verdict: 'K',
}

describe('checkStatus', () => {
  it('nic nie wpisano → brak', () => {
    expect(checkStatus(pusty)).toBe('brak')
  })
  it('część pól → niepelne', () => {
    expect(checkStatus({ ...pusty, visual: 'bz' })).toBe('niepelne')
  })
  it('komplet pól → komplet', () => {
    expect(checkStatus(komplet)).toBe('komplet')
  })
  it('temperatura 0 °C liczy się jako wypełniona', () => {
    expect(checkStatus({ ...komplet, tempChamber: 0 })).toBe('komplet')
  })
})

describe('tempExceeded', () => {
  it('drób chłodzony: 4,0 °C mieści się w progu', () => {
    expect(tempExceeded(4.0, 'drob', 'chlodzony')).toBe(false)
  })
  it('drób chłodzony: 4,1 °C przekracza', () => {
    expect(tempExceeded(4.1, 'drob', 'chlodzony')).toBe(true)
  })
  it('mięso czerwone ma próg +7 °C', () => {
    expect(tempExceeded(6.5, 'czerwone', 'chlodzony')).toBe(false)
  })
  it('mrożone: −10 °C przekracza próg −12 °C', () => {
    expect(tempExceeded(-10, 'czerwone', 'mrozony')).toBe(true)
  })
  it('brak pomiaru nie jest przekroczeniem', () => {
    expect(tempExceeded(null, 'drob', 'chlodzony')).toBe(false)
  })
})

describe('needsCorrectiveAction', () => {
  it('same b/z i K → nie trzeba', () => {
    expect(needsCorrectiveAction(komplet)).toBe(false)
  })
  it('ocena wizualna N → trzeba', () => {
    expect(needsCorrectiveAction({ ...komplet, visual: 'N' })).toBe(true)
  })
  it('kwalifikacja N → trzeba', () => {
    expect(needsCorrectiveAction({ ...komplet, verdict: 'N' })).toBe(true)
  })
})

describe('checkIssues', () => {
  it('N bez opisu działania daje uwagę', () => {
    const uwagi = checkIssues({ ...komplet, verdict: 'N' }, 'drob', 'chlodzony')
    expect(uwagi.some(u => u.includes('działanie'))).toBe(true)
  })
  it('przekroczony próg daje uwagę o temperaturze', () => {
    const uwagi = checkIssues({ ...komplet, tempMeat: 9 }, 'drob', 'chlodzony')
    expect(uwagi.some(u => u.includes('Temperatura'))).toBe(true)
  })
  it('komplet bez odchyleń nie ma uwag', () => {
    expect(checkIssues(komplet, 'drob', 'chlodzony')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/raw-batches/receptionCheck.test.ts
```

Expected: FAIL — `Failed to resolve import "./receptionCheck"`.

- [ ] **Step 3: Napisz moduł**

`src/features/raw-batches/receptionCheck.ts`:

```ts
/**
 * receptionCheck — kontrola HACCP dostawy, kolumny f-k karty 1.1.1.
 *
 * Czysta logika, zero React i zero fetch: te same reguły obowiązują
 * w formularzu biura i (docelowo) na kiosku przy rampie, więc nie mogą
 * mieszkać w komponencie.
 *
 * Progi temperatur pochodzą z `progPrzyjecia` — jedno miejsce na tę
 * decyzję w całej aplikacji, bo wisi na niej też magazyn i etykieta.
 */
import { progPrzyjecia } from './storageState'

export interface ReceptionCheck {
  receptionId:    string
  /** kol. f — ocena wizualna dostawy i książka mycia pojazdu. */
  visual:         'bz' | 'N' | null
  /** kol. g/h — NAJWYŻSZY zmierzony odczyt (instrukcja 1.1). */
  tempChamber:    number | null
  tempMeat:       number | null
  /** kol. i — zgodność kg z zamówieniem i dokumentami. */
  kgMatch:        'bz' | 'N' | null
  notes:          string          // kol. j
  /** kol. k — 'K' dostawa przyjęta, 'N' odmowa przyjęcia. */
  verdict:        'K' | 'N' | null
  ncDescription:  string
  ncAction:       string
  ncAt:           string | null
}

export type CheckStatus = 'brak' | 'niepelne' | 'komplet'

/** Pola, bez których wiersz karty 1.1.1 ma dziurę. */
const WYMAGANE = ['visual', 'tempChamber', 'tempMeat', 'kgMatch', 'verdict'] as const

/** Wypełnione = różne od null i od pustego napisu. Zero °C JEST pomiarem —
 *  `!value` wywaliłoby poprawny odczyt z komory na granicy. */
const wypelnione = (v: unknown) => v !== null && v !== undefined && v !== ''

export function checkStatus(c: ReceptionCheck): CheckStatus {
  const ile = WYMAGANE.filter(k => wypelnione(c[k])).length
  if (ile === 0) return 'brak'
  return ile === WYMAGANE.length ? 'komplet' : 'niepelne'
}

export function tempExceeded(
  temp: number | null | undefined,
  category: string | null | undefined,
  state: string | null | undefined,
): boolean {
  if (temp === null || temp === undefined) return false
  return temp > progPrzyjecia(category, state).maxC
}

/** Jakiekolwiek „N" wymaga opisania, co z tym zrobiono — inaczej karta
 *  pokazuje niezgodność bez wyjaśnienia i audytor pyta o nią pierwszą. */
export function needsCorrectiveAction(c: ReceptionCheck): boolean {
  return c.visual === 'N' || c.kgMatch === 'N' || c.verdict === 'N'
}

export function checkIssues(
  c: ReceptionCheck,
  category: string | null | undefined,
  state: string | null | undefined,
): string[] {
  const out: string[] = []
  const prog = progPrzyjecia(category, state)
  if (tempExceeded(c.tempChamber, category, state)) {
    out.push(`Temperatura komory ${c.tempChamber} °C przekracza próg ${prog.opis}`)
  }
  if (tempExceeded(c.tempMeat, category, state)) {
    out.push(`Temperatura mięsa ${c.tempMeat} °C przekracza próg ${prog.opis}`)
  }
  if (needsCorrectiveAction(c) && !c.ncAction.trim()) {
    out.push('Niezgodność bez opisu — uzupełnij działanie korygujące')
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/features/raw-batches/receptionCheck.test.ts
```

Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/raw-batches/receptionCheck.ts \
        kebab_fixed/src/features/raw-batches/receptionCheck.test.ts
git commit -m "feat(haccp): reguły kontroli dostawy (kompletność, progi, działanie korygujące)"
```

---

## Task 4: Klient API + sekcja „Kontrola HACCP" w podglądzie dostawy

**Files:**
- Modify: `src/lib/api.ts` (dopisać `receptionChecksApi` obok `receptionsApi`)
- Create: `src/features/raw-batches/components/ReceptionCheckCard.tsx`
- Modify: `src/features/raw-batches/pages/ReceptionPreviewPage.tsx`
- Test: `src/features/raw-batches/receptionCheckCard.test.tsx`

**Interfaces:**
- Consumes: `checkStatus`, `checkIssues`, `needsCorrectiveAction`, `ReceptionCheck` (Task 3)
- Produces:
  - `receptionChecksApi.get(receptionId)`, `.save(receptionId, dto)`, `.pending(days)`
  - `<ReceptionCheckCard receptionId category storageState />`

- [ ] **Step 1: Write the failing test**

`src/features/raw-batches/receptionCheckCard.test.tsx`:

```tsx
/** Sekcja kontroli HACCP w podglądzie dostawy — ekran z TEMPERATURAMI,
 *  więc obowiązuje ta sama zasada co ekrany z kilogramami: test komponentu,
 *  nie tylko czystej funkcji. */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const save = vi.fn()
vi.mock('@/lib/apiClient', () => ({
  receptionChecksApi: { get: (...a: any[]) => get(...a), save: (...a: any[]) => save(...a) },
}))

import { ReceptionCheckCard } from './components/ReceptionCheckCard'

const pusty = {
  receptionId: 'r1', visual: null, tempChamber: null, tempMeat: null,
  kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null,
}

beforeEach(() => {
  get.mockReset(); save.mockReset()
  get.mockResolvedValue(pusty)
  save.mockImplementation((_id: string, dto: any) => Promise.resolve({ ...pusty, ...dto }))
})

describe('ReceptionCheckCard', () => {
  it('dostawa bez wpisu prosi o uzupełnienie', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/Uzupełnij kontrolę HACCP/i)).toBeTruthy()
  })

  it('temperatura ponad progiem pokazuje uwagę, ale nie blokuje zapisu', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'bz', kgMatch: 'bz', verdict: 'K',
                            tempChamber: 2, tempMeat: 9 })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/przekracza próg/i)).toBeTruthy()
    const zapisz = screen.getByRole('button', { name: /Zapisz/i })
    expect(zapisz.hasAttribute('disabled')).toBe(false)
  })

  it('zapis wysyła wpisane wartości', async () => {
    const user = userEvent.setup()
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText(/Uzupełnij kontrolę HACCP/i)
    await user.type(screen.getByLabelText(/Temperatura komory/i), '2,5')
    await user.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempChamber).toBe(2.5)
  })

  it('ocena N żąda opisania działania korygującego', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'N', kgMatch: 'bz', verdict: 'N',
                            tempChamber: 2, tempMeat: 3 })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/działanie korygujące/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/features/raw-batches/receptionCheckCard.test.tsx
```

Expected: FAIL — brak modułu `./components/ReceptionCheckCard`.

- [ ] **Step 3: Dopisz klienta API**

W `src/lib/api.ts`, zaraz za blokiem `receptionsApi`:

```ts
/** Kontrola HACCP dostawy — kolumny f-k karty 1.1.1.
 *  Osobny klient, bo to osobny byt: wpis powstaje PO zapisaniu dostawy. */
export const receptionChecksApi = {
  get: (receptionId: string) =>
    get<any>(`/receptions/${encodeURIComponent(receptionId)}/check`),

  save: (receptionId: string, dto: Record<string, unknown>) =>
    put<any>(`/receptions/${encodeURIComponent(receptionId)}/check`, dto),

  /** Dostawy bez kompletu HACCP — okno dni, nie cała historia. */
  pending: (days = 14) => get<any[]>(`/receptions/haccp-pending?days=${days}`),
}
```

Sprawdź, czy `apiClient.ts` re-eksportuje wszystko z `api.ts` (`ReceptionCheckCard` importuje z `@/lib/apiClient`, tak jak reszta ekranów przyjęcia). Jeśli re-eksport jest wyliczany nazwa po nazwie, dopisz `receptionChecksApi`.

- [ ] **Step 4: Napisz komponent**

`src/features/raw-batches/components/ReceptionCheckCard.tsx` — sekcja z polami: ocena wizualna (`bz`/`N`), temperatura komory, temperatura mięsa, zgodność kg (`bz`/`N`), uwagi, kwalifikacja (`K`/`N`), a przy `needsCorrectiveAction` dodatkowo opis niezgodności, działanie i godzina.

Wymagania, które MUSZĄ być spełnione, żeby testy przeszły:
- każde pole liczbowe ma `<Label htmlFor>` z tekstem „Temperatura komory [°C]" / „Temperatura mięsa [°C]";
- przecinek dziesiętny działa jak kropka (biuro wpisuje `2,5`) — parsuj przez `parseKg`-podobną normalizację: `Number(String(v).replace(',', '.'))`;
- uwagi z `checkIssues` renderują się nad przyciskiem, a przycisk „Zapisz kontrolę" **nigdy** nie jest `disabled` z powodu przekroczenia progu (dostawę odrzuconą trzeba móc zapisać — to jest jej sens);
- nagłówek pokazuje „Uzupełnij kontrolę HACCP", gdy `checkStatus(...) !== 'komplet'`;
- blok działania korygującego renderuje się tylko przy `needsCorrectiveAction(...)`, z widocznym tekstem „działanie korygujące";
- przy zmianie `verdict` na `'N'` pokaż pytanie: „Dostawa odrzucona — anulować przyjęcie i zdjąć surowiec ze stanu?" z odnośnikiem do istniejącej ścieżki anulowania (`rawBatchesApi`/`receptionsApi.cancel`). **Nie anuluj automatycznie** — cofanie ruchów magazynowych to decyzja człowieka.

Styl: `Card` / `CardTitle` / `CardContent`, `Input`, `Label`, `Button`, `Select` z `@/components/ui/*` — jak `ReceptionForm.tsx`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/features/raw-batches/receptionCheckCard.test.tsx
```

Expected: 4 passed.

- [ ] **Step 6: Osadź sekcję w podglądzie dostawy**

W `src/features/raw-batches/pages/ReceptionPreviewPage.tsx`, pod tabelą pozycji:

```tsx
<ReceptionCheckCard
  receptionId={rec.id}
  category={rec.materialCategory}
  storageState={rec.storageState}
/>
```

Jeśli `mapReception` nie przenosi `materialCategory` ani `storageState`, dopisz je tam — bez nich `progPrzyjecia` dostanie `undefined` i policzy próg drobiu dla wołowiny.

- [ ] **Step 7: Uruchom cały zestaw testów frontu**

```bash
npx vitest run
```

Expected: wszystko zielone (żaden istniejący test nie może się wywrócić).

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/lib/api.ts \
        kebab_fixed/src/features/raw-batches/components/ReceptionCheckCard.tsx \
        kebab_fixed/src/features/raw-batches/receptionCheckCard.test.tsx \
        kebab_fixed/src/features/raw-batches/pages/ReceptionPreviewPage.tsx
git commit -m "feat(haccp): sekcja kontroli HACCP w podglądzie dostawy"
```

---

## Task 5: Upomnienia — baner, znacznik na liście, kafel na pulpicie

**Files:**
- Modify: `src/features/raw-batches/components/RawBatchesTable.tsx`
- Modify: `src/features/raw-batches/pages/RawBatchesPage.tsx` (baner po zapisie)
- Modify: `src/pages/office/DashboardPage.tsx`
- Test: `src/features/raw-batches/haccpBadge.test.ts`
- Create: `src/features/raw-batches/haccpBadge.ts`

**Interfaces:**
- Consumes: `receptionChecksApi.pending`, `CheckStatus` (Task 3)
- Produces: `haccpBadge(status: CheckStatus): { label: string; tone: 'ok' | 'warn' | 'todo' }`

- [ ] **Step 1: Write the failing test**

`src/features/raw-batches/haccpBadge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { haccpBadge } from './haccpBadge'

describe('haccpBadge', () => {
  it('brak wpisu woła o uzupełnienie', () => {
    expect(haccpBadge('brak')).toEqual({ label: 'HACCP: brak', tone: 'todo' })
  })
  it('wpis niepełny jest ostrzeżeniem', () => {
    expect(haccpBadge('niepelne')).toEqual({ label: 'HACCP: niepełne', tone: 'warn' })
  })
  it('komplet nie krzyczy', () => {
    expect(haccpBadge('komplet')).toEqual({ label: 'HACCP', tone: 'ok' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/features/raw-batches/haccpBadge.test.ts
```

Expected: FAIL — brak modułu.

- [ ] **Step 3: Napisz moduł**

`src/features/raw-batches/haccpBadge.ts`:

```ts
/**
 * haccpBadge — znacznik stanu kontroli HACCP w wierszu listy przyjęć.
 *
 * Osobny moduł, bo ten sam znacznik pojawia się w trzech miejscach
 * (lista przyjęć, podgląd dostawy, kafel pulpitu) i nazwy muszą być
 * wszędzie te same — inaczej „brak" na liście i „niepełne" na pulpicie
 * wyglądają jak dwa różne problemy.
 */
import type { CheckStatus } from './receptionCheck'

export function haccpBadge(status: CheckStatus): {
  label: string; tone: 'ok' | 'warn' | 'todo'
} {
  if (status === 'komplet') return { label: 'HACCP', tone: 'ok' }
  if (status === 'niepelne') return { label: 'HACCP: niepełne', tone: 'warn' }
  return { label: 'HACCP: brak', tone: 'todo' }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/features/raw-batches/haccpBadge.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Wepnij znacznik w listę przyjęć**

W `RawBatchesTable.tsx` dodaj kolumnę „HACCP" renderującą `haccpBadge(...)` w stylu istniejącego `StatusBadge`. Stan bierz z jednego zapytania `receptionChecksApi.pending(365)` zmapowanego na `receptionId → status` — nie odpytuj backendu raz na wiersz.

- [ ] **Step 6: Baner po zapisaniu dostawy**

W miejscu, gdzie `RawBatchesPage.tsx` obsługuje udany zapis przyjęcia, pokaż baner:

> „Dostawa zapisana. Uzupełnij kontrolę HACCP" — przycisk prowadzi do `/office/raw-batches/{id}/podglad`.

Baner **nie blokuje** i daje się zamknąć.

- [ ] **Step 7: Kafel na pulpicie**

W `DashboardPage.tsx` dodaj kafel „Przyjęcia bez kompletu HACCP" z liczbą z `receptionChecksApi.pending(14)`, prowadzący do listy przyjęć. Okno 14 dni jest celowe: pulpit pokazuje **stan, nie archiwum**. Kafel z zerem się nie renderuje — pusty licznik na pulpicie to szum.

- [ ] **Step 8: Uruchom testy i zbuduj**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: testy zielone, `tsc` bez błędów.

- [ ] **Step 9: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/raw-batches/haccpBadge.ts \
        kebab_fixed/src/features/raw-batches/haccpBadge.test.ts \
        kebab_fixed/src/features/raw-batches/components/RawBatchesTable.tsx \
        kebab_fixed/src/features/raw-batches/pages/RawBatchesPage.tsx \
        kebab_fixed/src/pages/office/DashboardPage.tsx
git commit -m "feat(haccp): upomnienia o brakującej kontroli (lista, baner, pulpit)"
```

---

## Task 6: Karta 1.1.1 — kolumny f–k

**Files:**
- Modify: `src/lib/receptionRegisterRows.ts`
- Modify: `src/lib/receptionRegisterRows.test.ts`
- Modify: `src/pages/office/ReceptionRegisterPrintPage.tsx`

**Interfaces:**
- Consumes: `Reception` z `@/types`, wpisy z `receptionChecksApi`
- Produces:
  - `export type Cell = string | { png: string }`
  - `mainRows(receptions: Reception[], cols: number, checks?: Record<string, ReceptionCheck>): Cell[][]`

Typ komórki zmienia się już teraz, choć obrazki dochodzą dopiero w Task 12 — inaczej `RegisterSheet` trzeba by przepisywać dwa razy.

- [ ] **Step 1: Write the failing test**

Dopisz do `src/lib/receptionRegisterRows.test.ts`:

```ts
import { mainRows } from './receptionRegisterRows'

const dostawa = {
  id: 'r1', receptionNo: '7/08', receivedDate: '2026-08-14',
  supplierName: 'KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  documentNo: 'WZ 388', hdiNo: '33656',
  batches: [{ internalBatchNo: '471', kgReceived: 1000, status: 'active',
              materialName: 'Ćwiartka z kurczaka', storageState: 'chlodzony' }],
} as any

const wpis = {
  receptionId: 'r1', visual: 'bz', tempChamber: 2.5, tempMeat: 3.1,
  kgMatch: 'bz', notes: 'brak uwag', verdict: 'K',
  ncDescription: '', ncAction: '', ncAt: null,
}

describe('mainRows — kolumny oceny', () => {
  it('bez wpisu kolumny f-k zostają puste', () => {
    const [row] = mainRows([dostawa], 13)
    expect(row.slice(5, 11)).toEqual(['', '', '', '', '', ''])
  })

  it('wpis wypełnia ocenę, temperatury, zgodność, uwagi i kwalifikację', () => {
    const [row] = mainRows([dostawa], 13, { r1: wpis as any })
    expect(row[5]).toBe('b/z')        // f — ocena wizualna
    expect(row[6]).toBe('2,5')        // g — komora
    expect(row[7]).toBe('3,1')        // h — mięso
    expect(row[8]).toBe('b/z')        // i — zgodność kg
    expect(row[9]).toBe('brak uwag')  // j
    expect(row[10]).toBe('K')         // k — kwalifikacja
  })

  it('temperatura 0 °C drukuje się jako „0", nie jako pusta kratka', () => {
    const [row] = mainRows([dostawa], 13, { r1: { ...wpis, tempChamber: 0 } as any })
    expect(row[6]).toBe('0')
  })

  it('ocena N drukuje się jako N', () => {
    const [row] = mainRows([dostawa], 13, { r1: { ...wpis, visual: 'N' } as any })
    expect(row[5]).toBe('N')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/receptionRegisterRows.test.ts
```

Expected: FAIL — `mainRows` przyjmuje dwa argumenty, kolumny f–k są puste.

- [ ] **Step 3: Zmień `mainRows`**

W `src/lib/receptionRegisterRows.ts`:

```ts
/** Komórka karty: tekst albo obrazek podpisu (kolumny l/m karty 1.1.1). */
export type Cell = string | { png: string }

/** 'bz' → „b/z" (tak brzmi legenda karty), 'N' → „N", brak → pusto. */
function ocena(v: string | null | undefined): string {
  if (v === 'bz') return 'b/z'
  return v === 'N' ? 'N' : ''
}

/** Temperatura po polsku. Zero jest POMIAREM, nie brakiem — `plNum`
 *  zwraca dla zera pusty napis, więc tutaj nie da się go użyć. */
function temp(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return v.toLocaleString('pl-PL', { maximumFractionDigits: 1 })
}
```

Zaktualizuj sygnaturę i budowanie wiersza:

```ts
export function mainRows(
  receptions: Reception[],
  cols: number,
  checks: Record<string, ReceptionCheck> = {},
): Cell[][] {
  // …sortowanie i kolumny a-e bez zmian…
      const c = checks[r.id]
      const row: Cell[] = [
        r.receptionNo,
        shortSupplier(r.supplierName),
        assortment.join(', '),
        plDate(r.receivedDate),
        documentLabel(r.hdiNo, r.documentNo),
        ocena(c?.visual),        // f
        temp(c?.tempChamber),    // g
        temp(c?.tempMeat),       // h
        ocena(c?.kgMatch),       // i
        c?.notes ?? '',          // j
        c?.verdict ?? '',        // k
      ]
      return [...row, ...Array(Math.max(0, cols - row.length)).fill('')]
```

**Przepisz nagłówkowy komentarz pliku.** Zdanie *„Tych nie wypełniamy nigdy — nie ma ich skąd wziąć"* przestaje być prawdą i zostawione wprowadzałoby następnego czytelnika w błąd. Nowa treść ma mówić, że kolumny f–k pochodzą z `reception_checks`, a l/m z podpisów.

- [ ] **Step 4: Renderuj komórkę obrazkową**

W `src/pages/office/ReceptionRegisterPrintPage.tsx` zamień treść `<td>`:

```tsx
{cols.map((c, i) => <td key={c.letter}>{renderCell(data[r]?.[i])}</td>)}
```

i dopisz:

```tsx
/** Komórka karty: tekst albo podpis. Obrazek skalujemy do WYSOKOŚCI kratki
 *  (9,5 mm w 1.1.1), żeby podpis nie rozpychał wiersza i karta nadal
 *  mieściła się na jednej kartce. */
function renderCell(cell: Cell | undefined) {
  if (!cell) return ''
  if (typeof cell === 'string') return cell
  return <img className="sig" src={cell.png} alt="" />
}
```

W stałej `CSS` tego pliku dodaj:

```css
.sig { height: 7mm; width: auto; max-width: 100%; object-fit: contain; display: block; margin: 0 auto; }
```

Zmień też typ `data` w `RegisterSheet` ze `string[][]` na `Cell[][]`.

- [ ] **Step 5: Endpoint zakresu dla karty**

`pending` zwraca tylko braki — karcie potrzebny jest **komplet** wpisów miesiąca. Nie rozszerzaj `receptionsApi.list`: ta lista jest używana w pięciu innych miejscach i doładowanie jej wpisami spowolniłoby wszystkie. Osobny endpoint.

Dopisz do `reception_checks_service.py`:

```python
def checks_for_range(date_from: str, date_to: str) -> list:
    """Wpisy kontroli dla zakresu dat — źródło kolumn f-m karty 1.1.1.

    Zwraca też PODPISY, żeby karta miesiąca powstawała z jednego żądania.
    Podpisy unieważnione tu nie docierają: karta ma drukować pustą kratkę,
    a nie podpis pod zmienioną treścią.
    """
    rows = query_all(
        """SELECT r.id, c.visual, c.temp_chamber, c.temp_meat, c.kg_match,
                  c.notes, c.verdict, c.nc_description, c.nc_action, c.nc_at
             FROM receptions r
             JOIN reception_checks c ON c.reception_id = r.id
            WHERE r.received_date BETWEEN %s AND %s""",
        (date_from, date_to),
    )
    podpisy = query_all(
        """SELECT s.doc_id, s.role, s.png, s.signer_name, s.signed_at
             FROM document_signatures s
             JOIN receptions r ON r.id = s.doc_id
            WHERE s.doc_type = 'reception_check'
              AND s.superseded_at IS NULL
              AND r.received_date BETWEEN %s AND %s""",
        (date_from, date_to),
    )
    wg_dostawy: dict = {}
    for p in podpisy:
        wg_dostawy.setdefault(p["doc_id"], {})[p["role"]] = {
            "png": p["png"],
            "signerName": p["signer_name"],
            "signedAt": p["signed_at"].isoformat() if p["signed_at"] else None,
        }
    return [{
        "receptionId": r["id"],
        "visual": r["visual"],
        "tempChamber": _f(r["temp_chamber"]),
        "tempMeat": _f(r["temp_meat"]),
        "kgMatch": r["kg_match"],
        "notes": r["notes"] or "",
        "verdict": r["verdict"],
        "ncDescription": r["nc_description"] or "",
        "ncAction": r["nc_action"] or "",
        "ncAt": r["nc_at"].isoformat() if r["nc_at"] else None,
        "signatures": wg_dostawy.get(r["id"], {}),
    } for r in rows]
```

Trasa w `routes/reception_checks.py` — **przed** `/{reception_id}/check`, obok `haccp-pending`:

```python
@router.get("/haccp-checks")
def haccp_checks(date_from: str = Query("", alias="from"),
                 date_to: str = Query("", alias="to")):
    """Wpisy kontroli i podpisy dla zakresu dat — źródło kolumn f-m."""
    return svc.checks_for_range(date_from, date_to)
```

Klient w `src/lib/api.ts`, do `receptionChecksApi`:

```ts
  /** Wpisy + podpisy dla zakresu — źródło kolumn f-m karty 1.1.1. */
  forRange: (from: string, to: string) =>
    get<any[]>(`/receptions/haccp-checks?from=${from}&to=${to}`),
```

W `RegisterCard` zmapuj wynik na `Record<string, ReceptionCheck & { signatures: … }>` po `receptionId` i podaj jako trzeci argument do `build`. **Kolumna `signatures` jest już teraz częścią kształtu**, choć wypełnia się dopiero w Task 12 — inaczej `RegisterCard` trzeba by przerabiać dwa razy.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/lib/receptionRegisterRows.test.ts
npx tsc --noEmit
```

Expected: wszystkie testy `receptionRegisterRows` zielone, `tsc` czysty.

- [ ] **Step 7: Obejrzyj kartę**

Otwórz `/office/rejestr-przyjecia/druk?dane=1&od=2026-08-01` i sprawdź na oko, że kolumny f–k mają treść, a wiersz nadal ma 9,5 mm i karta mieści się na jednej kartce.

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/lib/receptionRegisterRows.ts kebab_fixed/src/lib/receptionRegisterRows.test.ts \
        kebab_fixed/src/pages/office/ReceptionRegisterPrintPage.tsx \
        kebab_fixed/backend/app/routes/reception_checks.py \
        kebab_fixed/backend/app/services/reception_checks_service.py
git commit -m "feat(haccp): karta 1.1.1 wypełnia kolumny f-k z systemu"
```

**Koniec fazy 1.** Karta drukuje kolumny a–k. Zanim ruszysz dalej, wdroż i sprawdź na produkcji — faza 2 jest niezależna i może poczekać.

---

# FAZA 2 — podpisy elektroniczne

## Task 7: Kanoniczna treść i hash podpisu

**Files:**
- Create: `backend/app/services/signature_hash.py`
- Test: `backend/tests/test_signature_hash.py`

Test **nie** wymaga bazy — nazwa pliku bez sufiksu `_db`, więc uruchamia się w każdym `pytest`.

**Interfaces:**
- Produces:
  - `canonical_payload(reception: dict, check: dict) -> str`
  - `content_hash(reception: dict, check: dict) -> str` (sha256 hex)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_signature_hash.py`:

```python
"""Hash podpisanej treści — serce wiarygodności podpisu elektronicznego.

Zmiana danych po podpisaniu MUSI zmienić hash, inaczej „podpis" jest
obrazkiem, który da się przykleić do dowolnej treści.
Test czysty — bez bazy, uruchamia się zawsze."""
from app.services.signature_hash import canonical_payload, content_hash

REC = {"reception_no": "7/08", "supplier_name": "KOKO",
       "received_date": "2026-08-14", "kg_total": 10000}
CHK = {"visual": "bz", "temp_chamber": 2.5, "temp_meat": 3.1,
       "kg_match": "bz", "notes": "", "verdict": "K",
       "nc_description": "", "nc_action": "", "nc_at": None}


def test_ten_sam_wpis_daje_ten_sam_hash():
    assert content_hash(REC, CHK) == content_hash(dict(REC), dict(CHK))


def test_kolejnosc_kluczy_nie_zmienia_hasha():
    odwrocony = dict(reversed(list(CHK.items())))
    assert content_hash(REC, odwrocony) == content_hash(REC, CHK)


def test_zmiana_temperatury_o_dziesiata_zmienia_hash():
    inny = {**CHK, "temp_meat": 3.2}
    assert content_hash(REC, inny) != content_hash(REC, CHK)


def test_rowne_liczby_w_roznych_zapisach_daja_ten_sam_hash():
    """2.5, '2.50' i Decimal('2.5') to ten sam pomiar. Bez normalizacji
    hash zmieniałby się sam z siebie i unieważniał poprawne podpisy."""
    from decimal import Decimal
    a = content_hash(REC, {**CHK, "temp_chamber": 2.5})
    b = content_hash(REC, {**CHK, "temp_chamber": "2.50"})
    c = content_hash(REC, {**CHK, "temp_chamber": Decimal("2.5")})
    assert a == b == c


def test_brak_pomiaru_rozni_sie_od_zera():
    assert content_hash(REC, {**CHK, "temp_meat": None}) \
        != content_hash(REC, {**CHK, "temp_meat": 0})


def test_zmiana_dostawy_tez_zmienia_hash():
    assert content_hash({**REC, "kg_total": 9000}, CHK) != content_hash(REC, CHK)


def test_kanoniczna_tresc_jest_czytelna():
    """Ma dać się obejrzeć okiem przy sporze — to nie jest pickle."""
    tekst = canonical_payload(REC, CHK)
    assert "reception_no=7/08" in tekst
    assert "temp_meat=3.1" in tekst
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
python3 -m pytest tests/test_signature_hash.py -v
```

Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Napisz moduł**

`backend/app/services/signature_hash.py`:

```python
"""Kanoniczna treść podpisywanego dokumentu i jej sha256.

Po co: podpis elektroniczny bez związania z treścią to obrazek, który da
się przykleić do czegokolwiek. Hash liczony przy składaniu podpisu i
porównywany przy każdej zmianie wpisu sprawia, że poprawienie temperatury
po podpisaniu UNIEWAŻNIA podpis, zamiast po cichu zmienić to, pod czym
ktoś się podpisał.

Kanonizacja musi być STABILNA: 2.5, "2.50" i Decimal("2.5") to ten sam
pomiar. Gdyby hash zależał od zapisu liczby, unieważniałby poprawne
podpisy przy każdym przejściu danych przez JSON.
"""
import hashlib
from decimal import Decimal, InvalidOperation
from typing import Any, Dict

#: Kolejność jest częścią kanonu — nie sortujemy alfabetycznie, żeby
#: tekst dało się przeczytać okiem w tej samej kolejności co karta 1.1.1.
_POLA_DOSTAWY = ("reception_no", "supplier_name", "received_date", "kg_total")
_POLA_KONTROLI = ("visual", "temp_chamber", "temp_meat", "kg_match",
                  "notes", "verdict", "nc_description", "nc_action", "nc_at")
#: Pola liczbowe normalizowane do stałej liczby miejsc po przecinku.
_MIEJSCA = {"kg_total": 3, "temp_chamber": 1, "temp_meat": 1}


def _norm(klucz: str, wartosc: Any) -> str:
    """Brak wartości to PUSTY napis — i musi różnić się od zera.
    „Nie zmierzono" i „zmierzono 0 °C" to dwa różne zdarzenia."""
    if wartosc is None:
        return ""
    if klucz in _MIEJSCA:
        try:
            return f"{Decimal(str(wartosc)):.{_MIEJSCA[klucz]}f}"
        except (InvalidOperation, ValueError):
            return str(wartosc)
    return str(wartosc)


def canonical_payload(reception: Dict[str, Any], check: Dict[str, Any]) -> str:
    linie = [f"{k}={_norm(k, reception.get(k))}" for k in _POLA_DOSTAWY]
    linie += [f"{k}={_norm(k, check.get(k))}" for k in _POLA_KONTROLI]
    return "\n".join(linie)


def content_hash(reception: Dict[str, Any], check: Dict[str, Any]) -> str:
    return hashlib.sha256(
        canonical_payload(reception, check).encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m pytest tests/test_signature_hash.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/services/signature_hash.py \
        kebab_fixed/backend/tests/test_signature_hash.py
git commit -m "feat(podpisy): kanoniczna treść i hash podpisywanego dokumentu"
```

---

## Task 8: Tabele podpisów, uprawnienia pracowników, serwis

**Files:**
- Modify: `backend/app/migrations.py`
- Modify: `backend/tests/conftest.py:_TRUNCATE`
- Modify: `backend/app/models/workers.py`, `backend/app/services/workers_service.py`
- Create: `backend/app/models/signatures.py`, `backend/app/services/signatures_service.py`
- Test: `backend/tests/test_signatures_db.py`

**Interfaces:**
- Consumes: `content_hash` (Task 7), `verify_secret` z `app.utils.passwords`, `_record_failure`/`_reset_failures` z `app.services.auth_service`
- Produces:
  - `save_sample(worker_id: str, png: str, pin: str) -> dict`
  - `get_sample(worker_id: str) -> dict | None`
  - `eligible(role: str) -> list[dict]` — pracownicy z uprawnieniem **i** ze wzorem
  - `sign(doc_type: str, doc_id: str, role: str, worker_id: str, pin: str) -> dict`
  - `signatures_for(doc_type: str, doc_id: str) -> list[dict]` — tylko aktywne
  - `supersede_if_changed(doc_type: str, doc_id: str, new_hash: str) -> int`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_signatures_db.py`:

```python
"""Podpisy elektroniczne: wzór, akt podpisania PIN-em, unieważnianie.

Testy DB — wymagają TEST_DATABASE_URL (patrz conftest), inaczej skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_one
from app.models.reception_checks import ReceptionCheckIn
from app.services.reception_checks_service import save_check
from app.services.signatures_service import (eligible, get_sample, save_sample,
                                              sign, signatures_for)
from app.utils.ids import now_iso
from app.utils.passwords import hash_secret

PNG = "data:image/png;base64,iVBORw0KGgo="


def _pracownik(wid, imie, pin="1234", wykonal=True, sprawdzil=False):
    execute(
        "INSERT INTO workers (id, name, role, pin_hash, active, created_at, "
        "can_sign_performed, can_sign_checked) "
        "VALUES (%s,%s,'WORKER_PRODUCTION',%s,true,%s,%s,%s) "
        "ON CONFLICT (id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, "
        "can_sign_performed=EXCLUDED.can_sign_performed, "
        "can_sign_checked=EXCLUDED.can_sign_checked",
        (wid, imie, hash_secret(pin), now_iso(), wykonal, sprawdzil),
    )
    return wid


def _dostawa(rid="rec-sig"):
    execute(
        "INSERT INTO receptions (id, reception_no, reception_seq, reception_period, "
        "received_date, supplier_id, supplier_name, created_at) "
        "VALUES (%s,'7/08',7,'2026-08','2026-08-14','sup-1','KOKO',%s) "
        "ON CONFLICT (id) DO NOTHING",
        (rid, now_iso()),
    )
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 3.1,
        "kgMatch": "bz", "verdict": "K",
    }))
    return rid


def test_wzor_wymaga_poprawnego_pinu(db):
    w = _pracownik("w-1", "Jan K.")
    with pytest.raises(HTTPException) as e:
        save_sample(w, PNG, "9999")
    assert e.value.status_code in (401, 403)
    assert get_sample(w) is None


def test_wzor_zapisuje_sie_po_poprawnym_pinie(db):
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    assert get_sample(w)["png"] == PNG


def test_ponowny_zapis_nadpisuje_wzor(db):
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    save_sample(w, PNG + "AA", "1234")
    assert query_one(
        "SELECT count(*) AS n FROM signature_samples WHERE worker_id=%s", (w,))["n"] == 1


def test_eligible_pomija_osoby_bez_wzoru(db):
    _pracownik("w-1", "Jan K.")
    z_wzorem = _pracownik("w-2", "Ewa M.")
    save_sample(z_wzorem, PNG, "1234")
    assert [p["id"] for p in eligible("wykonal")] == ["w-2"]


def test_eligible_respektuje_uprawnienie_roli(db):
    w = _pracownik("w-1", "Jan K.", wykonal=True, sprawdzil=False)
    save_sample(w, PNG, "1234")
    assert eligible("sprawdzil") == []


def test_podpis_bez_uprawnienia_odrzucony_mimo_dobrego_pinu(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.", wykonal=True, sprawdzil=False)
    save_sample(w, PNG, "1234")
    with pytest.raises(HTTPException) as e:
        sign("reception_check", rid, "sprawdzil", w, "1234")
    assert e.value.status_code == 403


def test_podpis_kopiuje_wzor_i_nazwisko(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    (p,) = signatures_for("reception_check", rid)
    assert p["signerName"] == "Jan K."
    assert p["png"] == PNG


def test_przerysowanie_wzoru_nie_zmienia_zlozonego_podpisu(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_sample(w, PNG + "ZMIENIONY", "1234")
    (p,) = signatures_for("reception_check", rid)
    assert p["png"] == PNG


def test_zmiana_temperatury_uniewaznia_podpis(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 9.9,
        "kgMatch": "bz", "verdict": "K",
    }))
    assert signatures_for("reception_check", rid) == []
    assert query_one(
        "SELECT count(*) AS n FROM document_signatures WHERE doc_id=%s", (rid,))["n"] == 1


def test_po_uniewaznieniu_da_sie_podpisac_ponownie(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    sign("reception_check", rid, "wykonal", w, "1234")
    save_check(rid, ReceptionCheckIn.model_validate({
        "visual": "bz", "tempChamber": 2.5, "tempMeat": 9.9,
        "kgMatch": "bz", "verdict": "K",
    }))
    sign("reception_check", rid, "wykonal", w, "1234")
    assert len(signatures_for("reception_check", rid)) == 1


def test_zly_pin_nie_tworzy_podpisu(db):
    rid = _dostawa()
    w = _pracownik("w-1", "Jan K.")
    save_sample(w, PNG, "1234")
    with pytest.raises(HTTPException):
        sign("reception_check", rid, "wykonal", w, "0000")
    assert signatures_for("reception_check", rid) == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_signatures_db.py -v
```

Expected: FAIL — brak modułu `app.services.signatures_service`.

- [ ] **Step 3: Dopisz DDL**

Na końcu `_DDL` w `backend/app/migrations.py`:

```python
    # ── Podpisy elektroniczne ──
    #
    # WZÓR rysowany raz, na HMI rozbioru pod kodem serwisowym 0099 — to
    # jedyny dotykowy ekran w zakładzie. Jeden wzór na osobę.
    """CREATE TABLE IF NOT EXISTS signature_samples (
        worker_id  TEXT PRIMARY KEY REFERENCES workers(id) ON DELETE CASCADE,
        png        TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
    )""",
    # AKT PODPISANIA. `png` i `signer_name` są KOPIĄ, nie referencją:
    # przerysowanie wzoru albo odejście pracownika nie może zmienić
    # dokumentu sprzed roku. `content_hash` wiąże podpis z treścią —
    # zmiana danych po podpisaniu ustawia `superseded_at`.
    """CREATE TABLE IF NOT EXISTS document_signatures (
        id            TEXT PRIMARY KEY,
        doc_type      TEXT NOT NULL,
        doc_id        TEXT NOT NULL,
        role          TEXT NOT NULL,
        worker_id     TEXT NOT NULL REFERENCES workers(id),
        signer_name   TEXT NOT NULL,
        png           TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        signed_at     TIMESTAMPTZ NOT NULL,
        superseded_at TIMESTAMPTZ
    )""",
    # Jeden AKTYWNY podpis na (dokument, rola). Indeks częściowy, nie zwykły
    # UNIQUE: unieważnione podpisy zostają jako historia i muszą móc się
    # powtarzać, inaczej ponowne podpisanie po korekcie byłoby niemożliwe.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_document_signatures_active "
    "ON document_signatures (doc_type, doc_id, role) WHERE superseded_at IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_document_signatures_doc "
    "ON document_signatures (doc_type, doc_id)",
    # Uprawnienia podpisu — dwa, bo kolumny l i m karty 1.1.1 znaczą co innego:
    # „wykonał" to magazynier, „sprawdził" to kierownik albo technolog.
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS can_sign_performed BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS can_sign_checked BOOLEAN NOT NULL DEFAULT false",
```

- [ ] **Step 4: Dopisz tabele do `_TRUNCATE`**

W `backend/tests/conftest.py`, **przed** `"workers"`:

```python
    # Podpisy i wzory — czyszczone przed kartoteką pracowników (FK).
    "document_signatures", "signature_samples",
```

- [ ] **Step 5: Rozszerz model i serwis pracowników**

W `backend/app/models/workers.py` do `WorkerCreate`:

```python
    #: Uprawnienia podpisu elektronicznego — kolumny l/m karty 1.1.1.
    #: Rozdzielone, bo „sprawdził" to węższa grupa niż „wykonał".
    can_sign_performed: bool = False
    can_sign_checked: bool = False
```

do `WorkerUpdate`:

```python
    can_sign_performed: Optional[bool] = None
    can_sign_checked: Optional[bool] = None
```

W `workers_service.py` dopisz oba pola do `INSERT` przy tworzeniu oraz do łańcucha `if dto.X is not None:` w aktualizacji, wzorem `is_wrapper`. Dopisz je też do słownika zwracanego przy odczycie pracownika.

- [ ] **Step 6: Napisz model podpisów**

`backend/app/models/signatures.py`:

```python
"""Podpisy elektroniczne — DTO wzoru i aktu podpisania."""
from pydantic import BaseModel, ConfigDict, Field


class SignatureSampleIn(BaseModel):
    """Wzór rysowany na HMI. PIN, nie sam kod serwisowy: 0099 otwiera menu,
    ale nie upoważnia kierownika do narysowania cudzego podpisu."""

    model_config = ConfigDict(populate_by_name=True)

    png: str = Field(..., min_length=32)
    pin: str = Field(..., min_length=1)


class SignIn(BaseModel):
    """Złożenie podpisu pod dokumentem."""

    model_config = ConfigDict(populate_by_name=True)

    doc_type: str = Field(..., alias="docType", min_length=1)
    doc_id: str = Field(..., alias="docId", min_length=1)
    role: str = Field(..., min_length=1)          # 'wykonal' | 'sprawdzil'
    worker_id: str = Field(..., alias="workerId", min_length=1)
    pin: str = Field(..., min_length=1)
```

- [ ] **Step 7: Napisz serwis podpisów**

`backend/app/services/signatures_service.py`:

```python
"""Podpisy elektroniczne: wzór, akt podpisania, unieważnianie.

Trzy zasady, na których stoi wiarygodność:
  * `png` i `signer_name` są KOPIĄ, nie referencją — przerysowanie wzoru
    albo odejście pracownika nie może zmienić dokumentu sprzed roku;
  * `content_hash` wiąże podpis z treścią — zmiana danych po podpisaniu
    unieważnia podpis, zamiast po cichu podmienić to, pod czym ktoś się
    podpisał;
  * akt podpisania wymaga PIN-u, nie samej sesji — zalogowana przeglądarka
    znaczy tylko tyle, że ktoś ją zostawił otwartą.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.auth.lockout import is_locked
from app.services.auth_service import _record_failure, _reset_failures
from app.services.signature_hash import content_hash
from app.utils.ids import cuid, now_iso
from app.utils.passwords import verify_secret

#: Rola na karcie → kolumna uprawnienia. Dwie, bo kolumny l i m karty 1.1.1
#: znaczą co innego: „wykonał" to magazynier, „sprawdził" — kierownik.
ROLE_KOLUMNA = {"wykonal": "can_sign_performed", "sprawdzil": "can_sign_checked"}

#: Wzór 600x200 px waży kilkanaście kB. Większy plik to nie podpis,
#: tylko czyjaś fotografia wysłana pomyłkowo albo złośliwie.
MAX_PNG_BYTES = 200_000


def _pracownik(worker_id: str) -> Dict[str, Any]:
    w = query_one("SELECT * FROM workers WHERE id=%s", (worker_id,))
    if not w or not w["active"]:
        raise HTTPException(404, "Pracownik nie istnieje lub jest nieaktywny")
    return w


def _sprawdz_pin(w: Dict[str, Any], pin: str) -> None:
    if is_locked(w.get("locked_until"), datetime.now(tz=timezone.utc)):
        raise HTTPException(423, "Konto tymczasowo zablokowane")
    if not w.get("pin_hash") or not verify_secret(pin, w["pin_hash"]):
        _record_failure("workers", w["id"], w.get("failed_attempts") or 0)
        raise HTTPException(401, "Nieprawidłowy PIN")
    _reset_failures("workers", w["id"])


def save_sample(worker_id: str, png: str, pin: str) -> Dict[str, Any]:
    """Zapis wzoru. PIN, nie sam kod serwisowy: 0099 otwiera menu, ale nie
    upoważnia kierownika do narysowania cudzego podpisu."""
    if len(png.encode("utf-8")) > MAX_PNG_BYTES:
        raise HTTPException(413, "Wzór podpisu jest za duży")
    w = _pracownik(worker_id)
    _sprawdz_pin(w, pin)
    execute(
        """INSERT INTO signature_samples (worker_id, png, created_at)
           VALUES (%s,%s,%s)
           ON CONFLICT (worker_id) DO UPDATE
             SET png=EXCLUDED.png, created_at=EXCLUDED.created_at""",
        (worker_id, png, now_iso()),
    )
    return {"workerId": worker_id, "png": png}


def get_sample(worker_id: str) -> Optional[Dict[str, Any]]:
    row = query_one(
        "SELECT worker_id, png FROM signature_samples WHERE worker_id=%s", (worker_id,))
    return None if not row else {"workerId": row["worker_id"], "png": row["png"]}


def eligible(role: str) -> List[Dict[str, Any]]:
    """Pracownicy uprawnieni do TEJ roli i mający wzór.

    Bez wzoru nie ma czego nałożyć na kartę, więc taka osoba nie pojawia się
    na liście — dialog tłumaczy wtedy, gdzie wzór narysować.
    """
    kolumna = ROLE_KOLUMNA.get(role)
    if not kolumna:
        raise HTTPException(422, "Nieznana rola podpisu")
    rows = query_all(
        f"""SELECT w.id, w.name, s.png
              FROM workers w
              JOIN signature_samples s ON s.worker_id = w.id
             WHERE w.active = true AND w.{kolumna} = true
             ORDER BY w.name""")
    return [{"id": r["id"], "name": r["name"], "png": r["png"]} for r in rows]


def current_hash(reception_id: str) -> str:
    """Hash AKTUALNEJ treści dostawy razem z wpisem kontroli."""
    row = query_one(
        """SELECT r.reception_no, r.supplier_name, r.received_date,
                  COALESCE((SELECT sum(kg_received) FROM raw_batches
                             WHERE reception_id = r.id
                               AND COALESCE(status,'') <> 'cancelled'), 0) AS kg_total,
                  c.visual, c.temp_chamber, c.temp_meat, c.kg_match, c.notes,
                  c.verdict, c.nc_description, c.nc_action, c.nc_at
             FROM receptions r
             LEFT JOIN reception_checks c ON c.reception_id = r.id
            WHERE r.id = %s""",
        (reception_id,),
    )
    if not row:
        raise HTTPException(404, "Przyjęcie nie istnieje")
    return content_hash(row, row)


def sign(doc_type: str, doc_id: str, role: str,
         worker_id: str, pin: str) -> Dict[str, Any]:
    kolumna = ROLE_KOLUMNA.get(role)
    if not kolumna:
        raise HTTPException(422, "Nieznana rola podpisu")
    if doc_type != "reception_check":
        raise HTTPException(422, "Nieobsługiwany typ dokumentu")

    w = _pracownik(worker_id)
    # Uprawnienie sprawdzamy PRZED PIN-em: filtr listy w interfejsie nie jest
    # kontrolą dostępu, a odmowa nie może zależeć od tego, czy ktoś zna PIN.
    if not w.get(kolumna):
        raise HTTPException(403, "Pracownik nie ma uprawnienia do tego podpisu")
    wzor = get_sample(worker_id)
    if not wzor:
        raise HTTPException(400, "Pracownik nie ma wzoru podpisu")
    _sprawdz_pin(w, pin)

    h = current_hash(doc_id)
    # Podpis pod NIEAKTUALNĄ treścią nie ma sensu — najpierw sprzątamy.
    supersede_if_changed(doc_type, doc_id, h)
    execute(
        """INSERT INTO document_signatures
             (id, doc_type, doc_id, role, worker_id, signer_name, png,
              content_hash, signed_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (cuid(), doc_type, doc_id, role, worker_id, w["name"], wzor["png"],
         h, now_iso()),
    )
    return {"docType": doc_type, "docId": doc_id, "role": role,
            "signerName": w["name"], "png": wzor["png"]}


def signatures_for(doc_type: str, doc_id: str) -> List[Dict[str, Any]]:
    """Tylko AKTYWNE podpisy. Unieważnione zostają w bazie jako historia,
    ale nie mają prawa trafić ani na ekran, ani na kartę."""
    rows = query_all(
        """SELECT role, signer_name, png, signed_at
             FROM document_signatures
            WHERE doc_type=%s AND doc_id=%s AND superseded_at IS NULL
            ORDER BY signed_at""",
        (doc_type, doc_id),
    )
    return [{"role": r["role"], "signerName": r["signer_name"], "png": r["png"],
             "signedAt": r["signed_at"].isoformat() if r["signed_at"] else None}
            for r in rows]


def supersede_if_changed(doc_type: str, doc_id: str, new_hash: str) -> int:
    """Unieważnia aktywne podpisy, których treść się rozjechała.

    Nie kasujemy wierszy: ślad, że ktoś podpisał POPRZEDNIĄ wersję, jest
    częścią historii dokumentu i przy sporze bywa najważniejszy.
    """
    rows = query_all(
        "SELECT id FROM document_signatures WHERE doc_type=%s AND doc_id=%s "
        "AND superseded_at IS NULL AND content_hash <> %s",
        (doc_type, doc_id, new_hash),
    )
    for r in rows:
        execute("UPDATE document_signatures SET superseded_at=%s WHERE id=%s",
                (now_iso(), r["id"]))
    return len(rows)
```

**Uwaga o `current_hash`:** przekazuje ten sam `row` jako dostawę i jako wpis, bo `signature_hash` wybiera pola po nazwie i nazwy nie kolidują. Gdyby kiedyś skolidowały, rozdziel na dwa słowniki — testy hasha to wychwycą.

- [ ] **Step 8: Wepnij unieważnianie w zapis wpisu**

Na końcu `save_check()` w `reception_checks_service.py`, po `UPSERT`:

```python
    # Zmiana danych po podpisaniu UNIEWAŻNIA podpis. Wiersze zostają
    # (historia), ale karta ich nie drukuje, a ekran żąda podpisania od nowa.
    from app.services.signatures_service import supersede_if_changed, current_hash
    supersede_if_changed("reception_check", reception_id, current_hash(reception_id))
```

Import lokalny, nie na górze pliku — `signatures_service` importuje `reception_checks_service` po `current_hash`, a import cykliczny na poziomie modułu wywróci start aplikacji.

- [ ] **Step 9: Zbuduj schemat i uruchom testy**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -c "from app.migrations import run_migrations; run_migrations()"
docker exec kebab-op psql -U postgres -d kebab_mes_test -c "\d document_signatures"
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_signatures_db.py tests/test_reception_checks_db.py -v
```

Expected: 11 + 6 passed. Sprawdź w `\d`, że indeks częściowy `uq_document_signatures_active` istnieje — bez niego test ponownego podpisania przechodzi z niewłaściwego powodu.

- [ ] **Step 10: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/migrations.py kebab_fixed/backend/tests/conftest.py \
        kebab_fixed/backend/app/models/workers.py kebab_fixed/backend/app/services/workers_service.py \
        kebab_fixed/backend/app/models/signatures.py \
        kebab_fixed/backend/app/services/signatures_service.py \
        kebab_fixed/backend/app/services/reception_checks_service.py \
        kebab_fixed/backend/tests/test_signatures_db.py
git commit -m "feat(podpisy): tabele, uprawnienia i serwis podpisów elektronicznych"
```

---

## Task 9: API podpisów + dostęp dla kiosku

**Files:**
- Create: `backend/app/routes/signatures.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/auth/permissions.py`
- Test: `backend/tests/test_signature_permissions.py`

**Interfaces:**
- Produces:
  - `GET /api/signatures/eligible?role=wykonal`
  - `POST /api/signatures`
  - `GET /api/signatures/doc?docType=…&docId=…`
  - `GET|PUT /api/signature-samples/{worker_id}`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_signature_permissions.py` (czysty, bez bazy):

```python
"""Kto dosięga tras podpisu. Warstwa prefiksów jest DEFAULT-DENY: nowy
endpoint bez wpisu dostaje „office", a kiosk rozbioru dostaje 403 — wzoru
nie dałoby się narysować na jedynym dotykowym ekranie w zakładzie."""
from app.auth.permissions import can_access, permission_for_path

KIOSK = {"kind": "operator", "departments": ["rozbior"]}
BIURO = {"kind": "office", "role": "office"}


def test_wzory_dostepne_dla_kiosku_rozbioru():
    p = permission_for_path("/api/signature-samples/w-1", "PUT")
    assert can_access(KIOSK, p)


def test_wzory_dostepne_tez_dla_biura():
    p = permission_for_path("/api/signature-samples/w-1", "GET")
    assert can_access(BIURO, p)


def test_skladanie_podpisu_zostaje_w_biurze():
    p = permission_for_path("/api/signatures", "POST")
    assert can_access(BIURO, p)
    assert not can_access(KIOSK, p)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python3 -m pytest tests/test_signature_permissions.py -v
```

Expected: FAIL — `test_wzory_dostepne_dla_kiosku_rozbioru`, bo domyślne `"office"` odcina operatora.

- [ ] **Step 3: Dopisz regułę uprawnień**

W `backend/app/auth/permissions.py`, w `permission_for_path`, obok reguł `/api/meat-pallets`:

```python
    # Wzory podpisów: rysuje je HALA (menu serwisowe kiosku rozbioru pod
    # kodem 0099 — jedyny dotykowy ekran w zakładzie), a podgląd wzoru
    # potrzebny jest też biuru w dialogu podpisu. Reguła działowa daje
    # jedno i drugie. SAMO złożenie podpisu zostaje przy domyślnym
    # „office" — dokument podpisuje się z biura.
    if _matches(path, "/api/signature-samples"):
        return "rozbior"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m pytest tests/test_signature_permissions.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Napisz trasy**

`backend/app/routes/signatures.py` — dwa routery (`/api/signatures`, `/api/signature-samples`) opakowujące funkcje serwisu z Task 8. Kolejność w `/api/signatures`: `/eligible` i `/doc` **przed** ewentualnymi trasami z parametrem.

Zarejestruj oba w `backend/app/main.py`.

- [ ] **Step 6: Sprawdź trasy**

```bash
python3 -c "
from app.main import app
for r in app.routes:
    p = getattr(r, 'path', '')
    if 'signature' in p: print(r.methods, p)
"
```

Expected: cztery trasy z bloku **Interfaces**.

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/backend/app/routes/signatures.py kebab_fixed/backend/app/main.py \
        kebab_fixed/backend/app/auth/permissions.py \
        kebab_fixed/backend/tests/test_signature_permissions.py
git commit -m "feat(podpisy): API podpisów i wzorów, dostęp dla kiosku rozbioru"
```

---

## Task 10: `SignaturePad` — pole rysowania

**Files:**
- Create: `src/features/signatures/signatureImage.ts`
- Create: `src/features/signatures/SignaturePad.tsx`
- Test: `src/features/signatures/signatureImage.test.ts`

**Interfaces:**
- Produces:
  - `bounds(data: Uint8ClampedArray, w: number, h: number): { x0, y0, x1, y1 } | null`
  - `isBlank(...)` — `bounds() === null`
  - `<SignaturePad onChange={(png: string | null) => void} />`

Logika obrazkowa siedzi w **czystym** module, bo canvas w vitest nie renderuje — testujemy matematykę, nie przeglądarkę.

- [ ] **Step 1: Write the failing test**

`src/features/signatures/signatureImage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bounds, isBlank } from './signatureImage'

/** Płótno RGBA wypełnione przezroczystością, z zamalowanymi pikselami. */
function plotno(w: number, h: number, piksele: [number, number][]) {
  const d = new Uint8ClampedArray(w * h * 4)
  for (const [x, y] of piksele) d[(y * w + x) * 4 + 3] = 255
  return d
}

describe('bounds', () => {
  it('puste płótno nie ma zawartości', () => {
    expect(bounds(plotno(10, 10, []), 10, 10)).toBe(null)
  })
  it('jeden piksel daje ramkę o zerowej rozpiętości', () => {
    expect(bounds(plotno(10, 10, [[4, 6]]), 10, 10)).toEqual({ x0: 4, y0: 6, x1: 4, y1: 6 })
  })
  it('ramka obejmuje skrajne piksele', () => {
    const d = plotno(10, 10, [[2, 3], [7, 8], [5, 1]])
    expect(bounds(d, 10, 10)).toEqual({ x0: 2, y0: 1, x1: 7, y1: 8 })
  })
  it('piksel przezroczysty się nie liczy', () => {
    const d = plotno(10, 10, [[4, 4]])
    d[(4 * 10 + 4) * 4 + 3] = 0
    expect(bounds(d, 10, 10)).toBe(null)
  })
})

describe('isBlank', () => {
  it('puste płótno jest puste', () => {
    expect(isBlank(plotno(10, 10, []), 10, 10)).toBe(true)
  })
  it('płótno z rysunkiem nie jest puste', () => {
    expect(isBlank(plotno(10, 10, [[1, 1]]), 10, 10)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/features/signatures/signatureImage.test.ts
```

Expected: FAIL — brak modułu.

- [ ] **Step 3: Napisz moduł**

`src/features/signatures/signatureImage.ts`:

```ts
/**
 * signatureImage — matematyka rysunku podpisu, bez DOM.
 *
 * Wzór przycinamy do ramki rysunku, zanim trafi na serwer: człowiek rysuje
 * w lewym górnym rogu wielkiego pola, a na karcie 1.1.1 kratka ma 18 mm
 * szerokości i 9,5 mm wysokości. Bez przycięcia podpis byłby znaczkiem
 * w rogu białej plamy.
 *
 * Czysta funkcja, bo canvas w vitest nie renderuje — sprawdzamy matematykę,
 * nie przeglądarkę.
 */
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

/** Ramka niepustych (nieprzezroczystych) pikseli albo null dla pustego płótna. */
export function bounds(data: Uint8ClampedArray, w: number, h: number): Bounds | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] === 0) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

export function isBlank(data: Uint8ClampedArray, w: number, h: number): boolean {
  return bounds(data, w, h) === null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/features/signatures/signatureImage.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Napisz komponent**

`src/features/signatures/SignaturePad.tsx` — `<canvas>` + Pointer Events (`onPointerDown/Move/Up`, `setPointerCapture`), przyciski „Wyczyść" i „Zapisz wzór".

Wymagania:
- **Zero bibliotek zewnętrznych** — CSP w Tauri zabija inline i obce źródła.
- `touch-action: none` na canvasie, inaczej palec przewija stronę zamiast rysować.
- Rysowanie w układzie urządzenia: przelicz `clientX/Y` przez `getBoundingClientRect()` i `devicePixelRatio`; nie zakładaj, że CSS-owy rozmiar canvasa równa się jego atrybutom `width`/`height`.
- Grubość linii ~2,5 px przy DPR 1, `lineCap: 'round'`, `lineJoin: 'round'` — inaczej podpis wygląda jak wykres.
- Przy zapisie: pobierz `getImageData`, policz `bounds`, przerysuj wycinek na płótno **600×200** z 8 px marginesu, wyeksportuj `toDataURL('image/png')`. Pusty rysunek (`isBlank`) → `onChange(null)` i komunikat „Najpierw narysuj podpis".

- [ ] **Step 6: Sprawdź kompilację**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: czysto.

- [ ] **Step 7: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/signatures/
git commit -m "feat(podpisy): pole rysowania wzoru (canvas, bez bibliotek)"
```

---

## Task 11: Wzory podpisów w menu serwisowym kiosku

**Files:**
- Create: `src/features/signatures/SignatureSamplesScreen.tsx`
- Modify: `src/features/deboning/ServiceMenu.tsx`
- Modify: `src/lib/api.ts` (`signaturesApi`)

**Interfaces:**
- Consumes: `SignaturePad` (Task 10), `GET|PUT /api/signature-samples/{workerId}` (Task 9)
- Produces: `signaturesApi.{sample, saveSample, eligible, sign, forDoc}`

- [ ] **Step 1: Dopisz klienta API**

W `src/lib/api.ts`:

```ts
/** Podpisy elektroniczne. Wzór rysuje się na HMI rozbioru (menu serwisowe
 *  0099), sam podpis składa się w biurze — patrz auth/permissions.py. */
export const signaturesApi = {
  sample: (workerId: string) =>
    get<{ png: string } | null>(`/signature-samples/${encodeURIComponent(workerId)}`),

  saveSample: (workerId: string, png: string, pin: string) =>
    put<any>(`/signature-samples/${encodeURIComponent(workerId)}`, { png, pin }),

  eligible: (role: 'wykonal' | 'sprawdzil') =>
    get<any[]>(`/signatures/eligible?role=${role}`),

  sign: (dto: { docType: string; docId: string; role: string; workerId: string; pin: string }) =>
    post<any>('/signatures', dto),

  forDoc: (docType: string, docId: string) =>
    get<any[]>(`/signatures/doc?docType=${encodeURIComponent(docType)}&docId=${encodeURIComponent(docId)}`),
}
```

- [ ] **Step 2: Napisz ekran wzorów**

`src/features/signatures/SignatureSamplesScreen.tsx` — **nakładka na pełny ekran**, nie zawartość modalu serwisowego: panel menu ma 380 px, a pole rysowania się w nim nie mieści.

Przepływ: lista pracowników (`workersApi.list`, tylko aktywni) → wybór osoby → PIN → `SignaturePad` → „Zapisz wzór" → potwierdzenie i powrót do listy, żeby kierownik mógł wywołać następną osobę bez zamykania ekranu. Osoba, która ma już wzór, ma przy nazwisku miniaturę i podpis „Zmień wzór".

- [ ] **Step 3: Dodaj kafel do menu serwisowego**

W `src/features/deboning/ServiceMenu.tsx`, w sekcji renderowanej po `ok === true`, dołóż kafel „Wzory podpisów" (ikona `PenLine` z `lucide-react`, tak jak `Printer`/`History` obok) otwierający `SignatureSamplesScreen`.

- [ ] **Step 4: Sprawdź w przeglądarce**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npm run dev
```

Otwórz kiosk rozbioru w przeglądarce, przytrzymaj tytuł ekranu 3 s, wpisz `0099`, wejdź w „Wzory podpisów", narysuj myszą i zapisz. Sprawdź w bazie:

```bash
docker exec kebab-op psql -U postgres -d kebab_mes -c \
  "SELECT worker_id, length(png) FROM signature_samples"
```

Expected: wiersz z długością rzędu kilkunastu tysięcy znaków.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/signatures/SignatureSamplesScreen.tsx \
        kebab_fixed/src/features/deboning/ServiceMenu.tsx kebab_fixed/src/lib/api.ts
git commit -m "feat(podpisy): wzory podpisów w menu serwisowym kiosku (0099)"
```

---

## Task 12: Dialog podpisu w biurze + karta 1.1.1 kolumny l–m

**Files:**
- Create: `src/features/signatures/SignDialog.tsx`
- Modify: `src/features/raw-batches/components/ReceptionCheckCard.tsx`
- Modify: `src/lib/receptionRegisterRows.ts`
- Test: `src/features/signatures/signDialog.test.tsx`

**Interfaces:**
- Consumes: `signaturesApi` (Task 11), `Cell` (Task 6)
- Produces: `<SignDialog docType docId role onSigned />`

- [ ] **Step 1: Write the failing test**

`src/features/signatures/signDialog.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const eligible = vi.fn()
const sign = vi.fn()
vi.mock('@/lib/apiClient', () => ({
  signaturesApi: { eligible: (...a: any[]) => eligible(...a), sign: (...a: any[]) => sign(...a) },
}))

import { SignDialog } from './SignDialog'

beforeEach(() => {
  eligible.mockReset(); sign.mockReset()
  eligible.mockResolvedValue([{ id: 'w-1', name: 'Jan K.', png: 'data:image/png;base64,AA' }])
  sign.mockResolvedValue({ signerName: 'Jan K.' })
})

describe('SignDialog', () => {
  it('pokazuje tylko uprawnionych do tej roli', async () => {
    render(<SignDialog docType="reception_check" docId="r1" role="sprawdzil" onSigned={() => {}} />)
    await waitFor(() => expect(eligible).toHaveBeenCalledWith('sprawdzil'))
  })

  it('brak uprawnionych tłumaczy, gdzie narysować wzór', async () => {
    eligible.mockResolvedValue([])
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal" onSigned={() => {}} />)
    expect(await screen.findByText(/0099/)).toBeTruthy()
  })

  it('podpisanie wysyła PIN i identyfikator osoby', async () => {
    const user = userEvent.setup()
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal" onSigned={() => {}} />)
    await user.click(await screen.findByText('Jan K.'))
    await user.type(screen.getByLabelText(/PIN/i), '1234')
    await user.click(screen.getByRole('button', { name: /Podpisz/i }))
    await waitFor(() => expect(sign).toHaveBeenCalled())
    expect(sign.mock.calls[0][0]).toMatchObject({
      docType: 'reception_check', docId: 'r1', role: 'wykonal',
      workerId: 'w-1', pin: '1234',
    })
  })

  it('zły PIN pokazuje błąd i nie zamyka dialogu', async () => {
    const user = userEvent.setup()
    sign.mockRejectedValue(new Error('Nieprawidłowy PIN'))
    const onSigned = vi.fn()
    render(<SignDialog docType="reception_check" docId="r1" role="wykonal" onSigned={onSigned} />)
    await user.click(await screen.findByText('Jan K.'))
    await user.type(screen.getByLabelText(/PIN/i), '0000')
    await user.click(screen.getByRole('button', { name: /Podpisz/i }))
    expect(await screen.findByText(/Nieprawidłowy PIN/i)).toBeTruthy()
    expect(onSigned).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/features/signatures/signDialog.test.tsx
```

Expected: FAIL — brak modułu `./SignDialog`.

- [ ] **Step 3: Napisz dialog**

`src/features/signatures/SignDialog.tsx`: lista uprawnionych z miniaturą wzoru → wybór → pole PIN (`inputMode="numeric"`, `type="password"`) → „Podpisz".

- Pusta lista: *„Brak osób z wzorem podpisu. Narysuj wzór na HMI rozbioru: przytrzymaj 3 s, kod 0099, «Wzory podpisów»."*
- Błąd z backendu renderuje się w dialogu; dialog **zostaje otwarty**.
- Jeśli wybrana osoba podpisała już drugą rolę tego dokumentu, pokaż ostrzeżenie „Ta sama osoba podpisze wykonanie i sprawdzenie" z możliwością kontynuowania — właściciel świadomie nie chciał blokady.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/features/signatures/signDialog.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Wepnij podpisy w sekcję HACCP**

W `ReceptionCheckCard.tsx` dodaj dwa sloty: „Wykonał" i „Sprawdził". Slot pusty pokazuje przycisk „Podpisz", slot wypełniony — obrazek, nazwisko i datę. Po zapisie wpisu, który unieważnił podpisy, sloty wracają do stanu pustego z uwagą: *„Dane zmieniono po podpisaniu — wymagany ponowny podpis."*

- [ ] **Step 6: Kolumny l–m karty**

W `mainRows` dopisz dwie komórki na końcu wiersza. Podpisy przyszły już z `checks` (Task 6 Step 5) — **nie** dokładaj drugiego zapytania:

```ts
        podpis(c?.signatures?.wykonal),    // l
        podpis(c?.signatures?.sprawdzil),  // m
```

```ts
/** Podpis na karcie: obrazek albo PUSTA kratka. Podpis unieważniony
 *  (dane zmieniono po podpisaniu) nie dociera tu wcale — backend zwraca
 *  tylko aktywne. Pusta kratka jest uczciwa; podpis pod zmienioną treścią
 *  nie jest. */
function podpis(sig?: { png: string }): Cell {
  return sig ? { png: sig.png } : ''
}
```

Karta 1.1.1/2 (`detailRows`) dostaje w kolumnie „Podpis" podpis **„wykonał"** z przyjęcia, powtórzony przy każdym numerze porządkowym tej dostawy — dokładnie jak na papierze.

- [ ] **Step 7: Testy i wygląd**

```bash
npx vitest run
npx tsc --noEmit
```

Otwórz `/office/rejestr-przyjecia/druk?dane=1&od=2026-08-01` i sprawdź, że podpisy mieszczą się w kratce, a karta nadal jest jednostronicowa.

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/signatures/SignDialog.tsx \
        kebab_fixed/src/features/signatures/signDialog.test.tsx \
        kebab_fixed/src/features/raw-batches/components/ReceptionCheckCard.tsx \
        kebab_fixed/src/lib/receptionRegisterRows.ts
git commit -m "feat(podpisy): dialog podpisu w biurze i kolumny l-m karty 1.1.1"
```

---

## Task 13: Uprawnienia w panelu Pracownicy

**Files:**
- Modify: `src/pages/office/WorkersPage.tsx`

- [ ] **Step 1: Dodaj dwa checkboxy**

W formularzu pracownika, obok `is_wrapper`:

- „Podpis: wykonał" → `canSignPerformed`
- „Podpis: sprawdził" → `canSignChecked`

Podpowiedź pod polami: *„Uprawnienie decyduje, w której kolumnie karty 1.1.1 osoba może się podpisać. «Sprawdził» to kierownik albo technolog."*

- [ ] **Step 2: Sprawdź obieg do bazy**

```bash
npm run dev
```

Zaznacz oba uprawnienia u testowego pracownika, zapisz, potem:

```bash
docker exec kebab-op psql -U postgres -d kebab_mes -c \
  "SELECT name, can_sign_performed, can_sign_checked FROM workers WHERE can_sign_performed"
```

Expected: pracownik z `t`/`t`. Jeśli kolumny zostały na `f`, `workers_service.update` nie przenosi pól — popraw Task 8 Step 5.

- [ ] **Step 3: Testy i typy**

```bash
npx vitest run && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/pages/office/WorkersPage.tsx
git commit -m "feat(podpisy): uprawnienia podpisu w kartotece pracowników"
```

---

## Task 14: Wydanie — backend, biuro, kiosk

**Files:**
- Modify: `kebab_fixed/src-tauri/tauri.conf.json` (wersja kiosku rozbioru)

- [ ] **Step 1: Diff produkcja ↔ repo**

**OBOWIĄZKOWO przed deployem.** Zmiany istniejące tylko na produkcji trzeba najpierw scommitować do `main` — inaczej deploy je nadpisze.

```bash
cd /opt/kebab/kebab_new/kebab_fixed
rsync -avn --delete backend/app/ root@91.98.105.107:/opt/kebab/app/
```

`-n` to przebieg próbny: nic nie kopiuje, tylko wypisuje, co by się zmieniło. Każdy plik, który produkcja ma inaczej niż repo, wymaga decyzji **przed** deployem — jeśli to poprawka zrobiona kiedyś prosto na serwerze, najpierw ściągnij ją i scommituj do `main`.

Jeśli `deploy/proba_generalna.sh` pokrywa ten krok, użyj go zamiast ręcznego `rsync`.

- [ ] **Step 2: Pełny zestaw testów**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run
npx tsc --noEmit
cd backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest -v
```

Expected: wszystko zielone. **Policz pominięte testy** — każdy `SKIPPED` z rodziny `*_db` oznacza, że `TEST_DATABASE_URL` nie doszedł i nic nie zostało sprawdzone.

- [ ] **Step 3: Merge do main i deploy backendu**

```bash
cd /opt/kebab/kebab_new
git checkout main && git merge --no-ff feature/przyjecie-haccp-podpisy
git push origin main
```

Poczekaj na zielone CI (bramka `deploy.sh` i tak sprawdza czyste drzewo, `origin` oraz status CI), potem uruchom `deploy/deploy.sh`.

- [ ] **Step 4: Zweryfikuj migracje DANYMI, nie logiem**

`run_migrations()` połyka błędy pojedynczych instrukcji.

```bash
ssh root@91.98.105.107 "docker exec kebab-op psql -U postgres -d kebab_mes -c '\
  \d reception_checks' -c '\d document_signatures' -c '\d signature_samples'"
```

Expected: trzy tabele i indeks częściowy `uq_document_signatures_active`.

- [ ] **Step 5: Restart, nie reload**

Reload cicho serwuje stary kod. Zrestartuj backend i sprawdź:

```bash
curl -s https://<host>/api/receptions/haccp-pending?days=14 -H "Authorization: Bearer …" | head
```

- [ ] **Step 6: Wydanie kiosku rozbioru**

Bez tego hala **nie zobaczy** „Wzorów podpisów" — kiosk ma frontend wbudowany.

1. Podbij wersję w `src-tauri/tauri.conf.json` (bump **obowiązkowy**).
2. Zbuduj i otaguj z `main`: `rozbior-v10-<wersja>`.
3. Opublikuj na kanale `rozbior-v10` i sprawdź, że `latest.json` naprawdę pokazuje nową wersję — zielony build to jeszcze nie publikacja, stary adres potrafi przekierować, a `curl` bez `-L` gubi POST.
4. Na panelu: przytrzymaj 3 s → `0099` → sprawdź, że kafel „Wzory podpisów" jest widoczny.

- [ ] **Step 7: Próba na żywo**

Zarejestruj testową dostawę, uzupełnij kontrolę HACCP, podpisz obie role, wydrukuj `/office/rejestr-przyjecia/druk?dane=1`. Potem zmień temperaturę i sprawdź, że podpisy zniknęły z karty, a ekran żąda ponownego podpisu.

- [ ] **Step 8: Commit i tag**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src-tauri/tauri.conf.json
git commit -m "chore(kiosk): wydanie z wzorami podpisów w menu serwisowym"
git tag rozbior-v10-<wersja> && git push origin main --tags
```

---

## Przegląd planu względem specu

| Wymaganie specu | Zadanie |
|---|---|
| Tabela `reception_checks`, osobna od `receptions` | 1 |
| API wpisu, pusty szkic zamiast 404 | 2 |
| Lista braków, okno 14 dni | 2, 5 |
| Progi z `progPrzyjecia`, brak blokady zapisu | 3, 4 |
| Sekcja HACCP w formularzu, działanie korygujące przy N | 3, 4 |
| Ocena N → pytanie o anulowanie, bez automatu | 4 |
| Upomnienia: baner, znacznik, kafel | 5 |
| Karta 1.1.1 kolumny f–k | 6 |
| `content_hash`, kanonizacja stabilna | 7 |
| Tabele podpisów, kopia png i nazwiska, indeks częściowy | 8 |
| Unieważnianie podpisu po zmianie danych | 8 |
| Dwa uprawnienia, sprawdzane po stronie backendu | 8, 9, 13 |
| Dostęp kiosku do wzorów | 9 |
| `SignaturePad` bez bibliotek, normalizacja 600×200 | 10 |
| Wzory w menu serwisowym 0099, nakładka pełnoekranowa | 11 |
| Dialog podpisu z PIN-em, ostrzeżenie o tej samej osobie | 12 |
| Kolumny l–m, podpis unieważniony się nie drukuje | 12 |
| Karta 1.1.1/2 kolumna „Podpis" | 12 |
| Wydanie kiosku (bump + tag) | 14 |
