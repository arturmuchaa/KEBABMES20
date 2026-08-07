# Pracownicy: archiwizacja, godziny, potrącenia — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zakładka Pracownicy dostaje archiwizację zwolnionych, ewidencję godzin pracowników ogólnych (od–do, z dniem otwartym i znacznikami nieobecności), potrącenia oczekujące dopisywane w dowolnym momencie oraz automatyczne potrącenie z WZ wystawionego na pracownika.

**Architecture:** Rozszerzenie istniejącego modułu płac, bez nowej architektury. Godziny to nowa tabela `worker_hours` z jednym wierszem na (pracownik, dzień) i statusem; `get_worker_days()` dostaje trzecią gałąź dla roli `WORKER_GENERAL`, więc ekran Rozliczeń działa dla nich tą samą ścieżką co akord. Potrącenia przenoszą się z „powstają przy rozliczeniu" na rejestr `worker_deductions` w stanie `pending`, przepisywany do istniejącego `settlement_deductions` w chwili rozliczenia — dzięki temu pasek wypłaty i druk zbiorczy zostają nietknięte. Logika liczenia godzin i dopasowania nazwy odbiorcy siedzi w czystych funkcjach (backend: `work_hours_service`, front: `src/lib/workHours.ts`), testowanych bez bazy i bez DOM.

**Tech Stack:** FastAPI + psycopg2 (bez ORM, surowy SQL), PostgreSQL, pytest; React 18 + TypeScript + Vite, shadcn/ui, vitest.

## Global Constraints

- Katalog roboczy wszystkich komend: `/opt/kebab/kebab_new/kebab_fixed`. Korzeń repo git to `/opt/kebab/kebab_new` — ścieżki w `git add` podawaj względem katalogu roboczego.
- Migracje: **każdy statement musi być idempotentny** (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Dopisujesz na KOŃCU listy `_DDL` w `backend/app/migrations.py` (kończy się w linii 901). Nigdy `DROP` ani `ALTER TYPE` niszczącego dane.
- Testy DB uruchamiasz z `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test`. **Bez tej zmiennej testy z fixture `db` są cicho pomijane i dają fałszywą zieloną** — zawsze sprawdzaj w wyniku pytest, że testy się wykonały, a nie `skipped`.
- Po zmianie DDL przebuduj schemat bazy testowej:
  `DATABASE_URL="$TEST_DATABASE_URL" python3 -c "from app.migrations import run_migrations; run_migrations()"` (z katalogu `backend/`).
- `%` w SQL przez psycopg2 to placeholder — nie używaj `LIKE '%x%'`, użyj `left()`/`position()`.
- Nie używaj kluczy zarezerwowanych LogRecord (`created`, `filename`, `module`, `name`, `msg`, `args`) w `logger.*(extra=…)` — `KeyError` → 500.
- Statusy godzin (dokładnie te wartości, nigdzie indziej ich nie wymyślaj):
  `'work' | 'off' | 'vacation' | 'sick' | 'absent'`.
- Statusy potrąceń: `'pending' | 'settled' | 'cancelled'`. Źródła: `'manual' | 'wz'`.
- Podstawa rozliczenia (`payroll_settlements.basis`): `'kg' | 'hours'`.
- Etykiety PL w UI: `off` = „Wolne", `vacation` = „Urlop", `sick` = „Chorobowe", `absent` = „Nieobecność".
- Polskie znaki w kodzie i komentarzach są w repo normą — nie transliteruj (wyjątek: komunikaty commitów pisane są bez ogonków, zgodnie z historią repo).
- Front: `npm run typecheck` i `npm run test` muszą przechodzić przed każdym commitem dotykającym `src/`.

**Spec:** `docs/superpowers/specs/2026-08-07-pracownicy-godziny-potracenia-design.md`

## Struktura plików

**Backend — nowe:**
- `backend/app/services/work_hours_service.py` — liczenie godzin (czyste funkcje) + CRUD `worker_hours` + stempel zbiorczy.
- `backend/app/models/work_hours.py` — DTO godzin.
- `backend/tests/test_work_hours_calc.py` — testy czystego liczenia (bez bazy).
- `backend/tests/test_work_hours_db.py` — testy CRUD i stempla.
- `backend/tests/test_worker_days_hours_db.py` — testy `get_worker_days` dla roli ogólnej.
- `backend/tests/test_worker_deductions_db.py` — rejestr potrąceń + konsumpcja przy rozliczeniu.
- `backend/tests/test_worker_archive_db.py` — archiwizacja.
- `backend/tests/test_wz_payroll_deduction_db.py` — WZ → potrącenie, anulowanie, zmiana cen.
- `backend/tests/test_match_worker_name.py` — dopasowanie nazwy odbiorcy (bez bazy).

**Backend — modyfikowane:**
- `backend/app/migrations.py` — DDL na końcu `_DDL`.
- `backend/app/models/workers.py` — `rate_per_hour`, `deduction_ids`, `hours_per_date`, DTO potrąceń.
- `backend/app/services/workers_service.py` — `list_workers(include_inactive)`, gałąź `GENERAL` w `get_worker_days`, potrącenia, `create_settlement` z podstawą godzinową, `match_worker_by_name`.
- `backend/app/routes/workers.py` — nowe endpointy.
- `backend/app/services/wz_service.py` — `create_manual_wz`, `cancel_wz`, `update_wz_prices`.
- `backend/app/routes/wz.py` — przepisanie `payrollDeduction` z body.
- `backend/tests/conftest.py` — tabele płacowe w `_TRUNCATE`.

**Front — nowe:**
- `src/lib/workHours.ts` — czysta logika siatki (parsowanie czasu, liczenie godzin, tydzień, licznik braków).
- `src/lib/workHours.test.ts`
- `src/lib/payrollDeductions.ts` — podział potrąceń na „w zakresie" i „zaległe".
- `src/lib/payrollDeductions.test.ts`
- `src/pages/office/WorkHoursPage.tsx` — siatka tygodniowa.

**Front — modyfikowane:**
- `src/lib/api.ts` — `usersApi.list(includeInactive)`, `workHoursApi`, `payrollApi` (potrącenia, match).
- `src/lib/paySlipPrint.ts` + `.test.ts` — podstawa godzinowa na pasku.
- `src/pages/office/WorkersPage.tsx` — archiwizacja + stawka godzinowa.
- `src/pages/office/PayrollPage.tsx` — grupa Archiwum, podstawa godzinowa, potrącenia oczekujące.
- `src/pages/office/WzNewPage.tsx` — pasek wykrycia pracownika.
- `src/App.tsx`, `src/layouts/OfficeSidebar.tsx`, `src/layouts/OfficeLayout.tsx` — trasa `/office/godziny`.

---

### Task 1: Migracje i fixture testowa

Fundament dla wszystkich pozostałych zadań: kolumny i tabele muszą istnieć, a testy płacowe potrzebują czystego stanu między przebiegami (dziś `workers` i tabele płacowe NIE są czyszczone).

**Files:**
- Modify: `backend/app/migrations.py` (koniec listy `_DDL`, linia 901)
- Modify: `backend/tests/conftest.py:26-45` (lista `_TRUNCATE`)
- Test: `backend/tests/test_work_hours_db.py`

**Interfaces:**
- Produces: tabele `worker_hours`, `worker_deductions`; kolumny `workers.rate_per_hour`, `payroll_settlements.hours_total`, `payroll_settlements.rate_per_hour`, `payroll_settlements.basis`.

- [ ] **Step 1: Napisz test sprawdzający schemat**

Utwórz `backend/tests/test_work_hours_db.py`:

```python
"""Ewidencja godzin pracowników ogólnych — schemat i CRUD.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import query_all, query_one


def _cols(table):
    return {r["column_name"] for r in query_all(
        "SELECT column_name FROM information_schema.columns WHERE table_name=%s",
        (table,),
    )}


def test_schemat_godzin_i_potracen_istnieje(db):
    assert {"id", "worker_id", "work_date", "status", "time_from", "time_to",
            "hours", "note"} <= _cols("worker_hours")
    assert {"id", "worker_id", "deduction_date", "description", "amount",
            "source_type", "source_id", "status", "settlement_id"} <= _cols("worker_deductions")
    assert "rate_per_hour" in _cols("workers")
    assert {"hours_total", "rate_per_hour", "basis"} <= _cols("payroll_settlements")


def test_jeden_wpis_godzin_na_dzien(db):
    """UNIQUE (worker_id, work_date) — dzień ma jedną zmianę, druga to UPDATE."""
    row = query_one(
        "SELECT indexdef FROM pg_indexes "
        "WHERE tablename='worker_hours' AND indexdef LIKE %s",
        ("%UNIQUE%",),
    )
    assert row is not None
    assert "worker_id" in row["indexdef"] and "work_date" in row["indexdef"]
```

- [ ] **Step 2: Uruchom test — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_work_hours_db.py -v
```

Oczekiwane: FAIL — `worker_hours` nie istnieje, brak kolumn. Jeśli widzisz `skipped`, nie ustawiłeś `TEST_DATABASE_URL`.

- [ ] **Step 3: Dopisz DDL na końcu `_DDL`**

W `backend/app/migrations.py`, tuż przed zamykającym `]` (linia 901):

```python
    # ── Godziny pracowników ogólnych ──
    # Jeden wiersz na (pracownik, dzień). `time_to` NULL = zmiana OTWARTA:
    # biuro zapisuje rano sam start (6:00) i domyka po południu, czasem
    # dopiero po dwóch dniach. `status` jest osobno, bo BRAK WIERSZA znaczy
    # „jeszcze nie wpisane", a to zupełnie co innego niż „wolne".
    "ALTER TABLE workers ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC(10,2) DEFAULT 0",
    """CREATE TABLE IF NOT EXISTS worker_hours (
        id          TEXT PRIMARY KEY,
        worker_id   TEXT NOT NULL,
        work_date   DATE NOT NULL,
        status      TEXT NOT NULL DEFAULT 'work',
        time_from   TEXT,
        time_to     TEXT,
        hours       NUMERIC(5,2),
        note        TEXT DEFAULT '',
        created_by  TEXT,
        created_at  TIMESTAMPTZ DEFAULT now(),
        updated_at  TIMESTAMPTZ DEFAULT now(),
        UNIQUE (worker_id, work_date)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_worker_hours_date ON worker_hours (work_date)",
    "ALTER TABLE worker_hours DROP CONSTRAINT IF EXISTS worker_hours_status_ck",
    "ALTER TABLE worker_hours ADD CONSTRAINT worker_hours_status_ck "
    "CHECK (status = ANY (ARRAY['work','off','vacation','sick','absent']))",

    # ── Potrącenia oczekujące ──
    # Dopisywane w dowolnym momencie (np. w poniedziałek) i czekające na
    # rozliczenie. Przy rozliczeniu przepisywane do settlement_deductions,
    # które pozostaje JEDYNYM źródłem dla paska wypłaty i druku zbiorczego.
    """CREATE TABLE IF NOT EXISTS worker_deductions (
        id             TEXT PRIMARY KEY,
        worker_id      TEXT NOT NULL,
        deduction_date DATE NOT NULL,
        description    TEXT NOT NULL,
        amount         NUMERIC(10,2) NOT NULL,
        source_type    TEXT DEFAULT 'manual',
        source_id      TEXT,
        status         TEXT DEFAULT 'pending',
        settlement_id  TEXT,
        created_by     TEXT,
        created_at     TIMESTAMPTZ DEFAULT now()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_worker_deductions_worker "
    "ON worker_deductions (worker_id, status, deduction_date)",
    "CREATE INDEX IF NOT EXISTS idx_worker_deductions_source "
    "ON worker_deductions (source_type, source_id)",

    # ── Rozliczenie na podstawie godzin ──
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS hours_total NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE payroll_settlements ADD COLUMN IF NOT EXISTS basis TEXT DEFAULT 'kg'",
```

- [ ] **Step 4: Dopisz tabele płacowe do czyszczenia w conftest**

W `backend/tests/conftest.py` na końcu listy `_TRUNCATE` (przed `]`), dopisz:

```python
    # Płace: dotąd nieczyszczone, bo żaden test ich nie dotykał. Rozliczenia
    # i potrącenia przeciekałyby między testami (settled_days blokuje dzień
    # na zawsze, więc drugi przebieg tego samego testu padałby na 400).
    "worker_hours", "worker_deductions", "payroll_kg_adjustments",
    "settlement_deductions", "settled_days", "payroll_settlements",
```

- [ ] **Step 5: Przebuduj schemat bazy testowej i uruchom test**

```bash
cd backend && DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -c "from app.migrations import run_migrations; run_migrations()"
TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_work_hours_db.py -v
```

Oczekiwane: 2 passed (nie `skipped`).

- [ ] **Step 6: Sprawdź, że nic nie zepsułeś w istniejących testach**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest -q
```

