# Panel magazynu — plaster 1: rama kiosku + WYDANIE + MROŹNIA

> **Dla wykonawców agentowych:** WYMAGANY SUB-SKILL: użyj
> `superpowers:subagent-driven-development` (zalecane) albo
> `superpowers:executing-plans`, żeby wykonać ten plan zadanie po zadaniu.
> Kroki mają składnię checkboxów (`- [ ]`) do odhaczania.

**Cel:** Postawić kiosk stanowiska magazynowego z ekranem czterech kafli oraz
dwiema czynnościami domkniętymi do końca — WYDANIE (załadunek palet) i MROŹNIA
(skan w obie strony) — tak, żeby telefon zniknął z załadunku.

**Architektura:** Osobne wejście Vite (`magazyn.html` → `src/magazyn.tsx` →
`MagazynHmiPage`) bez routera i bez stron biura, wzorem `masowanie.tsx`
i `rozbior-v10.tsx`. Własny config Tauri, własny kanał aktualizacji `magazyn`,
własny workflow wydania. **Backend NIE jest dotykany poza dodaniem trasy
kanału aktualizacji** — logika obu czynności jest gotowa i wdrożona
21.09.2026. Logikę skanu bierzemy z istniejących modułów
(`features/loading/scanMessages`, `features/scan/useSkanAutoSubmit`,
`features/loading/useVehicleLoading`), nie kopiujemy jej.

**Stos:** React 18 + TypeScript + Vite + Tailwind, Tauri 2, FastAPI +
PostgreSQL (psycopg2), vitest + jsdom, pytest.

**Spec:** `docs/superpowers/specs/2026-09-21-panel-magazynu-design.md`

## Globalne wymagania

- **Kanoniczne źródła:** `/opt/kebab/kebab_new/kebab_fixed/` — korzeń repo git
  to `/opt/kebab/kebab_new/` (tam leży `.github/`).
- **Nazwa kanału:** dokładnie `magazyn` (mała litera) — w workflow, w trasie
  backendu, w `tauri.magazyn.conf.json` i w `SplashGate channel=`.
- **Dział operatora:** `magazyn` — `SplashGate department="magazyn"`.
- **Adres produkcji w CSP i w updaterze:** `http://91.98.105.107:8080`.
  Stary adres `204.168.166.34` zostaje w CSP tylko dlatego, że jest w każdym
  innym kiosku — nie usuwamy go w tym plastrze.
- **Wersja kiosku pochodzi z `tauri.magazyn.conf.json`**, nie z tagu i nie
  z `Cargo.toml`. Kioski nie mają bramki conf↔Cargo.
- **Motyw hali:** wyłącznie tokeny z `src/features/hmi-theme/vars.ts`
  (`HMI_VARS`). Żadnych kolorów wpisanych wprost w komponenty magazynu.
- **Znaczenia kolorów są zajęte:** indygo = akcja, zieleń = komplet,
  bursztyn = zrobione ale sprawdź, czerwień = nie przeszło.
- **Testy DB wymagają PEŁNEGO adresu:**
  `TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test`
  — bez niego cicho się pomijają i świecą fałszywym zielonym.
- **Jeden przebieg pytest naraz** — dwa równoległe czyszczą sobie dane.
- **Daty w fixture'ach względne**, nigdy sztywne.
- **Push plików `.github/workflows/*` wymaga tokenu z zakresem `workflow`.**
  Token na maszynie sesji bywa wygasły; token na produkcji
  (`root@91.98.105.107`) jest ważny — patrz Zadanie 7.

---

## Struktura plików

| plik | odpowiedzialność |
|---|---|
| `backend/app/routes/desktop_updates_magazyn.py` | manifest i pobieranie instalatora kanału `magazyn` |
| `backend/app/main.py` | rejestracja routera |
| `.github/workflows/tauri-magazyn.yml` | build instalatora + publikacja na kanał |
| `magazyn.html` | wejście HTML kiosku |
| `src/magazyn.tsx` | montowanie Reacta, rama kiosku |
| `src-tauri/tauri.magazyn.conf.json` | okno, CSP, updater, NSIS |
| `vite.config.ts` | wejście `magazyn` + `__MAGAZYN_VERSION__` |
| `src/features/magazyn/magazynTypes.ts` | typy ekranów i alarmu — jedno źródło |
| `src/features/magazyn/components/Kafel.tsx` | kafel czynności (rzeczownik + linia + stan) |
| `src/features/magazyn/components/Alarm.tsx` | błąd na CAŁYM ekranie |
| `src/features/magazyn/components/PasSkanowania.tsx` | pole skanu + auto-wysyłka |
| `src/features/magazyn/EkranWyboruAuta.tsx` | WYDANIE, poziom 2 |
| `src/features/magazyn/EkranZaladunku.tsx` | WYDANIE, poziom 3 |
| `src/features/magazyn/EkranMrozni.tsx` | MROŹNIA |
| `src/pages/tablet/MagazynHmiPage.tsx` | nawigacja między ekranami + kafle |

---

### Zadanie 1: Kanał aktualizacji `magazyn` (workflow + trasa backendu)

Najpierw kanał, bo bez niego instalator nie ma gdzie trafić, a strażnik
`test_kanaly_aktualizacji.py` wywraca build, gdy workflow istnieje bez trasy.

**Pliki:**
- Utwórz: `.github/workflows/tauri-magazyn.yml` (korzeń repo, NIE `kebab_fixed/`)
- Utwórz: `backend/app/routes/desktop_updates_magazyn.py`
- Modyfikuj: `backend/app/main.py` (dwie listy importu/rejestracji routerów)
- Test: `backend/tests/test_kanaly_aktualizacji.py` (istnieje, nie piszemy go)

**Interfejsy:**
- Konsumuje: nic
- Produkuje: trasy `GET /api/desktop-updates/magazyn/latest.json`,
  `GET /api/desktop-updates/magazyn/download/{filename}`,
  `GET /api/desktop-updates/magazyn/latest-installer`,
  `POST /api/admin/desktop-updates/magazyn/publish`

- [ ] **Krok 1: Skopiuj workflow masowni jako punkt wyjścia**

```bash
cd /opt/kebab/kebab_new
cp .github/workflows/tauri-masowanie.yml .github/workflows/tauri-magazyn.yml
```

- [ ] **Krok 2: Podmień w nim wszystkie odwołania do masowni**

W `.github/workflows/tauri-magazyn.yml` zamień (kolejność ma znaczenie —
najdłuższe wzorce pierwsze):

| z | na |
|---|---|
| `tauri.masowanie.conf.json` | `tauri.magazyn.conf.json` |
| `/api/admin/desktop-updates/masowanie/publish` | `/api/admin/desktop-updates/magazyn/publish` |
| `masowanie.html` | `magazyn.html` |
| `masowanie-` (prefiks tagu) | `magazyn-` |
| `Masowanie HMI` | `Magazyn HMI` |
| `masowanie` (pozostałe) | `magazyn` |

Sprawdź po podmianie, że nie został ani jeden ślad:

```bash
grep -n "masowan" .github/workflows/tauri-magazyn.yml   # oczekiwane: brak wyniku
grep -n "magazyn" .github/workflows/tauri-magazyn.yml | head -20
```

- [ ] **Krok 3: Uruchom strażnika kanałów — MUSI PAŚĆ**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_kanaly_aktualizacji.py -q
```

Oczekiwane: FAIL — strażnik znalazł kanał `magazyn` w workflow, a nie znalazł
jego tras w `app/routes/`. To jest sedno tego zadania: brak kanału ma wyjść
tutaj, a nie po kwadransie kompilacji Rusta na runnerze Windows.

- [ ] **Krok 4: Utwórz trasę kanału**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
sed -e 's/masowanie/magazyn/g' -e 's/masowni/magazynu/g' \
  backend/app/routes/desktop_updates_masowanie.py \
  > backend/app/routes/desktop_updates_magazyn.py
```

Następnie popraw ręcznie nagłówek docstringa pliku, bo `sed` nie zna odmiany:

```python
"""Kanał aktualizacji kiosku MAGAZYN — osobny manifest, osobny katalog.

Stanowisko magazynowe ma własny instalator (własny `tauri.magazyn.conf.json`,
osobny cykl wydań `magazyn-*` tag), więc musi mieć własny manifest.

Trasy tego pliku są WYMAGANE przez `tests/test_kanaly_aktualizacji.py`:
workflow, który publikuje na kanał bez trasy w backendzie, kończy się 405
przy zielonym buildzie — czyli kiosk cicho stoi na starej wersji.
"""
```

Sprawdź, że nazwy funkcji tras są unikalne i nie kolidują z masownią:

```bash
grep -n "^def \|^@router" backend/app/routes/desktop_updates_magazyn.py
```

Każda nazwa funkcji musi zawierać `magazyn` (np. `desktop_update_magazyn_manifest`).

- [ ] **Krok 5: Zarejestruj router w `main.py`**

W `backend/app/main.py` dopisz `desktop_updates_magazyn` w OBU miejscach,
w których wymieniony jest `desktop_updates_masowanie` (import ~linia 147
i rejestracja ~linia 218), zaraz po nim:

```python
        desktop_updates_masowanie,
        desktop_updates_magazyn,
```

