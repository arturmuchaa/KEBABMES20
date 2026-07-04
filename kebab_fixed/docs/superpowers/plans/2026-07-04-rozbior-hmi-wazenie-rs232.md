# Ważenie automatyczne RS232 w HMI rozbiór v10 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (subagenty NIE mogą pisać do `backend/` ani `src/` — wykonanie inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Waga najazdowa podłączona po RS232 do komputera panelowego sama wypełnia pole „Mięso Z/S" w HMI rozbiór v10: operator wybiera wózek (4 stałe tary), liczbę pojemników E2 (×2,0 kg), wjeżdża na wagę, system liczy netto = brutto − tara i po stabilizacji odblokowuje zapis; ćwiartka pobrana pozostaje ręczna.

**Architecture:** Czytnik portu szeregowego w Rust (proces Tauri kiosku, wątek + eventy `scale://weight` do frontendu; protokół-agnostyczny parser + softwarowa detekcja stabilności). Frontend: hook `useScale` + czysty util `computeWeighing` + panel tary i karta wagi w `DeboningHmiV10Page` (wizualnie wg zaakceptowanego mockupu, artefakt 6a94965a). Backend: kolumny audytowe (brutto/tary/tryb) w `deboning_entries` + walidacja spójności netto przy zapisie auto. Gdy wagi nie ma (web, biuro, awaria portu) HMI działa dokładnie jak dziś — wpis ręczny.

**Tech Stack:** Tauri 2 (Rust, crate `serialport` 4 bez default features), React + TypeScript (vitest), FastAPI + psycopg2 (pytest, automigracje w `app/migrations.py`).

## Global Constraints

- Repo: `/opt/kebab/kebab_new/kebab_fixed/`, gałąź robocza `wazenie-rs232` od `main`; commity po polsku, konwencja `feat:`/`fix:`.
- Subagenty nie piszą do `backend/` ani większości `src/` — całość inline w sesji głównej.
- Backend testy: `cd backend && python3 -m pytest` (pattern: logika czysta bez DB, endpointów nie testować TestClientem — auth default-deny).
- Frontend testy: `npm test` (vitest, TZ=UTC), testy kolokowane `*.test.ts`.
- Stałe domenowe: tary wózków **5,5 / 6,0 / 6,5 / 7,0 kg**, pojemnik E2 = **2,0 kg**, pasmo kontroli **15–25 kg mięsa/pojemnik** (ostrzeżenie, nie blokada), tolerancja spójności backend **0,5 kg**.
- HMI bez wagi (brak Tauri / port martwy) musi zachowywać się identycznie jak obecnie — zero regresji wpisu ręcznego.
- Wątek wagi tylko w buildach kiosku (`--features kiosk`) — aplikacja biurowa nie otwiera portów.
- Paleta/typografia v10 bez zmian (tokeny `VARS` w `DeboningHmiV10Page.tsx`, mono `hmi-v10-mono`).

---

### Task 1: Backend — kolumny audytowe ważenia + walidacja spójności

**Files:**
- Modify: `backend/app/models/deboning.py` (DTO create)
- Modify: `backend/app/migrations.py` (ALTER TABLE)
- Modify: `backend/init_db.py:66-75` (CREATE TABLE deboning_entries)
- Modify: `backend/app/services/deboning_service.py` (`_map_deboning_entry`, `create_deboning_entry`, nowa funkcja czysta)
- Test: `backend/tests/test_deboning_weighing.py` (nowy)

**Interfaces:**
- Consumes: istniejące `DeboningEntryCreate`, `_map_deboning_entry`, INSERT w `create_deboning_entry`.
- Produces: DTO przyjmuje opcjonalne `kgGross`, `tareCartKg`, `tareE2Kg`, `e2Count`, `weighMode` (`'auto'|'manual'`); odpowiedź wpisu zawiera te pola camelCase; `validate_weighing_consistency(kg_gross, tare_cart_kg, tare_e2_kg, kg_meat, tolerance=0.5) -> Optional[str]` (czysta, importowalna w testach); zapis `weigh_mode='auto'` z niespójnym netto → HTTP 400.

- [ ] **Step 1: Gałąź robocza**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git checkout main && git pull && git checkout -b wazenie-rs232
```

- [ ] **Step 2: Napisz failing test**

Plik `backend/tests/test_deboning_weighing.py`:

```python
"""Ważenie automatyczne RS232 — DTO + walidacja spójności netto (logika czysta, bez DB)."""
import pytest
from app.models.deboning import DeboningEntryCreate
from app.services.deboning_service import validate_weighing_consistency


def test_dto_przyjmuje_pola_wagi_camelcase():
    dto = DeboningEntryCreate(
        rawBatchId="b1", kgTaken=160, kgMeat=150.5,
        kgGross=170.0, tareCartKg=5.5, tareE2Kg=14.0, e2Count=7, weighMode="auto",
    )
    assert dto.kg_gross == 170.0
    assert dto.tare_cart_kg == 5.5
    assert dto.tare_e2_kg == 14.0
    assert dto.e2_count == 7
    assert dto.weigh_mode == "auto"


def test_dto_pola_wagi_opcjonalne():
    dto = DeboningEntryCreate(rawBatchId="b1", kgTaken=160, kgMeat=150.5)
    assert dto.kg_gross is None and dto.weigh_mode is None


def test_dto_odrzuca_zly_weigh_mode():
    with pytest.raises(Exception):
        DeboningEntryCreate(rawBatchId="b1", kgTaken=160, kgMeat=150.5, weighMode="magic")


def test_spojnosc_ok_przyklad_z_hali():
    # 170,0 brutto − wózek 5,5 − 7×E2 14,0 = 150,5 netto
    assert validate_weighing_consistency(170.0, 5.5, 14.0, 150.5) is None


def test_spojnosc_w_tolerancji_pol_kg():
    assert validate_weighing_consistency(170.0, 5.5, 14.0, 150.9) is None


def test_spojnosc_blad_poza_tolerancja():
    msg = validate_weighing_consistency(170.0, 5.5, 14.0, 140.0)
    assert msg is not None and "Niespójne" in msg


def test_spojnosc_brak_brutto_nie_waliduje():
    assert validate_weighing_consistency(None, None, None, 150.5) is None