Oczekiwane: tyle samo `passed` co przed zmianą, 0 `failed`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/migrations.py backend/tests/conftest.py backend/tests/test_work_hours_db.py
git commit -m "feat(payroll): schemat godzin pracownikow ogolnych i potracen oczekujacych"
```

---

### Task 2: Archiwizacja pracownika — backend

**Files:**
- Modify: `backend/app/services/workers_service.py:31-32` (`list_workers`)
- Modify: `backend/app/routes/workers.py:17-19`
- Test: `backend/tests/test_worker_archive_db.py`

**Interfaces:**
- Produces: `list_workers(include_inactive: bool = False) -> List[Dict]`; `GET /api/workers?includeInactive=1`.

- [ ] **Step 1: Napisz failing test**

Utwórz `backend/tests/test_worker_archive_db.py`:

```python
"""Archiwizacja pracownika = workers.active=false.

Domyślna lista MUSI zostać przy aktywnych — żywią się nią panele hali
i kioski rozbioru (usersApi.list w DeboningHmiV3..V10Page). Zarchiwizowany
ma z hali zniknąć; biuro widzi go po jawnym includeInactive.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.services.workers_service import list_workers


def _worker(wid, name, active=True):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,'WORKER_DEBONING',0.55,%s) "
        "ON CONFLICT (id) DO UPDATE SET active=EXCLUDED.active",
        (wid, name, active),
    )


def test_domyslna_lista_pomija_zarchiwizowanego(db):
    _worker("w-akt", "AKTYWNY", active=True)
    _worker("w-arch", "ZWOLNIONY", active=False)
    names = {w["name"] for w in list_workers()}
    assert "AKTYWNY" in names
    assert "ZWOLNIONY" not in names


def test_include_inactive_zwraca_obu(db):
    _worker("w-akt", "AKTYWNY", active=True)
    _worker("w-arch", "ZWOLNIONY", active=False)
    names = {w["name"] for w in list_workers(include_inactive=True)}
    assert {"AKTYWNY", "ZWOLNIONY"} <= names
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_archive_db.py -v
```

Oczekiwane: FAIL — `list_workers() got an unexpected keyword argument 'include_inactive'`.

- [ ] **Step 3: Rozszerz `list_workers`**

W `backend/app/services/workers_service.py` zamień funkcję `list_workers`:

```python
def list_workers(include_inactive: bool = False) -> List[Dict]:
    """Domyślnie tylko aktywni — z tej listy żyją panele hali i kioski
    rozbioru, więc zarchiwizowany ma z nich zniknąć natychmiast.
    `include_inactive` używa wyłącznie biuro (Pracownicy, Rozliczenia)."""
    if include_inactive:
        return query_all("SELECT * FROM workers ORDER BY active DESC, name")
    return query_all("SELECT * FROM workers WHERE active = true ORDER BY name")
```

- [ ] **Step 4: Dodaj parametr do endpointu**

W `backend/app/routes/workers.py` zamień handler listy:

```python
@router.get("/api/workers")
def list_workers(include_inactive: int = Query(0, alias="includeInactive")):
    return svc.list_workers(include_inactive=bool(include_inactive))
```

- [ ] **Step 5: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_archive_db.py -v
```

Oczekiwane: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/workers_service.py backend/app/routes/workers.py backend/tests/test_worker_archive_db.py
git commit -m "feat(workers): lista z opcjonalnymi zarchiwizowanymi"
```

---

### Task 3: Archiwizacja — frontend

**Files:**
- Modify: `src/lib/api.ts:709-715` (`usersApi`)
- Modify: `src/pages/office/WorkersPage.tsx`
- Modify: `src/pages/office/PayrollPage.tsx:50` i sekcja listy pracowników

**Interfaces:**
- Consumes: `GET /api/workers?includeInactive=1` (Task 2).
- Produces: `usersApi.list(includeInactive?: boolean)`; `usersApi.setActive(id, active)`.

- [ ] **Step 1: Rozszerz klienta API**

W `src/lib/api.ts` zamień `usersApi.list` i dopisz `setActive`:

```ts
export const usersApi = {
  /** Bez `includeInactive` zwraca tylko aktywnych — tak korzystają z tego
   *  panele hali i kioski rozbioru. Biuro (Pracownicy, Rozliczenia) prosi
   *  jawnie o archiwum. */
  list:   (includeInactive = false) =>
    get<User[]>(`/workers${includeInactive ? '?includeInactive=1' : ''}`),
  create: (dto: { name: string; role: string; pin?: string; departments?: string[]; ratePerKg?: number; ratePerHour?: number; contractType?: string; employerCostAmount?: number; crewSize?: number }) =>
    post<User>('/workers', toSnake(dto)),
  update: (id: string, dto: { name?: string; role?: string; pin?: string; departments?: string[]; ratePerKg?: number; ratePerHour?: number; contractType?: string; employerCostAmount?: number; active?: boolean; crewSize?: number }) =>
    put<User>(`/workers/${id}`, toSnake(dto)),
  setActive: (id: string, active: boolean) =>
    put<User>(`/workers/${id}`, { active }),
}
```

- [ ] **Step 2: Dodaj przełącznik i akcje w WorkersPage**

W `src/pages/office/WorkersPage.tsx`:

1. Do importów z `lucide-react` (linia 23) dopisz `Archive, RotateCcw`.
2. Pod `const [form, setForm]` dopisz stan widoku i cel archiwizacji:

```tsx
  const [view, setView] = useState<'active' | 'archive'>('active')
  const [archiveTarget, setArchiveTarget] = useState<UserType | null>(null)
  const activeMut = useMutation((d: { id: string; active: boolean }) =>
    usersApi.setActive(d.id, d.active))
```

3. Zamień pobranie danych (linia 66) na wersję z archiwum:

```tsx
  const { data, loading, refetch } = useApi(() => usersApi.list(true))
```

4. Zamień wyliczenia list (linie 93-95) na filtrowane widokiem:

```tsx
  const allUsers = (data ?? []).filter(u => (view === 'archive' ? !u.active : u.active))
  const workers  = allUsers.filter(u => u.role.startsWith('WORKER'))
  const system   = allUsers.filter(u => !u.role.startsWith('WORKER'))
  const archivedCount = (data ?? []).filter(u => !u.active).length
```

5. Dopisz handler pod `handleUpdate`:

```tsx
  async function handleSetActive(u: UserType, active: boolean) {
    try {
      await activeMut.mutate({ id: u.id, active })
      setArchiveTarget(null); refetch()
      toast.success(active ? `Przywrócono: ${u.name}` : `Zarchiwizowano: ${u.name}`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
    }
  }
```

6. W `CardHeader` tabeli (linie 173-181) wstaw przełącznik przed przyciskiem „Dodaj pracownika":

```tsx
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle>Pracownicy</CardTitle>
            <CardDescription className="mt-0.5">Hala produkcyjna · Biuro · Administratorzy</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border-2 border-border overflow-hidden">
              {([
                { v: 'active'  as const, l: 'Aktywni' },
                { v: 'archive' as const, l: `Archiwum${archivedCount ? ` (${archivedCount})` : ''}` },
              ]).map(o => (
                <button key={o.v} type="button" onClick={() => setView(o.v)}
                  className={`px-3 py-1.5 text-sm font-semibold transition-all ${view === o.v ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            <Button onClick={() => { setForm({ ...BLANK_FORM }); createMut.clearError?.(); setOpen(true) }}>
              <Plus size={14} className="mr-1.5" /> Dodaj pracownika
            </Button>
          </div>
        </CardHeader>
```

7. W komórce akcji wiersza (linie 264-268) dopisz archiwizację/przywrócenie:

```tsx
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                          <Pencil size={13} className="mr-1" /> Edytuj
                        </Button>
                        {u.active ? (
                          <Button variant="ghost" size="sm" onClick={() => setArchiveTarget(u)}>
                            <Archive size={13} className="mr-1" /> Archiwizuj
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleSetActive(u, true)}>
                            <RotateCcw size={13} className="mr-1" /> Przywróć
                          </Button>
                        )}
                      </TableCell>
```

8. Przed zamykającym `</div>` komponentu (przed linią 335) dopisz dialog potwierdzenia:

```tsx
      <Dialog open={!!archiveTarget} onOpenChange={v => { if (!v) setArchiveTarget(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Zarchiwizować pracownika?</DialogTitle>
            <DialogDescription>{archiveTarget?.name}</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Zniknie z paneli hali i z list wyboru. Wpisy rozbioru, godziny,
            historia i rozliczenia zostają nietknięte — możesz go przywrócić
            w każdej chwili z zakładki Archiwum.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setArchiveTarget(null)}>Anuluj</Button>
            <Button onClick={() => archiveTarget && handleSetActive(archiveTarget, false)}
              disabled={activeMut.loading}>
              <Archive size={14} className="mr-1.5" /> Archiwizuj
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: Pokaż archiwum w Rozliczeniach**

W `src/pages/office/PayrollPage.tsx`:

1. Linia 50 — dociągnij zarchiwizowanych:

```tsx
  const { data: workers, loading: wLoading } = useApi(() => usersApi.list(true))
```

2. Linia 95 — rozdziel aktywnych od archiwum:

```tsx
  const hallWorkers = (workers ?? []).filter(w => w.role?.startsWith('WORKER') && w.active)
  const archivedWorkers = (workers ?? []).filter(w => w.role?.startsWith('WORKER') && !w.active)
```

3. Po karcie grupy „Ogólny" (po linii 221, przed `{hallWorkers.length === 0 && …}`) dopisz grupę archiwum — bez niej po archiwizacji nie da się domknąć ostatniego tygodnia:

```tsx
              {archivedWorkers.length > 0 && (
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-1.5 text-muted-foreground">
                      <Archive size={14} /> Archiwum
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Zwolnieni — zostają tu, żeby domknąć ostatnie rozliczenie
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <div className="px-3 space-y-1.5">
                      {archivedWorkers.map(w => (
                        <button key={w.id} onClick={() => selectWorker(w)}
                          className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all ${selWorker?.id === w.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{w.name}</span>
                            <ChevronRight size={14} className="text-muted-foreground" />
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {ROLE_LABEL[w.role] ?? w.role} · zarchiwizowany
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
```

4. Do importów z `lucide-react` (linia 20) dopisz `Archive`.

- [ ] **Step 4: Sprawdź typy i testy**

```bash
npm run typecheck && npm run test
```

Oczekiwane: bez błędów TS, wszystkie testy vitest przechodzą.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/pages/office/WorkersPage.tsx src/pages/office/PayrollPage.tsx
git commit -m "feat(workers): archiwizacja zwolnionych z zakladka Archiwum"
```

---

### Task 4: Liczenie godzin — czysta funkcja

Najpierw sama arytmetyka, bez bazy i bez HTTP. Ten test działa bez `TEST_DATABASE_URL`.

**Files:**
- Create: `backend/app/services/work_hours_service.py`
- Test: `backend/tests/test_work_hours_calc.py`

**Interfaces:**
- Produces:
  - `HOUR_STATUSES: tuple[str, ...]`
  - `parse_hhmm(value: str) -> int` — minuty od północy; `HTTPException(400)` przy złym formacie
  - `compute_hours(time_from: Optional[str], time_to: Optional[str]) -> Optional[float]`

- [ ] **Step 1: Napisz failing test**

Utwórz `backend/tests/test_work_hours_calc.py`:

```python
"""Liczenie godzin z zakresu od–do. Czyste funkcje — działa bez bazy."""
import pytest
from fastapi import HTTPException

from app.services.work_hours_service import compute_hours, parse_hhmm


def test_zwykla_zmiana():
    assert compute_hours("6:00", "15:00") == 9.0
    assert compute_hours("06:00", "14:30") == 8.5


def test_zmiana_przez_polnoc():
    """22:00–6:00 to 8 godzin, nie minus 16."""
    assert compute_hours("22:00", "06:00") == 8.0


def test_kwadranse():
    assert compute_hours("6:15", "14:00") == 7.75


def test_brak_konca_to_zmiana_otwarta():
    """Rano zapisujemy sam start i czekamy — godzin jeszcze nie ma."""
    assert compute_hours("6:00", None) is None
    assert compute_hours("6:00", "") is None


def test_brak_startu_tez_daje_none():
    assert compute_hours(None, "15:00") is None


def test_rowne_godziny_to_blad():
    """6:00–6:00 nie znaczy 24 h ani 0 h — to pomyłka przy wpisywaniu."""
    with pytest.raises(HTTPException) as exc:
        compute_hours("6:00", "6:00")
    assert exc.value.status_code == 400


def test_parse_hhmm_akceptuje_skroty():
    """Biuro wpisuje szybko: '6' ma znaczyć 6:00."""
    assert parse_hhmm("6") == 360
    assert parse_hhmm("6:00") == 360
    assert parse_hhmm("06:05") == 365


def test_parse_hhmm_odrzuca_smiecie():
    for bad in ("", "25:00", "6:61", "abc", "-1:00"):
        with pytest.raises(HTTPException):
            parse_hhmm(bad)
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && python3 -m pytest tests/test_work_hours_calc.py -v
```

Oczekiwane: FAIL — `ModuleNotFoundError: app.services.work_hours_service`.

- [ ] **Step 3: Napisz moduł**

Utwórz `backend/app/services/work_hours_service.py`:

```python
"""Ewidencja godzin pracowników ogólnych.

Dzień bywa NIEDOKOŃCZONY: biuro zapisuje rano sam start (pracownik melduje
się o 6:00), a koniec dopisuje po południu — czasem dopiero po dwóch dniach.
Dlatego `time_to` jest NULL-owalne, a `hours` liczy się dopiero po domknięciu.