- [ ] **Krok 6: Strażnik kanałów przechodzi**

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest tests/test_kanaly_aktualizacji.py -q
```

Oczekiwane: PASS.

- [ ] **Krok 7: Commit**

```bash
cd /opt/kebab/kebab_new
git add .github/workflows/tauri-magazyn.yml \
        kebab_fixed/backend/app/routes/desktop_updates_magazyn.py \
        kebab_fixed/backend/app/main.py
git commit -m "feat(magazyn): kanal aktualizacji kiosku magazynowego

Workflow tauri-magazyn.yml + trasy /api/desktop-updates/magazyn/*.
Straznik test_kanaly_aktualizacji.py wymusza te pare — workflow bez trasy
konczy sie publikacja na 405 przy ZIELONYM buildzie, czyli kioskiem, ktory
cicho stoi na starej wersji."
```

---

### Zadanie 2: Wejście kiosku (HTML, entry, config Tauri, Vite)

**Pliki:**
- Utwórz: `magazyn.html`
- Utwórz: `src/magazyn.tsx`
- Utwórz: `src-tauri/tauri.magazyn.conf.json`
- Modyfikuj: `vite.config.ts`
- Utwórz: `src/features/magazyn/magazynTypes.ts`

**Interfejsy:**
- Konsumuje: `KioskGuards`, `SplashGate`, `dropServiceWorker`
  z `@/features/kiosk/KioskFrame`; `MagazynHmiPage` (Zadanie 4 — na razie
  zaślepka utworzona w tym zadaniu)
- Produkuje: `__MAGAZYN_VERSION__` (globalna stała Vite),
  typ `EkranMagazynu` i `StanAlarmu` z `magazynTypes.ts`

- [ ] **Krok 1: Typy ekranów — jedno źródło prawdy**

Utwórz `src/features/magazyn/magazynTypes.ts`:

```typescript
/**
 * Typy wspólne dla kiosku magazynu.
 *
 * Nazwy ekranów żyją TUTAJ, a nie w stringach rozrzuconych po komponentach —
 * literówka w nazwie ekranu daje pusty panel bez żadnego błędu, a to na hali
 * wygląda jak awaria MES.
 */

/** Ekrany plastra 1. Kartony i przyjęcie dochodzą w kolejnych plastrach. */
export type EkranMagazynu =
  | 'kafle'
  | 'wydanie-auta'
  | 'wydanie-praca'
  | 'mroznia'

/** Błąd pokazywany na CAŁYM ekranie.
 *
 *  Pełny ekran, a nie pasek: w docelowym podziale 30/70 (plaster 2) czerwony
 *  alarm w wąskim pasie dałby się przeoczyć, a magazynier i tak nie patrzy
 *  na ekran — podnosi wzrok dopiero po dźwięku. */
export interface StanAlarmu {
  /** Który skaner — 'L' albo 'P'. W plastrze 1 zawsze 'L'. */
  skaner: 'L' | 'P'
  /** Wielki napis, czytelny z trzech metrów. */
  naglowek: string
  /** Jedno zdanie kontekstu. */
  szczegol: string
  /** Opcjonalna podpowiedź „gdzie to należy" — błąd ma instruować. */
  gdzie?: string
  /** 'blad' = czerwony, 'uwaga' = bursztynowy (przeszło, ale sprawdź). */
  ton: 'blad' | 'uwaga'
  /** Znacznik czasu — wymusza ponowne pokazanie tego samego komunikatu. */
  ts: number
}
```

- [ ] **Krok 2: HTML wejścia**

Utwórz `magazyn.html` — skopiuj `masowanie.html` i podmień tytuł:

```bash
cd /opt/kebab/kebab_new/kebab_fixed
sed -e 's/Masowanie HMI/Magazyn HMI/g' -e 's#/src/masowanie.tsx#/src/magazyn.tsx#' \
  masowanie.html > magazyn.html
grep -n "magazyn\|Magazyn" magazyn.html
```

Oczekiwane: `<title>Magazyn HMI</title>` oraz
`<script type="module" src="/src/magazyn.tsx">`.

- [ ] **Krok 3: Entry React**

Utwórz `src/magazyn.tsx`:

```tsx
/**
 * magazyn.tsx — samodzielny entry dla Tauri „Magazyn HMI".
 *
 * Czwarte stanowisko hali. Rama i motyw jak w rozbiorze, produkcji i masowni:
 * ludzie chodzą między stanowiskami i nie mają się uczyć drugiego wyglądu.
 *
 * BEZ ROUTERA i bez stron biura — do bundla wchodzi tylko łańcuch
 * MagazynHmiPage + features/magazyn/* + lib/api + features/auth.
 *
 * Backend: ten sam serwer co główna aplikacja MES.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { ErrorBoundary, installGlobalErrorLogger } from '@/components/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/features/auth/AuthContext'
import { MagazynHmiPage } from '@/pages/tablet/MagazynHmiPage'
import { KioskGuards, SplashGate, dropServiceWorker } from '@/features/kiosk/KioskFrame'

// Wstrzykiwane przez Vite z pliku conf tego kiosku (vite.config.ts).
declare const __MAGAZYN_VERSION__: string

installGlobalErrorLogger()
dropServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <TooltipProvider>
          <KioskGuards />
          {/* Wrapper h-screen/w-screen — dzieci używają h-full/w-full */}
          <div style={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
            <SplashGate department="magazyn" label="Magazyn" channel="magazyn"
                        version={__MAGAZYN_VERSION__}>
              <MagazynHmiPage />
            </SplashGate>
          </div>
        </TooltipProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
```

- [ ] **Krok 4: Config Tauri**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
sed -e 's/Masowanie HMI/Magazyn HMI/g' \
    -e 's/pl.kebabmes.masowanie/pl.kebabmes.magazyn/' \
    -e 's#masowanie.html#magazyn.html#' \
    -e 's#desktop-updates/masowanie/#desktop-updates/magazyn/#' \
  src-tauri/tauri.masowanie.conf.json > src-tauri/tauri.magazyn.conf.json
python3 -c "import json; print(json.load(open('src-tauri/tauri.magazyn.conf.json'))['version'])"
```

Ustaw wersję startową na `1.0.0` (kiosk zaczyna własny cykl, nie dziedziczy
numeru po masowni):

```bash
python3 - <<'PY'
import json
p = 'src-tauri/tauri.magazyn.conf.json'
c = json.load(open(p, encoding='utf-8'))
c['version'] = '1.0.0'
json.dump(c, open(p, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
grep -n "masowan" src-tauri/tauri.magazyn.conf.json   # oczekiwane: brak wyniku
```

- [ ] **Krok 5: Zarejestruj wejście w Vite**

W `vite.config.ts` dopisz obok pozostałych configów kiosków (po
`masowanieVersion`):

```typescript
// Magazyn — czwarty kiosk hali, osobny kanał aktualizacji.
const magazynVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'src-tauri/tauri.magazyn.conf.json'), 'utf-8')
).version as string
```

w bloku `define` dopisz:

```typescript
    __MAGAZYN_VERSION__: JSON.stringify(magazynVersion),
```

w `build.rollupOptions.input` dopisz:

```typescript
        // Stanowisko magazynowe — przyjęcie, kartony, wydanie, mroźnia
        'magazyn': path.resolve(__dirname, 'magazyn.html'),
```

- [ ] **Krok 6: Zaślepka strony, żeby build przeszedł**

Utwórz `src/pages/tablet/MagazynHmiPage.tsx` (pełną treść dostanie w Zadaniu 4):

```tsx
/** Kiosk magazynu — pełna zawartość powstaje w Zadaniu 4 planu. */
export function MagazynHmiPage() {
  return <div>Magazyn</div>
}
```

- [ ] **Krok 7: Typecheck i build — weryfikacja wejścia**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx tsc --noEmit
npm run build 2>&1 | tail -20
ls -la dist/magazyn.html
```

Oczekiwane: `tsc` bez błędów, build kończy się sukcesem, `dist/magazyn.html`
istnieje. **Nie używaj `| tail` bez sprawdzenia kodu wyjścia osobno** — status
pipeline'u to status `tail` i maskuje OOM-kill builda.

- [ ] **Krok 8: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/magazyn.html kebab_fixed/src/magazyn.tsx \
        kebab_fixed/src-tauri/tauri.magazyn.conf.json \
        kebab_fixed/vite.config.ts \
        kebab_fixed/src/features/magazyn/magazynTypes.ts \
        kebab_fixed/src/pages/tablet/MagazynHmiPage.tsx
git commit -m "feat(magazyn): wejscie kiosku magazynowego

magazyn.html + src/magazyn.tsx + tauri.magazyn.conf.json (wersja 1.0.0,
wlasny cykl) + wejscie w vite.config. Bez routera i bez stron biura —
do bundla wchodzi tylko lancuch kiosku."
```

---

### Zadanie 3: Kafel, Alarm i Pas skanowania

Trzy elementy ramy, z których korzystają wszystkie ekrany. Robimy je razem,
bo osobno nie mają czego dostarczyć.

**Pliki:**
- Utwórz: `src/features/magazyn/components/Kafel.tsx`
- Utwórz: `src/features/magazyn/components/Alarm.tsx`
- Utwórz: `src/features/magazyn/components/PasSkanowania.tsx`
- Test: `src/features/magazyn/components/magazynComponents.test.tsx`

**Interfejsy:**
- Konsumuje: `StanAlarmu` z `@/features/magazyn/magazynTypes`,
  `useSkanAutoSubmit` z `@/features/scan/useSkanAutoSubmit`
- Produkuje:
  - `Kafel({ nazwa, czynnosc, glif, licznik, cel, stan, wariant, onClick })`
  - `Alarm({ alarm })` — `alarm: StanAlarmu | null`
  - `PasSkanowania({ placeholder, kody, onSkan, disabled })`

- [ ] **Krok 1: Napisz test, który pada**

Utwórz `src/features/magazyn/components/magazynComponents.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Elementy ramy kiosku magazynu.
 *
 * Kafel, alarm i pas skanowania mają test komponentu, bo to jedyne miejsca,
 * przez które magazynier rozmawia z systemem — a reguła repo mówi, że każdy
 * ekran przyjmujący dane operatora dostaje test na to, CO WIDZI człowiek.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Kafel } from './Kafel'
import { Alarm } from './Alarm'
import { PasSkanowania } from './PasSkanowania'

afterEach(cleanup)

describe('Kafel czynności', () => {
  it('pokazuje rzeczownik, czynność i żywy stan', () => {
    render(<Kafel nazwa="WYDANIE" czynnosc="Załaduj auto" glif="⇥"
                  licznik={2} cel={6} stan="3 zamówienia · 1 840 kg"
                  onClick={() => {}} />)
    expect(screen.getByText('WYDANIE')).toBeTruthy()
    expect(screen.getByText('Załaduj auto')).toBeTruthy()
    expect(screen.getByText(/1 840 kg/)).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('komplet oznacza wariantem gotowe, nie samym licznikiem', () => {
    const { container } = render(
      <Kafel nazwa="MROŹNIA" czynnosc="Wstaw lub wyjmij" glif="❄"
             licznik={6} cel={6} stan="komplet" wariant="gotowe"
             onClick={() => {}} />)
    expect(container.querySelector('[data-wariant="gotowe"]')).toBeTruthy()
  })

  it('dotknięcie woła onClick', () => {
    const fn = vi.fn()
    render(<Kafel nazwa="KARTONY" czynnosc="Spakuj" glif="▣"
                  licznik={0} cel={3} stan="—" onClick={fn} />)
    fireEvent.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledOnce()
  })
})

describe('Alarm', () => {
  it('nie renderuje nic, gdy nie ma błędu', () => {
    const { container } = render(<Alarm alarm={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('nazywa skaner, bo przy dwóch trzeba wiedzieć czyj to błąd', () => {
    render(<Alarm alarm={{ skaner: 'L', naglowek: 'NIE MA GDZIE',
      szczegol: 'BULLI · KIRMIZI 10 kg', ton: 'blad', ts: 1 }} />)
    expect(screen.getByText(/SKANER L/)).toBeTruthy()
    expect(screen.getByText('NIE MA GDZIE')).toBeTruthy()
  })

  it('podpowiada, gdzie sztuka należy — błąd ma instruować', () => {
    render(<Alarm alarm={{ skaner: 'L', naglowek: 'NIE DO TEGO KARTONU',
      szczegol: "DEM`S · YAPRAK 25 kg", gdzie: 'KARTON 000320',
      ton: 'blad', ts: 2 }} />)
    expect(screen.getByText('KARTON 000320')).toBeTruthy()
  })

  it('ton uwaga jest bursztynowy, nie czerwony', () => {
    const { container } = render(<Alarm alarm={{ skaner: 'P',
      naglowek: 'POZA KOLEJNOŚCIĄ', szczegol: 'POLAT ma 2 z 3',
      ton: 'uwaga', ts: 3 }} />)
    expect(container.querySelector('[data-ton="uwaga"]')).toBeTruthy()
  })
})

