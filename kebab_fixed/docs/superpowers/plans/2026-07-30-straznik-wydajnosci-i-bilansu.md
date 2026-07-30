# Strażnik wydajności pobrania i bilansu ubocznych — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zatrzymać na kiosku wpisy o fizycznie niemożliwej wydajności (twardy blok 60–71%) i ostrzec przed nadmiarem ubocznych, żeby błąd nie trafiał do biura ani do raportów.

**Architecture:** Walidacja mieszka w backendzie (`deboning_service`) jako czysta funkcja wołana z dwóch ścieżek kiosku — zapisu „od razu" i domknięcia pobrania. Furtka serwisowa to flaga `overrideYield` w DTO (wzorzec skopiowany z istniejącego `overrideWeighings`), a jej użycie ląduje w `deboning_entry_corrections` jako ślad audytowy. Kiosk lustrzanie pokazuje komunikat i pyta o kod 0099. Uboczne dostają ostrzeżenie w kreatorze plus usuwanie pojedynczej palety.

**Tech Stack:** FastAPI + psycopg2, pytest; React + TypeScript + Vite; Tauri (kiosk hali).

## Global Constraints

- Pasmo wydajności: **60,0%–71,0% włącznie**. Poza nim zapis odrzucony (HTTP 400).
- Zwolnienie: pobrania **< 30 kg ćwiartki** nie podlegają sprawdzeniu.
- Furtka: flaga `overrideYield` (alias `override_yield`), na kiosku odblokowana kodem **0099** (`SERVICE_CODE` w `src/features/deboning/ServiceMenu.tsx`).
- Próg ostrzeżenia bilansu ubocznych: **103%**.
- Ścieżka biura (`correct_deboning_entry`) **NIE** dostaje nowego pasma — zostaje przy `validate_meat_yield` (30–95%), bo biuro rekonstruuje dane i ma własny ślad + `overrideWeighings`.
- Testy DB wymagają `TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test` — bez tego cicho się pomijają.
- Deploy backendu = kopiowanie plików + **restart** `kebab-mes` (reload nie przeładowuje kodu).

## Kontekst historyczny — przeczytaj przed Task 1

Górny pułap uzysku **już kiedyś istniał** (95%) i został usunięty z domknięcia pobrania 2026-07-24, bo zakleszczał wpis w `pending` — patrz docstring `validate_take_completion` (linia 731). Powodem był wpis ANATOLII 290,5/300 = 96,8%, opisany wtedy jako „realnie wysoki uzysk dowiezionej reszty".

**To była błędna diagnoza.** `deboning_entry_corrections` pokazuje, że ten sam wpis został tego samego dnia poprawiony na 197,0 kg z powodem „blad". Strażnik miał rację — zabrakło mu tylko furtki, więc usunięto strażnika zamiast dodać furtkę. Po usunięciu ta sama klasa błędu wróciła: 442 (298,5→198,5), 443 (150,0→98,0), 444 (231,0→197,0).

Dlatego Task 2 dodaje furtkę **razem** z progiem. Nie wolno wdrożyć progu bez furtki.

## Struktura plików

| Plik | Odpowiedzialność |
|---|---|
| `backend/app/services/deboning_service.py` | czysta walidacja pasma + wpięcie w 2 ścieżki kiosku + ślad furtki |
| `backend/app/models/deboning.py` | flagi `override_yield` w DTO zapisu i domknięcia |
| `backend/app/routes/deboning.py` | endpoint raportu odchyleń (DTO idą w całości, więc reszta bez zmian) |
| `backend/tests/test_deboning_yield.py` | testy czystej funkcji (bez DB) |
| `backend/tests/test_deboning_takes_db.py` | testy ścieżek zapisu i furtki (DB) |
| `src/features/deboning/utils/weighing.ts` | lustro progów + `yieldBandError()` dla kiosku |
| `src/pages/tablet/DeboningHmiV10Page.tsx` | modal „kod serwisowy" po odrzuceniu zapisu |
| `src/features/deboning/ByproductsWizard.tsx` | ostrzeżenie >103% + usuwanie pojedynczej palety |
| `src/pages/office/DeboningReportsPage.tsx` | zakładka „Odchylenia" |
| `src-tauri/tauri.rozbior-v10.conf.json` | bump wersji kiosku 1.0.70 → 1.0.71 |