```

- [ ] **Step 3: Uruchom — ma FAILować**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_deboning_weighing.py -v`
Expected: FAIL/ERROR — `ImportError: cannot import name 'validate_weighing_consistency'` (i pola DTO nieznane).

- [ ] **Step 4: DTO — dopisz pola**

W `backend/app/models/deboning.py`, w klasie `DeboningEntryCreate` po linii `kg_bones: float = Field(0, alias="kgBones", ge=0)` dodaj:

```python
    # Ważenie automatyczne RS232 (HMI v10) — audyt brutto/tara; wszystkie
    # opcjonalne, wpis ręczny wysyła tylko weigh_mode='manual' albo nic.
    kg_gross: Optional[float] = Field(None, alias="kgGross", ge=0)
    tare_cart_kg: Optional[float] = Field(None, alias="tareCartKg", ge=0)
    tare_e2_kg: Optional[float] = Field(None, alias="tareE2Kg", ge=0)
    e2_count: Optional[int] = Field(None, alias="e2Count", ge=0)
    weigh_mode: Optional[str] = Field(None, alias="weighMode", pattern="^(auto|manual)$")
```

- [ ] **Step 5: Serwis — funkcja czysta + wpięcie w create + mapper + INSERT**

W `backend/app/services/deboning_service.py`:

(a) nad `create_deboning_entry` dodaj:

```python
def validate_weighing_consistency(
    kg_gross, tare_cart_kg, tare_e2_kg, kg_meat, tolerance: float = 0.5
):
    """Ważenie auto: netto z wagi (brutto − tary) musi zgadzać się z kg_meat.

    Zwraca komunikat błędu albo None. Czysta funkcja — testowana bez DB.
    Brak kg_gross → brak walidacji (wpis ręczny / stara wersja HMI).
    """
    if kg_gross is None:
        return None
    net = float(kg_gross) - float(tare_cart_kg or 0) - float(tare_e2_kg or 0)
    if abs(net - float(kg_meat)) > tolerance:
        return (
            f"Niespójne ważenie: brutto {kg_gross} kg − tara "
            f"{float(tare_cart_kg or 0) + float(tare_e2_kg or 0):g} kg = {net:g} kg, "
            f"a wysłano {kg_meat} kg mięsa"
        )
    return None
```

(b) w `create_deboning_entry`, zaraz po odczytaniu `kg_meat = float(dto.kg_meat)` dodaj:

```python
    if dto.weigh_mode == "auto":
        err = validate_weighing_consistency(
            dto.kg_gross, dto.tare_cart_kg, dto.tare_e2_kg, kg_meat
        )
        if err:
            raise HTTPException(400, err)
```

(c) w INSERT (linia ~162) rozszerz kolumny i wartości:

```python
        entry = cx_execute_returning(
            conn,
            """
            INSERT INTO deboning_entries
                (id, raw_batch_id, raw_batch_no, session_id, session_no,
                 kg_quarter, kg_meat, kg_remainder, yield_pct,
                 worker_id, worker_name,
                 kg_gross, tare_cart_kg, tare_e2_kg, e2_count, weigh_mode,
                 created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                entry_id,
                batch["id"],
                batch["internal_batch_no"],
                session_id,
                session_no,
                kg_taken,
                kg_meat,
                kg_remainder,
                yield_pct,
                worker_id,
                worker_name,
                dto.kg_gross,
                dto.tare_cart_kg,
                dto.tare_e2_kg,
                dto.e2_count,
                dto.weigh_mode,
                now_iso(),
            ),
        )
```

(d) w `_map_deboning_entry` przed `"createdAt"` dodaj:

```python
        "kgGross": float(row["kg_gross"]) if row.get("kg_gross") is not None else None,
        "tareCartKg": float(row["tare_cart_kg"]) if row.get("tare_cart_kg") is not None else None,
        "tareE2Kg": float(row["tare_e2_kg"]) if row.get("tare_e2_kg") is not None else None,
        "e2Count": row.get("e2_count"),
        "weighMode": row.get("weigh_mode"),
```

- [ ] **Step 6: Migracje + świeża baza**

W `backend/app/migrations.py` dopisz do listy migracji (obok innych `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`):

```python
    # Ważenie automatyczne RS232 (HMI rozbiór v10) — audyt brutto/tara/tryb.
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS kg_gross NUMERIC(10,3)",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS tare_cart_kg NUMERIC(10,3)",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS tare_e2_kg NUMERIC(10,3)",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS e2_count INTEGER",
    "ALTER TABLE deboning_entries ADD COLUMN IF NOT EXISTS weigh_mode TEXT",
```

W `backend/init_db.py` w `CREATE TABLE IF NOT EXISTS deboning_entries` po `worker_id TEXT, worker_name TEXT,` dodaj:

```sql
    kg_gross NUMERIC(10,3), tare_cart_kg NUMERIC(10,3), tare_e2_kg NUMERIC(10,3),
    e2_count INTEGER, weigh_mode TEXT,
```

- [ ] **Step 7: Testy — mają przejść (plus całość bez regresji)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/backend && python3 -m pytest tests/test_deboning_weighing.py -v && python3 -m pytest`
Expected: nowy plik 7 passed; pełny zestaw bez nowych FAILi.

- [ ] **Step 8: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add backend/app/models/deboning.py backend/app/migrations.py backend/init_db.py backend/app/services/deboning_service.py backend/tests/test_deboning_weighing.py
git commit -m "feat(rozbior): kolumny audytowe ważenia RS232 + walidacja spójności netto"
```

---

### Task 2: Frontend — czysty util `computeWeighing` (vitest)

**Files:**
- Create: `src/features/deboning/utils/weighing.ts`
- Test: `src/features/deboning/utils/weighing.test.ts`

**Interfaces:**
- Produces (używane w Task 5):

```ts
export const E2_TARE_KG = 2.0
export const CART_TARES_KG: readonly number[] = [5.5, 6.0, 6.5, 7.0]
export const KG_PER_E2_MIN = 15
export const KG_PER_E2_MAX = 25
export interface WeighingInput  { gross: number; cartTareKg: number | null; e2Count: number }
export interface WeighingResult {
  tareE2Kg: number; tareTotalKg: number; netKg: number
  kgPerContainer: number; plausible: boolean; ready: boolean
}
export function computeWeighing(input: WeighingInput): WeighingResult
```

- [ ] **Step 1: Failing test**