describe('Pas skanowania', () => {
  it('Enter wysyła kod i czyści pole', () => {
    const fn = vi.fn()
    render(<PasSkanowania placeholder="Skanuj kod…" kody={[]} onSkan={fn} />)
    const pole = screen.getByPlaceholderText('Skanuj kod…') as HTMLInputElement
    fireEvent.change(pole, { target: { value: 'PAL|o1|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    expect(fn).toHaveBeenCalledWith('PAL|o1|1')
    expect(pole.value).toBe('')
  })

  it('próbne kody wysyłają się dotknięciem', () => {
    const fn = vi.fn()
    render(<PasSkanowania placeholder="Skanuj kod…" kody={['PAL|o1|2']} onSkan={fn} />)
    fireEvent.click(screen.getByText('PAL|o1|2'))
    expect(fn).toHaveBeenCalledWith('PAL|o1|2')
  })
})
```

- [ ] **Krok 2: Uruchom test — MUSI PAŚĆ**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/magazyn/components/magazynComponents.test.tsx
```

Oczekiwane: FAIL — `Failed to resolve import "./Kafel"`.

- [ ] **Krok 3: Kafel**

Utwórz `src/features/magazyn/components/Kafel.tsx`:

```tsx
/**
 * Kafel czynności na ekranie startowym magazynu.
 *
 * RZECZOWNIK do rozpoznania z metra, pod nim JEDNA linia czasownikiem
 * (co się stanie po dotknięciu), a pod kreską żywy stan.
 *
 * Dlaczego nie czasownik w tytule jak w masowni: masownia ma DWA kafle
 * i operator krąży między nimi w kółko, więc zdanie na kaflu uczy. Magazyn
 * ma CZTERY roboty w czterech miejscach, a magazynier stoi już przy rampie
 * albo przy aucie — on wie, co robi. Kafel służy rozpoznaniu i stanowi.
 * (decyzja właściciela 21.09.2026)
 */
export type WariantKafla = 'zwykly' | 'gotowe' | 'pilne'

export function Kafel({ nazwa, czynnosc, glif, licznik, cel, stan,
                        wariant = 'zwykly', onClick }: {
  nazwa: string
  czynnosc: string
  glif: string
  licznik: number
  cel: number
  stan: string
  wariant?: WariantKafla
  onClick: () => void
}) {
  // Zieleń = ta robota jest na dziś skończona.
  // Bursztyn TYLKO wtedy, gdy coś czeka na człowieka teraz.
  const tlo = wariant === 'gotowe' ? 'var(--successSoft)'
            : wariant === 'pilne'  ? 'var(--ambSoft)' : 'var(--panel)'
  const ramka = wariant === 'gotowe' ? 'var(--successLine)'
              : wariant === 'pilne'  ? 'var(--ambLine)' : 'var(--line)'
  const akcent = wariant === 'gotowe' ? 'var(--success)'
               : wariant === 'pilne'  ? 'var(--amb)' : 'var(--accent)'

  return (
    <button type="button" onClick={onClick} data-wariant={wariant}
      className="flex flex-col items-start gap-2.5 rounded-2xl p-7 text-left w-full h-full"
      style={{ background: tlo, border: `1px solid ${ramka}`, color: 'var(--ink)',
               minHeight: 168, cursor: 'pointer' }}>
      <span className="grid place-items-center rounded-xl"
        style={{ width: 54, height: 54, fontSize: 27, background: 'var(--accentSoft)',
                 color: akcent, border: '1px solid var(--accentLine)' }}>{glif}</span>
      <span className="text-[34px] font-extrabold leading-none">{nazwa}</span>
      <span className="text-[16px]" style={{ color: 'var(--mut)' }}>{czynnosc}</span>
      <span className="mt-auto flex w-full items-baseline gap-2.5 pt-3"
        style={{ borderTop: '1px solid var(--lineSoft)' }}>
        <span className="font-mono text-[26px] font-bold tabular-nums" style={{ color: akcent }}>
          {licznik}<span style={{ color: '#9AA3B0' }}>/{cel}</span>
        </span>
        <span className="text-[13px]" style={{ color: 'var(--mut)' }}>{stan}</span>
      </span>
    </button>
  )
}
```

- [ ] **Krok 4: Alarm**

Utwórz `src/features/magazyn/components/Alarm.tsx`:

```tsx
/**
 * Błąd skanu na CAŁYM ekranie.
 *
 * DLACZEGO PEŁNY EKRAN, a nie pasek: magazynier nie patrzy na ekran — panel
 * milczy, gdy jest dobrze, a podnosi go dopiero dźwięk. Kiedy już spojrzy,
 * komunikat musi być nie do przeoczenia. W docelowym podziale 30/70
 * (plaster 2) czerwień w wąskim pasie ginie obok dużego, kolorowego
 * załadunku. Drugi operator zobaczy przez chwilę cudzy błąd — to lepsze niż
 * pierwszy, który swojego nie zobaczył.
 *
 * NAZWA SKANERA jest obowiązkowa: przy dwóch ludziach pracujących obok siebie
 * każdy musi wiedzieć, czy to jego wpadka.
 */
import type { StanAlarmu } from '@/features/magazyn/magazynTypes'

export function Alarm({ alarm }: { alarm: StanAlarmu | null }) {
  if (!alarm) return null
  const blad = alarm.ton === 'blad'
  const kolor = blad ? 'var(--red)' : 'var(--amb)'
  const tlo = blad ? 'var(--redSoft)' : 'var(--ambSoft)'
  const opis = blad ? '#991B1B' : '#92400E'

  return (
    <div role="alert" data-ton={alarm.ton}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 p-8 text-center"
      style={{ background: tlo }}>
      <span className="font-mono text-[15px] font-extrabold tracking-[0.14em] rounded-lg px-3.5 py-1"
        style={{ color: kolor, border: `2px solid ${kolor}` }}>
        SKANER {alarm.skaner}
      </span>
      <span className="text-[clamp(30px,5vw,68px)] font-extrabold leading-none"
        style={{ color: kolor }}>{alarm.naglowek}</span>
      <span className="text-[clamp(15px,1.8vw,24px)] leading-snug"
        style={{ color: opis, maxWidth: '26ch' }}>{alarm.szczegol}</span>
      {alarm.gdzie ? (
        <span className="text-[clamp(17px,2vw,28px)] font-extrabold rounded-xl px-6 py-3"
          style={{ background: '#fff', border: `2px solid ${kolor}`, color: 'var(--ink)' }}>
          {alarm.gdzie}
        </span>
      ) : null}
    </div>
  )
}
```

- [ ] **Krok 5: Pas skanowania**

Utwórz `src/features/magazyn/components/PasSkanowania.tsx`:

```tsx
/**
 * Pole skanowania kiosku magazynu.
 *
 * Czytnik Zebra bez sufiksu Enter wpisuje kod i nic więcej — formularz się
 * nie wysyła i wygląda to jak awaria MES (zakład, 17.09.2026, DS2278).
 * Dlatego auto-wysyłka po chwili bezczynności, przez wspólny hook
 * `useSkanAutoSubmit` — ten sam, którego używa ekran załadunku. Enter, jeśli
 * jednak przyjdzie, też działa.
 *
 * „Próbne kody" są widoczne zawsze: serwisant przy panelu bez czytnika musi
 * móc przeklikać ścieżkę, a magazynier ich po prostu nie dotyka.
 */
import { useState } from 'react'
import { useSkanAutoSubmit } from '@/features/scan/useSkanAutoSubmit'

export function PasSkanowania({ placeholder, kody, onSkan, disabled = false }: {
  placeholder: string
  kody: string[]
  onSkan: (kod: string) => void
  disabled?: boolean
}) {
  const [wartosc, setWartosc] = useState('')

  function wyslij(kod: string) {
    const t = kod.trim()
    setWartosc('')
    if (t) onSkan(t)
  }

  useSkanAutoSubmit(wartosc, wyslij)

  return (
    <div className="shrink-0 px-4 pb-4 pt-3"
      style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
      <div className="flex gap-2.5">
        <input
          className="min-w-0 flex-1 rounded-xl px-4 py-3 font-mono text-[18px] font-semibold"
          style={{ border: '2px solid var(--accent)', background: '#fff', color: 'var(--ink)' }}
          placeholder={placeholder}
          aria-label="Pole skanowania"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={wartosc}
          onChange={e => setWartosc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') wyslij((e.target as HTMLInputElement).value) }}
        />
      </div>
      {kody.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: 'var(--mut)' }}>Próbne kody</span>
          {kody.map(k => (
            <button key={k} type="button" onClick={() => wyslij(k)}
              className="rounded-full px-2.5 py-1 font-mono text-[11.5px] font-semibold"
              style={{ background: 'var(--accentSoft)', border: '1px solid var(--accentLine)',
                       color: '#3730A3', cursor: 'pointer' }}>{k}</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Krok 6: Testy przechodzą**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/magazyn/components/magazynComponents.test.tsx
npx tsc --noEmit
```

Oczekiwane: 8 testów PASS, `tsc` bez błędów.

- [ ] **Krok 7: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/magazyn/
git commit -m "feat(magazyn): kafel, alarm i pas skanowania

Kafel: rzeczownik + jedna linia czasownikiem + zywy stan (decyzja
wlasciciela — masownia uczy zdaniem przy dwoch kaflach, magazyn przy
czterech tylko nazywa).

Alarm na CALYM ekranie z nazwa skanera: magazynier nie patrzy na ekran,
panel milczy gdy dobrze, a gdy juz spojrzy — komunikat ma byc nie do
przeoczenia. Nazwa skanera, bo przy dwoch ludziach obok siebie kazdy musi
wiedziec, czyja to wpadka."
```

---

### Zadanie 4: Ekran kafli i nawigacja (`MagazynHmiPage`)

**Pliki:**
- Modyfikuj: `src/pages/tablet/MagazynHmiPage.tsx` (zastępuje zaślepkę z Zadania 2)
- Test: `src/pages/tablet/magazynHmiPage.test.tsx`

**Interfejsy:**
- Konsumuje: `Kafel`, `Alarm` (Zadanie 3), `EkranMagazynu`, `StanAlarmu`
  (Zadanie 2), `EkranWyboruAuta` i `EkranZaladunku` (Zadanie 5),
  `EkranMrozni` (Zadanie 6)
- Produkuje: `MagazynHmiPage()` — komponent bez propsów

> **Kolejność wykonania:** to zadanie kompiluje się dopiero po Zadaniach 5 i 6.
> Wykonaj je jako ostatnie z trójki 4–6 albo tymczasowo zaślep importy trzech
> ekranów, a przywróć je w kroku 6.

- [ ] **Krok 1: Napisz test, który pada**

Utwórz `src/pages/tablet/magazynHmiPage.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Ekran startowy kiosku magazynu — cztery kafle i nawigacja.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ pojazdy: [] as any[], mroznia: [] as any[] }))