Brak wiersza znaczy „jeszcze nie wpisane" i to zupełnie co innego niż wolne
— stąd osobna kolumna `status`, a nie wnioskowanie z pustych godzin.
"""
import re
from typing import Optional

from fastapi import HTTPException

#: Kolejność ma znaczenie tylko dla czytelności — CHECK w bazie zna te same.
HOUR_STATUSES = ("work", "off", "vacation", "sick", "absent")

_HHMM = re.compile(r"^(\d{1,2})(?::(\d{2}))?$")


def parse_hhmm(value: str) -> int:
    """'6' → 360, '6:05' → 365. Minuty od północy."""
    m = _HHMM.match((value or "").strip())
    if not m:
        raise HTTPException(400, f"Zła godzina: {value!r} — użyj formatu 6:00")
    hh = int(m.group(1))
    mm = int(m.group(2) or 0)
    if hh > 23 or mm > 59:
        raise HTTPException(400, f"Zła godzina: {value!r} — poza dobą")
    return hh * 60 + mm


def compute_hours(
    time_from: Optional[str], time_to: Optional[str]
) -> Optional[float]:
    """None = zmiana otwarta (brak którejś godziny). Koniec wcześniejszy niż
    start znaczy zmianę przez północ, nie ujemny czas pracy."""
    if not time_from or not time_to:
        return None
    a = parse_hhmm(time_from)
    b = parse_hhmm(time_to)
    if a == b:
        raise HTTPException(400, "Godzina końca musi różnić się od początku")
    if b < a:
        b += 24 * 60
    return round((b - a) / 60.0, 2)
```

- [ ] **Step 4: Uruchom testy**

```bash
cd backend && python3 -m pytest tests/test_work_hours_calc.py -v
```

Oczekiwane: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/work_hours_service.py backend/tests/test_work_hours_calc.py
git commit -m "feat(payroll): liczenie godzin od-do ze zmiana przez polnoc"
```

---

### Task 5: Zapis i odczyt godzin (CRUD + strażnik dnia rozliczonego)

**Files:**
- Modify: `backend/app/services/work_hours_service.py`
- Create: `backend/app/models/work_hours.py`
- Modify: `backend/app/routes/workers.py`
- Test: `backend/tests/test_work_hours_db.py` (dopisujesz do pliku z Taska 1)

**Interfaces:**
- Consumes: `compute_hours`, `HOUR_STATUSES` (Task 4).
- Produces:
  - `upsert_hours(dto: WorkHoursDto) -> Dict` — klucze wyjścia: `id`, `workerId`, `workDate`, `status`, `timeFrom`, `timeTo`, `hours`, `note`
  - `list_hours(date_from: str, date_to: str) -> List[Dict]` — te same klucze
  - `delete_hours(worker_id: str, work_date: str) -> Dict` — `{"ok": True}`
  - `WorkHoursDto(worker_id, work_date, status, time_from, time_to, note)`
  - `GET/PUT/DELETE /api/payroll/hours`

- [ ] **Step 1: Napisz failing testy**

Dopisz do `backend/tests/test_work_hours_db.py`:

```python
import pytest
from fastapi import HTTPException

from app.db import execute
from app.models.work_hours import WorkHoursDto
from app.services.work_hours_service import delete_hours, list_hours, upsert_hours


def _gen(wid="w-gen", name="ADRIAN", rate=25.0, active=True):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, active) "
        "VALUES (%s,%s,'WORKER_GENERAL',%s,%s) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_GENERAL', "
        "rate_per_hour=EXCLUDED.rate_per_hour, active=EXCLUDED.active",
        (wid, name, rate, active),
    )
    return wid


def _dto(**kw):
    base = dict(worker_id="w-gen", work_date="2026-08-03", status="work",
                time_from="6:00", time_to=None, note="")
    base.update(kw)
    return WorkHoursDto(**base)


def test_sam_start_zapisuje_sie_jako_zmiana_otwarta(db):
    """Rano znamy tylko 6:00 — wpis ma czekać, a nie zostać odrzucony."""
    _gen()
    row = upsert_hours(_dto())
    assert row["timeFrom"] == "6:00"
    assert row["timeTo"] == ""
    assert row["hours"] is None


def test_domkniecie_dnia_liczy_godziny(db):
    _gen()
    upsert_hours(_dto())
    row = upsert_hours(_dto(time_to="15:00"))
    assert row["hours"] == 9.0
    assert len(list_hours("2026-08-03", "2026-08-03")) == 1, "drugi zapis to UPDATE, nie nowy wiersz"


def test_znacznik_kasuje_godziny(db):
    """Wolne/urlop/chorobowe to 0 h i żadnych czasów."""
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    row = upsert_hours(_dto(status="vacation"))
    assert row["status"] == "vacation"
    assert row["timeFrom"] == "" and row["timeTo"] == ""
    assert row["hours"] is None


def test_godzin_nie_wpisuje_sie_pracownikowi_rozbioru(db):
    execute(
        "INSERT INTO workers (id, name, role, active) VALUES ('w-deb','VADYM','WORKER_DEBONING',true) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_DEBONING'"
    )
    with pytest.raises(HTTPException) as exc:
        upsert_hours(_dto(worker_id="w-deb"))
    assert exc.value.status_code == 400


def test_dzien_rozliczony_jest_zamkniety(db):
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-gen','2026-08-03','s1')"
    )
    with pytest.raises(HTTPException) as exc:
        upsert_hours(_dto(time_to="16:00"))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        delete_hours("w-gen", "2026-08-03")
    # Siatka musi wiedzieć, że dzień jest zamknięty — inaczej rysowałaby
    # edytowalne pola, które i tak odbiją się od backendu.
    assert list_hours("2026-08-03", "2026-08-03")[0]["settled"] is True


def test_lista_obejmuje_tylko_aktywnych_ogolnych_w_zakresie(db):
    _gen("w-gen", "ADRIAN")
    _gen("w-arch", "ZWOLNIONY", active=False)
    upsert_hours(_dto(worker_id="w-gen", work_date="2026-08-03", time_to="15:00"))
    upsert_hours(_dto(worker_id="w-gen", work_date="2026-08-10", time_to="15:00"))
    rows = list_hours("2026-08-03", "2026-08-09")
    assert [r["workDate"] for r in rows] == ["2026-08-03"]


def test_czyszczenie_komorki(db):
    _gen()
    upsert_hours(_dto(time_to="15:00"))
    delete_hours("w-gen", "2026-08-03")
    assert list_hours("2026-08-03", "2026-08-03") == []
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_work_hours_db.py -v
```

Oczekiwane: FAIL — brak `app.models.work_hours`.

- [ ] **Step 3: Napisz DTO**

Utwórz `backend/app/models/work_hours.py`:

```python
from typing import Optional

from pydantic import BaseModel


class WorkHoursDto(BaseModel):
    worker_id: str
    work_date: str
    #: 'work' | 'off' | 'vacation' | 'sick' | 'absent'
    status: str = "work"
    #: Sam `time_from` bez `time_to` to zmiana OTWARTA — zapis dozwolony.
    time_from: Optional[str] = None
    time_to: Optional[str] = None
    note: str = ""
    created_by: str = ""


class StampDto(BaseModel):
    """Stempel zbiorczy: 10 osób startuje o tej samej godzinie, więc
    wpisywanie tego ręcznie to 10 pól zamiast jednego kliknięcia."""

    work_date: str
    #: 'start' zakłada otwarte wpisy, 'end' domyka istniejące otwarte.
    mode: str
    time: str
```

- [ ] **Step 4: Dopisz CRUD do serwisu**

Do `backend/app/services/work_hours_service.py` dopisz importy i funkcje. Istniejącą linię `from typing import Optional` (z Taska 4) rozszerz do `from typing import Dict, List, Optional` zamiast dodawać drugą:

```python
from app.db import cx_execute, cx_query_one, query_all, transaction
from app.logging_config import get_logger
from app.models.work_hours import WorkHoursDto
from app.utils.ids import cuid, now_iso

logger = get_logger(__name__)


def _row_out(r: Dict) -> Dict:
    return {
        "id": r["id"],
        "workerId": r["worker_id"],
        "workDate": str(r["work_date"]),
        "status": r["status"],
        "timeFrom": r["time_from"] or "",
        "timeTo": r["time_to"] or "",
        "hours": float(r["hours"]) if r["hours"] is not None else None,
        "note": r.get("note") or "",
        # Dzień objęty rozliczeniem jest zamknięty — siatka rysuje kłódkę,
        # a zapis i tak odbiłby się od _assert_not_settled.
        "settled": bool(r.get("settled")),
    }


def _assert_not_settled(conn, worker_id: str, work_date: str) -> None:
    settled = cx_query_one(
        conn,
        "SELECT settlement_id FROM settled_days WHERE worker_id=%s AND work_date=%s",
        (worker_id, work_date),
    )
    if settled:
        raise HTTPException(400, f"Dzień {work_date} jest już rozliczony")


def upsert_hours(dto: WorkHoursDto) -> Dict:
    if dto.status not in HOUR_STATUSES:
        raise HTTPException(400, f"Nieznany status dnia: {dto.status!r}")

    if dto.status == "work":
        time_from = (dto.time_from or "").strip() or None
        time_to = (dto.time_to or "").strip() or None
        if not time_from:
            raise HTTPException(400, "Podaj godzinę rozpoczęcia")
        # Normalizacja: '6' wpisane w pośpiechu ma wylądować jako '6:00'.
        time_from = _fmt(parse_hhmm(time_from))
        time_to = _fmt(parse_hhmm(time_to)) if time_to else None
        hours = compute_hours(time_from, time_to)
    else:
        # Znacznik nieobecności nie niesie godzin — czyścimy, żeby nie
        # zostały po wcześniejszym wpisie roboczym.
        time_from = time_to = hours = None

    with transaction() as conn:
        worker = cx_query_one(
            conn, "SELECT id, role, active FROM workers WHERE id=%s", (dto.worker_id,)
        )
        if not worker:
            raise HTTPException(404, "Pracownik nie istnieje")
        if "GENERAL" not in (worker.get("role") or ""):
            raise HTTPException(400, "Godziny wpisuje się tylko pracownikom ogólnym")
        _assert_not_settled(conn, dto.worker_id, dto.work_date)

        cx_execute(
            conn,
            """
            INSERT INTO worker_hours
                (id, worker_id, work_date, status, time_from, time_to, hours,
                 note, created_by, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (worker_id, work_date) DO UPDATE SET
                status=EXCLUDED.status, time_from=EXCLUDED.time_from,
                time_to=EXCLUDED.time_to, hours=EXCLUDED.hours,
                note=EXCLUDED.note, updated_at=EXCLUDED.updated_at
            """,
            (cuid(), dto.worker_id, dto.work_date, dto.status, time_from,
             time_to, hours, dto.note or "", dto.created_by or "",
             now_iso(), now_iso()),
        )
        row = cx_query_one(
            conn,
            "SELECT * FROM worker_hours WHERE worker_id=%s AND work_date=%s",
            (dto.worker_id, dto.work_date),
        )
    assert row is not None
    return _row_out(row)


def _fmt(minutes: int) -> str:
    return f"{minutes // 60}:{minutes % 60:02d}"


def list_hours(date_from: str, date_to: str) -> List[Dict]:
    """Wiersze wszystkich AKTYWNYCH pracowników ogólnych w zakresie."""
    rows = query_all(
        """
        SELECT h.*, (sd.settlement_id IS NOT NULL) AS settled
        FROM worker_hours h
        JOIN workers w ON w.id = h.worker_id
        LEFT JOIN settled_days sd
               ON sd.worker_id = h.worker_id AND sd.work_date = h.work_date
        WHERE w.active = true AND w.role = 'WORKER_GENERAL'
          AND h.work_date BETWEEN %s AND %s
        ORDER BY h.work_date, w.name
        """,
        (date_from, date_to),
    )
    return [_row_out(r) for r in rows]


def delete_hours(worker_id: str, work_date: str) -> Dict:
    with transaction() as conn:
        _assert_not_settled(conn, worker_id, work_date)
        cx_execute(
            conn,
            "DELETE FROM worker_hours WHERE worker_id=%s AND work_date=%s",
            (worker_id, work_date),
        )
    return {"ok": True}
```

- [ ] **Step 5: Dodaj endpointy**

Do `backend/app/routes/workers.py` dopisz import i handlery:

```python
from app.models.work_hours import WorkHoursDto
from app.services import work_hours_service as hours_svc


@router.get("/api/payroll/hours")
def list_hours(
    date_from: str = Query("", alias="dateFrom"),
    date_to: str = Query("", alias="dateTo"),
):
    return hours_svc.list_hours(date_from, date_to)


@router.put("/api/payroll/hours")
def upsert_hours(dto: WorkHoursDto):
    return hours_svc.upsert_hours(dto)


@router.delete("/api/payroll/hours")
def delete_hours(
    worker_id: str = Query(..., alias="workerId"),
    work_date: str = Query(..., alias="workDate"),
):
    return hours_svc.delete_hours(worker_id, work_date)
```

- [ ] **Step 6: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_work_hours_db.py tests/test_work_hours_calc.py -v
```

Oczekiwane: wszystkie passed (9 z pliku `_db` + 8 z `_calc`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/work_hours_service.py backend/app/models/work_hours.py \
        backend/app/routes/workers.py backend/tests/test_work_hours_db.py
git commit -m "feat(payroll): zapis godzin ogolnych ze strazikiem dnia rozliczonego"
```

---

### Task 6: Stempel zbiorczy „Start / Koniec"

**Files:**
- Modify: `backend/app/services/work_hours_service.py`
- Modify: `backend/app/routes/workers.py`
- Test: `backend/tests/test_work_hours_db.py`

**Interfaces:**
- Consumes: `upsert_hours`, `_assert_not_settled`, `_fmt`, `parse_hhmm`, `compute_hours` (Task 5).
- Produces: `stamp_hours(dto: StampDto) -> Dict` zwracający `{"changed": int}`; `POST /api/payroll/hours/stamp`.

- [ ] **Step 1: Napisz failing testy**

Dopisz do `backend/tests/test_work_hours_db.py`:

```python
from app.models.work_hours import StampDto
from app.services.work_hours_service import stamp_hours


def test_stempel_startu_zaklada_otwarte_tylko_bez_wpisu(db):
    """Kto ma już wpis (np. przyszedł później), zostaje nietknięty."""
    _gen("w-a", "ADRIAN")
    _gen("w-b", "ARAZ")
    upsert_hours(_dto(worker_id="w-b", time_from="7:30"))

    res = stamp_hours(StampDto(work_date="2026-08-03", mode="start", time="6:00"))
    assert res["changed"] == 1

    rows = {r["workerId"]: r for r in list_hours("2026-08-03", "2026-08-03")}
    assert rows["w-a"]["timeFrom"] == "6:00" and rows["w-a"]["hours"] is None
    assert rows["w-b"]["timeFrom"] == "7:30", "istniejący wpis nie może zostać nadpisany"


def test_stempel_konca_domyka_tylko_otwarte(db):
    _gen("w-a", "ADRIAN")
    _gen("w-b", "ARAZ")
    upsert_hours(_dto(worker_id="w-a", time_from="6:00"))
    upsert_hours(_dto(worker_id="w-b", time_from="6:00", time_to="12:00"))

    res = stamp_hours(StampDto(work_date="2026-08-03", mode="end", time="15:00"))
    assert res["changed"] == 1

    rows = {r["workerId"]: r for r in list_hours("2026-08-03", "2026-08-03")}
    assert rows["w-a"]["hours"] == 9.0
    assert rows["w-b"]["hours"] == 6.0, "dzień już domknięty zostaje bez zmian"


def test_stempel_omija_znaczniki_i_dni_rozliczone(db):
    _gen("w-a", "ADRIAN")
    _gen("w-b", "ARAZ")
    _gen("w-c", "MARCIN")
    upsert_hours(_dto(worker_id="w-a", status="vacation"))
    upsert_hours(_dto(worker_id="w-b", time_from="6:00"))
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-c','2026-08-03','s1')"
    )

    res = stamp_hours(StampDto(work_date="2026-08-03", mode="start", time="6:00"))
    assert res["changed"] == 0, "urlop, otwarty wpis i dzień rozliczony — nic do zrobienia"
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_work_hours_db.py -k stempel -v
```

Oczekiwane: FAIL — `cannot import name 'stamp_hours'`.

- [ ] **Step 3: Zaimplementuj stempel**

Do `backend/app/services/work_hours_service.py` dopisz (i rozszerz import o `StampDto`):

```python
def stamp_hours(dto: StampDto) -> Dict:
    """Stempel zbiorczy dnia. 'start' zakłada OTWARTE wpisy tam, gdzie
    jeszcze nic nie ma; 'end' domyka wpisy otwarte. Nigdy nie nadpisuje
    tego, co biuro wpisało ręcznie, i nie rusza dni rozliczonych."""
    if dto.mode not in ("start", "end"):
        raise HTTPException(400, "Tryb stempla: 'start' albo 'end'")
    time = _fmt(parse_hhmm(dto.time))
    changed = 0

    with transaction() as conn:
        settled = {
            r["worker_id"]
            for r in cx_query_all(
                conn,
                "SELECT worker_id FROM settled_days WHERE work_date=%s",
                (dto.work_date,),
            )
        }
        workers = cx_query_all(
            conn,
            "SELECT id FROM workers WHERE active=true AND role='WORKER_GENERAL'",
        )
        existing = {
            r["worker_id"]: r
            for r in cx_query_all(
                conn,
                "SELECT * FROM worker_hours WHERE work_date=%s",
                (dto.work_date,),
            )
        }

        for w in workers:
            wid = w["id"]
            if wid in settled:
                continue
            row = existing.get(wid)
            if dto.mode == "start":
                if row is not None:
                    continue
                cx_execute(
                    conn,
                    """
                    INSERT INTO worker_hours
                        (id, worker_id, work_date, status, time_from, time_to,
                         hours, note, created_at, updated_at)
                    VALUES (%s,%s,%s,'work',%s,NULL,NULL,'',%s,%s)
                    """,
                    (cuid(), wid, dto.work_date, time, now_iso(), now_iso()),
                )
                changed += 1
            else:
                if row is None or row["status"] != "work" or row["time_to"]:
                    continue
                hours = compute_hours(row["time_from"], time)
                cx_execute(
                    conn,
                    "UPDATE worker_hours SET time_to=%s, hours=%s, updated_at=%s "
                    "WHERE worker_id=%s AND work_date=%s",
                    (time, hours, now_iso(), wid, dto.work_date),
                )
                changed += 1

    logger.info(
        "payroll.hours.stamp",
        extra={"work_date": dto.work_date, "mode": dto.mode, "changed": changed},
    )
    return {"changed": changed}
```

Dopisz `cx_query_all` do importu z `app.db` w tym module oraz `StampDto` do importu z `app.models.work_hours`.

- [ ] **Step 4: Dodaj endpoint**

Do `backend/app/routes/workers.py`:

```python
from app.models.work_hours import StampDto, WorkHoursDto


@router.post("/api/payroll/hours/stamp")
def stamp_hours(dto: StampDto):
    return hours_svc.stamp_hours(dto)
```

- [ ] **Step 5: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_work_hours_db.py -v
```

Oczekiwane: 12 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/work_hours_service.py backend/app/models/work_hours.py \
        backend/app/routes/workers.py backend/tests/test_work_hours_db.py
git commit -m "feat(payroll): stempel zbiorczy startu i konca dnia"
```

---

### Task 7: `get_worker_days` dla roli ogólnej

**Files:**
- Modify: `backend/app/services/workers_service.py:166-237`
- Test: `backend/tests/test_worker_days_hours_db.py`

**Interfaces:**
- Consumes: tabela `worker_hours` (Task 5).
- Produces: `get_worker_days` zwraca dla `WORKER_GENERAL` listę
  `{workDate, status, timeFrom, timeTo, hours, open, settled}`;
  `pending_kg_days(worker_id, date_from, date_to) -> {"days": int, "kg": float}`;
  `GET /api/payroll/pending-kg-days`.

- [ ] **Step 1: Napisz failing test**

Utwórz `backend/tests/test_worker_days_hours_db.py`:

```python
"""Podstawa rozliczenia pracownika ogólnego = godziny, nie kilogramy.

Dzień OTWARTY (bez godziny końca) musi być oznaczony, bo wpadłby do
rozliczenia jako 0 h i pracownik dostałby za mało.

Testy DB — bez TEST_DATABASE_URL skip."""
from app.db import execute
from app.models.work_hours import WorkHoursDto
from app.services.work_hours_service import upsert_hours
from app.services.workers_service import get_worker_days


def _gen(wid="w-gen", name="ADRIAN", rate=25.0):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, active) "
        "VALUES (%s,%s,'WORKER_GENERAL',%s,true) "
        "ON CONFLICT (id) DO UPDATE SET role='WORKER_GENERAL'",
        (wid, name, rate),
    )


def _h(**kw):
    base = dict(worker_id="w-gen", work_date="2026-08-03", status="work",
                time_from="6:00", time_to="15:00", note="")
    base.update(kw)
    return upsert_hours(WorkHoursDto(**base))


def test_dni_godzinowe_wracaja_z_godzinami(db):
    _gen()
    _h(work_date="2026-08-03")
    _h(work_date="2026-08-04", time_to="14:30")
    days = get_worker_days("w-gen", "2026-08-03", "2026-08-09")
    assert [d["workDate"] for d in days] == ["2026-08-03", "2026-08-04"]
    assert [d["hours"] for d in days] == [9.0, 8.5]
    assert all(d["open"] is False for d in days)


def test_dzien_otwarty_jest_oznaczony(db):
    _gen()
    _h(time_to=None)
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-09")[0]
    assert day["open"] is True
    assert day["hours"] == 0.0


def test_znacznik_to_zero_godzin(db):
    _gen()
    _h(status="sick", time_from=None, time_to=None)
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-09")[0]
    assert day["status"] == "sick"
    assert day["hours"] == 0.0
    assert day["open"] is False


def test_dzien_rozliczony_ma_flage(db):
    _gen()
    _h()
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-gen','2026-08-03','s1')"
    )
    day = get_worker_days("w-gen", "2026-08-03", "2026-08-09")[0]
    assert day["settled"] is True
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_days_hours_db.py -v
```

Oczekiwane: FAIL — `IndexError` / pusta lista (dziś rola ogólna zwraca `[]`).

- [ ] **Step 3: Dodaj gałąź GENERAL**

W `backend/app/services/workers_service.py`, w `get_worker_days`, zamień końcowe `return []` (linia 237) na:

```python
    if "GENERAL" in role:
        # Podstawą jest czas pracy, nie kilogramy — korekt kg tu nie ma
        # z definicji (_apply_kg_adjustments dotyczy akordu).
        rows = query_all(
            """
            SELECT work_date::text AS work_date, status, time_from, time_to, hours
            FROM worker_hours
            WHERE worker_id=%s AND work_date BETWEEN %s AND %s
            ORDER BY work_date
            """,
            (worker_id, date_from, date_to),
        )
        return [
            {
                "workDate": r["work_date"],
                "status": r["status"],
                "timeFrom": r["time_from"] or "",
                "timeTo": r["time_to"] or "",
                "hours": float(r["hours"]) if r["hours"] is not None else 0.0,
                # Zmiana bez godziny końca — do rozliczenia NIE wolno jej brać,
                # bo weszłaby jako 0 h.
                "open": r["status"] == "work" and not r["time_to"],
                "settled": r["work_date"] in settled_dates,
            }
            for r in rows
        ]

    return []
```

- [ ] **Step 4: Napisz test osieroconych dni rozbioru**

Podstawa idzie za BIEŻĄCĄ rolą, a role zmieniają się w czasie: ADRIAN ma dziś `WORKER_GENERAL`, a w bazie 40 wpisów rozbioru z lipca. Gdyby któryś taki dzień był nierozliczony, po zmianie roli zniknąłby z ekranu bez śladu. Dopisz do `backend/tests/test_worker_days_hours_db.py`:

```python
from app.services.workers_service import pending_kg_days
from app.utils.ids import cuid


def _deb_entry(wid, at, kg):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, price_per_kg, created_at)"
        " VALUES ('rb-h','900',900,'Dostawca',10000,0,'used','mat-cwiartka',"
        "'Ćwiartka z kurczaka',10,now()) ON CONFLICT (id) DO NOTHING"
    )
    execute(
        "INSERT INTO deboning_entries (id, raw_batch_id, raw_batch_no, worker_id,"
        " worker_name, kg_quarter, kg_meat, yield_pct, status, created_at, completed_at)"
        " VALUES (%s,'rb-h','900',%s,'ADRIAN',%s,%s,65,'complete',%s,%s)",
        (cuid(), wid, kg, kg * 0.65, at, at),
    )


def test_nierozliczone_dni_rozbioru_sa_widoczne(db):
    """Pracownik przeniesiony na godziny nie może zgubić starego akordu."""
    _gen()
    _deb_entry("w-gen", "2026-08-03T08:00:00+00:00", 450)
    _deb_entry("w-gen", "2026-08-04T08:00:00+00:00", 300)
    res = pending_kg_days("w-gen", "2026-08-03", "2026-08-09")
    assert res == {"days": 2, "kg": 750.0}


def test_dni_rozbioru_juz_rozliczone_nie_alarmuja(db):
    _gen()
    _deb_entry("w-gen", "2026-08-03T08:00:00+00:00", 450)
    execute(
        "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
        "VALUES ('w-gen','2026-08-03','s1')"
    )
    assert pending_kg_days("w-gen", "2026-08-03", "2026-08-09") == {"days": 0, "kg": 0.0}
```

- [ ] **Step 5: Zaimplementuj `pending_kg_days`**

Do `backend/app/services/workers_service.py` dopisz:

```python
def pending_kg_days(worker_id: str, date_from: str, date_to: str) -> Dict:
    """Nierozliczone dni AKORDOWE pracownika — dla ogólnych to sygnał, że
    ktoś przeszedł z rozbioru na godziny i zostawił niezapłacone kilogramy.
    Podstawa rozliczenia idzie za bieżącą rolą, więc bez tej informacji
    takie dni zniknęłyby z ekranu bez śladu."""
    row = query_one(
        """
        SELECT COUNT(*) AS days, COALESCE(SUM(d.kg), 0) AS kg
        FROM (
            SELECT DATE(created_at AT TIME ZONE 'Europe/Warsaw') AS work_date,
                   SUM(kg_quarter) AS kg
            FROM deboning_entries
            WHERE worker_id=%s
              AND COALESCE(status, 'complete') = 'complete'
              AND DATE(created_at AT TIME ZONE 'Europe/Warsaw') BETWEEN %s AND %s
            GROUP BY 1
        ) d
        LEFT JOIN settled_days s
               ON s.worker_id = %s AND s.work_date = d.work_date
        WHERE s.settlement_id IS NULL
        """,
        (worker_id, date_from, date_to, worker_id),
    )
    return {"days": int(row["days"] or 0), "kg": float(row["kg"] or 0)}
```

Do `backend/app/routes/workers.py` dopisz:

```python
@router.get("/api/payroll/pending-kg-days")
def pending_kg_days(
    worker_id: str = Query(..., alias="workerId"),
    date_from: str = Query("", alias="dateFrom"),
    date_to: str = Query("", alias="dateTo"),
):
    return svc.pending_kg_days(worker_id, date_from, date_to)
```

- [ ] **Step 6: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_days_hours_db.py -v
```

Oczekiwane: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/workers_service.py backend/app/routes/workers.py \
        backend/tests/test_worker_days_hours_db.py
git commit -m "feat(payroll): dni pracy pracownika ogolnego liczone z godzin"
```

---

### Task 8: Rejestr potrąceń oczekujących

**Files:**
- Modify: `backend/app/models/workers.py`
- Modify: `backend/app/services/workers_service.py`
- Modify: `backend/app/routes/workers.py`
- Test: `backend/tests/test_worker_deductions_db.py`

**Interfaces:**
- Produces:
  - `WorkerDeductionDto(worker_id, deduction_date, description, amount, source_type, source_id, created_by)`
  - `create_worker_deduction(dto) -> Dict` — klucze: `id`, `workerId`, `deductionDate`, `description`, `amount`, `sourceType`, `sourceId`, `status`
  - `list_worker_deductions(worker_id: str, status: str = "pending") -> List[Dict]` — te same klucze, sortowane po dacie
  - `cancel_worker_deduction(deduction_id: str) -> Dict` — `{"ok": True}`
  - `GET/POST /api/payroll/deductions`, `DELETE /api/payroll/deductions/{id}`

- [ ] **Step 1: Napisz failing testy**

Utwórz `backend/tests/test_worker_deductions_db.py`:

```python
"""Potrącenia oczekujące — dopisywane w dowolnym momencie, czekają na
rozliczenie. Do rozliczenia wchodzą TYLKO te z datą w jego zakresie.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute
from app.models.workers import WorkerDeductionDto
from app.services.workers_service import (
    cancel_worker_deduction,
    create_worker_deduction,
    list_worker_deductions,
)


def _worker(wid="w1", name="VADYM"):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,'WORKER_DEBONING',0.55,true) ON CONFLICT (id) DO NOTHING",
        (wid, name),
    )