Plik `src/features/deboning/utils/weighing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeWeighing, E2_TARE_KG, CART_TARES_KG } from './weighing'

describe('computeWeighing', () => {
  it('przykład z hali: 170,0 − wózek 5,5 − 7×E2 = 150,5 netto, 21,5 kg/poj (w normie)', () => {
    const r = computeWeighing({ gross: 170.0, cartTareKg: 5.5, e2Count: 7 })
    expect(r.tareE2Kg).toBe(14.0)
    expect(r.tareTotalKg).toBe(19.5)
    expect(r.netKg).toBe(150.5)
    expect(r.kgPerContainer).toBeCloseTo(21.5, 5)
    expect(r.plausible).toBe(true)
    expect(r.ready).toBe(true)
  })

  it('bez wybranego wózka nie liczy netto', () => {
    const r = computeWeighing({ gross: 170.0, cartTareKg: null, e2Count: 7 })
    expect(r.netKg).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('bez pojemników nie liczy netto', () => {
    const r = computeWeighing({ gross: 170.0, cartTareKg: 5.5, e2Count: 0 })
    expect(r.ready).toBe(false)
  })

  it('brutto poniżej tary → netto 0 (pusta waga / sam wózek)', () => {
    const r = computeWeighing({ gross: 12.0, cartTareKg: 5.5, e2Count: 7 })
    expect(r.netKg).toBe(0)
    expect(r.ready).toBe(false)
  })

  it('poza pasmem 15–25 kg/poj → plausible=false (np. źle policzone E2)', () => {
    const r = computeWeighing({ gross: 80.0, cartTareKg: 5.5, e2Count: 7 })  // ~8,6 kg/poj
    expect(r.ready).toBe(true)
    expect(r.plausible).toBe(false)
  })

  it('zaokrągla netto do 0,1 kg (unika artefaktów float)', () => {
    const r = computeWeighing({ gross: 170.05, cartTareKg: 6.5, e2Count: 3 })
    expect(r.netKg).toBe(157.6)  // 170.05−6.5−6.0 = 157.55 → 157.6
  })

  it('stałe domenowe zgodne z halą', () => {
    expect(E2_TARE_KG).toBe(2.0)
    expect(CART_TARES_KG).toEqual([5.5, 6.0, 6.5, 7.0])
  })
})
```

- [ ] **Step 2: Uruchom — FAIL**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx vitest run src/features/deboning/utils/weighing.test.ts`
Expected: FAIL — `Cannot find module './weighing'`.

- [ ] **Step 3: Implementacja**

Plik `src/features/deboning/utils/weighing.ts`:

```ts
/**
 * weighing.ts — czysta matematyka ważenia automatycznego (HMI rozbiór v10).
 *
 * Wózek z pojemnikami E2 wjeżdża na wagę najazdową; netto mięsa =
 * brutto − tara wózka − n × tara E2. Pasmo 15–25 kg mięsa na pojemnik to
 * kontrola wiarygodności (najczęstszy błąd operatora: źle policzone E2) —
 * ostrzeżenie, nie blokada.
 */

export const E2_TARE_KG = 2.0
/** Cztery fizyczne typy wózków na hali — tary potwierdzone przez użytkownika. */
export const CART_TARES_KG: readonly number[] = [5.5, 6.0, 6.5, 7.0]
export const KG_PER_E2_MIN = 15
export const KG_PER_E2_MAX = 25

export interface WeighingInput {
  gross: number
  cartTareKg: number | null
  e2Count: number
}

export interface WeighingResult {
  tareE2Kg: number
  tareTotalKg: number
  netKg: number
  kgPerContainer: number
  plausible: boolean
  /** true = jest sensowne netto do zapisania (tara wybrana i brutto > tara) */
  ready: boolean
}

const round1 = (x: number) => Math.round(x * 10) / 10

export function computeWeighing({ gross, cartTareKg, e2Count }: WeighingInput): WeighingResult {
  const taraSet = cartTareKg != null && e2Count > 0
  const tareE2Kg = round1(e2Count * E2_TARE_KG)
  const tareTotalKg = taraSet ? round1((cartTareKg as number) + tareE2Kg) : 0
  const netKg = taraSet && gross > tareTotalKg ? round1(gross - tareTotalKg) : 0
  const kgPerContainer = netKg > 0 && e2Count > 0 ? netKg / e2Count : 0
  const plausible = kgPerContainer >= KG_PER_E2_MIN && kgPerContainer <= KG_PER_E2_MAX
  return { tareE2Kg, tareTotalKg, netKg, kgPerContainer, plausible, ready: netKg > 0 }
}
```

- [ ] **Step 4: Testy PASS + pełny vitest**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm test`
Expected: nowe testy passed, reszta bez regresji.

- [ ] **Step 5: Commit**

```bash
git add src/features/deboning/utils/weighing.ts src/features/deboning/utils/weighing.test.ts
git commit -m "feat(rozbior): computeWeighing — netto z brutto i tar, kontrola kg/pojemnik"
```

---

### Task 3: Rust — most wagowy RS232 (parser + stabilność + wątek + eventy)

**Files:**
- Create: `src-tauri/src/scale.rs`
- Modify: `src-tauri/src/lib.rs` (mod + spawn w setup)
- Modify: `src-tauri/Cargo.toml` (dependency `serialport`)
- Test: testy jednostkowe `#[cfg(test)]` w `scale.rs`

**Interfaces:**
- Produces: event Tauri `scale://weight` z payloadem `{ gross: number, stable: boolean, connected: boolean }` (camelCase przez serde rename), emitowany ≤ ~8/s; konfiguracja `scale.json` obok exe lub w app_config_dir: `{ "enabled": true, "port": "COM3", "baud": 9600 }` (defaults gdy brak pliku). Wątek startuje TYLKO w buildach `--features kiosk`.
- Consumes: nic z innych tasków.

- [ ] **Step 1: Dependency**

W `src-tauri/Cargo.toml` w `[dependencies]` dodaj (default-features off → bez libudev, kompiluje się też na Linuksie dev; otwieranie portu po nazwie działa bez enumeracji):

```toml
# Most wagowy RS232 (HMI rozbiór v10): odczyt wagi najazdowej z portu
# szeregowego. default-features=false — bez enumeracji udev, port otwieramy
# po nazwie z configu (COM3), co kompiluje się czysto na Linux/Windows.
serialport = { version = "4", default-features = false }
```