vi.mock('@/lib/api', () => ({
  vehiclesApi: { list: () => Promise.resolve(stan.pojazdy) },
  palletScanApi: {
    inColdStorage: () => Promise.resolve(stan.mroznia),
    scan: () => Promise.resolve({ result: 'SUCCESS', palletNo: 1, totalKg: 0,
      order: { id: 'o1', orderNo: 'X' }, pozaKolejnoscia: null }),
  },
  vehicleLoadingApi: { state: () => Promise.resolve(null) },
  errCode: () => '',
  isOfflineError: () => false,
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))

import { MagazynHmiPage } from './MagazynHmiPage'

beforeEach(() => { stan.pojazdy = []; stan.mroznia = [] })
afterEach(cleanup)

describe('kiosk magazynu — ekran kafli', () => {
  it('pokazuje cztery czynności rzeczownikami', async () => {
    render(<MagazynHmiPage />)
    expect(await screen.findByText('PRZYJĘCIE')).toBeTruthy()
    expect(screen.getByText('KARTONY')).toBeTruthy()
    expect(screen.getByText('WYDANIE')).toBeTruthy()
    expect(screen.getByText('MROŹNIA')).toBeTruthy()
  })

  it('kafle plastra 2 i 3 są wyłączone, żeby nie prowadziły donikąd', async () => {
    render(<MagazynHmiPage />)
    const kartony = (await screen.findByText('KARTONY')).closest('button')
    expect((kartony as HTMLButtonElement).disabled).toBe(true)
  })

  it('WYDANIE prowadzi do wyboru auta', async () => {
    stan.pojazdy = [{ id: 'v1', name: 'SOLÓWKA', plate: 'KR 1', active: true }]
    render(<MagazynHmiPage />)
    fireEvent.click((await screen.findByText('WYDANIE')).closest('button')!)
    expect(await screen.findByText(/Które auto/i)).toBeTruthy()
  })

  it('ze wszystkich ekranów da się wrócić do kafli', async () => {
    stan.pojazdy = [{ id: 'v1', name: 'SOLÓWKA', plate: 'KR 1', active: true }]
    render(<MagazynHmiPage />)
    fireEvent.click((await screen.findByText('WYDANIE')).closest('button')!)
    fireEvent.click(await screen.findByText(/Wstecz/))
    await waitFor(() => expect(screen.getByText('MROŹNIA')).toBeTruthy())
  })
})
```

- [ ] **Krok 2: Uruchom test — MUSI PAŚĆ**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/pages/tablet/magazynHmiPage.test.tsx
```

Oczekiwane: FAIL — zaślepka renderuje samo słowo „Magazyn".

- [ ] **Krok 3: Napisz stronę**

Zastąp treść `src/pages/tablet/MagazynHmiPage.tsx`:

```tsx
/**
 * Kiosk stanowiska magazynowego — ekran kafli i nawigacja.
 *
 * Cztery czynności, trzy poziomy: czynność → którą konkretnie → robota.
 * Warstwy środkowej brakowało w pierwszym projekcie i to była główna uwaga
 * właściciela: panel wchodził od razu w jedną dostawę / karton / auto wbite
 * na sztywno.
 *
 * PLASTER 1 domyka WYDANIE i MROŹNIĘ. Kafle KARTONY i PRZYJĘCIE są widoczne,
 * ale wyłączone — kafel prowadzący donikąd jest gorszy niż kafel, który
 * uczciwie mówi „jeszcze nie".
 *
 * CZEGO TU NIE MA: wołania „auto stoi na rampie". Nikt tej informacji nie
 * wprowadza, a kazać biuru awizować podstawienie auta to dokładanie roboty,
 * żeby system powiedział coś, co magazynier widzi przez okno. Kafel WYDANIE
 * liczy z terminów dostawy zamówień — dane, które już są.
 */
import { useState } from 'react'
import { HMI_VARS } from '@/features/hmi-theme/vars'
import { Kafel } from '@/features/magazyn/components/Kafel'
import { Alarm } from '@/features/magazyn/components/Alarm'
import { EkranWyboruAuta } from '@/features/magazyn/EkranWyboruAuta'
import { EkranZaladunku } from '@/features/magazyn/EkranZaladunku'
import { EkranMrozni } from '@/features/magazyn/EkranMrozni'
import type { EkranMagazynu, StanAlarmu } from '@/features/magazyn/magazynTypes'

const TYTULY: Record<EkranMagazynu, { t: string; p: string; back: EkranMagazynu | null }> = {
  'kafle':         { t: 'Magazyn',  p: 'Kebab MES · stanowisko magazynowe', back: null },
  'wydanie-auta':  { t: 'Wydanie',  p: 'Które auto',                        back: 'kafle' },
  'wydanie-praca': { t: 'Wydanie',  p: 'Załadunek palet',                   back: 'wydanie-auta' },
  'mroznia':       { t: 'Mroźnia',  p: 'Wstawianie i wyjmowanie',           back: 'kafle' },
}

export function MagazynHmiPage() {
  const [ekran, setEkran] = useState<EkranMagazynu>('kafle')
  const [pojazdId, setPojazdId] = useState('')
  const [alarm, setAlarm] = useState<StanAlarmu | null>(null)

  /** Alarm znika sam — magazynier nie ma go zamykać dotknięciem, bo wraca
   *  do roboty, a nie do ekranu. */
  function pokazAlarm(a: Omit<StanAlarmu, 'ts'>) {
    const pelny: StanAlarmu = { ...a, ts: Date.now() }
    setAlarm(pelny)
    setTimeout(() => setAlarm(x => (x && x.ts === pelny.ts ? null : x)), 3400)
  }

  const meta = TYTULY[ekran]

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={HMI_VARS as object}>
      <header className="flex shrink-0 items-center gap-4 px-5"
        style={{ minHeight: 72, background: 'var(--barBg)',
                 borderBottom: '1px solid var(--line)' }}>
        {meta.back ? (
          <button type="button" onClick={() => setEkran(meta.back!)}
            className="rounded-lg px-4 text-[13px] font-bold"
            style={{ height: 36, background: 'var(--panel)',
                     border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>
            ← Wstecz
          </button>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <b className="text-[19px] font-extrabold uppercase leading-none">{meta.t}</b>
          <i className="font-mono text-[10px] font-bold uppercase not-italic tracking-[0.13em]"
            style={{ color: 'var(--mut)' }}>{meta.p}</i>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {ekran === 'kafle' ? (
          <div className="grid flex-1 grid-cols-2 gap-3.5 overflow-y-auto p-4"
            style={{ gridAutoRows: '1fr' }}>
            <Kafel nazwa="PRZYJĘCIE" czynnosc="Przyjmij dostawę z rampy" glif="⤓"
              licznik={0} cel={0} stan="plaster 3 — jeszcze nie" onClick={() => {}} />
            <Kafel nazwa="KARTONY" czynnosc="Spakuj karton z listy dnia" glif="▣"
              licznik={0} cel={0} stan="plaster 2 — jeszcze nie" onClick={() => {}} />
            <Kafel nazwa="WYDANIE" czynnosc="Załaduj auto" glif="⇥"
              licznik={0} cel={0} stan="wybierz auto"
              onClick={() => setEkran('wydanie-auta')} />
            <Kafel nazwa="MROŹNIA" czynnosc="Wstaw lub wyjmij paletę" glif="❄"
              licznik={0} cel={0} stan="skan przestawia w obie strony"
              onClick={() => setEkran('mroznia')} />
          </div>
        ) : null}

        {ekran === 'wydanie-auta' ? (
          <EkranWyboruAuta onWybor={(id) => { setPojazdId(id); setEkran('wydanie-praca') }} />
        ) : null}

        {ekran === 'wydanie-praca' ? (
          <EkranZaladunku vehicleId={pojazdId} onAlarm={pokazAlarm}
            onKoniec={() => setEkran('kafle')} />
        ) : null}

        {ekran === 'mroznia' ? <EkranMrozni onAlarm={pokazAlarm} /> : null}
      </div>

      <Alarm alarm={alarm} />
    </div>
  )
}
```

**Wyłączenie kafli plastra 2 i 3** — `Kafel` nie ma jeszcze propsa `disabled`.
Dopisz go w `src/features/magazyn/components/Kafel.tsx`: dodaj
`disabled?: boolean` do typu propsów, przekaż `disabled={disabled}` do
`<button>`, a gdy `disabled` jest prawdą, ustaw
`opacity: .55` i `cursor: 'not-allowed'` w `style`. Następnie w
`MagazynHmiPage` dopisz `disabled` do kafli PRZYJĘCIE i KARTONY.

- [ ] **Krok 4: Testy przechodzą**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/pages/tablet/magazynHmiPage.test.tsx
npx tsc --noEmit
```

Oczekiwane: 4 testy PASS.

- [ ] **Krok 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/pages/tablet/MagazynHmiPage.tsx \
        kebab_fixed/src/pages/tablet/magazynHmiPage.test.tsx \
        kebab_fixed/src/features/magazyn/components/Kafel.tsx
git commit -m "feat(magazyn): ekran kafli i nawigacja kiosku

Cztery czynnosci rzeczownikami, trzy poziomy. Kafle KARTONY i PRZYJECIE
widoczne, ale WYLACZONE — kafel prowadzacy donikad jest gorszy niz kafel,
ktory uczciwie mowi 'jeszcze nie'.

Bez wolania 'auto stoi na rampie': nikt tej informacji nie wprowadza."
```

---

### Zadanie 5: WYDANIE — wybór auta i załadunek

**Pliki:**
- Utwórz: `src/features/magazyn/EkranWyboruAuta.tsx`
- Utwórz: `src/features/magazyn/EkranZaladunku.tsx`
- Test: `src/features/magazyn/ekranZaladunku.test.tsx`

**Interfejsy:**
- Konsumuje: `useVehicleLoading` i `POLL_MS` z `@/features/loading/useVehicleLoading`;
  `komunikatSkanu`, `komunikatPozaKolejnoscia` z `@/features/loading/scanMessages`;
  `palletScanApi`, `vehiclesApi` z `@/lib/api`; `PasSkanowania` (Zadanie 3)
- Produkuje:
  - `EkranWyboruAuta({ onWybor: (vehicleId: string) => void })`
  - `EkranZaladunku({ vehicleId, onAlarm, onKoniec })` gdzie
    `onAlarm: (a: Omit<StanAlarmu,'ts'>) => void`, `onKoniec: () => void`

- [ ] **Krok 1: Napisz test, który pada**

Utwórz `src/features/magazyn/ekranZaladunku.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Załadunek na kiosku magazynu.
 *
 * Te testy pilnują DWÓCH rzeczy, które kosztowały już produkcję:
 * 1. skan poza kolejnością OSTRZEGA, ale palety NIE odrzuca (21.09.2026),
 * 2. odmowa niesie KOD z backendu, nie zdanie — tłumaczenie po stronie
 *    serwera nie może po cichu zepsuć obsługi błędu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({
  migawka: null as any,
  wynikSkanu: null as any,
  odmowa: null as any,
  skany: [] as string[],
}))

vi.mock('@/lib/api', () => ({
  vehiclesApi: { list: () => Promise.resolve([]) },
  vehicleLoadingApi: { state: () => Promise.resolve(stan.migawka) },
  palletScanApi: {
    scan: (kod: string) => {
      stan.skany.push(kod)
      if (stan.odmowa) return Promise.reject(stan.odmowa)
      return Promise.resolve(stan.wynikSkanu)
    },
  },
  errCode: (e: any) => e?.code ?? '',
  isOfflineError: () => false,
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))

import { EkranZaladunku } from './EkranZaladunku'

const MIGAWKA = {
  vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 8842L' },
  orders: [
    { id: 'polat', orderNo: 'POLAT/Z/2/09/26', clientName: 'POLAT', position: 0,
      pallets: [{ id: 'p1', palletNo: 1, status: 'created', totalKg: 620,
                  totalQty: 24, onThisVehicle: false, items: [] }],
      totals: { totalPallets: 1, loadedPallets: 0, totalKg: 620, loadedKg: 0 } },
  ],
  totals: { totalPallets: 1, loadedPallets: 0, totalKg: 620, loadedKg: 0 },
}

beforeEach(() => {
  stan.migawka = MIGAWKA
  stan.odmowa = null
  stan.skany = []
  stan.wynikSkanu = { result: 'SUCCESS', palletNo: 1, totalKg: 620,
    order: { id: 'polat', orderNo: 'POLAT/Z/2/09/26' }, pozaKolejnoscia: null }
})
afterEach(cleanup)

function pokaz(onAlarm = vi.fn()) {
  render(<EkranZaladunku vehicleId="v1" onAlarm={onAlarm} onKoniec={() => {}} />)
  return onAlarm
}

describe('załadunek na kiosku', () => {
  it('pokazuje auto i zamówienia w kolejności załadunku', async () => {
    pokaz()
    expect(await screen.findByText(/SOLÓWKA/)).toBeTruthy()
    expect(screen.getByText('POLAT')).toBeTruthy()
  })

  it('udany skan NIE podnosi alarmu — cisza znaczy dobrze', async () => {
    const onAlarm = pokaz()
    const pole = await screen.findByLabelText('Pole skanowania')
    fireEvent.change(pole, { target: { value: 'PAL|polat|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(stan.skany).toEqual(['PAL|polat|1']))
    expect(onAlarm).not.toHaveBeenCalled()
  })

  it('skan poza kolejnością ostrzega BURSZTYNEM, ale paleta wchodzi', async () => {
    stan.wynikSkanu = { ...stan.wynikSkanu, pozaKolejnoscia: {
      pozycja: 3,
      czeka: { orderNo: 'POLAT/Z/2/09/26', clientName: 'POLAT',
               pozycja: 1, loaded: 2, total: 3 },
    } }
    const onAlarm = pokaz()
    const pole = await screen.findByLabelText('Pole skanowania')
    fireEvent.change(pole, { target: { value: 'PAL|nazar|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    const a = onAlarm.mock.calls[0][0]
    expect(a.ton).toBe('uwaga')
    expect(a.szczegol).toContain('POLAT')
    expect(a.szczegol).toContain('2 z 3')
  })

  it('paleta z obcego auta to CZERWONY alarm', async () => {
    const e: any = new Error('nie ma go na tym samochodzie')
    e.code = 'WRONG_ORDER'
    stan.odmowa = e
    const onAlarm = pokaz()
    const pole = await screen.findByLabelText('Pole skanowania')
    fireEvent.change(pole, { target: { value: 'PAL|obce|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].ton).toBe('blad')
  })
})
```

- [ ] **Krok 2: Uruchom test — MUSI PAŚĆ**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/magazyn/ekranZaladunku.test.tsx
```

Oczekiwane: FAIL — `Failed to resolve import "./EkranZaladunku"`.

- [ ] **Krok 3: Wybór auta**

Utwórz `src/features/magazyn/EkranWyboruAuta.tsx`:

```tsx
/**
 * WYDANIE, poziom 2 — które auto.
 *
 * Ta warstwa jest sednem projektu: pierwsza wersja panelu wchodziła od razu
 * w JEDNO auto wbite na sztywno. Rano przy rampie stoją dwa.
 */
import { useEffect, useState } from 'react'
import { vehiclesApi } from '@/lib/api'

interface Pojazd { id: string; name: string; plate: string }

export function EkranWyboruAuta({ onWybor }: { onWybor: (vehicleId: string) => void }) {
  const [pojazdy, setPojazdy] = useState<Pojazd[]>([])
  const [blad, setBlad] = useState('')

  useEffect(() => {
    vehiclesApi.list()
      .then(r => setPojazdy(r.map((v: any) => ({
        id: v.id, name: v.name ?? '', plate: v.plate ?? '' }))))
      .catch(() => setBlad('Nie udało się wczytać listy aut'))
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: 'var(--mut)' }}>Które auto</div>
      {blad ? (
        <div className="mb-3 rounded-xl p-3 text-sm"
          style={{ background: 'var(--redSoft)', border: '1px solid var(--redLine)',
                   color: 'var(--red)' }}>{blad}</div>
      ) : null}
      <div className="flex flex-col gap-2.5">
        {pojazdy.map(v => (
          <button key={v.id} type="button" onClick={() => onWybor(v.id)}
            className="flex w-full items-center gap-4 rounded-xl px-5 py-4 text-left"
            style={{ background: 'var(--panel)', border: '1.5px solid var(--line)',
                     color: 'var(--ink)', cursor: 'pointer' }}>
            <span className="min-w-0 flex-1">
              <span className="block text-[20px] font-extrabold leading-tight">{v.name}</span>
              <span className="mt-1 block font-mono text-[13px]"
                style={{ color: 'var(--mut)' }}>{v.plate}</span>
            </span>
          </button>
        ))}
        {!pojazdy.length && !blad ? (
          <div className="text-sm" style={{ color: 'var(--mut)' }}>Brak aktywnych aut.</div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Krok 4: Ekran załadunku**

Utwórz `src/features/magazyn/EkranZaladunku.tsx`:

```tsx
/**
 * WYDANIE, poziom 3 — załadunek palet.
 *
 * Stan auta jest WSPÓLNY dla wszystkich skanerów (`useVehicleLoading`,
 * odpytywanie co 4 s) — paleta zeskanowana na drugim urządzeniu pojawia się
 * tutaj sama. To nie jest wygoda, tylko poprawność: do 20.09.2026 lista żyła
 * w localStorage urządzenia i dwa skanery miały różne zdanie o tym samym
 * aucie.
 *
 * CISZA ZNACZY DOBRZE: udany skan NIE podnosi alarmu i nic nie miga.
 * Magazynier stoi przy aucie, nie przy ekranie — zatrzymuje go dopiero
 * ostrzeżenie albo błąd.
 *
 * Skan zapisuje TYLKO to, co wyjechało; dokumenty wystawia biuro po
 * zakończeniu kursu — magazynier nie ma ani drukarki, ani uprawnień.
 */
import { errCode, palletScanApi } from '@/lib/api'
import { useVehicleLoading } from '@/features/loading/useVehicleLoading'
import { komunikatSkanu } from '@/features/loading/scanMessages'
import { PasSkanowania } from '@/features/magazyn/components/PasSkanowania'
import type { StanAlarmu } from '@/features/magazyn/magazynTypes'

export function EkranZaladunku({ vehicleId, onAlarm, onKoniec }: {
  vehicleId: string
  onAlarm: (a: Omit<StanAlarmu, 'ts'>) => void
  onKoniec: () => void
}) {
  const { stan, odswiez } = useVehicleLoading(vehicleId)
  const zamowienia = stan?.orders ?? []
  const suma = stan?.totals ?? { totalPallets: 0, loadedPallets: 0, totalKg: 0, loadedKg: 0 }

  async function skanuj(kod: string) {
    try {
      const w = await palletScanApi.scan(kod, 'loaded', '', vehicleId)
      const poza = w.result === 'SUCCESS' ? w.pozaKolejnoscia : null
      if (poza) {
        // Bursztyn, nie czerwień: paleta JEST zaliczona. Na zielono
        // ostrzeżenie byłoby niewidoczne, na czerwono kłamałoby.
        const kto = poza.czeka.clientName || poza.czeka.orderNo || 'poprzednie zamówienie'
        onAlarm({
          skaner: 'L',
          ton: 'uwaga',
          naglowek: 'POZA KOLEJNOŚCIĄ',
          szczegol: `Paleta zaliczona, ale ${kto} (${poza.czeka.pozycja}.) ma dopiero `
            + `${poza.czeka.loaded} z ${poza.czeka.total} palet.`,
        })
      } else if (w.result !== 'SUCCESS') {
        const k = komunikatSkanu(w.result, { palletNo: w.palletNo })
        onAlarm({ skaner: 'L', ton: 'blad', naglowek: k.naglowek, szczegol: k.szczegol })
      }
      // SUCCESS bez ostrzeżenia → CISZA. Nic nie wołamy.
      await odswiez()
    } catch (e) {
      const k = komunikatSkanu((errCode(e) || 'ERROR') as any, {})
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: k.naglowek, szczegol: k.szczegol })
      await odswiez()
    }
  }

  const proc = suma.totalPallets ? Math.round(suma.loadedPallets / suma.totalPallets * 100) : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 rounded-xl p-4"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <div className="text-[20px] font-extrabold">
            {stan?.vehicle?.name ?? '—'}{' '}
            <span className="font-mono text-[15px]"
              style={{ color: 'var(--mut)' }}>{stan?.vehicle?.plate ?? ''}</span>
          </div>
          <div className="mt-2 font-mono text-[28px] font-bold tabular-nums"
            style={{ color: 'var(--success)' }}>
            {suma.loadedPallets}<span style={{ color: '#9AA3B0' }}>/{suma.totalPallets}</span>
            <span className="ml-2 text-[14px] font-normal"
              style={{ color: 'var(--mut)' }}>palet · {Math.round(suma.loadedKg)} kg</span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-lg"
            style={{ background: 'var(--lineSoft)' }}>
            <div className="h-full rounded-lg"
              style={{ width: `${proc}%`, background: 'var(--success)' }} />
          </div>
        </div>

        {zamowienia.map((z: any, i: number) => (
          <div key={z.id} className="mb-3 overflow-hidden rounded-xl"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: '1px solid var(--lineSoft)', background: '#FBFCFD' }}>
              <span className="grid place-items-center rounded-full font-mono text-[13px] font-extrabold"
                style={{ width: 28, height: 28, background: 'var(--accentSoft)',
                         color: 'var(--accent)', border: '1.5px solid var(--accentLine)' }}>
                {i + 1}
              </span>
              <b className="text-[16px]">{z.clientName}</b>
              <span className="ml-auto font-mono text-[15px] font-bold tabular-nums">
                {z.totals.loadedPallets}/{z.totals.totalPallets}
              </span>
            </div>
            <ul className="m-0 list-none p-0">
              {z.pallets.map((p: any) => (
                <li key={p.id ?? p.palletNo} className="flex items-center gap-3 px-4 py-3"
                  style={{ borderTop: '1px solid var(--lineSoft)',
                           background: p.onThisVehicle ? 'var(--successSoft)' : undefined }}>
                  <span className="grid place-items-center rounded-full font-mono text-[12px] font-extrabold"
                    style={{ width: 30, height: 30, background: '#fff',
                             border: `2px solid ${p.onThisVehicle ? 'var(--success)' : 'var(--line)'}`,
                             color: p.onThisVehicle ? 'var(--success)' : '#AFB7C4' }}>
                    {p.onThisVehicle ? '✓' : `P${p.palletNo}`}
                  </span>
                  <span className="flex-1 text-[14.5px] font-bold">Paleta {p.palletNo}</span>
                  <span className="font-mono text-[14px] tabular-nums"
                    style={{ color: 'var(--mut)' }}>{Math.round(p.totalKg)} kg</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <button type="button" onClick={onKoniec}
          className="rounded-xl px-5 py-3.5 text-[15px] font-extrabold"
          style={{ background: 'var(--success)', border: '1px solid var(--success)',
                   color: '#fff', cursor: 'pointer' }}>
          Zakończ i wróć
        </button>
      </div>

      <PasSkanowania placeholder="Skanuj paletę…" kody={[]} onSkan={skanuj} />
    </div>
  )
}
```

- [ ] **Krok 5: Testy przechodzą**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/magazyn/ekranZaladunku.test.tsx
npx tsc --noEmit
```

Oczekiwane: 4 testy PASS.

- [ ] **Krok 6: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/magazyn/EkranWyboruAuta.tsx \
        kebab_fixed/src/features/magazyn/EkranZaladunku.tsx \
        kebab_fixed/src/features/magazyn/ekranZaladunku.test.tsx
git commit -m "feat(magazyn): wydanie — wybor auta i zaladunek palet

Warstwa 'ktore auto' to sedno projektu: pierwsza wersja panelu wchodzila
od razu w JEDNO auto wbite na sztywno, a rano przy rampie stoja dwa.

CISZA ZNACZY DOBRZE: udany skan nie podnosi alarmu i nic nie miga.
Skan poza kolejnoscia daje bursztyn (paleta JEST zaliczona), odmowa —
czerwien. Stan auta wspolny dla wszystkich skanerow przez useVehicleLoading."
```

---

### Zadanie 6: MROŹNIA

**Pliki:**
- Utwórz: `src/features/magazyn/EkranMrozni.tsx`
- Test: `src/features/magazyn/ekranMrozni.test.tsx`

**Interfejsy:**
- Konsumuje: `palletScanApi.inColdStorage()`, `palletScanApi.scan(kod,'cold_storage')`,
  `PasSkanowania` (Zadanie 3), `StanAlarmu` (Zadanie 2)
- Produkuje: `EkranMrozni({ onAlarm })` gdzie
  `onAlarm: (a: Omit<StanAlarmu,'ts'>) => void`

- [ ] **Krok 1: Napisz test, który pada**

Utwórz `src/features/magazyn/ekranMrozni.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Mroźnia na kiosku magazynu.
 *
 * Mroźnia to PRZEGUB procesu, nie czynność poboczna: karton pełny → skan →
 * wjazd do mroźni → czeka dniami → skan → wyjazd na auto. Dlatego kartony
 * pod załadunek są dawno przygotowane, a pakowacz robi inne zamówienia niż
 * te, które właśnie jadą.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({
  wMrozni: [] as any[],
  odmowa: null as any,
  skany: [] as string[],
}))

vi.mock('@/lib/api', () => ({
  palletScanApi: {
    inColdStorage: () => Promise.resolve(stan.wMrozni),
    scan: (kod: string) => {
      stan.skany.push(kod)
      if (stan.odmowa) return Promise.reject(stan.odmowa)
      return Promise.resolve({ result: 'SUCCESS', palletNo: 1, totalKg: 900,
        order: { id: 'o1', orderNo: 'TRUVA/Z/1/09/26' } })
    },
  },
  errCode: (e: any) => e?.code ?? '',
  isOfflineError: () => false,
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))

import { EkranMrozni } from './EkranMrozni'

beforeEach(() => { stan.wMrozni = []; stan.odmowa = null; stan.skany = [] })
afterEach(cleanup)

describe('mroźnia na kiosku', () => {
  it('pokazuje, co stoi w mroźni', async () => {
    stan.wMrozni = [{ id: 'p1', palletNo: 1, orderNo: 'TRUVA/Z/1/09/26',
      clientName: 'TRUVA', totalKg: 900, totalQty: 60 }]
    render(<EkranMrozni onAlarm={vi.fn()} />)
    expect(await screen.findByText(/TRUVA/)).toBeTruthy()
  })

  it('skan przestawia jednostkę i NIE podnosi alarmu', async () => {
    const onAlarm = vi.fn()
    render(<EkranMrozni onAlarm={onAlarm} />)
    const pole = await screen.findByLabelText('Pole skanowania')
    fireEvent.change(pole, { target: { value: 'PAL|truva|1' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(stan.skany).toEqual(['PAL|truva|1']))
    expect(onAlarm).not.toHaveBeenCalled()
  })

  it('nieznany kod to czerwony alarm', async () => {
    const e: any = new Error('nie znam')
    e.code = 'INVALID'
    stan.odmowa = e
    const onAlarm = vi.fn()
    render(<EkranMrozni onAlarm={onAlarm} />)
    const pole = await screen.findByLabelText('Pole skanowania')
    fireEvent.change(pole, { target: { value: 'XXX' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(onAlarm).toHaveBeenCalled())
    expect(onAlarm.mock.calls[0][0].ton).toBe('blad')
  })
})
```

- [ ] **Krok 2: Uruchom test — MUSI PAŚĆ**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/magazyn/ekranMrozni.test.tsx
```

Oczekiwane: FAIL — `Failed to resolve import "./EkranMrozni"`.

- [ ] **Krok 3: Napisz ekran**

Utwórz `src/features/magazyn/EkranMrozni.tsx`:

```tsx
/**
 * MROŹNIA — przegub procesu magazynowego.
 *
 * Karton pełny → skan → wjazd do mroźni → czeka (dniami) → skan → wyjazd na
 * auto. To dlatego kartony pod załadunek są „dawno przygotowane", a drugi
 * operator pakuje INNE zamówienia niż te, które właśnie jadą.
 *
 * JEDEN SKAN W OBIE STRONY, bez pytania o kierunek: co jest poza mroźnią —
 * wjeżdża, co w mroźni — wyjeżdża. Pytanie „wstawiasz czy wyjmujesz?" byłoby
 * pytaniem o coś, co system już wie.
 */
import { useCallback, useEffect, useState } from 'react'
import { errCode, palletScanApi } from '@/lib/api'
import { komunikatSkanu } from '@/features/loading/scanMessages'
import { PasSkanowania } from '@/features/magazyn/components/PasSkanowania'
import type { StanAlarmu } from '@/features/magazyn/magazynTypes'

interface WMrozni {
  id: string; palletNo: number; orderNo: string
  clientName: string; totalKg: number; totalQty: number
}

export function EkranMrozni({ onAlarm }: {
  onAlarm: (a: Omit<StanAlarmu, 'ts'>) => void
}) {
  const [lista, setLista] = useState<WMrozni[]>([])

  const wczytaj = useCallback(async () => {
    try {
      const r = await palletScanApi.inColdStorage()
      setLista((Array.isArray(r) ? r : []) as WMrozni[])
    } catch { /* lista jest podglądem — brak sieci nie blokuje skanowania */ }
  }, [])

  useEffect(() => { void wczytaj() }, [wczytaj])

  async function skanuj(kod: string) {
    try {
      const w = await palletScanApi.scan(kod, 'cold_storage')
      if (w.result !== 'SUCCESS') {
        const k = komunikatSkanu(w.result, { palletNo: w.palletNo })
        onAlarm({ skaner: 'L', ton: 'blad', naglowek: k.naglowek, szczegol: k.szczegol })
      }
      // SUCCESS → CISZA.
      await wczytaj()
    } catch (e) {
      const k = komunikatSkanu((errCode(e) || 'ERROR') as any, {})
      onAlarm({ skaner: 'L', ton: 'blad', naglowek: k.naglowek, szczegol: k.szczegol })
      await wczytaj()
    }
  }

  const kg = lista.reduce((s, p) => s + Number(p.totalKg || 0), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 rounded-xl p-3 text-[12.5px] leading-relaxed"
          style={{ background: '#FBFCFD', border: '1px dashed var(--line)',
                   color: 'var(--mut)' }}>
          <b style={{ color: 'var(--ink)' }}>Mroźnia łączy pakowanie z załadunkiem.</b>{' '}
          Skan przestawia jednostkę w obie strony — co poza mroźnią, wjeżdża;
          co w mroźni, wyjeżdża.
        </div>

        <div className="mb-3 rounded-xl p-4"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: 'var(--mut)' }}>W mroźni</div>
          <div className="mt-1 font-mono text-[34px] font-bold tabular-nums"
            style={{ color: 'var(--accent)' }}>{lista.length}</div>
          <div className="text-[13px]" style={{ color: 'var(--mut)' }}>
            jednostek · {Math.round(kg)} kg
          </div>
        </div>

        <ul className="m-0 overflow-hidden rounded-xl p-0"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          {lista.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3"
              style={{ borderTop: '1px solid var(--lineSoft)' }}>
              <span className="grid place-items-center rounded-full text-[13px]"
                style={{ width: 30, height: 30, background: '#fff',
                         border: '2px solid var(--success)', color: 'var(--success)' }}>❄</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold">{p.clientName}</span>
                <span className="block font-mono text-[12px]"
                  style={{ color: 'var(--mut)' }}>{p.orderNo} · P{p.palletNo}</span>
              </span>
              <span className="font-mono text-[14px] tabular-nums"
                style={{ color: 'var(--mut)' }}>{Math.round(p.totalKg)} kg</span>
            </li>
          ))}
          {!lista.length ? (
            <li className="px-4 py-4 text-sm" style={{ color: 'var(--mut)' }}>
              Mroźnia pusta.
            </li>
          ) : null}
        </ul>
      </div>

      <PasSkanowania placeholder="Skanuj jednostkę…" kody={[]} onSkan={skanuj} />
    </div>
  )
}
```

- [ ] **Krok 4: Testy przechodzą**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx vitest run src/features/magazyn/
npx tsc --noEmit
```