def _ded(**kw):
    base = dict(worker_id="w1", deduction_date="2026-08-03",
                description="Zaliczka", amount=100.0)
    base.update(kw)
    return create_worker_deduction(WorkerDeductionDto(**base))


def test_potracenie_powstaje_jako_oczekujace(db):
    _worker()
    row = _ded()
    assert row["status"] == "pending"
    assert row["amount"] == 100.0
    assert row["sourceType"] == "manual"


def test_lista_zwraca_oczekujace_po_dacie(db):
    _worker()
    _ded(deduction_date="2026-08-05", description="Druga")
    _ded(deduction_date="2026-08-03", description="Pierwsza")
    rows = list_worker_deductions("w1")
    assert [r["description"] for r in rows] == ["Pierwsza", "Druga"]


def test_zerowa_kwota_i_pusty_opis_odrzucone(db):
    _worker()
    with pytest.raises(HTTPException):
        _ded(amount=0)
    with pytest.raises(HTTPException):
        _ded(description="   ")


def test_anulowanie_znika_z_oczekujacych(db):
    _worker()
    row = _ded()
    cancel_worker_deduction(row["id"])
    assert list_worker_deductions("w1") == []
    assert len(list_worker_deductions("w1", status="cancelled")) == 1
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_deductions_db.py -v
```

Oczekiwane: FAIL — brak `WorkerDeductionDto`.

- [ ] **Step 3: Dodaj DTO**

Do `backend/app/models/workers.py` dopisz:

```python
class WorkerDeductionDto(BaseModel):
    """Potrącenie zapisane z wyprzedzeniem — czeka na rozliczenie."""

    worker_id: str
    deduction_date: str
    description: str
    amount: float
    #: 'manual' (biuro) albo 'wz' (zakup pracownika udokumentowany WZ)
    source_type: str = "manual"
    source_id: Optional[str] = None
    created_by: str = ""
```

Do `WorkerCreate` i `WorkerUpdate` dopisz stawkę godzinową:

```python
    rate_per_hour: float = 0.0        # WorkerCreate
    rate_per_hour: Optional[float] = None   # WorkerUpdate
```

- [ ] **Step 4: Zaimplementuj serwis**

Do `backend/app/services/workers_service.py` dopisz (import `WorkerDeductionDto` z `app.models.workers`):

```python
# ── Potrącenia oczekujące ─────────────────────────────────────────────

def _deduction_out(r: Dict) -> Dict:
    return {
        "id": r["id"],
        "workerId": r["worker_id"],
        "deductionDate": str(r["deduction_date"]),
        "description": r["description"],
        "amount": float(r["amount"] or 0),
        "sourceType": r.get("source_type") or "manual",
        "sourceId": r.get("source_id"),
        "status": r.get("status") or "pending",
        "settlementId": r.get("settlement_id"),
    }


def create_worker_deduction(dto: WorkerDeductionDto) -> Dict:
    """Potrącenie znane np. w poniedziałek nie musi już czekać na kartce
    do piątku — leży w rejestrze i wchodzi do rozliczenia obejmującego
    jego datę."""
    if not dto.description.strip():
        raise HTTPException(400, "Podaj opis potrącenia")
    if not dto.amount or dto.amount <= 0:
        raise HTTPException(400, "Kwota potrącenia musi być większa od zera")
    worker = query_one("SELECT id FROM workers WHERE id=%s", (dto.worker_id,))
    if not worker:
        raise HTTPException(404, "Pracownik nie istnieje")

    did = cuid()
    with transaction() as conn:
        cx_execute(
            conn,
            """
            INSERT INTO worker_deductions
                (id, worker_id, deduction_date, description, amount,
                 source_type, source_id, status, created_by, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)
            """,
            (did, dto.worker_id, dto.deduction_date, dto.description.strip(),
             round(dto.amount, 2), dto.source_type, dto.source_id,
             dto.created_by or "", now_iso()),
        )
        row = cx_query_one(
            conn, "SELECT * FROM worker_deductions WHERE id=%s", (did,)
        )
    assert row is not None
    logger.info(
        "payroll.deduction.created",
        extra={"deduction_id": did, "worker_id": dto.worker_id,
               "amount": dto.amount, "source_type": dto.source_type},
    )
    return _deduction_out(row)


def list_worker_deductions(worker_id: str, status: str = "pending") -> List[Dict]:
    rows = query_all(
        "SELECT * FROM worker_deductions WHERE worker_id=%s AND status=%s "
        "ORDER BY deduction_date, created_at",
        (worker_id, status),
    )
    return [_deduction_out(r) for r in rows]


def cancel_worker_deduction(deduction_id: str) -> Dict:
    """Anulowanie zostawia ślad (status), nie kasuje wiersza."""
    with transaction() as conn:
        row = cx_query_one(
            conn,
            "SELECT status FROM worker_deductions WHERE id=%s FOR UPDATE",
            (deduction_id,),
        )
        if not row:
            raise HTTPException(404, "Potrącenie nie istnieje")
        if row["status"] == "settled":
            raise HTTPException(400, "Potrącenie jest już rozliczone")
        cx_execute(
            conn,
            "UPDATE worker_deductions SET status='cancelled' WHERE id=%s",
            (deduction_id,),
        )
    return {"ok": True}
```

- [ ] **Step 5: Dodaj endpointy**

Do `backend/app/routes/workers.py` (rozszerz import o `WorkerDeductionDto`):

```python
@router.get("/api/payroll/deductions")
def list_deductions(
    worker_id: str = Query(..., alias="workerId"),
    status: str = Query("pending"),
):
    return svc.list_worker_deductions(worker_id, status)


@router.post("/api/payroll/deductions")
def create_deduction(dto: WorkerDeductionDto):
    return svc.create_worker_deduction(dto)


@router.delete("/api/payroll/deductions/{deduction_id}")
def cancel_deduction(deduction_id: str):
    return svc.cancel_worker_deduction(deduction_id)
```

- [ ] **Step 6: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_deductions_db.py -v
```

Oczekiwane: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/workers.py backend/app/services/workers_service.py \
        backend/app/routes/workers.py backend/tests/test_worker_deductions_db.py
git commit -m "feat(payroll): rejestr potracen oczekujacych"
```

---

### Task 9: Rozliczenie — konsumpcja potrąceń i podstawa godzinowa

Najbardziej wrażliwe zadanie: dotyka pieniędzy i istniejącej ścieżki akordowej. Ta musi zostać bez zmiany zachowania.

**Files:**
- Modify: `backend/app/models/workers.py` (`CreateSettlementDto`)
- Modify: `backend/app/services/workers_service.py:326-430` (`create_settlement`)
- Test: `backend/tests/test_worker_deductions_db.py`

**Interfaces:**
- Consumes: `worker_deductions` (Task 8), `worker_hours` (Task 5).
- Produces: `CreateSettlementDto` z polami `hours_per_date: Dict[str, float] = {}`, `rate_per_hour: float = 0`, `deduction_ids: List[str] = []`; `payroll_settlements.basis/hours_total/rate_per_hour` wypełniane.

- [ ] **Step 1: Napisz failing testy**

Dopisz do `backend/tests/test_worker_deductions_db.py`:

```python
from app.db import query_all, query_one
from app.models.work_hours import WorkHoursDto
from app.models.workers import CreateSettlementDto
from app.services.work_hours_service import upsert_hours
from app.services.workers_service import create_settlement


def _settle(**kw):
    base = dict(worker_id="w1", date_from="2026-08-03", date_to="2026-08-09",
                work_dates=["2026-08-03"], kg_per_date={"2026-08-03": 1000.0},
                rate_per_kg=0.55)
    base.update(kw)
    return create_settlement(CreateSettlementDto(**base))


def test_potracenie_w_zakresie_trafia_na_pasek(db):
    _worker()
    d = _ded(deduction_date="2026-08-03", description="Zakup ćwiartki", amount=56.0)
    s = _settle(deduction_ids=[d["id"]])

    assert float(s["gross_amount"]) == 550.0
    assert float(s["deductions_total"]) == 56.0
    assert float(s["net_amount"]) == 494.0
    rows = query_all(
        "SELECT description, amount FROM settlement_deductions WHERE settlement_id=%s",
        (s["id"],),
    )
    assert [(r["description"], float(r["amount"])) for r in rows] == [("Zakup ćwiartki", 56.0)]
    after = query_one("SELECT status, settlement_id FROM worker_deductions WHERE id=%s", (d["id"],))
    assert after["status"] == "settled" and after["settlement_id"] == s["id"]


def test_potracenie_spoza_zakresu_odrzucone(db):
    _worker()
    d = _ded(deduction_date="2026-07-30")
    with pytest.raises(HTTPException) as exc:
        _settle(deduction_ids=[d["id"]])
    assert exc.value.status_code == 400
    assert query_one("SELECT status FROM worker_deductions WHERE id=%s", (d["id"],))["status"] == "pending"


def test_cudze_i_juz_rozliczone_potracenie_odrzucone(db):
    _worker("w1", "VADYM")
    _worker("w2", "DENYS")
    obce = create_worker_deduction(WorkerDeductionDto(
        worker_id="w2", deduction_date="2026-08-03", description="Obce", amount=10))
    with pytest.raises(HTTPException):
        _settle(deduction_ids=[obce["id"]])

    moje = _ded()
    _settle(deduction_ids=[moje["id"]])
    with pytest.raises(HTTPException):
        _settle(work_dates=["2026-08-04"], kg_per_date={"2026-08-04": 500.0},
                deduction_ids=[moje["id"]])


def test_rozliczenie_godzinowe_liczy_z_godzin(db):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_hour, active) "
        "VALUES ('wg','ADRIAN','WORKER_GENERAL',25,true) ON CONFLICT (id) DO NOTHING"
    )
    upsert_hours(WorkHoursDto(worker_id="wg", work_date="2026-08-03",
                              time_from="6:00", time_to="15:00"))
    s = create_settlement(CreateSettlementDto(
        worker_id="wg", date_from="2026-08-03", date_to="2026-08-09",
        work_dates=["2026-08-03"], hours_per_date={"2026-08-03": 9.0},
        rate_per_kg=0, rate_per_hour=25.0))

    assert s["basis"] == "hours"
    assert float(s["hours_total"]) == 9.0
    assert float(s["gross_amount"]) == 225.0
    assert float(s["kg_total"]) == 0


def test_akord_dziala_jak_dotad(db):
    """Regresja: ścieżka kilogramowa bez potrąceń nie zmienia zachowania."""
    _worker()
    s = _settle()
    assert s["basis"] == "kg"
    assert float(s["kg_total"]) == 1000.0
    assert float(s["gross_amount"]) == 550.0
    assert float(s["net_amount"]) == 550.0
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_deductions_db.py -v
```

Oczekiwane: FAIL — `CreateSettlementDto` nie zna `deduction_ids`.

- [ ] **Step 3: Rozszerz DTO**

W `backend/app/models/workers.py` zamień `CreateSettlementDto`:

```python
class CreateSettlementDto(BaseModel):
    worker_id: str
    date_from: str
    date_to: str
    work_dates: List[str]
    #: Podstawa kilogramowa (rozbiór, produkcja).
    kg_per_date: Dict[str, float] = {}
    rate_per_kg: float
    #: Podstawa godzinowa (pracownicy ogólni) — wypełniona zamiast kg.
    hours_per_date: Dict[str, float] = {}
    rate_per_hour: float = 0.0
    deductions: List[SettlementDeductionDto] = []
    #: Potrącenia oczekujące z rejestru, wskazane do konsumpcji.
    deduction_ids: List[str] = []
    notes: str = ""