- [ ] **Step 2: Moduł `scale.rs` z failing testami (napisz całość, testy najpierw sprawdź że failują bez implementacji — w praktyce: napisz testy, `cargo test` FAIL, potem funkcje)**

Plik `src-tauri/src/scale.rs`:

```rust
//! Most wagowy RS232 → eventy `scale://weight` do frontendu HMI rozbiór v10.
//!
//! Protokół-agnostyczny: z każdej linii ASCII miernika wyciąga pierwszą
//! liczbę (kropka LUB przecinek dziesiętny), a stabilność liczy softwarowo
//! (okno odczytów o rozrzucie ≤ 0,1 kg przez ≥ 1,5 s) — działa więc z każdą
//! wagą w trybie transmisji ciągłej, bez znajomości formatu ramki.
//! Konfiguracja: `scale.json` obok exe albo w app_config_dir (port/baud).

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

pub const EVENT: &str = "scale://weight";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleReading {
    pub gross: f64,
    pub stable: bool,
    pub connected: bool,
}

#[derive(Deserialize)]
#[serde(default)]
pub struct ScaleConfig {
    pub enabled: bool,
    pub port: String,
    pub baud: u32,
}

impl Default for ScaleConfig {
    fn default() -> Self {
        Self { enabled: true, port: "COM3".into(), baud: 9600 }
    }
}

/// Pierwsza liczba w ramce, np. "ST,GS,+  170.0kg" → 170.0, "0170,5" → 170.5.
pub fn parse_weight(line: &str) -> Option<f64> {
    let mut buf = String::new();
    let mut seen_digit = false;
    for c in line.chars() {
        match c {
            '0'..='9' => {
                buf.push(c);
                seen_digit = true;
            }
            '.' | ',' if seen_digit && !buf.contains('.') => buf.push('.'),
            '-' if buf.is_empty() => buf.push('-'),
            _ if seen_digit => break,
            _ => buf.clear(),
        }
    }
    if !seen_digit {
        return None;
    }
    buf.trim_end_matches('.').parse::<f64>().ok()
}

/// Softwarowa detekcja stabilności: okno czasowe odczytów; stabilna gdy w
/// ostatnich `span` jest ≥ `min_count` odczytów o rozrzucie ≤ `tol` kg.
pub struct StabilityWindow {
    readings: VecDeque<(Instant, f64)>,
    span: Duration,
    tol: f64,
    min_count: usize,
}

impl StabilityWindow {
    pub fn new() -> Self {
        Self {
            readings: VecDeque::new(),
            span: Duration::from_millis(1500),
            tol: 0.1,
            min_count: 5,
        }
    }

    /// Dodaje odczyt, zwraca czy waga jest stabilna.
    pub fn push(&mut self, now: Instant, weight: f64) -> bool {
        self.readings.push_back((now, weight));
        while let Some(&(t, _)) = self.readings.front() {
            if now.duration_since(t) > self.span {
                self.readings.pop_front();
            } else {
                break;
            }
        }
        if self.readings.len() < self.min_count {
            return false;
        }
        let (mut lo, mut hi) = (f64::MAX, f64::MIN);
        for &(_, v) in &self.readings {
            lo = lo.min(v);
            hi = hi.max(v);
        }
        hi - lo <= self.tol
    }
}

fn load_config(app: &tauri::AppHandle) -> ScaleConfig {
    let mut paths = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            paths.push(dir.join("scale.json"));
        }
    }
    if let Ok(dir) = app.path().app_config_dir() {
        paths.push(dir.join("scale.json"));
    }
    for p in paths {
        if let Ok(s) = std::fs::read_to_string(&p) {
            match serde_json::from_str(&s) {
                Ok(cfg) => return cfg,
                Err(e) => eprintln!("scale.json niepoprawny ({}): {e}", p.display()),
            }
        }
    }
    ScaleConfig::default()
}