Oczekiwane: wszystkie testy `features/magazyn/` PASS.

- [ ] **Krok 5: Commit**

```bash
cd /opt/kebab/kebab_new
git add kebab_fixed/src/features/magazyn/EkranMrozni.tsx \
        kebab_fixed/src/features/magazyn/ekranMrozni.test.tsx
git commit -m "feat(magazyn): mroznia jako przegub procesu

Jeden skan w obie strony, bez pytania o kierunek — co poza mroznia wjezdza,
co w mrozni wyjezdza. Pytanie 'wstawiasz czy wyjmujesz?' byloby pytaniem
o cos, co system juz wie."
```

---

### Zadanie 7: Pełny przebieg, wydanie i weryfikacja kanału

**Pliki:**
- Modyfikuj: `src-tauri/tauri.magazyn.conf.json` (tylko jeśli trzeba podbić wersję)

**Interfejsy:**
- Konsumuje: wszystko powyżej
- Produkuje: instalator `Magazyn HMI 1.0.0` na kanale `magazyn`

- [ ] **Krok 1: Cały pakiet testów, oba stosy**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
npx tsc --noEmit && echo "TSC OK"
npx vitest run 2>&1 | tail -8
```

```bash
cd /opt/kebab/kebab_new/kebab_fixed/backend
TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test \
  python3 -m pytest -q 2>&1 | tail -8