---

### Task 1: Czysta walidacja pasma wydajności

**Files:**
- Modify: `backend/app/services/deboning_service.py` (po `_kg`, linia ~763)
- Test: `backend/tests/test_deboning_yield.py`

**Interfaces:**
- Produces: `validate_yield_band(kg_taken: float, kg_meat: float, override: bool = False) -> str | None`, stałe `YIELD_BAND_MIN_PCT = 60.0`, `YIELD_BAND_MAX_PCT = 71.0`, `YIELD_GUARD_MIN_TAKE_KG = 30.0`

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `backend/tests/test_deboning_yield.py`:

```python
from app.services.deboning_service import (
    YIELD_BAND_MAX_PCT,
    YIELD_BAND_MIN_PCT,
    validate_yield_band,
)


# ── Twarde pasmo wydajności (60–71%) ──────────────────────────────────
def test_pasmo_przepuszcza_typowa_wydajnosc():
    assert validate_yield_band(300.0, 198.0) is None  # 66,0%


def test_pasmo_blokuje_wpis_ze_zla_tara_wozka():
    """442/ANATOLII: 298,5 kg mięsa z 300 kg ćwiartki = 99,5%.
    Różnica do prawdy (198,5) to waga wózka."""
    err = validate_yield_band(300.0, 298.5)
    assert err is not None
    assert "99,5%" in err
    assert "wózek" in err


def test_pasmo_blokuje_rowne_sto_procent():
    """443/SERHII: 150/150. Stary warunek kgMeat>kgQuarter tego NIE łapał."""
    assert validate_yield_band(150.0, 150.0) is not None


def test_pasmo_blokuje_zbyt_niska_wydajnosc():
    err = validate_yield_band(150.0, 82.5)  # 55,0%
    assert err is not None
    assert "zważone" in err


def test_granice_pasma_sa_domkniete():
    assert validate_yield_band(100.0, YIELD_BAND_MIN_PCT) is None   # dokładnie 60,0%
    assert validate_yield_band(100.0, YIELD_BAND_MAX_PCT) is None   # dokładnie 71,0%
    assert validate_yield_band(100.0, 59.9) is not None
    assert validate_yield_band(100.0, 71.1) is not None


def test_male_pobranie_zwolnione_z_pasma():
    """Przy 15 kg zaokrąglenie 0,5 kg to ponad 3 pp — procent jest tam
    z natury rozchwiany (4 takie wpisy na 676 w 25 dni)."""
    assert validate_yield_band(15.0, 8.5) is None      # 56,7%
    assert validate_yield_band(29.9, 29.9) is None     # 100%, ale < 30 kg


def test_duze_pobranie_z_ta_sama_wydajnoscia_juz_nie():
    assert validate_yield_band(150.0, 85.0) is not None  # 56,7% przy 150 kg


def test_furtka_przepuszcza_wszystko():
    assert validate_yield_band(300.0, 298.5, override=True) is None
    assert validate_yield_band(150.0, 82.5, override=True) is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
python3 -m pytest backend/tests/test_deboning_yield.py -q
```

Expected: FAIL — `ImportError: cannot import name 'validate_yield_band'`

- [ ] **Step 3: Write minimal implementation**

W `backend/app/services/deboning_service.py`, bezpośrednio po funkcji `_kg` (linia ~763):