```

- [ ] **Step 4: Przepisz `create_settlement`**

W `backend/app/services/workers_service.py` zamień całą funkcję `create_settlement`:

```python
def create_settlement(dto: CreateSettlementDto) -> Dict:
    sid = cuid()

    with transaction() as conn:
        worker = cx_query_one(
            conn, "SELECT * FROM workers WHERE id=%s FOR UPDATE", (dto.worker_id,)
        )
        if not worker:
            raise HTTPException(404, "Pracownik nie istnieje")

        # Podstawa idzie za BIEŻĄCĄ rolą: ogólny płaci się od godzin,
        # rozbiór i produkcja od kilogramów.
        basis = "hours" if "GENERAL" in (worker.get("role") or "") else "kg"
        if basis == "hours":
            hours_total = round(
                sum(dto.hours_per_date.get(d, 0) for d in dto.work_dates), 2
            )
            kg_total = 0.0
            gross_amount = round(hours_total * dto.rate_per_hour, 2)
            work_dates_detail = json.dumps(
                [{"work_date": d, "hours": dto.hours_per_date.get(d, 0)}
                 for d in sorted(dto.work_dates)]
            )
        else:
            hours_total = 0.0
            kg_total = round(
                sum(dto.kg_per_date.get(d, 0) for d in dto.work_dates), 3
            )
            gross_amount = round(kg_total * dto.rate_per_kg, 2)
            work_dates_detail = json.dumps(
                [{"work_date": d, "kg": dto.kg_per_date.get(d, 0)}
                 for d in sorted(dto.work_dates)]
            )

        for d in dto.work_dates:
            already = cx_query_one(
                conn,
                "SELECT 1 FROM settled_days WHERE worker_id=%s AND work_date=%s",
                (dto.worker_id, d),
            )
            if already:
                raise HTTPException(400, f"Dzień {d} jest już rozliczony")

        # Potrącenia oczekujące: blokada wierszy, żeby dwa równoległe
        # rozliczenia nie zjadły tego samego potrącenia dwa razy.
        pending: List[Dict] = []
        for did in dto.deduction_ids:
            row = cx_query_one(
                conn,
                "SELECT * FROM worker_deductions WHERE id=%s FOR UPDATE",
                (did,),
            )
            if not row:
                raise HTTPException(404, f"Potrącenie {did} nie istnieje")
            if row["worker_id"] != dto.worker_id:
                raise HTTPException(400, "Potrącenie należy do innego pracownika")
            if row["status"] != "pending":
                raise HTTPException(
                    400, f"Potrącenie „{row['description']}” nie jest już oczekujące"
                )
            dd = str(row["deduction_date"])
            if not (dto.date_from <= dd <= dto.date_to):
                raise HTTPException(
                    400,
                    f"Potrącenie „{row['description']}” z {dd} jest poza zakresem "
                    f"{dto.date_from}–{dto.date_to}",
                )
            pending.append(row)

        deductions_total = round(
            sum(d.amount for d in dto.deductions)
            + sum(float(r["amount"] or 0) for r in pending),
            2,
        )
        net_amount = round(gross_amount - deductions_total, 2)
        employer_cost_amount = float(worker.get("employer_cost_amount") or 0)

        cx_execute(
            conn,
            """
            INSERT INTO payroll_settlements
                (id, worker_id, worker_name, worker_role,
                 date_from, date_to, kg_total, rate_per_kg,
                 hours_total, rate_per_hour, basis,
                 gross_amount, employer_cost_pct, employer_cost_amount,
                 deductions_total, net_amount, contract_type,
                 work_dates_detail, notes, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                sid, dto.worker_id, worker["name"], worker.get("role"),
                dto.date_from, dto.date_to, kg_total, dto.rate_per_kg,
                hours_total, dto.rate_per_hour, basis,
                gross_amount, 0, employer_cost_amount,
                deductions_total, net_amount,
                worker.get("contract_type", "zlecenie"),
                work_dates_detail, dto.notes, now_iso(),
            ),
        )
        for ded in dto.deductions:
            cx_execute(
                conn,
                "INSERT INTO settlement_deductions (id, settlement_id, description, amount) "
                "VALUES (%s,%s,%s,%s)",
                (cuid(), sid, ded.description, ded.amount),
            )
        # Rejestr przepisuje się do settlement_deductions, które zostaje
        # JEDYNYM źródłem dla paska wypłaty i druku zbiorczego.
        for row in pending:
            cx_execute(
                conn,
                "INSERT INTO settlement_deductions (id, settlement_id, description, amount) "
                "VALUES (%s,%s,%s,%s)",
                (cuid(), sid, row["description"], row["amount"]),
            )
            cx_execute(
                conn,
                "UPDATE worker_deductions SET status='settled', settlement_id=%s WHERE id=%s",
                (sid, row["id"]),
            )
        for d in dto.work_dates:
            cx_execute(
                conn,
                "INSERT INTO settled_days (worker_id, work_date, settlement_id) "
                "VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                (dto.worker_id, d, sid),
            )

        row = cx_query_one(
            conn, "SELECT * FROM payroll_settlements WHERE id=%s", (sid,)
        )
        assert row is not None
        row["deductions"] = cx_query_all(
            conn,
            "SELECT * FROM settlement_deductions WHERE settlement_id=%s",
            (sid,),
        )
    row["date_from"] = str(row["date_from"])
    row["date_to"] = str(row["date_to"])
    logger.info(
        "payroll.settlement.created",
        extra={"settlement_id": sid, "worker_id": dto.worker_id,
               "basis": basis, "net": net_amount},
    )
    return row
```

- [ ] **Step 5: Uruchom testy — nowe i regresję całego backendu**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_deductions_db.py -v
TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest -q
```

Oczekiwane: 9 passed w pliku potrąceń; cały pakiet bez `failed`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/workers.py backend/app/services/workers_service.py \
        backend/tests/test_worker_deductions_db.py
git commit -m "feat(payroll): rozliczenie konsumuje potracenia i liczy podstawe godzinowa"
```

---

### Task 10: Dopasowanie odbiorcy WZ do pracownika

**Files:**
- Modify: `backend/app/services/workers_service.py`
- Modify: `backend/app/routes/workers.py`
- Test: `backend/tests/test_match_worker_name.py`

**Interfaces:**
- Produces:
  - `normalize_worker_name(value: str) -> str` — czysta funkcja
  - `match_worker_by_name(name: str, nip: str) -> Optional[Dict]` — `{"workerId", "name", "role"}` albo `None`
  - `GET /api/payroll/match-worker?name=&nip=`

- [ ] **Step 1: Napisz failing test czystej normalizacji**

Utwórz `backend/tests/test_match_worker_name.py`:

```python
"""Dopasowanie nazwy odbiorcy WZ do pracownika.

Pracownicy kupują ćwiartkę na własny użytek, biuro wystawia im WZ (prod:
WZ/3/08/26 „DENYS" 56 zł, bez NIP). Firma o imieniu pracownika NIE MOŻE
wygenerować potrącenia przez przypadek, więc: tylko pusty NIP i tylko
dopasowanie dokładne po znormalizowanej nazwie.

Czysta funkcja — działa bez bazy."""
from app.services.workers_service import normalize_worker_name


def test_normalizacja_scina_wielkosc_liter_i_spacje():
    assert normalize_worker_name("  Vadym  ") == "vadym"
    assert normalize_worker_name("DENYS") == "denys"


def test_normalizacja_scala_wielokrotne_spacje():
    assert normalize_worker_name("Jan   Kowalski") == "jan kowalski"


def test_normalizacja_pustych():
    assert normalize_worker_name("") == ""
    assert normalize_worker_name(None) == ""
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && python3 -m pytest tests/test_match_worker_name.py -v
```

Oczekiwane: FAIL — `cannot import name 'normalize_worker_name'`.

- [ ] **Step 3: Napisz dopasowanie**

Do `backend/app/services/workers_service.py` dopisz:

```python
# ── Dopasowanie odbiorcy WZ do pracownika ─────────────────────────────

def normalize_worker_name(value: Optional[str]) -> str:
    return " ".join((value or "").split()).casefold()


def match_worker_by_name(name: str, nip: str = "") -> Optional[Dict]:
    """Zwraca pracownika TYLKO gdy NIP jest pusty (firma ma NIP, pracownik
    nie) i nazwa pasuje DOKŁADNIE do jednego aktywnego pracownika.
    Zero dopasowania rozmytego — pomyłka kosztowałaby kogoś pieniądze."""
    if (nip or "").strip():
        return None
    needle = normalize_worker_name(name)
    if not needle:
        return None
    rows = query_all(
        "SELECT id, name, role FROM workers WHERE active = true"
    )
    hits = [r for r in rows if normalize_worker_name(r["name"]) == needle]
    if len(hits) != 1:
        return None
    return {"workerId": hits[0]["id"], "name": hits[0]["name"], "role": hits[0]["role"]}
```

- [ ] **Step 4: Dopisz test DB dopasowania**

Dopisz do `backend/tests/test_worker_deductions_db.py`:

```python
from app.services.workers_service import match_worker_by_name


def test_dopasowanie_po_nazwie_bez_nipu(db):
    _worker("w1", "VADYM")
    assert match_worker_by_name("vadym", "")["workerId"] == "w1"
    assert match_worker_by_name("  VADYM ", "")["workerId"] == "w1"


def test_nip_wyklucza_dopasowanie(db):
    """Firma ma NIP — nawet gdy nazywa się jak pracownik, to nie on."""
    _worker("w1", "VADYM")
    assert match_worker_by_name("VADYM", "5130201509") is None


def test_zarchiwizowany_nie_lapie_sie(db):
    _worker("w1", "VADYM")
    execute("UPDATE workers SET active=false WHERE id='w1'")
    assert match_worker_by_name("VADYM", "") is None


def test_dwoch_o_tej_samej_nazwie_to_brak_dopasowania(db):
    _worker("w1", "VADYM")
    execute(
        "INSERT INTO workers (id, name, role, active) "
        "VALUES ('w2','VADYM','WORKER_GENERAL',true) ON CONFLICT (id) DO NOTHING"
    )
    assert match_worker_by_name("VADYM", "") is None
```

- [ ] **Step 5: Dodaj endpoint**

Do `backend/app/routes/workers.py`:

```python
@router.get("/api/payroll/match-worker")
def match_worker(name: str = Query(""), nip: str = Query("")):
    return svc.match_worker_by_name(name, nip)
```

- [ ] **Step 6: Uruchom testy**

```bash
cd backend && python3 -m pytest tests/test_match_worker_name.py -v
TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_worker_deductions_db.py -v
```

Oczekiwane: 3 passed + 13 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/workers_service.py backend/app/routes/workers.py \
        backend/tests/test_match_worker_name.py backend/tests/test_worker_deductions_db.py
git commit -m "feat(payroll): dopasowanie odbiorcy WZ do pracownika po nazwie"
```

---

### Task 11: WZ zakłada potrącenie atomowo

**Files:**
- Modify: `backend/app/services/wz_service.py:334-…` (`create_manual_wz`)
- Modify: `backend/app/routes/wz.py:80-109`
- Test: `backend/tests/test_wz_payroll_deduction_db.py`

**Interfaces:**
- Consumes: `worker_deductions` (Task 8).
- Produces: `create_manual_wz(..., payroll_deduction: Optional[Dict] = None)` gdzie
  `payroll_deduction = {"workerId": str, "amount": float}`; route czyta
  `body["payrollDeduction"]` (WZ używa camelCase w body, bez `toSnake`).

- [ ] **Step 1: Napisz failing test**

Utwórz `backend/tests/test_wz_payroll_deduction_db.py`:

```python
"""WZ wystawiony na pracownika dopisuje potrącenie do jego rozliczenia.

Rozchód i potrącenie są w JEDNEJ transakcji — albo oba, albo żadne.

Testy DB — bez TEST_DATABASE_URL skip."""
import pytest
from fastapi import HTTPException

from app.db import execute, query_all, query_one
from app.services.wz_service import create_manual_wz


def _worker(wid="w1", name="VADYM"):
    execute(
        "INSERT INTO workers (id, name, role, rate_per_kg, active) "
        "VALUES (%s,%s,'WORKER_DEBONING',0.55,true) ON CONFLICT (id) DO NOTHING",
        (wid, name),
    )


def _batch(bid="rb1", no="500", kg=1000):
    execute(
        "INSERT INTO raw_batches (id, internal_batch_no, internal_batch_seq,"
        " supplier_name, kg_received, kg_available, status, material_type_id,"
        " material_name, price_per_kg, created_at)"
        " VALUES (%s,%s,%s,'Dostawca',%s,%s,'open','mat-cwiartka',"
        "'Ćwiartka z kurczaka',10,now())",
        (bid, no, int(no), kg, kg),
    )
    return bid


def _wz(payroll_deduction=None, qty=5.0, price=11.2):
    return create_manual_wz(
        buyer={"name": "VADYM", "address": "", "nip": ""},
        selections=[{"stock_type": "raw", "stock_id": "rb1", "name": "Ćwiartka",
                     "unit": "kg", "qty": qty, "price": price, "batch_no": "500"}],
        valued=True,
        issued_date="2026-08-04",
        payroll_deduction=payroll_deduction,
    )


def test_wz_zaklada_potracenie_oczekujace(db):
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})

    rows = query_all("SELECT * FROM worker_deductions WHERE worker_id='w1'")
    assert len(rows) == 1
    d = rows[0]
    assert float(d["amount"]) == 56.0
    assert d["status"] == "pending"
    assert d["source_type"] == "wz"
    assert d["source_id"] == doc["id"]
    assert str(d["deduction_date"]) == "2026-08-04"
    assert doc["number"] in d["description"]


def test_bez_wskazania_pracownika_nie_ma_potracenia(db):
    _worker()
    _batch()
    _wz(None)
    assert query_all("SELECT * FROM worker_deductions") == []


def test_brak_stanu_cofa_takze_potracenie(db):
    """Rollback musi objąć potrącenie — inaczej zostałoby po nieudanym WZ."""
    _worker()
    _batch(kg=1)
    with pytest.raises(HTTPException):
        _wz({"workerId": "w1", "amount": 56.0}, qty=500.0)
    assert query_all("SELECT * FROM worker_deductions") == []
    assert query_one("SELECT kg_available FROM raw_batches WHERE id='rb1'")["kg_available"] == 1
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_wz_payroll_deduction_db.py -v
```

Oczekiwane: FAIL — `create_manual_wz() got an unexpected keyword argument 'payroll_deduction'`.

- [ ] **Step 3: Rozszerz `create_manual_wz`**

W `backend/app/services/wz_service.py`:

1. Do sygnatury `create_manual_wz` (po `pallets_other_kind`) dopisz parametr:

```python
    payroll_deduction: Optional[Dict[str, Any]] = None,
```

2. W docstringu dopisz akapit:

```
    payroll_deduction: {"workerId", "amount"} — zakup pracownika na własny
    użytek. Potrącenie powstaje W TEJ SAMEJ transakcji co rozchód, więc
    nieudany WZ nie zostawia po sobie długu na pasku.
```

3. Wewnątrz `with transaction() as conn:`, po pętli `for sel in selections:` (czyli po zaksięgowaniu rozchodu, przed końcem bloku transakcji), dopisz:

```python
        if payroll_deduction and payroll_deduction.get("workerId"):
            amount = round(float(payroll_deduction.get("amount") or 0), 2)
            if amount > 0:
                worker = cx_query_one(
                    conn,
                    "SELECT id, name FROM workers WHERE id=%s AND active=true",
                    (payroll_deduction["workerId"],),
                )
                if not worker:
                    raise HTTPException(400, "Pracownik do potrącenia nie istnieje")
                number = cx_query_one(
                    conn, "SELECT number FROM wz_documents WHERE id=%s", (wid,)
                )["number"]
                cx_execute(
                    conn,
                    """
                    INSERT INTO worker_deductions
                        (id, worker_id, deduction_date, description, amount,
                         source_type, source_id, status, created_at)
                    VALUES (%s,%s,%s,%s,%s,'wz',%s,'pending',%s)
                    """,
                    (cuid(), worker["id"], issued, f"Zakup — {number}",
                     amount, wid, now_iso()),
                )
```

`cuid`, `now_iso`, `cx_execute`, `cx_query_one` i `HTTPException` są w tym module już zaimportowane — nie dopisuj importów.

- [ ] **Step 4: Przepisz `payrollDeduction` z body w route**

W `backend/app/routes/wz.py`, w handlerze `manual`, dopisz argument na końcu wywołania `svc.create_manual_wz(...)`:

```python
        # Zakup pracownika: {"workerId", "amount"} — WZ używa camelCase
        # w body (bez toSnake), więc czytamy klucz tak, jak przyszedł.
        payroll_deduction=body.get("payrollDeduction") or None,
```

- [ ] **Step 5: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_wz_payroll_deduction_db.py -v
```

Oczekiwane: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/wz_service.py backend/app/routes/wz.py \
        backend/tests/test_wz_payroll_deduction_db.py
git commit -m "feat(wz): WZ na pracownika zaklada potracenie w tej samej transakcji"
```

---

### Task 12: Cykl życia potrącenia z WZ (anulowanie, zmiana cen)

**Files:**
- Modify: `backend/app/services/wz_service.py:679-…` (`cancel_wz`), `:527-…` (`update_wz_prices`)
- Test: `backend/tests/test_wz_payroll_deduction_db.py`

**Interfaces:**
- Consumes: potrącenia z `source_type='wz'` (Task 11).
- Produces: `cancel_wz` zwraca dodatkowy klucz `deductionWarning: Optional[str]`.

- [ ] **Step 1: Napisz failing testy**

Dopisz do `backend/tests/test_wz_payroll_deduction_db.py`:

```python
from app.services.wz_service import cancel_wz, update_wz_prices


def test_anulowanie_wz_anuluje_oczekujace_potracenie(db):
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})
    res = cancel_wz(doc["id"])

    d = query_one("SELECT status FROM worker_deductions WHERE source_id=%s", (doc["id"],))
    assert d["status"] == "cancelled"
    assert res.get("deductionWarning") is None


def test_anulowanie_nie_rusza_potracenia_juz_rozliczonego(db):
    """Pieniądze są już na pasku — cichy powrót zostawiłby rozjazd."""
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})
    execute(
        "UPDATE worker_deductions SET status='settled', settlement_id='s1' "
        "WHERE source_id=%s",
        (doc["id"],),
    )
    res = cancel_wz(doc["id"])

    d = query_one("SELECT status FROM worker_deductions WHERE source_id=%s", (doc["id"],))
    assert d["status"] == "settled"
    assert "rozliczone" in (res.get("deductionWarning") or "").lower()


def test_zmiana_cen_aktualizuje_oczekujace_potracenie(db):
    """Ceny bywają dopisywane po wystawieniu — potrącenie ma iść za nimi."""
    _worker()
    _batch()
    doc = _wz({"workerId": "w1", "amount": 56.0})
    update_wz_prices(doc["id"], [{"index": 0, "price": 20.0}])

    d = query_one("SELECT amount FROM worker_deductions WHERE source_id=%s", (doc["id"],))
    assert float(d["amount"]) == 100.0  # 5 kg × 20,00
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_wz_payroll_deduction_db.py -k "anulowanie or zmiana_cen" -v
```

Oczekiwane: FAIL — status pozostaje `pending`, brak `deductionWarning`.

- [ ] **Step 3: Podepnij anulowanie**

W `backend/app/services/wz_service.py`, w `cancel_wz`, wewnątrz `with transaction() as conn:` tuż przed zwróceniem wyniku dopisz:

```python
        # Potrącenie z tego WZ: oczekujące anulujemy razem z dokumentem,
        # rozliczonego NIE ruszamy — pieniądze są już na pasku, więc cicha
        # zmiana zostawiłaby rozjazd między paskiem a magazynem.
        deduction_warning = None
        ded = cx_query_one(
            conn,
            "SELECT id, status, amount FROM worker_deductions "
            "WHERE source_type='wz' AND source_id=%s FOR UPDATE",
            (wz_id,),
        )
        if ded:
            if ded["status"] == "pending":
                cx_execute(
                    conn,
                    "UPDATE worker_deductions SET status='cancelled' WHERE id=%s",
                    (ded["id"],),
                )
            elif ded["status"] == "settled":
                deduction_warning = (
                    f"Potrącenie {float(ded['amount']):.2f} zł jest już rozliczone "
                    f"na pasku — skoryguj ręcznie."
                )
```

`cancel_wz` kończy się `return get_wz(wz_id)` — zamień te dwie ostatnie linie funkcji na:

```python
    logger.info("wz.cancelled", extra={"wz_id": wz_id})
    doc = get_wz(wz_id)
    doc["deductionWarning"] = deduction_warning
    return doc
```

`deduction_warning` jest przypisywane wewnątrz `with transaction()`, ale w Pythonie blok `with` nie tworzy własnego zakresu, więc zmienna jest tu widoczna.

- [ ] **Step 4: Podepnij aktualizację przy zmianie cen**

W `backend/app/services/wz_service.py`, w `update_wz_prices`, tuż po `cx_execute(conn, "UPDATE wz_documents SET lines=%s, total_value=%s, valued=TRUE WHERE id=%s", …)` (wewnątrz tej samej transakcji) dopisz:

```python
        # Potrącenie idzie za wartością dokumentu, dopóki jest oczekujące.
        # Ceny bywają dopisywane po wystawieniu — bez tego pracownik miałby
        # potrącenie z nieaktualnej kwoty. Rozliczonego NIE ruszamy.
        cx_execute(
            conn,
            "UPDATE worker_deductions SET amount=%s "
            "WHERE source_type='wz' AND source_id=%s AND status='pending'",
            (round(float(total), 2), wz_id),
        )
```

Zmienna `total` pochodzi z `new_lines, total = apply_wz_prices(lines, prices)` linię wyżej. Zwróć uwagę, że `update_wz_prices` działa tylko na WZ o statusie `wstepny` — świeżo wystawiony ręczny WZ taki właśnie jest (`_insert_wz` wpisuje `'wstepny'` na sztywno), więc test z Kroku 1 przechodzi tą ścieżką.

- [ ] **Step 5: Uruchom testy**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/test_wz_payroll_deduction_db.py -v
TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest tests/ -q -k wz
```

Oczekiwane: 6 passed w pliku potrąceń WZ; pozostałe testy WZ bez `failed`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/wz_service.py backend/tests/test_wz_payroll_deduction_db.py
git commit -m "feat(wz): anulowanie i zmiana cen synchronizuja potracenie pracownika"
```

---

### Task 13: Front — czysta logika siatki godzin

**Files:**
- Create: `src/lib/workHours.ts`
- Test: `src/lib/workHours.test.ts`

**Interfaces:**
- Produces:
  - `type HourStatus = 'work' | 'off' | 'vacation' | 'sick' | 'absent'`
  - `interface HourCell { workerId: string; workDate: string; status: HourStatus; timeFrom: string; timeTo: string; hours: number | null; settled?: boolean }`
  - `STATUS_LABEL: Record<HourStatus, string>`
  - `parseTime(v: string): number | null`
  - `formatTime(min: number): string`
  - `computeHours(from: string, to: string): number | null`
  - `mondayOf(iso: string): string`
  - `weekDays(mondayIso: string): string[]`
  - `isOpenCell(c: HourCell): boolean`
  - `weekGaps(cells: HourCell[], workerIds: string[], days: string[], todayIso: string): { open: number; missing: number }`

- [ ] **Step 1: Napisz failing testy**

Utwórz `src/lib/workHours.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  computeHours, formatTime, isOpenCell, mondayOf, parseTime, weekDays, weekGaps,
  type HourCell,
} from './workHours'

const cell = (over: Partial<HourCell> = {}): HourCell => ({
  workerId: 'w1', workDate: '2026-08-03', status: 'work',
  timeFrom: '6:00', timeTo: '15:00', hours: 9, ...over,
})

describe('parseTime — biuro wpisuje w pośpiechu', () => {
  it('przyjmuje skróty i pełny zapis', () => {
    expect(parseTime('6')).toBe(360)
    expect(parseTime('6:00')).toBe(360)
    expect(parseTime('06:30')).toBe(390)
  })
  it('odrzuca śmieci', () => {
    for (const bad of ['', '25:00', '6:61', 'abc']) expect(parseTime(bad)).toBeNull()
  })
})

describe('computeHours', () => {
  it('zwykła zmiana', () => expect(computeHours('6:00', '15:00')).toBe(9))
  it('kwadranse', () => expect(computeHours('6:15', '14:00')).toBe(7.75))
  it('przez północ', () => expect(computeHours('22:00', '6:00')).toBe(8))
  it('brak końca to null — zmiana otwarta', () => {
    expect(computeHours('6:00', '')).toBeNull()
  })
  it('równe godziny to null — pomyłka, nie 24 h', () => {
    expect(computeHours('6:00', '6:00')).toBeNull()
  })
})

describe('formatTime', () => {
  it('minuty na HH:MM', () => {
    expect(formatTime(360)).toBe('6:00')
    expect(formatTime(390)).toBe('6:30')
  })
})

describe('tydzień', () => {
  it('poniedziałek dla środy', () => expect(mondayOf('2026-08-05')).toBe('2026-08-03'))
  it('poniedziałek dla niedzieli — tydzień kończy się nią, nie zaczyna', () => {
    expect(mondayOf('2026-08-09')).toBe('2026-08-03')
  })
  it('siedem kolejnych dni', () => {
    expect(weekDays('2026-08-03')).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
      '2026-08-07', '2026-08-08', '2026-08-09',
    ])
  })
})

describe('isOpenCell', () => {
  it('praca bez godziny końca', () => {
    expect(isOpenCell(cell({ timeTo: '', hours: null }))).toBe(true)
  })
  it('znacznik nie jest otwarty', () => {
    expect(isOpenCell(cell({ status: 'off', timeFrom: '', timeTo: '', hours: null }))).toBe(false)
  })
})

describe('weekGaps — ściągawka przy nadrabianiu', () => {
  const days = weekDays('2026-08-03')
  const workers = ['w1', 'w2']

  it('liczy otwarte i brakujące do dziś włącznie', () => {
    const cells = [
      cell({ workerId: 'w1', workDate: '2026-08-03' }),
      cell({ workerId: 'w1', workDate: '2026-08-04', timeTo: '', hours: null }),
      cell({ workerId: 'w2', workDate: '2026-08-03' }),
    ]
    // dziś = wtorek 4.08; brakuje w2/wtorek
    expect(weekGaps(cells, workers, days, '2026-08-04')).toEqual({ open: 1, missing: 1 })
  })

  it('dni przyszłe nie są brakiem', () => {
    expect(weekGaps([], workers, days, '2026-08-03')).toEqual({ open: 0, missing: 2 })
  })

  it('znacznik zamyka dzień — to nie brak', () => {
    const cells = workers.map(w => cell({
      workerId: w, workDate: '2026-08-03', status: 'off',
      timeFrom: '', timeTo: '', hours: null,
    }))
    expect(weekGaps(cells, workers, days, '2026-08-03')).toEqual({ open: 0, missing: 0 })
  })
})
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
npm run test -- workHours
```

Oczekiwane: FAIL — nie znaleziono modułu `./workHours`.

- [ ] **Step 3: Napisz moduł**

Utwórz `src/lib/workHours.ts`:

```ts
/**
 * Siatka godzin pracowników ogólnych — czysta logika, bez DOM i bez API.
 *
 * Dzień bywa NIEDOKOŃCZONY: biuro zapisuje rano sam start, koniec dopisuje
 * po południu (czasem po dwóch dniach). Dlatego `timeTo` bywa puste, a
 * `hours` jest wtedy `null` — to zmiana OTWARTA, nie zero godzin.
 *
 * BRAK KOMÓRKI ≠ WOLNE. Brak znaczy „jeszcze nie wpisane" i właśnie dlatego
 * `weekGaps` liczy te dwa stany osobno.
 */

export type HourStatus = 'work' | 'off' | 'vacation' | 'sick' | 'absent'

export interface HourCell {
  workerId: string
  workDate: string
  status: HourStatus
  timeFrom: string
  timeTo: string
  hours: number | null
  /** Dzień objęty rozliczeniem — komórka tylko do odczytu. */
  settled?: boolean
}

export const STATUS_LABEL: Record<HourStatus, string> = {
  work: 'Praca',
  off: 'Wolne',
  vacation: 'Urlop',
  sick: 'Chorobowe',
  absent: 'Nieobecność',
}

/** '6' → 360, '6:30' → 390. null gdy to nie jest godzina. */
export function parseTime(v: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec((v ?? '').trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2] ?? 0)
  if (hh > 23 || mm > 59) return null
  return hh * 60 + mm
}

export function formatTime(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

/** null = zmiana otwarta albo błędny wpis. Koniec przed startem = przez północ. */
export function computeHours(from: string, to: string): number | null {
  const a = parseTime(from)
  const b0 = parseTime(to)
  if (a === null || b0 === null || a === b0) return null
  const b = b0 < a ? b0 + 24 * 60 : b0
  return Math.round(((b - a) / 60) * 100) / 100
}

/** Poniedziałek tygodnia zawierającego podaną datę (tydzień Pn–Nd). */
export function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const dow = d.getDay()               // 0 = niedziela
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return d.toISOString().slice(0, 10)
}

export function weekDays(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mondayIso + 'T12:00:00')
    d.setDate(d.getDate() + i)
    return d.toISOString().slice(0, 10)
  })
}

export function isOpenCell(c: HourCell): boolean {
  return c.status === 'work' && !c.timeTo
}

/**
 * Ile dni czeka na domknięcie, a ile na jakikolwiek wpis — liczone do
 * dnia dzisiejszego włącznie (dni przyszłe nie są brakiem).
 */
export function weekGaps(
  cells: HourCell[],
  workerIds: string[],
  days: string[],
  todayIso: string,
): { open: number; missing: number } {
  const byKey = new Map(cells.map(c => [`${c.workerId}|${c.workDate}`, c]))
  let open = 0
  let missing = 0
  for (const day of days) {
    if (day > todayIso) continue
    for (const w of workerIds) {
      const c = byKey.get(`${w}|${day}`)
      if (!c) { missing += 1; continue }
      if (isOpenCell(c)) open += 1
    }
  }
  return { open, missing }
}
```

- [ ] **Step 4: Uruchom testy**

```bash
npm run test -- workHours && npm run typecheck
```

Oczekiwane: wszystkie testy przechodzą, brak błędów TS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workHours.ts src/lib/workHours.test.ts
git commit -m "feat(godziny): czysta logika siatki tygodniowej"
```

---

### Task 14: Front — ekran „Godziny pracy"

**Files:**
- Create: `src/pages/office/WorkHoursPage.tsx`
- Modify: `src/lib/api.ts` (dopisz `workHoursApi`)
- Modify: `src/App.tsx:184` (trasa), `src/layouts/OfficeSidebar.tsx:62`, `src/layouts/OfficeLayout.tsx:42`

**Interfaces:**
- Consumes: `GET/PUT/DELETE /api/payroll/hours`, `POST /api/payroll/hours/stamp` (Tasks 5-6); `src/lib/workHours.ts` (Task 13).
- Produces: `workHoursApi.list/save/clear/stamp`.

- [ ] **Step 1: Dopisz klienta API**

W `src/lib/api.ts`, za `payrollApi`, dodaj:

```ts
// ─── Godziny pracowników ogólnych ─────────────────────────────
export const workHoursApi = {
  list: (dateFrom: string, dateTo: string) =>
    get<any[]>(`/payroll/hours?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`),
  save: (dto: {
    workerId: string; workDate: string; status: string;
    timeFrom?: string | null; timeTo?: string | null; note?: string;
  }) => put<any>('/payroll/hours', toSnake(dto)),
  clear: (workerId: string, workDate: string) =>
    del<{ ok: boolean }>(`/payroll/hours?workerId=${encodeURIComponent(workerId)}&workDate=${encodeURIComponent(workDate)}`),
  stamp: (dto: { workDate: string; mode: 'start' | 'end'; time: string }) =>
    post<{ changed: number }>('/payroll/hours/stamp', toSnake(dto)),
}
```

- [ ] **Step 2: Napisz stronę**

Utwórz `src/pages/office/WorkHoursPage.tsx`:

```tsx
/**
 * WorkHoursPage — ewidencja godzin pracowników ogólnych.
 *
 * Rytm biura: rano pracownik melduje się o 6:00, wpisujemy sam start i wpis
 * CZEKA jako otwarty; koniec dopisujemy po południu, a bywa że dopiero po
 * dwóch dniach. Stąd stemple zbiorcze (10 osób = jedno kliknięcie zamiast
 * dziesięciu pól) i licznik braków w nagłówku.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { usersApi, workHoursApi } from '@/lib/apiClient'
import {
  computeHours, mondayOf, parseTime, weekDays, weekGaps,
  STATUS_LABEL, type HourCell, type HourStatus,
} from '@/lib/workHours'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, Clock, Lock, Sunrise, Sunset } from 'lucide-react'

const todayIso = () => new Date().toISOString().slice(0, 10)
const nf = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MARKERS: HourStatus[] = ['off', 'vacation', 'sick', 'absent']

function dayHead(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  return {
    dow: d.toLocaleDateString('pl-PL', { weekday: 'short' }),
    day: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }),
  }
}

export function WorkHoursPage() {
  const [monday, setMonday] = useState(() => mondayOf(todayIso()))
  const [startTime, setStartTime] = useState('6:00')
  const [endTime, setEndTime]     = useState('15:00')
  const [busy, setBusy] = useState(false)

  const days = useMemo(() => weekDays(monday), [monday])
  const from = days[0], to = days[6]

  const { data: workers, loading: wLoading } = useApi(() => usersApi.list(), [])
  const { data: rows, loading: hLoading, refetch } = useApi(
    () => workHoursApi.list(from, to), [from, to])

  const general = (workers ?? []).filter(w => w.role === 'WORKER_GENERAL')
  const cells: HourCell[] = (rows ?? []) as HourCell[]
  const byKey = useMemo(
    () => new Map(cells.map(c => [`${c.workerId}|${c.workDate}`, c])),
    [cells])

  const gaps = weekGaps(cells, general.map(w => w.id), days, todayIso())

  async function save(workerId: string, workDate: string, patch: Partial<HourCell>) {
    const cur = byKey.get(`${workerId}|${workDate}`)
    const next = {
      status: (patch.status ?? cur?.status ?? 'work') as HourStatus,
      timeFrom: patch.timeFrom ?? cur?.timeFrom ?? '',
      timeTo:   patch.timeTo   ?? cur?.timeTo   ?? '',
    }
    try {
      if (next.status === 'work' && !next.timeFrom) {
        // Wyczyszczony start = wyczyszczona komórka (brak wpisu ≠ wolne).
        if (cur) { await workHoursApi.clear(workerId, workDate); refetch() }
        return
      }
      await workHoursApi.save({
        workerId, workDate, status: next.status,
        timeFrom: next.status === 'work' ? next.timeFrom : null,
        timeTo:   next.status === 'work' ? (next.timeTo || null) : null,
      })
      refetch()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu godzin')
    }
  }

  async function stamp(mode: 'start' | 'end') {
    const time = mode === 'start' ? startTime : endTime
    if (parseTime(time) === null) { toast.error('Zła godzina stempla'); return }
    setBusy(true)
    try {
      const res = await workHoursApi.stamp({ workDate: todayIso(), mode, time })
      toast.success(res.changed === 0
        ? 'Nic do ostemplowania — wszystko już wpisane'
        : `Ostemplowano ${res.changed} ${res.changed === 1 ? 'osobę' : 'osób'}`)
      refetch()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd stempla')
    } finally {
      setBusy(false)
    }
  }

  function shiftWeek(delta: number) {
    const d = new Date(monday + 'T12:00:00')
    d.setDate(d.getDate() + delta * 7)
    setMonday(mondayOf(d.toISOString().slice(0, 10)))
  }

  const weekTotal = cells.reduce((s, c) => s + (c.hours ?? 0), 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}><ChevronLeft size={15} /></Button>
            <div>
              <CardTitle className="text-base">
                {new Date(from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}
                {' – '}
                {new Date(to + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}
              </CardTitle>
              <CardDescription className="text-xs">
                {gaps.open > 0 && <span className="text-amber-700 font-semibold">{gaps.open} dni otwartych</span>}
                {gaps.open > 0 && gaps.missing > 0 && ' · '}
                {gaps.missing > 0 && <span className="text-muted-foreground">{gaps.missing} dni bez wpisu</span>}
                {gaps.open === 0 && gaps.missing === 0 && 'Tydzień kompletny'}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => shiftWeek(1)}><ChevronRight size={15} /></Button>
          </div>
          <div className="flex items-center gap-2">
            <Input className="w-20 h-9" value={startTime} onChange={e => setStartTime(e.target.value)} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => stamp('start')}>
              <Sunrise size={14} className="mr-1.5" /> Start wszystkim
            </Button>
            <Input className="w-20 h-9" value={endTime} onChange={e => setEndTime(e.target.value)} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => stamp('end')}>
              <Sunset size={14} className="mr-1.5" /> Koniec otwartym
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {wLoading || hLoading ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : general.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Clock size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak pracowników ogólnych</CardTitle>
              <CardDescription>Dodaj ich w zakładce Pracownicy i ustaw stawkę godzinową</CardDescription>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wide font-semibold sticky left-0 bg-background">Pracownik</th>
                  {days.map(d => {
                    const h = dayHead(d)
                    return (
                      <th key={d} className={`px-2 py-2 text-xs font-semibold ${d === todayIso() ? 'bg-primary/5 text-primary' : ''}`}>
                        <div className="uppercase">{h.dow}</div>
                        <div className="text-muted-foreground font-normal">{h.day}</div>
                      </th>
                    )
                  })}
                  <th className="px-3 py-2 text-xs uppercase tracking-wide font-semibold text-right">Razem</th>
                </tr>
              </thead>
              <tbody>
                {general.map(w => {
                  const total = days.reduce((s, d) => s + (byKey.get(`${w.id}|${d}`)?.hours ?? 0), 0)
                  return (
                    <tr key={w.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-semibold whitespace-nowrap sticky left-0 bg-background">{w.name}</td>
                      {days.map(d => (
                        <td key={d} className={`px-1.5 py-2 align-top ${d === todayIso() ? 'bg-primary/5' : ''}`}>
                          <HourCellEditor cell={byKey.get(`${w.id}|${d}`)} onSave={p => save(w.id, d, p)} />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">
                        {nf.format(total)} h
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-muted/40 font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-muted/40">Razem</td>
                  {days.map(d => {
                    const t = general.reduce((s, w) => s + (byKey.get(`${w.id}|${d}`)?.hours ?? 0), 0)
                    return <td key={d} className="px-2 py-2 text-center tabular-nums">{nf.format(t)}</td>
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">{nf.format(weekTotal)} h</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Komórka: dwa pola czasu albo znacznik ────────────────────
function HourCellEditor({ cell, onSave }: {
  cell?: HourCell
  onSave: (patch: Partial<HourCell>) => void
}) {
  const [from, setFrom] = useState(cell?.timeFrom ?? '')
  const [to, setTo]     = useState(cell?.timeTo ?? '')
  const [menu, setMenu] = useState(false)

  // Wpis przyjechał z serwera po zapisie — pola idą za nim.
  const key = `${cell?.timeFrom ?? ''}|${cell?.timeTo ?? ''}|${cell?.status ?? ''}`
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setFrom(cell?.timeFrom ?? '')
    setTo(cell?.timeTo ?? '')
  }

  // Dzień objęty rozliczeniem jest zamknięty — backend i tak odbiłby zapis,
  // ale edytowalne pole obiecywałoby coś, czego nie da się zrobić.
  if (cell?.settled) {
    return (
      <div className="flex items-center justify-center gap-1 rounded-lg bg-muted px-1 py-2 text-[11px] text-muted-foreground">
        <Lock size={11} />
        {cell.status === 'work' ? `${nf.format(cell.hours ?? 0)} h` : STATUS_LABEL[cell.status]}
      </div>
    )
  }

  if (cell && cell.status !== 'work') {
    return (
      <button onClick={() => onSave({ status: 'work', timeFrom: '', timeTo: '' })}
        className="w-full rounded-lg border-2 border-dashed border-border px-1 py-2 text-[11px] font-bold uppercase text-muted-foreground hover:border-primary/40">
        {STATUS_LABEL[cell.status]}
      </button>
    )
  }

  const hours = computeHours(from, to)
  const open = !!from && !to
  const bad = !!from && !!to && hours === null

  return (
    <div className="space-y-1 min-w-[92px]">
      <div className="flex items-center gap-0.5">
        <Input className="h-7 px-1 text-center text-xs" placeholder="—"
          value={from} onChange={e => setFrom(e.target.value)}
          onBlur={() => { if (from !== (cell?.timeFrom ?? '')) onSave({ timeFrom: from }) }} />
        <Input className="h-7 px-1 text-center text-xs" placeholder="—"
          value={to} onChange={e => setTo(e.target.value)}
          onBlur={() => { if (to !== (cell?.timeTo ?? '')) onSave({ timeTo: to }) }} />
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-semibold ${
          bad ? 'text-red-600' : open ? 'text-amber-700' : 'text-muted-foreground'}`}>
          {bad ? 'błędna godzina' : open ? 'otwarty' : hours !== null ? `${nf.format(hours)} h` : ''}
        </span>
        <button onClick={() => setMenu(m => !m)}
          className="text-[10px] text-muted-foreground hover:text-primary px-1">•••</button>
      </div>
      {menu && (
        <div className="rounded-lg border border-border bg-background shadow-sm p-1 space-y-0.5">
          {MARKERS.map(s => (
            <button key={s} onClick={() => { setMenu(false); onSave({ status: s }) }}
              className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted">
              {STATUS_LABEL[s]}
            </button>
          ))}
          <button onClick={() => { setMenu(false); setFrom(''); setTo(''); onSave({ status: 'work', timeFrom: '', timeTo: '' }) }}
            className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted text-muted-foreground">
            Wyczyść
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Podepnij trasę, menu i tytuł**

1. `src/App.tsx` — dopisz import przy pozostałych stronach biura i trasę obok `pracownicy` (linia 184):

```tsx
        <Route path="godziny"               element={<WorkHoursPage />} />
```

2. `src/layouts/OfficeSidebar.tsx` — w grupie „Administracja", między Pracownikami a Rozliczeniami (linia 62), dopisz (import `Clock` z `lucide-react`):

```tsx
    { to: '/office/godziny',     label: 'Godziny pracy', icon: <Clock size={16} /> },
```

3. `src/layouts/OfficeLayout.tsx` — przy linii 42 dopisz wpis mapy tytułów:

```tsx
  '/office/godziny':               { title: 'Godziny pracy',               description: 'Pracownicy ogólni · Tydzień · Stemple zbiorcze' },
```

- [ ] **Step 4: Sprawdź typy i testy**

```bash
npm run typecheck && npm run test
```

Oczekiwane: bez błędów.

- [ ] **Step 5: Commit**

```bash
git add src/pages/office/WorkHoursPage.tsx src/lib/api.ts src/App.tsx \
        src/layouts/OfficeSidebar.tsx src/layouts/OfficeLayout.tsx
git commit -m "feat(godziny): ekran siatki tygodniowej ze stemplami zbiorczymi"
```

---

### Task 15: Front — stawka godzinowa, potrącenia i podstawa godzinowa w Rozliczeniach

**Files:**
- Create: `src/lib/payrollDeductions.ts`, `src/lib/payrollDeductions.test.ts`
- Modify: `src/lib/paySlipPrint.ts`, `src/lib/paySlipPrint.test.ts`
- Modify: `src/lib/api.ts` (`payrollApi`)
- Modify: `src/pages/office/WorkersPage.tsx` (pole zł/h)
- Modify: `src/pages/office/PayrollPage.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/payroll/deductions` (Task 8), `deduction_ids`/`hours_per_date` w `createSettlement` (Task 9), `open`/`hours` w dniach pracy oraz `GET /api/payroll/pending-kg-days` (Task 7).
- Produces:
  - `splitDeductions(items, dateFrom, dateTo): { inRange: Deduction[]; overdue: Deduction[] }`
  - `basisOf(s): 'kg' | 'hours'`, `basisLabel(s)`, `basisUnit(s)`, `basisTotal(s)`, `dayAmount(d, s)`, `dayEarning(d, s)` w `paySlipPrint.ts`

- [ ] **Step 1: Napisz failing test podziału potrąceń**

Utwórz `src/lib/payrollDeductions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitDeductions, type Deduction } from './payrollDeductions'

const d = (id: string, date: string, amount = 50): Deduction => ({
  id, deductionDate: date, description: `poz. ${id}`, amount,
  sourceType: 'manual', sourceId: null, status: 'pending',
})

describe('splitDeductions — reguła zakresu jest ścisła, ale nic nie ginie', () => {
  it('w zakresie wchodzi, wcześniejsze idzie do zaległych', () => {
    const res = splitDeductions([d('a', '2026-08-04'), d('b', '2026-07-30')],
      '2026-08-03', '2026-08-09')
    expect(res.inRange.map(x => x.id)).toEqual(['a'])
    expect(res.overdue.map(x => x.id)).toEqual(['b'])
  })

  it('brzegi zakresu włącznie', () => {
    const res = splitDeductions([d('a', '2026-08-03'), d('b', '2026-08-09')],
      '2026-08-03', '2026-08-09')
    expect(res.inRange).toHaveLength(2)
    expect(res.overdue).toHaveLength(0)
  })

  it('data po zakresie nie jest zaległa — jeszcze nie jej czas', () => {
    const res = splitDeductions([d('a', '2026-08-20')], '2026-08-03', '2026-08-09')
    expect(res.inRange).toHaveLength(0)
    expect(res.overdue).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Uruchom — musi paść**

```bash
npm run test -- payrollDeductions
```

Oczekiwane: FAIL — brak modułu.

- [ ] **Step 3: Napisz moduł**

Utwórz `src/lib/payrollDeductions.ts`:

```ts
/**
 * Potrącenia oczekujące w kontekście jednego rozliczenia.
 *
 * Reguła: do rozliczenia wchodzą TYLKO potrącenia z datą w jego zakresie.
 * Zaległe (starsze, wciąż nierozliczone) nie wchodzą po cichu, ale muszą być
 * widoczne — inaczej cicho zniknęłyby z płacy przy przesuwaniu okresu.
 */

export interface Deduction {
  id: string
  deductionDate: string
  description: string
  amount: number
  sourceType: string
  sourceId: string | null
  status: string
}

export function splitDeductions(
  items: Deduction[], dateFrom: string, dateTo: string,
): { inRange: Deduction[]; overdue: Deduction[] } {
  const inRange: Deduction[] = []
  const overdue: Deduction[] = []
  for (const d of items) {
    if (d.deductionDate >= dateFrom && d.deductionDate <= dateTo) inRange.push(d)
    else if (d.deductionDate < dateFrom) overdue.push(d)
    // Data po zakresie to potrącenie przyszłe — poczeka na swoje rozliczenie.
  }
  return { inRange, overdue }
}
```

- [ ] **Step 4: Napisz failing test paska godzinowego**

Dopisz do `src/lib/paySlipPrint.test.ts`. Nowych nazw NIE importuj osobną instrukcją — rozszerz istniejący import z linii 2-4 do:

```ts
import {
  settlementOverlapsRange, chunkIntoPages, pageCount, buildPaySlipsDocument,
  basisLabel, basisTotal, basisUnit, dayEarning,
} from './paySlipPrint'
```

a na końcu pliku dopisz:

```ts
const hourly = () => ({
  ...sample({
    worker_role: 'WORKER_GENERAL',
    basis: 'hours',
    kg_total: 0,
    rate_per_kg: 0,
    hours_total: 44,
    rate_per_hour: 25,
    gross_amount: 1100,
    net_amount: 1100,
    deductions: [],
    work_dates_detail: [{ work_date: '2026-08-03', hours: 9 }],
  }),
})

describe('pasek godzinowy', () => {
  it('etykieta i jednostka idą za podstawą', () => {
    expect(basisLabel(hourly())).toBe('Przepracowane godziny')
    expect(basisUnit(hourly())).toBe('h')
    expect(basisTotal(hourly())).toBe(44)
  })

  it('zarobek dnia liczy się ze stawki godzinowej', () => {
    expect(dayEarning({ work_date: '2026-08-03', hours: 9 }, hourly())).toBe(225)
  })

  it('akord zostaje przy kilogramach', () => {
    const s = sample()
    expect(basisUnit(s)).toBe('kg')
    expect(basisTotal(s)).toBe(820)
    expect(dayEarning({ work_date: '2026-07-13', kg: 120.5 }, s)).toBe(241)
  })

  it('pasek godzinowy renderuje się z jednostką h', () => {
    const html = buildPaySlipsDocument([hourly()])
    expect(html).toContain('44,00 h')
    expect(html).toContain('Przepracowane godziny')
  })
})
```

- [ ] **Step 5: Uruchom — musi paść**

```bash
npm run test -- paySlipPrint
```

Oczekiwane: FAIL — brak eksportów `basisLabel` itd.

- [ ] **Step 6: Dodaj podstawę godzinową do paska**

W `src/lib/paySlipPrint.ts`, za `kgLabel` (linia 68), dopisz:

```ts
/** Podstawa rozliczenia: kilogramy (akord) albo godziny (pracownicy ogólni). */
export function basisOf(s: any): 'kg' | 'hours' {
  return (s?.basis ?? 'kg') === 'hours' ? 'hours' : 'kg'
}

export function basisLabel(s: any): string {
  return basisOf(s) === 'hours'
    ? 'Przepracowane godziny'
    : kgLabel(s?.worker_role ?? '')
}

export function basisUnit(s: any): string {
  return basisOf(s) === 'hours' ? 'h' : 'kg'
}

export function basisTotal(s: any): number {
  return basisOf(s) === 'hours' ? Number(s?.hours_total ?? 0) : Number(s?.kg_total ?? 0)
}

export function dayAmount(d: any, s: any): number {
  return basisOf(s) === 'hours' ? Number(d?.hours ?? 0) : Number(d?.kg ?? 0)
}

export function dayEarning(d: any, s: any): number {
  return basisOf(s) === 'hours'
    ? Number(d?.hours ?? 0) * Number(s?.rate_per_hour ?? 0)
    : Number(d?.kg ?? 0) * Number(s?.rate_per_kg ?? 0)
}
```

W `paySlipHtml` zamień:

- linię `const label = kgLabel(role)` na `const label = basisLabel(s)` oraz dopisz `const unit = basisUnit(s)`,
- w `dayRow` zamień `${num(d.kg)}` na `${num(dayAmount(d, s))}` (oba wystąpienia) i `${num(Number(d.kg) * Number(s.rate_per_kg))} zł` na `${num(dayEarning(d, s))} zł`,
- w `daysHead` zamień oba `<th class="r">kg</th>` na `<th class="r">${esc(unit)}</th>`,
- w wierszu podsumowania zamień `${num(s.kg_total)} kg` na `${num(basisTotal(s))} ${esc(unit)}`.

Zmienna `role` zostaje — używa jej `ROLE_LABEL[role]` w nagłówku.

- [ ] **Step 7: Dopisz endpointy potrąceń do klienta API**

W `src/lib/api.ts`, w `payrollApi`, dopisz metody i rozszerz `createSettlement`:

```ts
  createSettlement: (dto: {
    workerId: string; dateFrom: string; dateTo: string;
    workDates: string[]; kgPerDate?: Record<string, number>;
    hoursPerDate?: Record<string, number>;
    ratePerKg: number; ratePerHour?: number;
    deductions: { description: string; amount: number }[];
    deductionIds?: string[];
    notes?: string;
  }) => post<any>('/payroll/settlements', toSnake(dto)),
  listDeductions: (workerId: string, status = 'pending') =>
    get<any[]>(`/payroll/deductions?workerId=${encodeURIComponent(workerId)}&status=${encodeURIComponent(status)}`),
  createDeduction: (dto: {
    workerId: string; deductionDate: string; description: string; amount: number;
  }) => post<any>('/payroll/deductions', toSnake(dto)),
  cancelDeduction: (id: string) => del<{ ok: boolean }>(`/payroll/deductions/${id}`),
  matchWorker: (name: string, nip: string) =>
    get<{ workerId: string; name: string; role: string } | null>(
      `/payroll/match-worker?name=${encodeURIComponent(name)}&nip=${encodeURIComponent(nip)}`),
  pendingKgDays: (workerId: string, dateFrom: string, dateTo: string) =>
    get<{ days: number; kg: number }>(
      `/payroll/pending-kg-days?workerId=${encodeURIComponent(workerId)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`),
```

- [ ] **Step 8: Dodaj stawkę godzinową w formularzu pracownika**

W `src/pages/office/WorkersPage.tsx`:

1. `BLANK_FORM` (linia 63) — dopisz `ratePerHour: '0'`.
2. `createMut`/`updateMut` — dopisz `ratePerHour: parseFloat(d.ratePerHour) || 0`.
3. `openEdit` — dopisz `ratePerHour: String((u as any).ratePerHour ?? (u as any).rate_per_hour ?? 0)`.
4. W typie propsów `WorkerForm` dopisz `ratePerHour: string`.
5. W `WorkerForm` zamień blok pola stawki (linie 408-413) na wybór zależny od roli:

```tsx
            {form.role === 'WORKER_GENERAL' ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Stawka godzinowa (zł/h)</Label>
                <Input type="number" step="0.01" min="0"
                  value={form.ratePerHour}
                  onChange={e => setForm((f: any) => ({ ...f, ratePerHour: e.target.value }))} />
                <p className="text-[10px] text-muted-foreground">
                  Pracownicy ogólni rozliczają się z godzin wpisywanych w zakładce „Godziny pracy"
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Stawka akordowa (zł/kg)</Label>
                <Input type="number" step="0.01" min="0"
                  value={form.ratePerKg}
                  onChange={e => setForm((f: any) => ({ ...f, ratePerKg: e.target.value }))} />
              </div>
            )}
```

6. W tabeli, w komórce „Stawka / Umowa" (linia 248), pokaż właściwą jednostkę:

```tsx
                            <span className="font-semibold text-green-700">
                              {u.role === 'WORKER_GENERAL'
                                ? `${Number((u as any).ratePerHour ?? (u as any).rate_per_hour ?? 0).toFixed(2)} zł/h`
                                : `${Number(rate).toFixed(2)} zł/kg`}
                            </span>
```

- [ ] **Step 9: Przebuduj Rozliczenia**

W `src/pages/office/PayrollPage.tsx`:

1. Importy — dopisz `splitDeductions` z `@/lib/payrollDeductions` oraz `Clock` z `lucide-react`.

2. Pod `const { data: settlements … }` dopisz pobranie oczekujących:

```tsx
  const { data: pendingDeductions, refetch: refetchDeductions } = useApi(
    () => selWorker ? payrollApi.listDeductions(selWorker.id) : Promise.resolve([]),
    [selWorker?.id]
  )
  const [pickedDeductions, setPickedDeductions] = useState<Set<string>>(new Set())
  const [newDed, setNewDed] = useState({ open: false, date: '', description: '', amount: '' })
```

3. Pod istniejące wyliczenia (linie 111-120) wstaw podstawę i potrącenia:

```tsx
  const isHourly = selWorker?.role === 'WORKER_GENERAL'
  const rateHour = parseFloat(String((selWorker as any)?.ratePerHour ?? (selWorker as any)?.rate_per_hour ?? 0)) || 0

  const unitPerDay: Record<string, number> = Object.fromEntries(
    (workerDays ?? []).map((d: any) => [d.workDate, (isHourly ? d.hours : d.kgTotal) ?? 0])
  )
  const totalUnits = Array.from(selectedDays).reduce((s, d) => s + (unitPerDay[d] ?? 0), 0)
  const effRate = isHourly ? rateHour : rate
  const gross   = totalUnits * effRate

  const dedSplit = splitDeductions(
    ((pendingDeductions ?? []) as any[]), range.from, range.to)
  const pickedTotal = dedSplit.inRange
    .filter(d => pickedDeductions.has(d.id))
    .reduce((s, d) => s + Number(d.amount || 0), 0)
  const deductTotal = deductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0) + pickedTotal
  const net = gross - deductTotal
```

Usuń stare linie `const kgPerDay`, `const totalKg`, `const gross`, `const deductTotal`, `const net` — zastępuje je powyższy blok. Zachowaj `const rate` i `const employerCost`.

4. Domyślne zaznaczenie oczekujących z zakresu — dopisz efekt (import `useEffect` już jest):

```tsx
  const inRangeKey = dedSplit.inRange.map(d => d.id).join(',')
  useEffect(() => {
    setPickedDeductions(new Set(dedSplit.inRange.map(d => d.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRangeKey])
```

5. `handleSettle` — wyślij podstawę i wskazane potrącenia:

```tsx
      const dto = {
        workerId: selWorker.id,
        dateFrom: range.from,
        dateTo: range.to,
        workDates: Array.from(selectedDays),
        kgPerDate: isHourly ? {} : Object.fromEntries(Array.from(selectedDays).map(d => [d, unitPerDay[d] ?? 0])),
        hoursPerDate: isHourly ? Object.fromEntries(Array.from(selectedDays).map(d => [d, unitPerDay[d] ?? 0])) : {},
        ratePerKg: isHourly ? 0 : rate,
        ratePerHour: isHourly ? rateHour : 0,
        deductions: deductions.map(d => ({ description: d.description, amount: parseFloat(d.amount) || 0 })),
        deductionIds: Array.from(pickedDeductions),
        notes: '',
      }
```

Po udanym zapisie dopisz `refetchDeductions()` i `setPickedDeductions(new Set())` obok istniejących `refetchDays()`.

6. Lista dni — dzień otwarty ma być niezaznaczalny. W mapowaniu `(workerDays ?? []).map((d: any) => …)` zamień początek na:

```tsx
                      const unit = (isHourly ? d.hours : d.kgTotal) ?? 0
                      const earn = unit * effRate
                      const blocked = d.settled || d.open
                      const sel  = selectedDays.has(d.workDate)
```

i użyj `blocked` zamiast `d.settled` w warunkach renderujących checkbox oraz w klasach tła. Pod nazwą dnia dopisz opis stanu:

```tsx
                            <div className="text-xs text-muted-foreground">
                              {isHourly
                                ? (d.status && d.status !== 'work'
                                    ? { off: 'Wolne', vacation: 'Urlop', sick: 'Chorobowe', absent: 'Nieobecność' }[d.status as string]
                                    : `${d.timeFrom || '—'}–${d.timeTo || '…'}`)
                                : (d.entriesCount ? `${d.entriesCount} wpisów` : d.sessionCount ? `${d.sessionCount} sesji` : '')}
                              {d.open && ' · brak godziny końca'}
                              {d.settled && ' · Rozliczone'}
                            </div>
```

a w kolumnie z wartością zamień `{fmtKg(kg)} kg` na:

```tsx
                            <div className="text-sm font-bold tabular-nums">
                              {isHourly ? `${fmtKg(unit)} h` : `${fmtKg(unit)} kg`}
                            </div>
```

Przycisk „Korekta" pokazuj tylko dla podstawy kilogramowej: `{!blocked && !isHourly && (…)}`.

7. Karta „Potrącenia" — usuń otaczający ją warunek `{selectedDays.size > 0 && (` … `)}` (linie 342 i 370 oryginału). Potrącenie dopisuje się w poniedziałek, a rozlicza w piątek, więc karta musi być widoczna także bez zaznaczonych dni. Zamień całą kartę na:

```tsx
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Potrącenia</CardTitle>
                <button className="text-xs text-primary hover:underline flex items-center gap-1"
                  onClick={() => setNewDed({ open: true, date: new Date().toISOString().slice(0, 10), description: '', amount: '' })}>
                  <Plus size={12} /> Dodaj potrącenie
                </button>
              </CardHeader>
              <CardContent className="space-y-3">
                {dedSplit.overdue.length > 0 && (
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>Zaległe potrącenia:</strong>{' '}
                    {dedSplit.overdue.length} poz. ·{' '}
                    {fmtPln(dedSplit.overdue.reduce((s, d) => s + Number(d.amount || 0), 0))} zł
                    {' — '}cofnij datę „Od", żeby weszły do tego rozliczenia.
                  </div>
                )}
                {dedSplit.inRange.length > 0 && (
                  <div className="space-y-1.5">
                    {dedSplit.inRange.map(d => (
                      <label key={d.id} className="flex items-center gap-2 rounded-xl border-2 border-border px-3 py-2 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                          checked={pickedDeductions.has(d.id)}
                          onChange={() => setPickedDeductions(prev => {
                            const next = new Set(prev)
                            if (next.has(d.id)) next.delete(d.id); else next.add(d.id)
                            return next
                          })} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{d.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(d.deductionDate + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                            {d.sourceType === 'wz' && ' · z WZ'}
                          </div>
                        </div>
                        <span className="text-sm font-bold text-red-600 tabular-nums">− {fmtPln(Number(d.amount))} zł</span>
                        <button onClick={async e => {
                          e.preventDefault()
                          await payrollApi.cancelDeduction(d.id)
                          refetchDeductions()
                        }} className="text-destructive hover:text-destructive/70"><Trash2 size={14} /></button>
                      </label>
                    ))}
                  </div>
                )}
                {deductions.map(d => (
                  <div key={d.id} className="flex gap-2 items-center">
                    <Input placeholder="Opis (np. zaliczka, czynsz)" value={d.description}
                      onChange={e => setDeductions(prev => prev.map(x => x.id === d.id ? { ...x, description: e.target.value } : x))} />
                    <Input type="number" step="0.01" placeholder="0.00" className="w-28" value={d.amount}
                      onChange={e => setDeductions(prev => prev.map(x => x.id === d.id ? { ...x, amount: e.target.value } : x))} />
                    <span className="text-muted-foreground text-sm">zł</span>
                    <button onClick={() => setDeductions(prev => prev.filter(x => x.id !== d.id))}
                      className="text-destructive hover:text-destructive/70"><Trash2 size={15} /></button>
                  </div>
                ))}
                <button onClick={() => setDeductions(prev => [...prev, { id: Math.random().toString(), description: '', amount: '' }])}
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Plus size={13} /> Pozycja doraźna (tylko to rozliczenie)
                </button>
              </CardContent>
            </Card>
```

8. Dialog dopisania potrącenia — dodaj przed zamykającym `</div>` komponentu:

```tsx
      {newDed.open && (
        <Dialog open onOpenChange={() => setNewDed(d => ({ ...d, open: false }))}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Dodaj potrącenie</DialogTitle>
              <DialogDescription>{selWorker?.name} — czeka do rozliczenia obejmującego tę datę</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={newDed.date}
                  onChange={e => setNewDed(d => ({ ...d, date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Opis</Label>
                <Input placeholder="np. zaliczka, zakup mięsa" value={newDed.description}
                  onChange={e => setNewDed(d => ({ ...d, description: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Kwota (zł)</Label>
                <Input type="number" step="0.01" min="0" value={newDed.amount}
                  onChange={e => setNewDed(d => ({ ...d, amount: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setNewDed(d => ({ ...d, open: false }))}>Anuluj</Button>
                <Button onClick={async () => {
                  try {
                    await payrollApi.createDeduction({
                      workerId: selWorker.id, deductionDate: newDed.date,
                      description: newDed.description, amount: parseFloat(newDed.amount) || 0,
                    })
                    setNewDed({ open: false, date: '', description: '', amount: '' })
                    refetchDeductions()
                    toast.success('Potrącenie zapisane — wejdzie do rozliczenia')
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
                  }
                }}>Zapisz</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
```

9. W podsumowaniu zamień etykiety na zależne od podstawy:

```tsx
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{isHourly ? 'Łącznie godzin' : 'Łącznie kg'}</span>
                      <span className="font-semibold">{fmtKg(totalUnits)} {isHourly ? 'h' : 'kg'}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Wynagrodzenie brutto ({effRate.toFixed(2)} {isHourly ? 'zł/h' : 'zł/kg'})
                      </span>
                      <span className="font-semibold">{fmtPln(gross)} zł</span>
                    </div>
```

10. Nagłówek pracownika (linia 239) — pokaż właściwą stawkę:

```tsx
                    {ROLE_LABEL[selWorker.role]} · Stawka:{' '}
                    <strong>{effRate.toFixed(2)} {isHourly ? 'zł/h' : 'zł/kg'}</strong>
```

11. Osierocony akord — pracownik przeniesiony z rozbioru na godziny mógł zostawić nierozliczone kilogramy, które po zmianie roli zniknęłyby z ekranu. Dopisz pobranie:

```tsx
  const { data: pendingKg } = useApi(
    () => (selWorker && isHourly)
      ? payrollApi.pendingKgDays(selWorker.id, range.from, range.to)
      : Promise.resolve({ days: 0, kg: 0 }),
    [selWorker?.id, isHourly, range.from, range.to]
  )
```

i notkę nad kartą „Dni pracy":

```tsx
            {isHourly && (pendingKg?.days ?? 0) > 0 && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <strong>{selWorker.name}</strong> ma {pendingKg!.days} nierozliczonych dni
                rozbioru ({fmtKg(pendingKg!.kg)} kg) w tym zakresie. Rozliczenie idzie za
                bieżącą rolą — żeby je zapłacić, przestaw rolę na „Pracownik rozbioru"
                w zakładce Pracownicy.
              </div>
            )}
```

- [ ] **Step 10: Uruchom testy i typy**

```bash
npm run test && npm run typecheck
```

Oczekiwane: wszystkie testy przechodzą (w tym nowe `payrollDeductions` i `paySlipPrint`), brak błędów TS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/payrollDeductions.ts src/lib/payrollDeductions.test.ts \
        src/lib/paySlipPrint.ts src/lib/paySlipPrint.test.ts src/lib/api.ts \
        src/pages/office/WorkersPage.tsx src/pages/office/PayrollPage.tsx
git commit -m "feat(payroll): podstawa godzinowa i potracenia oczekujace w rozliczeniach"
```

---

### Task 16: Front — pasek wykrycia pracownika na WZ

**Files:**
- Modify: `src/pages/office/WzNewPage.tsx`

**Interfaces:**
- Consumes: `payrollApi.matchWorker` (Task 15, endpoint z Taska 10), `payrollDeduction` w `wzApi.createManual` (Task 11).

- [ ] **Step 1: Rozszerz typ `wzApi.createManual`**

W `src/lib/api.ts`, w sygnaturze `createManual`, dopisz pole:

```ts
    /** Zakup pracownika na własny użytek — potrącenie powstaje razem z WZ. */
    payrollDeduction?: { workerId: string; amount: number } | null;
```

- [ ] **Step 2: Dodaj wykrywanie i pasek w formularzu**

W `src/pages/office/WzNewPage.tsx`:

1. Do importów z `@/lib/apiClient` dopisz `payrollApi`.
2. Pod pozostałe stany dopisz:

```tsx
  // Pracownicy kupują ćwiartkę/mięso na własny użytek; WZ zdejmuje to ze
  // stanów, a potrącenie ma trafić prosto do ich rozliczenia. Dopasowanie
  // tylko po pustym NIP i dokładnej nazwie — po stronie backendu.
  const [empMatch, setEmpMatch] = useState<{ workerId: string; name: string } | null>(null)
  const [empDeduct, setEmpDeduct] = useState(true)
  const [empAmount, setEmpAmount] = useState('')
```

3. Dopisz efekt wykrywania (debounce 400 ms):

```tsx
  useEffect(() => {
    const name = buyer.name.trim()
    if (!name || buyer.nip.trim()) { setEmpMatch(null); return }
    const t = setTimeout(() => {
      payrollApi.matchWorker(name, buyer.nip)
        .then(m => setEmpMatch(m ?? null))
        .catch(() => setEmpMatch(null))
    }, 400)
    return () => clearTimeout(t)
  }, [buyer.name, buyer.nip])
```

4. Kwota domyślna idzie za wartością dokumentu (przy EUR przeliczona kursem):

```tsx
  const deductionDefault = useMemo(() => {
    if (!valued) return 0
    const v = currency === 'EUR' && eurRate > 0 ? totalValue * eurRate : totalValue
    return Math.round(v * 100) / 100
  }, [valued, currency, eurRate, totalValue])

  useEffect(() => { setEmpAmount(deductionDefault ? deductionDefault.toFixed(2) : '') },
    [deductionDefault])
```

5. Nad przyciskiem zapisu wstaw pasek:

```tsx
      {empMatch && (
        <div className={`rounded-xl border-2 px-3 py-2.5 flex items-center gap-3 ${
          deductionDefault > 0 ? 'border-primary/40 bg-primary/5' : 'border-amber-300 bg-amber-50'}`}>
          {deductionDefault > 0 ? (
            <>
              <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                checked={empDeduct} onChange={e => setEmpDeduct(e.target.checked)} />
              <div className="flex-1 text-sm">
                Odbiorca to pracownik <strong>{empMatch.name}</strong> — dopisz potrącenie
              </div>
              <Input className="w-28 h-9 text-right" type="number" step="0.01" min="0"
                value={empAmount} onChange={e => setEmpAmount(e.target.value)}
                disabled={!empDeduct} />
              <span className="text-sm text-muted-foreground">zł</span>
            </>
          ) : (
            <div className="text-sm text-amber-900">
              Odbiorca to pracownik <strong>{empMatch.name}</strong>, ale WZ jest bez
              wyceny — uzupełnij ceny, żeby powstało potrącenie.
            </div>
          )}
        </div>
      )}
```

6. W `submit`, w obiekcie przekazywanym do `wzApi.createManual`, dopisz:

```tsx
        payrollDeduction: empMatch && empDeduct && (parseFloat(empAmount) || 0) > 0
          ? { workerId: empMatch.workerId, amount: parseFloat(empAmount) }
          : null,
```

- [ ] **Step 3: Sprawdź typy i testy**

```bash
npm run typecheck && npm run test && npm run build
```

Oczekiwane: brak błędów, build przechodzi.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/pages/office/WzNewPage.tsx
git commit -m "feat(wz): pasek wykrycia pracownika z potraceniem na formularzu WZ"
```

---

### Task 17: Domknięcie — pełna regresja i notatka wdrożeniowa

**Files:**
- Modify: `docs/superpowers/plans/2026-08-07-pracownicy-godziny-potracenia.md` (odhaczenie)

- [ ] **Step 1: Pełna regresja backendu**

```bash
cd backend && TEST_DATABASE_URL="postgresql://postgres:p@localhost:55437/kebab_mes_test" \
  python3 -m pytest -q
```

Oczekiwane: 0 `failed`. Sprawdź w podsumowaniu, że liczba `passed` wzrosła o nowe testy, a nie że przybyło `skipped`.

- [ ] **Step 2: Pełna regresja frontu**

```bash
npm run typecheck && npm run test && npm run build
```

Oczekiwane: wszystko zielone.

- [ ] **Step 3: Sprawdź migracje na kopii bazy produkcyjnej**

Zanim cokolwiek pójdzie na VPS, uruchom migracje na świeżo odtworzonej bazie testowej i zweryfikuj DANE, nie sam fakt „migrations.done" — `run_migrations()` połyka błędy pojedynczych instrukcji:

```bash
cd backend && DATABASE_URL="$TEST_DATABASE_URL" \
  python3 -c "from app.migrations import run_migrations; run_migrations()"
psql "$TEST_DATABASE_URL" -c "\d worker_hours" -c "\d worker_deductions" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='payroll_settlements' AND column_name IN ('basis','hours_total','rate_per_hour')"
```

Oczekiwane: obie tabele istnieją z kompletem kolumn, zapytanie zwraca 3 wiersze.

- [ ] **Step 4: Obowiązkowy diff prod ↔ repo przed deployem**

Zgodnie z regułą repo: zmiany istniejące tylko na produkcji scommituj do `main` **przed** deployem, inaczej deploy je nadpisze.

```bash
diff -ru backend/app /opt/kebab/prod-snapshot/app | head -50
```

Jeśli diff pokazuje zmiany prod-only — zatrzymaj się i zgłoś je, zanim wdrożysz cokolwiek z tego planu.

- [ ] **Step 5: Commit domknięcia**

```bash
git add docs/superpowers/plans/2026-08-07-pracownicy-godziny-potracenia.md
git commit -m "docs(plan): domkniecie planu pracownicy/godziny/potracenia"
```

---

## Kolejność i zależności

```
Task 1 (schemat) ──┬─→ Task 2 → Task 3            [archiwizacja]
                   ├─→ Task 4 → Task 5 → Task 6 ──┐
                   │                              ├─→ Task 7 ─┐
                   ├─→ Task 8 ────────────────────┴─→ Task 9 ─┤
                   └─→ Task 10 → Task 11 → Task 12            │
                                                              │
        Task 13 → Task 14 [ekran godzin]  ←───────────────────┤
        Task 15 [rozliczenia] ←───────────────────────────────┘
        Task 16 [WZ front] ← Task 10, 11, 15
        Task 17 [regresja]
```

Task 1 blokuje wszystko. Ścieżki archiwizacji (2-3), godzin (4-7, 13-14), potrąceń (8-9) i WZ (10-12, 16) są między sobą niezależne aż do Taska 15, który spina podstawę godzinową z potrąceniami w jednym ekranie.