```

Oczekiwane: `tsc` czysto, frontend i backend bez porażek. **Jeden przebieg
pytest naraz** — dwa równoległe czyszczą sobie dane i dają lawinę błędów FK,
która wygląda jak regresja, a jest kolizją.

- [ ] **Krok 2: Push gałęzi `main`**

Token na maszynie sesji bywa wygasły (`gh auth status`). Wtedy przenieś
commity bundlem i wypchnij z produkcji, gdzie token jest ważny:

```bash
cd /opt/kebab/kebab_new
git bundle create /tmp/magazyn.bundle origin/main..main
scp /tmp/magazyn.bundle root@91.98.105.107:/tmp/magazyn.bundle
ssh root@91.98.105.107 'set -e; cd /opt/kebab/kebab_new;
  git fetch /tmp/magazyn.bundle main:refs/bundle/magazyn;
  git merge --ff-only refs/bundle/magazyn;
  git push origin main; rm -f /tmp/magazyn.bundle'
```

**Uwaga:** `.github/workflows/tauri-magazyn.yml` wymaga tokenu z zakresem
`workflow`. Jeśli push odbije się na braku zakresu, wypchnij najpierw resztę,
a workflow dodaj przez interfejs GitHuba albo tokenem z tym zakresem.

- [ ] **Krok 3: Poczekaj na zielone CI**

```bash
ssh root@91.98.105.107 'cd /opt/kebab/kebab_new && gh run list --limit 3 \
  --json status,conclusion,headSha,name \
  --jq ".[] | \"\(.status)\t\(.conclusion // \"-\")\t\(.headSha[0:7])\t\(.name)\""'