```python
# Twarde pasmo wydajności pobrania. Rozkład 676 wpisów z 25 dni: mediana
# 66,0%, p1 60,0%, p99 68,4%, max 69,5%; prawdziwe pobrania ≥30 kg mieszczą
# się w 62,5–69,5%. Blokada 60–71% zatrzymałaby 1 z 676 wpisów (0,15%).
# Łapie klasę błędu „zła/brak tary wózka": mięso rośnie o wagę wózka
# (87–110 kg), a wydajność skacze do 96–100% — patrz 431, 442, 443, 444.
YIELD_BAND_MIN_PCT = 60.0
YIELD_BAND_MAX_PCT = 71.0
# Małe pobrania zwolnione: przy 15 kg zaokrąglenie 0,5 kg to ponad 3 pp.
YIELD_GUARD_MIN_TAKE_KG = 30.0


def validate_yield_band(kg_taken: float, kg_meat: float, override: bool = False) -> str | None:
    """Twardy próg wydajności dla ŚCIEŻEK KIOSKU. None = wolno zapisać.

    Granice fizyczne (mięso > ćwiartka, wartości ≤ 0) sprawdzają
    validate_meat_yield / validate_take_completion — tu tylko pasmo.

    Furtka (override) jest częścią projektu, nie luką: pułap 95% usunięto
    2026-07-24, bo bez furtki zakleszczał pobranie w 'pending'. Próg bez
    furtki zostanie usunięty tak samo — albo operator zacznie wpisywać
    zmyśloną ćwiartkę, żeby przejść, i błąd zrobi się niewidzialny.
    """
    if override:
        return None
    kg_taken = float(kg_taken or 0)
    kg_meat = float(kg_meat or 0)
    if kg_taken <= 0 or kg_meat <= 0 or kg_taken < YIELD_GUARD_MIN_TAKE_KG:
        return None
    pct = kg_meat / kg_taken * 100
    if pct > YIELD_BAND_MAX_PCT:
        return (
            f"Wydajność {_pct(pct)} — mięso {_kg(kg_meat)} kg z {_kg(kg_taken)} kg "
            "ćwiartki. Sprawdź, czy wybrałeś właściwy wózek (tara). "
            "Zapis wymaga kodu serwisowego."
        )
    if pct < YIELD_BAND_MIN_PCT:
        return (
            f"Wydajność {_pct(pct)} — mięso {_kg(kg_meat)} kg z {_kg(kg_taken)} kg "
            "ćwiartki. Sprawdź, czy całe mięso z pobrania zostało zważone. "
            "Zapis wymaga kodu serwisowego."
        )
    return None
```

Oraz obok `_kg` dopisz formatowanie procentu po polsku:

```python
def _pct(v) -> str:
    """Procent po polsku — przecinek dziesiętny, jedno miejsce."""
    return f"{float(v):.1f}".replace(".", ",") + "%"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python3 -m pytest backend/tests/test_deboning_yield.py -q
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/deboning_service.py backend/tests/test_deboning_yield.py
git commit -m "feat(rozbior): pasmo wydajnosci 60-71% jako czysta funkcja"
```

---

### Task 2: Furtka serwisowa w DTO i wpięcie w ścieżki kiosku

**Files:**
- Modify: `backend/app/models/deboning.py:7-70` (dodanie flag)
- Modify: `backend/app/services/deboning_service.py:908` (create) i `:1550` (complete)
- Test: `backend/tests/test_deboning_takes_db.py`

**Interfaces:**
- Consumes: `validate_yield_band` z Task 1
- Produces: pola DTO `override_yield` (alias `overrideYield`) w `DeboningEntryCreate` i `DeboningTakeComplete`; helper `_log_yield_override(conn, entry_id, kg_taken, kg_meat, by_subject) -> None`

- [ ] **Step 1: Write the failing test**

Dopisz na końcu `backend/tests/test_deboning_takes_db.py`:

```python
def test_zapis_od_razu_odrzuca_wpis_poza_pasmem(db):
    """Klasa błędu 442/443: waga wózka wchodzi w mięso."""
    _seed_batch(kg=1000.0)
    with pytest.raises(HTTPException) as e:
        create_deboning_entry(DeboningEntryCreate(
            rawBatchId="rb1", workerId="w1", workerName="ANATOLII",
            kgQuarter=300.0, kgMeat=298.5,
        ))
    assert e.value.status_code == 400
    assert "Wydajność" in e.value.detail


def test_furtka_przepuszcza_i_zostawia_slad(db):
    _seed_batch(kg=1000.0)
    entry = create_deboning_entry(DeboningEntryCreate(
        rawBatchId="rb1", workerId="w1", workerName="ANATOLII",
        kgQuarter=300.0, kgMeat=298.5, overrideYield=True,
    ))
    row = query_one(
        "SELECT reason, changes FROM deboning_entry_corrections WHERE entry_id=%s",
        (entry["id"],),
    )
    assert row is not None, "ominięcie progu musi zostawić ślad audytowy"
    assert "wydajno" in row["reason"].lower()


def test_domkniecie_pobrania_tez_sprawdza_pasmo(db):
    """complete liczy SUMĘ porcji (weigh-part), nie ostatnią porcję —
    pasmo musi widzieć sumę."""
    _seed_batch(kg=1000.0)
    take = create_deboning_take(_take_dto(kg_quarter=300.0))
    with pytest.raises(HTTPException) as e:
        complete_deboning_take(take["id"], _complete_dto(kg_meat=298.5))
    assert e.value.status_code == 400
```

