# Rozbiór HMI v10 „Rzemiosło" — projekt

**Data:** 2026-07-03
**Zakres:** wyłącznie moduł rozbioru (`/tablet/rozbior`), nowy tryb `v10` dołożony obok istniejących
(`classic`, `v2`–`v9`). Żaden istniejący plik HMI nie jest modyfikowany ani usuwany. Zero zmian backendu.
**Cel:** nowy, wyróżniający się wizualnie wariant produkcyjny — punkt wyjścia do ewentualnego ustawienia
jako domyślny w konkretnym zakładzie, ale wdrożenie tego pozostaje osobną, świadomą decyzją (przełącznik
trybu jest per-urządzenie w `localStorage`, więc dodanie `v10` nie zmienia niczego u nikogo automatycznie).

## Kontekst decyzji

Poprzednie warianty (v5 „Clinical", v8 „Porcelana", v9 „Sterownia") oceniono jako najlepsze z dotychczas
zbudowanych. Właściciel poprosił jednak nie o kolejną rekombinację tych trzech, tylko o coś **odrębnego
wizualnie i robiącego wrażenie**, przy zachowaniu pełnej funkcjonalności hali (rękawice, jaskrawe światło,
zero rozpraszania operatora). Zbudowano i porównano trzy niezależne kierunki wizualne (mockup HTML,
skala 1:1 komponentów) — wybrano **„Rzemiosło"**: jedyny kierunek zakorzeniony wprost w tym, czym zakład
się zajmuje (rozbiór/przetwórstwo mięsa), zamiast w generycznej stylistyce „dashboard/SCADA", którą ma
każde inne oprogramowanie MES. Pozostałe dwa kierunki („Kalibrownia" — instrument pomiarowy,
„Telemetria" — sterownia w świetle dnia) odrzucono na rzecz jednoznacznego skupienia się na jednym języku
wizualnym (rozmycie między trzema stylami wypadało mniej przekonująco niż pełne zaangażowanie w jeden).

## Szkielet layoutu (zatwierdzony przed wyborem stylu wizualnego)

3-kolumnowy „control room", stały — nic nie chowa się w modalach poza Statystykami/Zakończ partię/Zakończ
zmianę:

```
┌──────────────────────────────────────────────────────────────────┐
│ ROZBIÓR  data  Magazyn  Partie  Operator          🔔 alarmy  ZEGAR │
├──────────────────────────────────────────────────────────────────┤
│ PARTIE — szyna pozioma, sort FEFO, plakietka „najpierw"           │
├───────────────┬────────────────────┬──────────────────────────────┤
│ PRACOWNICY    │  ①②③ WPIS          │  STEROWNIA                    │
│ (~30% szer.,  │  (~35% szer.)      │  (~35% szer.)                 │
│ duże kafle,   │  zabrano kg/poj.   │  wydajność [wskaźnik z pasmem │
│ inicjały+kg   │  + mięso, numpad,  │  celu], tempo [j.w.],          │
│ dziś+licznik  │  ZAPISZ z podpo-   │  prognoza dnia, aktywni (60min)│
│ wpisów)       │  wiedzią braków    │  alarmy, live-feed wpisów      │
├───────────────┴────────────────────┴──────────────────────────────┤
│ KPI: ćwiartka | mięso | wydajność | grzbiety | kości | wpisy |     │
│ tempo | [Statystyki →]                                            │
└──────────────────────────────────────────────────────────────────┘
```

Kroki `①②③` (Partia → Pracownik → Waga) z v8 jako wskaźnik postępu, nie modal. Przycisk ZAPISZ zawsze
komunikuje czego brakuje („WYBIERZ PARTIĘ" / „MIĘSO > ZABRANE!" itd. — z v8). Siatka pracowników
auto-dopasowana do liczby osób (bez sztywnych pustych slotów jak w v5/v9). **Bez pól HACCP** (temperatura
surowca/sali) — świadomie pominięte na tym etapie; można dodać później jako osobny follow-up.

Modale zachowane: Statystyki (sortowalna tabela per pracownik), Zakończ partię (rozbicie kości/grzbietów),
Zakończ zmianę. Brak osobnego modala „Wpisy dzisiaj" — zastąpiony live-feedem w kolumnie sterowni (jak v9).

## Język wizualny — „Rzemiosło"

**Metafora:** rzeźnicza księga i wiszące etykiety partii, nie ekran korporacyjnego dashboardu. Zasada
funkcjonalna z v9 (ISA-101: kolor tylko dla stanu nienormalnego) zostaje w pełni — to nie jest w konflikcie
z charakterem wizualnym, tylko go dyscyplinuje.

**Paleta** (wszystkie pary tekst/tło zweryfikowane kalkulatorem kontrastu WCAG, nie na oko):

| Token | Hex | Użycie | Kontrast |
|---|---|---|---|
| `--paper` | `#EFEAE1` | tło aplikacji | — |
| `--panel` | `#F8F5EF` | tło kart/paneli | — |
| `--ink` | `#241F1A` | tekst główny | 13.6:1 / 15.0:1 (paper/panel) |
| `--mut` | `#6E665A` | tekst pomocniczy | 4.7:1 / 5.2:1 |
| `--line` | `#8C7D60` | ramki/obwódki | 3.4:1 / 3.7:1 (próg komponentów UI) |
| `--accent` | `#9C3B1E` | zaznaczenie (partia/pracownik/pole), akcja główna | 5.7:1 / 6.3:1 |
| `--accentSoft` | `#F0DCCF` | tło zaznaczenia | — |
| `--stamp` | `#3D6B49` | „pieczątka" weryfikacji/ukończenia kroku | 5.2:1 / 5.7:1 |
| `--amb` | `#8A5A12` | ostrzeżenie (tylko realne odchylenie) | 4.9:1 / 5.4:1 |
| `--red` | `#9C2020` | alarm (tylko realne odchylenie) | 6.6:1 / 7.3:1 |

Uwaga: pierwotne wartości z mockupu porównawczego (`--mut #7A7267`, `--line #D9D0C1`) nie przechodziły
4.5:1 / 3:1 — powyższe to skorygowane, docelowe wartości do implementacji.

**Typografia:** `Zilla Slab` (600/700, kursywa dla wordmarku „Rozbiór") do nagłówków i etykiet sekcji —
slab serif kojarzący się z szyldem sklepu mięsnego, nie z generycznym SaaS. `IBM Plex Mono` (500/600,
`tabular-nums`) do **wszystkich** liczb (wagi, %, zegar, KPI) — inny wybór niż JetBrains/Space Mono użyte
w v5/v8/v9, żeby HMI nie wyglądało jak jeszcze jedna iteracja tych samych trzech. Etykiety UI (`labels`,
przyciski numpada) — systemowy sans, wersaliki, `letter-spacing: .12–.16em`. Fonty ładowane lokalnie
(`@font-face` z plikami w `public/fonts/`, **nie** link do Google Fonts CDN — desktop Tauri offline).

**Motywy graficzne (z umiarem, nie na każdym elemencie):**
- Kafle partii: lekkie „uszko" z dziurką po lewej krawędzi (jak zawieszka na hak) — `::before` z małym
  okręgiem, obrys `border-radius: 2px 8px 2px 2px`.
- Krok ukończony (`①②③`): pieczątka zamiast checkmarka — okrąg z cienką obwódką w kolorze `--stamp`,
  lekki obrót `rotate(-6deg)`, tekst zamiast ikony (np. „OK").
- Nagłówek sekcji i pasek KPI: podwójna linia (`border: 3px double var(--line)`) jak linia w księdze
  rachunkowej, zamiast pojedynczej linii SaaS.
- Panel sterowni: przerywana ramka wewnętrzna na kartach pracownika (`border: 1px dashed`), sugerująca
  brzeg kartki.
- Bez gradientów, bez cieni „miękkiego SaaS-u", bez zaokrągleń >8px poza kaflami partii.

**Dostępność / ergonomia hali (niezmienne, niezależnie od stylu):**
- Min. rozmiar celu dotykowego 44×44px (kafle pracowników/partii/numpad znacznie większe — 80–140px).
- Kolor nigdy jedynym nośnikiem informacji — zawsze tekst/liczba obok (np. „74%" w kolorze `--stamp` ORAZ
  liczba, nie sam kolor tła).
- `prefers-reduced-motion`: animacja pulsu na live-feed wyłączana.
- Jeden, stały jasny motyw — bez przełącznika dzień/noc (hala ma stałe, jaskrawe oświetlenie; upraszcza
  to też QA, bo nie trzeba testować dwóch wariantów kontrastu).

## Wpięcie w system

- Nowy plik `src/pages/tablet/DeboningHmiV10Page.tsx`. Logika sesji/wpisów 1:1 z istniejących hooków
  (`useProductionSession`, `useDeboningEntries`, `rawBatchesApi`, `usersApi`, `getExpiryStatus`) — bez
  nowych endpointów, jak w każdym poprzednim wariancie.
- `src/features/deboning/useHmiMode.ts`: dopisać `'v10'` do typu `HmiMode`, `HMI_MODES`, `HMI_LABELS`
  (`'HMI v10'`), do `read()`.
- `src/pages/tablet/RozbiorRoute.tsx`: dopisać gałąź `if (mode === 'v10') return <DeboningHmiV10Page />`.
- Fonty: `Zilla Slab` (600/700) i `IBM Plex Mono` (500/600), podzbiór `latin-ext` (polskie znaki), jako
  pliki `.woff2` w `public/fonts/rozbior-v10/` + `@font-face` w nowym pliku CSS/module scoped do v10
  (nie nadpisywać fontów reszty aplikacji biurowej — tam kanonicznie Fira).
- Zero ryzyka dla obecnych urządzeń/klientów: tryb jest opt-in per urządzenie, nikt nie zostaje
  przełączony automatycznie.

## Poza zakresem tej iteracji

- Pola HACCP (temperatura surowca/sali) — świadomie pominięte, możliwy follow-up.
- Ustawienie `v10` jako domyślnego trybu w danym zakładzie — osobna decyzja wdrożeniowa po realnym
  teście na hali.
- Ciemny motyw dla v10 — nieplanowany (patrz: „jeden, stały jasny motyw" wyżej).