```

Oczekiwane: `CI` dla twojego SHA `completed success`.

- [ ] **Krok 4: Wdroż front na produkcję**

```bash
ssh root@91.98.105.107 'set -e; cd /opt/kebab/kebab_new/kebab_fixed;
  git pull --ff-only origin main;
  bash deploy/deploy.sh all > /tmp/deploy.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/deploy.log'
ssh root@91.98.105.107 'cd /opt/kebab/kebab_new/kebab_fixed && bash deploy/smoke.sh'
```

**Przed deployem obowiązuje bramka:** `deploy.sh` sam sprawdza, czy CI dla
tego commita jest zielone, i odmawia, gdy nie jest. Nie omijaj jej
`KEBAB_FORCE_DEPLOY=1`.

Sprawdź trasę nowego kanału:

```bash
curl -s http://91.98.105.107:8080/api/desktop-updates/magazyn/latest.json | head -c 200
```

Oczekiwane: JSON albo czytelny komunikat o braku wydania — **nie HTML SPA**.
HTML znaczy, że trasy nie ma i Zadanie 1 nie weszło na produkcję.

- [ ] **Krok 5: Wydanie instalatora**

```bash
ssh root@91.98.105.107 'set -e; cd /opt/kebab/kebab_new;
  git tag -a magazyn-1.0.0 -m "Magazyn HMI 1.0.0 — plaster 1: wydanie i mroznia";
  git push origin magazyn-1.0.0'