Jeśli w pliku nie ma helperów `_seed_batch`, `_take_dto`, `_complete_dto`, użyj tych, które już są w tym pliku — sprawdź jego górę przed pisaniem testu i dostosuj nazwy zamiast tworzyć nowe.

- [ ] **Step 2: Run test to verify it fails**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest backend/tests/test_deboning_takes_db.py -k "pasmo or furtka" -q
```

Expected: FAIL — wpis 298,5/300 zapisuje się bez błędu

- [ ] **Step 3: Write minimal implementation**

W `backend/app/models/deboning.py` dopisz pole do `DeboningEntryCreate` (po `kg_meat`, linia ~28) i do `DeboningTakeComplete` (po `kg_meat`, linia ~66):

```python
    # Furtka serwisowa (kod 0099 na kiosku) — świadome ominięcie pasma
    # wydajności. Zostawia ślad w deboning_entry_corrections.
    override_yield: bool = Field(False, alias="overrideYield")
```

W `backend/app/services/deboning_service.py` dodaj helper obok `_kg`:

```python
def _log_yield_override(conn, entry_id: str, kg_taken: float, kg_meat: float,
                        by_subject: str = "") -> None:
    """Ślad ominięcia pasma wydajności — bez tego furtka byłaby dziurą."""
    pct = (kg_meat / kg_taken * 100) if kg_taken else 0
    cx_execute(
        conn,
        "INSERT INTO deboning_entry_corrections (id, entry_id, by_subject, reason, changes) "
        "VALUES (%s,%s,%s,%s,%s)",
        (cuid(), entry_id, by_subject or "kiosk",
         "Ominięcie progu wydajności (kod serwisowy)",
         json.dumps({"yieldPct": round(pct, 2), "kgQuarter": kg_taken,
                     "kgMeat": kg_meat, "band": [YIELD_BAND_MIN_PCT, YIELD_BAND_MAX_PCT]},
                    ensure_ascii=False)),
    )
```

W `create_deboning_entry` tuż po istniejącym `yield_err = validate_meat_yield(...)` (linia ~908):

```python
        band_err = validate_yield_band(kg_taken, kg_meat, getattr(dto, "override_yield", False))
        if band_err:
            raise HTTPException(400, band_err)
```

a po utworzeniu wpisu, wewnątrz tej samej transakcji, gdy `dto.override_yield` jest prawdą — wołaj `_log_yield_override(conn, entry_id, kg_taken, kg_meat, getattr(dto, "operator", ""))`.

W `complete_deboning_take` tuż po `yield_err = validate_take_completion(kg_taken, kg_meat)` (linia ~1550) — **po** przeliczeniu `kg_meat` na sumę porcji:

```python
        band_err = validate_yield_band(kg_taken, kg_meat, getattr(dto, "override_yield", False))
        if band_err:
            raise HTTPException(400, band_err)
```

oraz analogiczny `_log_yield_override` przy ominięciu.

- [ ] **Step 4: Run tests**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest backend/tests -q
```