/// Wątek czytający wagę przez cały czas życia aplikacji; po błędzie portu
/// emituje `connected: false` i ponawia otwarcie co 3 s.
pub fn spawn_reader(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let cfg = load_config(&app);
        if !cfg.enabled {
            return;
        }
        loop {
            match serialport::new(&cfg.port, cfg.baud)
                .timeout(Duration::from_millis(500))
                .open()
            {
                Ok(port) => read_loop(&app, port),
                Err(_) => {
                    let _ = app.emit(
                        EVENT,
                        ScaleReading { gross: 0.0, stable: false, connected: false },
                    );
                }
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

fn read_loop(app: &tauri::AppHandle, port: Box<dyn serialport::SerialPort>) {
    let mut reader = BufReader::new(port);
    let mut window = StabilityWindow::new();
    let mut line = String::new();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return, // port zniknął (odpięty kabel/USB)
            Ok(_) => {
                if let Some(gross) = parse_weight(&line) {
                    let stable = window.push(Instant::now(), gross);
                    if last_emit.elapsed() >= Duration::from_millis(120) {
                        last_emit = Instant::now();
                        let _ = app.emit(
                            EVENT,
                            ScaleReading { gross, stable, connected: true },
                        );
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
            Err(_) => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_ramka_st_gs() {
        assert_eq!(parse_weight("ST,GS,+  170.0kg\r\n"), Some(170.0));
    }

    #[test]
    fn parser_przecinek_dziesietny() {
        assert_eq!(parse_weight("  0150,5 kg"), Some(150.5));
    }

    #[test]
    fn parser_liczba_ujemna_i_zero() {
        assert_eq!(parse_weight("-0.4kg"), Some(-0.4));
        assert_eq!(parse_weight("W+000.0"), Some(0.0));
    }

    #[test]
    fn parser_smieci_bez_liczby() {
        assert_eq!(parse_weight("ERR OVERLOAD"), None);
        assert_eq!(parse_weight(""), None);
    }

    #[test]
    fn stabilnosc_wymaga_min_odczytow() {
        let mut w = StabilityWindow::new();
        let t0 = Instant::now();
        assert!(!w.push(t0, 170.0));
        assert!(!w.push(t0 + Duration::from_millis(200), 170.0));
        assert!(!w.push(t0 + Duration::from_millis(400), 170.0));
        assert!(!w.push(t0 + Duration::from_millis(600), 170.05));
        // 5. odczyt w oknie, rozrzut 0,05 ≤ 0,1 → stabilna
        assert!(w.push(t0 + Duration::from_millis(800), 170.0));
    }

    #[test]
    fn stabilnosc_rozrzut_ponad_tolerancje() {
        let mut w = StabilityWindow::new();
        let t0 = Instant::now();
        for (i, v) in [168.0, 169.5, 170.4, 169.9, 170.1].iter().enumerate() {
            assert!(!w.push(t0 + Duration::from_millis(200 * i as u64), *v));
        }
    }

    #[test]
    fn stabilnosc_stare_odczyty_wypadaja_z_okna() {
        let mut w = StabilityWindow::new();
        let t0 = Instant::now();
        // skok wagi dawno temu nie psuje stabilności teraz
        w.push(t0, 20.0);
        for i in 1..=5 {
            w.push(t0 + Duration::from_millis(1600 + 200 * i), 170.0);
        }
        assert!(w.push(t0 + Duration::from_millis(3000), 170.0));
    }

    #[test]
    fn config_default_gdy_brak_pliku() {
        let cfg = ScaleConfig::default();
        assert!(cfg.enabled);
        assert_eq!(cfg.port, "COM3");
        assert_eq!(cfg.baud, 9600);
    }
}
```

- [ ] **Step 3: Wpięcie w `lib.rs`**

W `src-tauri/src/lib.rs`:

(a) po `use tauri_plugin_updater::UpdaterExt;` dodaj:

```rust
mod scale;
```

(b) w `setup(|_app| {` wewnątrz istniejącego bloku `#[cfg(feature = "kiosk")] {` (przed pętlą silent update) dodaj:

```rust
                // Most wagowy RS232 (HMI rozbiór v10): wątek czyta wagę
                // najazdową i emituje `scale://weight`. Tylko kiosk — appka
                // biurowa nie ma prawa dotykać portów szeregowych.
                scale::spawn_reader(_app.handle().clone());
```

- [ ] **Step 4: cargo test + cargo check z feature kiosk**

Run: `cd /opt/kebab/kebab_new/kebab_fixed/src-tauri && cargo test && cargo check --features kiosk`
Expected: 8 testów scale passed; check bez błędów. (Jeśli na tej maszynie brak toolchaina/cache — odnotuj i zweryfikuj przez CI po pushu; NIE pomijaj milcząco.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/scale.rs src-tauri/src/lib.rs
git commit -m "feat(rozbior): most wagowy RS232 w Tauri — parser ramek, stabilność, eventy scale://weight"
```

---

### Task 4: Frontend — hook `useScale` + symulator dev

**Files:**
- Create: `src/features/deboning/useScale.ts`

**Interfaces:**
- Consumes: event `scale://weight` `{ gross, stable, connected }` z Task 3.
- Produces (używane w Task 5):

```ts
export interface ScaleState {
  gross: number; stable: boolean; connected: boolean
  /** true = jest źródło wagi (Tauri kiosk albo włączony symulator) */
  available: boolean
}
export function useScale(): ScaleState
```

  Symulator dev/E2E: `window.__scaleSim(gross: number, stable?: boolean)` — ustawia odczyt (działa też poza Tauri, np. `npm run dev`); `window.__scaleSim(null)` wyłącza symulator.

- [ ] **Step 1: Implementacja**

Plik `src/features/deboning/useScale.ts`:

```ts
/**
 * useScale — odczyt wagi najazdowej na żywo (HMI rozbiór v10).
 *
 * W kiosku Tauri nasłuchuje eventów `scale://weight` z mostu RS232 (Rust,
 * src-tauri/src/scale.rs). Poza Tauri (web/dev) waga jest niedostępna i HMI
 * działa jak dotychczas — chyba że test/dev włączy symulator:
 *   window.__scaleSim(170.0)        // brutto 170,0; stable=true
 *   window.__scaleSim(93.2, false)  // ważenie w toku
 *   window.__scaleSim(null)         // wyłącz symulator
 */
import { useEffect, useRef, useState } from 'react'

export interface ScaleReading {
  gross: number
  stable: boolean
  connected: boolean
}

export interface ScaleState extends ScaleReading {
  available: boolean
}

const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const OFF: ScaleReading = { gross: 0, stable: false, connected: false }

export function useScale(): ScaleState {
  const [reading, setReading] = useState<ScaleReading>(OFF)
  const [simActive, setSimActive] = useState(false)
  const simRef = useRef(false)

  useEffect(() => {
    ;(window as any).__scaleSim = (gross: number | null, stable = true) => {
      if (gross == null) {
        simRef.current = false
        setSimActive(false)
        setReading(OFF)
        return
      }
      simRef.current = true
      setSimActive(true)
      setReading({ gross, stable, connected: true })
    }
    return () => {
      delete (window as any).__scaleSim
    }
  }, [])

  useEffect(() => {
    if (!IS_TAURI) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<ScaleReading>('scale://weight', e => {
        if (!simRef.current) setReading(e.payload)
      }),
    ).then(fn => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return { ...reading, available: IS_TAURI || simActive }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit`
Expected: bez nowych błędów.

- [ ] **Step 3: Commit**

```bash
git add src/features/deboning/useScale.ts
git commit -m "feat(rozbior): hook useScale — eventy wagi z Tauri + symulator dev"
```

---

### Task 5: UI — panel tary i karta wagi w DeboningHmiV10Page (wg mockupu)

**Files:**
- Modify: `src/pages/tablet/DeboningHmiV10Page.tsx`
- Modify: `src/features/deboning/types/index.ts` (DTO + DeboningEntry o pola wagi)

**Interfaces:**
- Consumes: `useScale()` (Task 4), `computeWeighing`, `CART_TARES_KG`, `E2_TARE_KG`, `KG_PER_E2_MIN/MAX` (Task 2), backend przyjmuje `kgGross/tareCartKg/tareE2Kg/e2Count/weighMode` (Task 1).
- Produces: zachowanie zgodne z zaakceptowanym mockupem (artefakt 6a94965a): kafle wózków, licznik E2, auto-netto w polu „Mięso Z/S", karta wagi w prawej kolumnie, kontrola kg/pojemnik, przycisk Zapisz odblokowany dopiero przy stabilnej wadze (w trybie auto).

**Zasady zachowania (kontrakt UX):**
1. `scale.available === false` → strona renderuje się DOKŁADNIE jak dziś (zero zmian wizualnych i logicznych).
2. Tryb auto (domyślny przy dostępnej wadze): pole „Mięso Z/S" pokazuje netto z `computeWeighing`; numpad pisze tylko do „Ćwiartka pobrana"; tap w pole „Mięso Z/S" przełącza na tryb ręczny (`weighMode='manual'`, numpad znów pisze do mięsa — awaryjnie, np. waga padła w trakcie zmiany).
3. Zapis w trybie auto wymaga: partia + pracownik + wózek + E2>0 + waga stabilna + netto>0 + ćwiartka>0 + netto ≤ ćwiartka; wysyła `kgMeat=netKg, kgGross, tareCartKg, tareE2Kg, e2Count, weighMode:'auto'`.
4. Po zapisie: ćwiartka czyszczona, wózek i liczba E2 ZOSTAJĄ (kolejny wózek zwykle taki sam), tryb wraca na auto.
5. Kontrola 15–25 kg/poj: chip ostrzegawczy (amber) przy karcie wagi — nie blokuje zapisu.

- [ ] **Step 1: Typy frontendu**

W `src/features/deboning/types/index.ts`:

(a) w `DeboningEntry` po `readonly meatLotNo?: string` dodaj:

```ts
  // Ważenie automatyczne RS232 — audyt (null dla wpisów ręcznych/starych)
  readonly kgGross?:    number | null
  readonly tareCartKg?: number | null
  readonly tareE2Kg?:   number | null
  readonly e2Count?:    number | null
  readonly weighMode?:  'auto' | 'manual' | null
```

(b) w `CreateDeboningEntryDto` po `notes?: string` dodaj:

```ts
  kgGross?:    number
  tareCartKg?: number
  tareE2Kg?:   number
  e2Count?:    number
  weighMode?:  'auto' | 'manual'
```

- [ ] **Step 2: Importy + stan w `DeboningHmiV10Page.tsx`**

(a) do importów dodaj:

```ts
import { Scale, Minus, Plus } from 'lucide-react'
import { useScale } from '@/features/deboning/useScale'
import {
  computeWeighing, CART_TARES_KG, E2_TARE_KG, KG_PER_E2_MIN, KG_PER_E2_MAX,
} from '@/features/deboning/utils/weighing'
```

(`Scale`, `Minus`, `Plus` dopisz do istniejącego importu z `lucide-react`.)

(b) w komponencie, po istniejących `useState` (obok `takenMode`) dodaj:

```ts
  const scale = useScale()
  const [cartTare, setCartTare] = useState<number | null>(null)
  const [e2Count,  setE2Count]  = useState(0)
  // false = mięso z wagi (auto); true = operator przejął ręcznie (awaryjnie)
  const [meatManual, setMeatManual] = useState(false)

  const weighing = useMemo(
    () => computeWeighing({ gross: scale.gross, cartTareKg: cartTare, e2Count }),
    [scale.gross, cartTare, e2Count],
  )
  const autoMode = scale.available && !meatManual
  const autoNet  = autoMode && scale.connected && scale.stable ? weighing.netKg : 0
```

(c) zamień wyliczenie `meat` (linia ~387 `const meat = parseFloat(kgMeat) || 0`) na:

```ts
  const meat = autoMode ? autoNet : (parseFloat(kgMeat) || 0)
```

(d) rozszerz `canSave` i `saveHint` (zastąp istniejące):

```ts
  const canSave = !!selBatch && !!selWorker && taken > 0 && meat > 0 && !meatTooBig
    && (!autoMode || (scale.stable && weighing.ready))

  const saveHint = !selBatch ? 'WYBIERZ PARTIĘ'
    : !selWorker ? 'WYBIERZ PRACOWNIKA'
    : autoMode && cartTare == null ? 'WYBIERZ WÓZEK'
    : autoMode && e2Count <= 0 ? 'DODAJ POJEMNIKI E2'
    : autoMode && !scale.connected ? 'WAGA NIEPODŁĄCZONA'
    : autoMode && weighing.netKg <= 0 ? 'WJEDŹ NA WAGĘ'
    : autoMode && !scale.stable ? 'CZEKAM NA STABILNĄ WAGĘ…'
    : taken <= 0 ? 'PODAJ WAGĘ ZABRANĄ'
    : meat <= 0 ? 'PODAJ WAGĘ MIĘSA'
    : meatTooBig ? 'MIĘSO > ZABRANE!'
    : autoMode ? `ZAPISZ — ${fmtKg(meat, 1)} KG MIĘSA` : 'ZAPISZ WPIS'
```

- [ ] **Step 3: Zapis z metadanymi wagi**

W `handleSave` zamień wywołanie `addEntry` na:

```ts
    const err = await addEntry(
      {
        sessionId: session.id, rawBatchId: selBatch.id, workerId: selWorker.id,
        kgTaken: taken, kgMeat: meat,
        ...(scale.available ? {
          weighMode: autoMode ? 'auto' as const : 'manual' as const,
          ...(autoMode ? {
            kgGross: scale.gross,
            tareCartKg: cartTare ?? undefined,
            tareE2Kg: weighing.tareE2Kg,
            e2Count,
          } : {}),
        } : {}),
      },
      session, Number(selBatch.kgAvailable), selBatch.expiryDate,
    )
```

a po udanym zapisie (obok `setKgTaken(''); setKgMeat('')`) dodaj powrót do auto:

```ts
    setMeatManual(false)
```

(wózek i `e2Count` celowo zostają — patrz kontrakt UX pkt 4).

- [ ] **Step 4: Interakcje pól — auto/ręczne**

(a) `ReadoutV10` dla „Mięso Z/S" (linia ~636) zamień na:

```tsx
            <ReadoutV10
              label={autoMode ? 'Mięso Z/S — z wagi' : 'Mięso Z/S'}
              unit="kg"
              value={autoMode ? (autoNet > 0 ? fmtKg(autoNet, 1) : '') : kgMeat}
              active={!autoMode && active === 'meat'}
              error={meatTooBig}
              onActivate={() => {
                // tap w pole przy dostępnej wadze = świadome przejęcie ręczne
                if (scale.available) setMeatManual(true)
                setActive('meat')
              }}
              sub={meatTooBig ? `Mięso nie może przekraczać ${fmtKg(taken, 0)} kg!`
                : autoMode ? (autoNet > 0
                    ? `= ${fmtKg(scale.gross, 1)} − ${fmtKg(weighing.tareTotalKg, 1)} tara`
                    : weighing.ready ? 'czekam na stabilną wagę…' : 'wybierz wózek i pojemniki')
                : yieldPct > 0 ? `${fmtPct(yieldPct, 1)} wydajność` : ''}
              extraHeader={scale.available ? (
                <span role="button"
                  onClick={e => { e.stopPropagation(); setMeatManual(m => !m) }}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold uppercase cursor-pointer"
                  style={{ borderRadius: 6, background: autoMode ? 'var(--accentSoft)' : 'var(--ambSoft)',
                    color: autoMode ? 'var(--accent)' : 'var(--amb)',
                    border: `1px solid ${autoMode ? 'var(--accentSoft)' : 'var(--ambLine)'}` }}>
                  <Scale size={11} /> {autoMode ? 'AUTO' : 'RĘCZNIE'}
                </span>
              ) : undefined}
            />
```

(b) w `pressKey` — w trybie auto numpad pisze tylko do ćwiartki; dodaj na początku callbacka:

```ts
    if (active === 'meat' && scale.available && !meatManual) setMeatManual(true)
```

(zależności `useCallback` rozszerz o `scale.available` i `meatManual`).

- [ ] **Step 5: Panel tary (środkowa kolumna, między readoutami a numpadem)**

Bezpośrednio POD `<div className="flex gap-2 flex-shrink-0">…readouty…</div>`, renderowany tylko gdy `scale.available`:

```tsx
          {scale.available && (
            <div className="flex-shrink-0 p-3 flex flex-col gap-2.5"
              style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>
                  Tara — wózek i pojemniki E2
                </span>
                <span className="hmi-v10-mono text-sm font-bold">
                  {cartTare != null && e2Count > 0
                    ? `${fmtKg(cartTare, 1)} + ${e2Count} × ${fmtKg(E2_TARE_KG, 1)} = ${fmtKg(weighing.tareTotalKg, 1)} kg`
                    : '—'}
                </span>
              </div>
              <div className="flex gap-2">
                {CART_TARES_KG.map(w => (
                  <button key={w} type="button" onClick={() => setCartTare(w)}
                    className="flex-1 flex flex-col items-center gap-0.5 py-2 transition-all active:scale-[0.97]"
                    style={{
                      borderRadius: 10,
                      background: cartTare === w ? 'var(--accent)' : 'var(--panel)',
                      border: `1.5px solid ${cartTare === w ? 'var(--accent)' : 'var(--line)'}`,
                      color: cartTare === w ? '#fff' : 'var(--ink)',
                    }}>
                    <span className="hmi-v10-mono font-bold text-2xl leading-none">{fmtKg(w, 1)}</span>
                    <span className="text-[10px] font-bold uppercase"
                      style={{ color: cartTare === w ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>kg · wózek</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setE2Count(n => Math.max(0, n - 1))}
                  className="w-16 h-14 flex items-center justify-center flex-shrink-0 active:bg-[var(--ink)] active:text-white"
                  style={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                  <Minus size={26} />
                </button>
                <div className="flex-1 text-center">
                  <div className="hmi-v10-mono font-bold text-4xl leading-none">{e2Count}</div>
                  <div className="text-xs font-semibold mt-1" style={{ color: 'var(--mut)' }}>
                    pojemników E2 × {fmtKg(E2_TARE_KG, 1)} kg{e2Count > 0 ? ` = ${fmtKg(weighing.tareE2Kg, 1)} kg` : ''}
                  </div>
                </div>
                <button type="button" onClick={() => setE2Count(n => Math.min(20, n + 1))}
                  className="w-16 h-14 flex items-center justify-center flex-shrink-0 active:bg-[var(--ink)] active:text-white"
                  style={{ borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)' }}>
                  <Plus size={26} />
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 6: Karta wagi (prawa kolumna)**

Gdy `scale.available`, karta wagi ZASTĘPUJE kartę „Wydajność i tempo" (jak w mockupie; wydajność zostaje w modalu Statystyki). Istniejący blok `<div className="flex-shrink-0 p-3.5" …>Wydajność i tempo…</div>` opakuj: `{!scale.available && (…istniejąca karta…)}` a przed nim dodaj:

```tsx
          {scale.available && (
            <div className="flex-shrink-0 p-3.5" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div className="flex items-center gap-2">
                <span className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                  style={{ background: scale.connected ? 'var(--success)' : 'var(--red)',
                    boxShadow: scale.connected ? '0 0 0 3px rgba(22,163,74,.18)' : '0 0 0 3px rgba(220,38,38,.15)' }} />
                <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Waga najazdowa</span>
                <span className="hmi-v10-mono text-[11px] font-bold ml-auto" style={{ color: 'var(--mut)' }}>
                  {scale.connected ? 'RS232' : 'BRAK POŁĄCZENIA'}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mt-1.5">
                <span className="hmi-v10-mono font-bold leading-none" style={{ fontSize: 'clamp(44px, 3.6vw, 64px)' }}>
                  {fmtKg(scale.gross, 1)}
                </span>
                <span className="text-lg font-bold" style={{ color: 'var(--mut)' }}>kg</span>
                <span className="ml-auto flex items-center gap-2 px-3 h-8 text-[13px] font-bold self-center"
                  style={scale.connected && scale.gross > 0
                    ? scale.stable
                      ? { borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF0D3', color: 'var(--success)' }
                      : { borderRadius: 8, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }
                    : { borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}>
                  {scale.connected && scale.gross > 0 ? (scale.stable ? 'STABILNA' : 'WAŻENIE…') : 'PUSTA'}
                </span>
              </div>
              <div className="mt-2 pt-2 flex flex-col gap-1" style={{ borderTop: '1px solid var(--lineSoft)' }}>
                <div className="flex justify-between text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>
                  <span>− tara wózka</span>
                  <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{cartTare != null ? `−${fmtKg(cartTare, 1)} kg` : '—'}</span>
                </div>
                <div className="flex justify-between text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>
                  <span>− pojemniki E2 ({e2Count} × {fmtKg(E2_TARE_KG, 1)})</span>
                  <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{e2Count > 0 ? `−${fmtKg(weighing.tareE2Kg, 1)} kg` : '—'}</span>
                </div>
                <div className="flex items-baseline justify-between px-3 py-2 mt-1" style={{ borderRadius: 8, background: 'var(--accentSoft)' }}>
                  <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)', letterSpacing: '.08em' }}>Netto mięso</span>
                  <span className="hmi-v10-mono font-bold text-2xl" style={{ color: 'var(--accent)' }}>
                    {weighing.netKg > 0 ? `${fmtKg(weighing.netKg, 1)} kg` : '—'}
                  </span>
                </div>
                {weighing.netKg > 0 && (
                  <div className="px-3 py-1.5 text-[12px] font-bold" style={weighing.plausible
                    ? { borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF0D3', color: 'var(--success)' }
                    : { borderRadius: 8, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}>
                    {weighing.plausible
                      ? `✓ ${fmtKg(weighing.kgPerContainer, 1)} kg / pojemnik — w normie (${KG_PER_E2_MIN}–${KG_PER_E2_MAX} kg)`
                      : `⚠ ${fmtKg(weighing.kgPerContainer, 1)} kg / pojemnik — poza normą ${KG_PER_E2_MIN}–${KG_PER_E2_MAX} kg. Sprawdź liczbę E2 i wózek!`}
                  </div>
                )}
              </div>
            </div>
          )}
```

- [ ] **Step 7: Kroki ①②③④ (nagłówek środkowej kolumny)**

Gdy `scale.available`, sekcja kroków pokazuje 4 kroki; istniejący trzeci (`Waga`) zamień na:

```tsx
            {scale.available && (
              <SectionStep no={3} done={cartTare != null && e2Count > 0}>Tara</SectionStep>
            )}
            <SectionStep no={scale.available ? 4 : 3}
              done={taken > 0 && meat > 0 && !meatTooBig && (!autoMode || scale.stable)}>
              Waga
            </SectionStep>
```

- [ ] **Step 8: Weryfikacja ręczna (dev + symulator)**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npx tsc --noEmit && npm test && npm run dev
```

W przeglądarce (`:5173`, strona v10) w konsoli DevTools:

```js
window.__scaleSim(93.2, false)  // WAŻENIE… (amber), zapis zablokowany
window.__scaleSim(170.0)        // STABILNA; wybierz wózek 5,5 + 7×E2 → netto 150,5
window.__scaleSim(null)         // waga znika → strona jak dziś (wpis ręczny)
```

Sprawdź (Playwright MCP lub ręcznie): (1) bez symulatora strona wygląda jak przed zmianą; (2) pełny przepływ auto kończy się zapisem z `weighMode:'auto'` (network tab); (3) tap w pole Mięso przełącza na RĘCZNIE i numpad pisze do mięsa; (4) chip poza normą przy 2×E2 i netto 150.

- [ ] **Step 9: Commit**

```bash
git add src/pages/tablet/DeboningHmiV10Page.tsx src/features/deboning/types/index.ts
git commit -m "feat(rozbior): HMI v10 — panel tary wózek+E2, karta wagi na żywo, auto-netto w Mięso Z/S"
```

---

### Task 6: Weryfikacja całości + PR

**Files:** brak nowych — build, testy, PR.

- [ ] **Step 1: Pełna weryfikacja**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx tsc --noEmit && npm test && npm run build
cd backend && python3 -m pytest && cd ..
cd src-tauri && cargo test && cargo check --features kiosk && cd ..
```

Expected: wszystko zielone (frontend build przechodzi; jeśli cargo niedostępne lokalnie — weryfikacja przez CI po pushu, odnotować w PR).

- [ ] **Step 2: Push + PR do main**

```bash
git push -u origin wazenie-rs232
gh pr create --base main --title "Ważenie automatyczne RS232 w HMI rozbiór v10" --body "$(cat <<'EOF'
## Co
Waga najazdowa (RS232) sama wypełnia „Mięso Z/S" w HMI rozbiór v10:
wózek (4 stałe tary 5,5/6,0/6,5/7,0) + licznik pojemników E2 (×2,0 kg) →
netto = brutto − tara po stabilizacji wagi. Ćwiartka pobrana zostaje ręczna.
Wizualnie wg zaakceptowanego mockupu (artefakt 6a94965a).

## Jak
- **Rust (kiosk only):** `src-tauri/src/scale.rs` — wątek czyta port (config
  `scale.json`, default COM3/9600), parser protokół-agnostyczny + softwarowa
  stabilność (rozrzut ≤0,1 kg / 1,5 s), eventy `scale://weight`.
- **Frontend:** `useScale` (+ symulator `window.__scaleSim`), czysty
  `computeWeighing` (vitest), panel tary + karta wagi w DeboningHmiV10Page.
  Bez wagi strona działa DOKŁADNIE jak dotychczas.
- **Backend:** kolumny audytowe `kg_gross/tare_cart_kg/tare_e2_kg/e2_count/
  weigh_mode` + walidacja spójności netto (±0,5 kg) dla `weighMode='auto'`.

## Testy
- pytest: DTO + walidacja spójności (7 testów)
- vitest: computeWeighing (7 testów)
- cargo test: parser ramek + okno stabilności (8 testów)
- ręcznie: pełny przepływ na symulatorze (dev) — auto, przejęcie ręczne, brak wagi

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Follow-up (poza PR — zanotować)**

Po podłączeniu fizycznej wagi u klienta: ustawić w mierniku tryb transmisji ciągłej, wpisać port/baud do `scale.json` obok exe; jeśli ramka miernika ma flagę stabilności (np. `ST`/`US`), rozważyć parsowanie jej zamiast/obok stabilności softwarowej.

---

## Self-Review

1. **Spec coverage:** przepływ operatora (partia→pracownik→wózek→E2→waga→ćwiartka→zapis) → Task 5; 4 stałe tary + E2=2,0 → Task 2 (stałe) + Task 5 (UI); stabilność → Task 3; audyt brutto/tara → Task 1; kontrola 15–25 → Task 2+5; brak wagi = zero regresji → Task 4/5 (available); kiosk-only wątek → Task 3. Brak luk.
2. **Placeholder scan:** brak TBD/TODO; każdy krok kodowy ma kod.
3. **Type consistency:** `ScaleReading {gross,stable,connected}` spójne Rust (serde camelCase) ↔ TS; `computeWeighing`/`WeighingResult` spójne Task 2↔5; aliasy DTO `kgGross/tareCartKg/tareE2Kg/e2Count/weighMode` spójne Task 1↔5.