```

Tag pushuj **imiennie**. `git push --tags` wypycha wszystkie lokalne tagi,
w tym stare śmieci, i potrafi odpalić build publikujący niewłaściwą wersję.

- [ ] **Krok 6: Weryfikacja kanału — NIE koloru builda**

Po zakończeniu buildu (~10–15 min):

```bash
curl -s http://91.98.105.107:8080/api/desktop-updates/magazyn/latest.json \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('version:',d['version']);print('url:',d['url'])"
curl -s --max-time 30 -r 0-1 \
  "$(curl -s http://91.98.105.107:8080/api/desktop-updates/magazyn/latest.json \
     | python3 -c 'import sys,json;print(json.load(sys.stdin)["url"])')" | xxd | head -1
```

Oczekiwane: `version: 1.0.0`, nazwa pliku w `url` zawiera `1.0.0`, pierwsze
bajty pliku to `MZ`.

**Zielony build to NIE to samo co nowa wersja na kanale.** Krok publikacji
potrafił świecić na zielono, gdy kanał stał na starej wersji — dwa razy.
Sprawdź też numer W ŚRODKU binarki, bo manifest zgodny z nazwą pliku przy
starszej binarce daje updater instalujący tę samą wersję w kółko co godzinę.

- [ ] **Krok 7: Commit ewentualnych poprawek i zamknięcie plastra**

```bash
cd /opt/kebab/kebab_new
git status --short
```

Jeśli czysto — plaster 1 zamknięty. Zainstaluj `Magazyn HMI 1.0.0` na panelu
w hali (pierwsza instalacja jest ręczna; kolejne idą cichym auto-updatem,
bo NSIS działa w trybie `currentUser` i updater w `quiet`).

---

## Samoprzegląd planu

**Pokrycie specyfikacji (plaster 1):**

| wymaganie spec | zadanie |
|---|---|
| §3 własne wejście bez routera | 2 |
| §3 własny config Tauri + kanał `magazyn` | 1, 2 |
| §3 motyw z `hmi-theme/vars.ts` | 3, 4 |
| §4 cztery kafle, rzeczownik + czasownik + stan | 3, 4 |
| §4 brak wołania „auto na rampie" | 4 |
| §4 trzy poziomy (czynność → która → robota) | 5 |
| §6 WYDANIE ze wspólnym stanem auta | 5 |
| §6 MROŹNIA jako przegub, skan w obie strony | 6 |
| §7.3 błąd na całym ekranie z nazwą skanera | 3 |
| §5.4 cisza znaczy dobrze | 5, 6 |
| §10 testy komponentów każdego ekranu | 3, 4, 5, 6 |

**Poza plastrem 1 (świadomie):** §5 pakowanie i karta QR (plaster 2),
§7.1–7.2 most dwóch skanerów i podział 30/70 (plaster 2), §6 PRZYJĘCIE
(plaster 3). Kafle tych czynności są w Zadaniu 4 wyłączone.

**Spójność nazw:** `StanAlarmu` (pola `skaner`, `naglowek`, `szczegol`,
`gdzie?`, `ton`, `ts`) użyty identycznie w Zadaniach 2, 3, 4, 5, 6.
`onAlarm: (a: Omit<StanAlarmu,'ts'>) => void` identyczny w 4, 5, 6.
`EkranMagazynu` obejmuje dokładnie cztery ekrany zaimplementowane w 4–6.