Expected: PASS (wszystkie ~788)

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/deboning.py backend/app/services/deboning_service.py backend/tests/test_deboning_takes_db.py
git commit -m "feat(rozbior): twardy prog wydajnosci na kiosku + furtka serwisowa ze sladem"
```

---

### Task 3: Ostrzeżenie o nadmiarze bilansu ubocznych (backend)

**Files:**
- Modify: `backend/app/services/batch_byproducts_service.py`
- Test: `backend/tests/test_batch_byproducts_db.py`

**Interfaces:**
- Produces: `BALANCE_WARN_PCT = 103.0`; `get()` zwraca dodatkowe pole `massBalancePct: float | None`

- [ ] **Step 1: Write the failing test**

```python
def test_get_zwraca_bilans_masy_partii(db):
    """Kreator musi znać bilans, żeby ostrzec PRZED zapisem kolejnej palety —
    dziś ostrzega wyłącznie o frakcji ZA MAŁEJ (isByproductBelowNorm)."""
    _seed_batch_with_entries(internal_no="804", quarter_each=2700.0, n=2)
    ensure_record("rb1")
    p = _pallet(containers=36, gross=543.0)
    record("rb1", "bones", p["net"], [p])
    rec = get("rb1")
    # mięso z wpisów = 66% z 5400 = 3564; + kości 453 -> (3564+453)/5400
    assert rec["massBalancePct"] == pytest.approx(74.39, abs=0.05)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest backend/tests/test_batch_byproducts_db.py -k bilans -q
```

Expected: FAIL — `KeyError: 'massBalancePct'`

- [ ] **Step 3: Write minimal implementation**

W `batch_byproducts_service.py` dodaj stałą obok `BYPRODUCT_LOSS_TOL_PCT`:

```python
# Górna granica bilansu masy. Norma historyczna to 101% (ćwiartka liczona
# nominalnie: pojemniki × 15 kg, więc lekko przepełnione dają nadwyżkę);
# zakres 30 partii to 95,7–103,4%. Powyżej 103% kreator PYTA — nie blokuje,
# bo uboczne waży się po fakcie i nadmiar bywa prawdziwy (ociek, mokre
# grzbiety). Partia 445 doszła do 108,3% bez jednego sygnału.
BALANCE_WARN_PCT = 103.0
```

W zapytaniu `get()` dolicz mięso z `deboning_entries` i wystaw `massBalancePct` w `_row()` (None gdy `quarter_kg` = 0).

- [ ] **Step 4: Run tests**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest backend/tests/test_batch_byproducts_db.py -q
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/batch_byproducts_service.py backend/tests/test_batch_byproducts_db.py
git commit -m "feat(uboczne): get() wystawia bilans masy partii dla kreatora"
```

---

### Task 4: Lustro progów i komunikatów w kiosku

**Files:**
- Modify: `src/features/deboning/utils/weighing.ts`
- Test: `src/features/deboning/utils/weighing.test.ts`

**Interfaces:**
- Produces: `YIELD_BAND_MIN_PCT = 60`, `YIELD_BAND_MAX_PCT = 71`, `YIELD_GUARD_MIN_TAKE_KG = 30`, `yieldBandError(kgTaken: number, kgMeat: number): string | null`, `BALANCE_WARN_PCT = 103`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { yieldBandError } from './weighing'

describe('yieldBandError', () => {
  it('przepuszcza typową wydajność', () => {
    expect(yieldBandError(300, 198)).toBeNull()
  })
  it('łapie wagę wózka w mięsie (442: 298,5/300)', () => {
    expect(yieldBandError(300, 298.5)).toMatch(/wózek/)
  })
  it('łapie równe 100% (443: 150/150)', () => {
    expect(yieldBandError(150, 150)).not.toBeNull()
  })
  it('zwalnia pobrania poniżej 30 kg', () => {
    expect(yieldBandError(15, 8.5)).toBeNull()
  })
  it('domyka granice pasma', () => {
    expect(yieldBandError(100, 60)).toBeNull()
    expect(yieldBandError(100, 71)).toBeNull()
    expect(yieldBandError(100, 71.1)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/features/deboning/utils/weighing.test.ts
```

Expected: FAIL — `yieldBandError is not a function`

- [ ] **Step 3: Write minimal implementation**

W `src/features/deboning/utils/weighing.ts` — komunikaty **identyczne co do treści** jak w backendzie (Task 1), żeby operator nie widział dwóch różnych tekstów dla tego samego błędu. Backend zostaje źródłem prawdy; to lustro tylko oszczędza rundę po sieci.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/features/deboning/utils/weighing.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/deboning/utils/weighing.ts src/features/deboning/utils/weighing.test.ts
git commit -m "feat(hmi): lustro pasma wydajnosci w kiosku"
```

---

### Task 5: Modal furtki serwisowej na kiosku

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx` (ścieżki zapisu pobrania, ~1099 i ~1221)
- Modify: `src/lib/api.ts` (pola `overrideYield` w wywołaniach zapisu i domknięcia)

**Interfaces:**
- Consumes: `yieldBandError` (Task 4), `SERVICE_CODE` z `src/features/deboning/ServiceMenu.tsx`
- Produces: stan `yieldBlock: { kgTaken: number; kgMeat: number; message: string; retry: (override: boolean) => Promise<void> } | null`

- [ ] **Step 1: Napisz komponent modala**

Modal pokazuje komunikat z `yieldBandError`, pole na kod i dwa przyciski: „Popraw wpis" (zamyka, wraca do edycji) oraz „Zapisz mimo to" (aktywny dopiero po wpisaniu `SERVICE_CODE`). Przycisk zapisu woła `retry(true)`.

- [ ] **Step 2: Wepnij sprawdzenie przed zapisem**

W obu ścieżkach zapisu: policz `yieldBandError(kgTaken, kgMeat)`. Jeśli niepusty — zamiast wołać API ustaw `yieldBlock` i **nie zapisuj**. `retry(true)` woła to samo API z `overrideYield: true`.

- [ ] **Step 3: Obsłuż 400 z backendu**

Backend zostaje źródłem prawdy — gdy mimo lustra wróci 400 z tekstem zawierającym „kodu serwisowego", też pokaż ten modal. Chroni to przed kioskiem na starej wersji i przed rozjazdem progów.

- [ ] **Step 4: Sprawdź ręcznie na dev**

```bash
npm run dev
```

Zapisz pobranie 300 kg / 298,5 kg mięsa → modal. Wpisz 0099 → zapis przechodzi. Sprawdź w bazie, że jest wiersz w `deboning_entry_corrections`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/tablet/DeboningHmiV10Page.tsx src/lib/api.ts
git commit -m "feat(hmi): modal furtki serwisowej przy przekroczeniu pasma wydajnosci"
```

---

### Task 6: Ostrzeżenie bilansu i usuwanie palety w kreatorze ubocznych

**Files:**
- Modify: `src/features/deboning/ByproductsWizard.tsx:80-127` (suma, `addPallet`) i lista palet (~375)

**Interfaces:**
- Consumes: `record.massBalancePct` (Task 3), `BALANCE_WARN_PCT` (Task 4)

- [ ] **Step 1: Ostrzeżenie górne**

Dziś jest wyłącznie `belowNorm` (frakcja za mała). Dołóż `aboveBalance`: gdy `record.massBalancePct` przekracza `BALANCE_WARN_PCT`, przed zapisem palety pokaż pytanie „Ta partia ma już {X}% bilansu masy — sprawdź, czy paleta nie jest zapisana pod drugą frakcją." z wyborem „Zapisz" / „Anuluj". To **ostrzeżenie**, nie blokada.

- [ ] **Step 2: Usuwanie pojedynczej palety**

Przy każdym wierszu listy palet dodaj przycisk kosza. Klik usuwa paletę z lokalnej listy i woła `persist(next)` — backend nadpisze frakcję nową listą. Dziś jest tylko „Wyczyść sumę" na całą frakcję, więc operator, który pomylił frakcję, musiałby przeważyć wszystko od nowa.

- [ ] **Step 3: Sprawdź ręcznie na dev**

Zważ paletę, usuń ją z listy, potwierdź że suma frakcji i `%` się przeliczyły, a lot ABP w magazynie ubocznych zgadza się z nową sumą.

- [ ] **Step 4: Commit**

```bash
git add src/features/deboning/ByproductsWizard.tsx
git commit -m "feat(uboczne): ostrzezenie o nadmiarze bilansu + usuwanie pojedynczej palety"
```

---

### Task 7: Raport odchyleń w biurze

**Files:**
- Modify: `backend/app/services/deboning_service.py` (funkcja `yield_overrides`)
- Modify: `backend/app/routes/deboning.py` (endpoint `GET /api/deboning/yield-overrides`)
- Modify: `src/lib/api.ts`, `src/pages/office/DeboningReportsPage.tsx`
- Test: `backend/tests/test_deboning_panel_db.py`

**Interfaces:**
- Produces: `yield_overrides(date_from: str, date_to: str) -> Dict[str, Any]` — lista `{entryId, at, batchNo, workerName, kgQuarter, kgMeat, yieldPct, bySubject}`

- [ ] **Step 1: Write the failing test**

```python
def test_raport_odchylen_pokazuje_ominiecia_progu(db):
    _seed_batch(kg=1000.0)
    create_deboning_entry(DeboningEntryCreate(
        rawBatchId="rb1", workerId="w1", workerName="ANATOLII",
        kgQuarter=300.0, kgMeat=298.5, overrideYield=True,
    ))
    out = yield_overrides("2026-01-01", "2030-01-01")
    assert len(out["data"]) == 1
    assert out["data"][0]["yieldPct"] == pytest.approx(99.5, abs=0.05)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest backend/tests/test_deboning_panel_db.py -k odchylen -q
```

Expected: FAIL — `ImportError: cannot import name 'yield_overrides'`

- [ ] **Step 3: Write minimal implementation**

Zapytanie po `deboning_entry_corrections` z `left(reason, 9) = 'Ominięcie'` — **nie** używaj `LIKE '%…'`: `%` w psycopg2 to placeholder i wysypuje zapytanie `IndexError`. Dołącz `deboning_entries` po `entry_id`.

W `DeboningReportsPage.tsx` dodaj zakładkę „Odchylenia" z tabelą: data, partia, pracownik, ćwiartka, mięso, wydajność, kto ominął.

- [ ] **Step 4: Run tests**

```bash
TEST_DATABASE_URL=postgres://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest backend/tests -q && npx vitest run
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/deboning_service.py backend/app/routes/deboning.py backend/tests/test_deboning_panel_db.py src/lib/api.ts src/pages/office/DeboningReportsPage.tsx
git commit -m "feat(biuro): raport ominiec progu wydajnosci"
```

---

### Task 8: Wydanie — backend na VPS, kiosk hali

**Files:**
- Modify: `src-tauri/tauri.rozbior-v10.conf.json:4` (1.0.70 → 1.0.71)

- [ ] **Step 1: Scal do main**

```bash
git checkout main && git merge --no-ff <branch> -m "Merge: straznik wydajnosci i bilansu"
```

- [ ] **Step 2: Diff prod ↔ repo przed deployem**

```bash
diff -rq /opt/kebab/app/backend/app /opt/kebab/kebab_new/kebab_fixed/backend/app | grep -v __pycache__ | grep -v '\.bak'
```

Zmiany istniejące TYLKO na produkcji scommituj do `main` **najpierw** — inaczej deploy je nadpisze.

- [ ] **Step 3: Deploy backendu + restart**

```bash
cp -r /opt/kebab/kebab_new/kebab_fixed/backend/app/. /opt/kebab/app/backend/app/
systemctl restart kebab-mes
systemctl is-active kebab-mes
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8010/api/health
```

Reload/HUP **nie** przeładowuje kodu — cicho serwuje stary.

- [ ] **Step 4: Zweryfikuj DANE, nie „migrations.done"**

Zapisz na produkcji testowe pobranie poza pasmem i potwierdź, że wraca 400 z komunikatem o kodzie serwisowym.

- [ ] **Step 5: Bump wersji i tag kiosku**

```bash
# w tauri.rozbior-v10.conf.json: "version": "1.0.71"
git add src-tauri/tauri.rozbior-v10.conf.json
git commit -m "chore(kiosk): 1.0.71 — straznik wydajnosci i bilansu"
git tag rozbior-v10-1.0.71 && git push origin main --tags
```

Bump wersji jest **obowiązkowy** — bez niego updater hali nie pobierze nowego kiosku, a ekrany zostaną na starym froncie.

---

## Kolejność i zależności

Task 1 → 2 (backend, twardy blok) daje wartość **sam w sobie** i może pójść na produkcję przed resztą: blokuje błędną klasę wpisów niezależnie od wersji kiosku. Task 4 → 5 poprawiają tylko komunikat dla operatora. Task 3 → 6 to osobna ścieżka (uboczne), niezależna od 1–2. Task 7 wymaga Task 2 (potrzebuje śladów). Task 8 zamyka całość.

Uwaga wykonawcza: subagenty nie mają prawa zapisu do `backend/` ani większości `src/` — Taski 1, 2, 3, 7 (część backendowa) rób inline w sesji.
