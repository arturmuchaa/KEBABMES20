# HMI v5 — Design Spec
**Data:** 2026-06-01  
**Projekt:** Kebab MES — Rozbiór  
**Urządzenie docelowe:** Panel PC 21", Windows, dotykowy, landscape 1920×1080  
**Plik docelowy:** `src/pages/tablet/DeboningHmiV5Page.tsx`  
**Route:** dodać `v5` do `useHmiMode` i `RozbiorRoute`

---

## 1. Cel i filozofia

HMI v5 to ekran roboczy dla operatora rozbioru na przemysłowym komputerze panelowym. Kluczowe zasady:

- **Zero cognitive load** — operator tapuje, nie myśli
- **No-scroll** — wszystko widoczne na jednym ekranie 1920×1080
- **Auto-fokus flow** — po wyborze pracownika kursor sam przechodzi przez pola
- **Duże cele dotykowe** — minimum 56px wysokości dla każdego elementu interaktywnego
- **Dwa motywy** — Light i Dark, przełączane w nagłówku (localStorage)

---

## 2. Layout (1920×1080, no-scroll)

```
┌─────────────────────────────────────────────────────────────────────┐
│  NAGŁÓWEK  (zegar, sesja, przełącznik motywu, zakończ zmianę)  60px │
├─────────────────────────────────────────────────────────────────────┤
│  PASEK PARTII  (6 kafli, pełna szerokość)                       88px │
├──────────────────────────────────┬──────────────────────────────────┤
│                                  │                                   │
│   GRID PRACOWNIKÓW               │   PANEL WPISYWANIA WAG            │
│   54% szerokości (~1037px)       │   46% szerokości (~883px)         │
│   4 kolumny × 4 rzędy            │   2 pola + numpad + ZAPISZ        │
│   878px wysokości                │   878px wysokości                 │
│                                  │                                   │
├──────────────────────────────────┴──────────────────────────────────┤
│  PASEK STATUSU  (ostatnie wpisy bieżącej sesji)                 54px │
└─────────────────────────────────────────────────────────────────────┘
```

Suma pionowa: 60 + 88 + 878 + 54 = **1080px** ✓

---

## 3. Nagłówek (60px)

Elementy od lewej do prawej:
- Logo / nazwa "Rozbiór" + podtytuł sesji
- Zegar `HH:MM:SS` (izolowany timer, monospace, bold 24px)
- Przełącznik motywu (ikona Słońce/Księżyc)
- Przycisk `Zakończ zmianę` (small, secondary — celowo mały, nie na głównej ścieżce)
- Przycisk `Zakończ partię` (small, secondary)

---

## 4. Pasek partii (88px, pełna szerokość)

Max 6 kafli poziomo, równej szerokości (`(1920 - marginesy) / 6`).

### Zawartość kafla:
```
┌─────────────────────────────────┐
│  P4321                    2 dni │  ← numer partii 20px bold | dni do wygaśnięcia (kolor semaforu)
│  KOWALSKI-FARM                  │  ← nazwa dostawcy 13px, kolor drugoplanowy
│  112 kg · 7 poj.                │  ← dostępna masa + pojemniki 13px muted
└─────────────────────────────────┘
```

### Stany kafla partii:
| Stan | Opis |
|------|------|
| Neutralny | Tło panelu, ramka 1px |
| **Wybrany** | Tło akcentu niebieskiego, biały tekst, ramka 2px |
| Wygasa wkrótce (≤3 dni) | Ramka amber `#f59e0b`, tekst dni = amber |
| Przeterminowany | Ramka czerwona `#ef4444`, tekst dni = czerwony |

Tap na kafel = natychmiastowe przypisanie (brak potwierdzenia).

---

## 5. Grid pracowników (lewy panel, 54%)

**Wymiary siatki:**
- 4 kolumny × 4 rzędy = 16 slotów
- Max 13 pracowników; pozostałe sloty puste (niewidoczne)
- Kafel: `~245px × ~200px`, `border-radius: 12px`

### Zawartość kafla pracownika:
```
┌──────────────────────────┐
│                          │
│          JK              │  ← inicjały 36px bold
│     Jan Kowalski         │  ← pełne nazwisko 14px
│  ● 3 wpisy dziś          │  ← zielona kropka gdy aktywny
│                          │
└──────────────────────────┘
```

### Stany kafla pracownika:
| Stan | Opis |
|------|------|
| Neutralny | Tło panelu, ramka 1px |
| **Wybrany** | Tło akcent niebieski, biały tekst, ramka 2px |
| Aktywny dziś | Zielona kropka + liczba wpisów |
| Pusty slot | Niewidoczny (brak ramki i tła) |

Po wyborze pracownika kafel pozostaje wybrany przez cały czas — reset tylko przez tap innego pracownika lub koniec sesji.

---

## 6. Panel wpisywania wag (prawy panel, 46%)

### Układ pionowy (878px):
1. Pole ĆWIARTKA (~120px)
2. Pole MIĘSO Z/S + wskaźnik wydajności (~120px)
3. Numpad 3×4 (~500px)
4. Przycisk ZAPISZ (~90px)
5. Marginesy wewnętrzne (~48px łącznie)

### Pola wag:
- Etykieta: `11px`, uppercase, `letter-spacing: 0.16em`, kolor drugoplanowy
- Wartość: `56px`, bold, monospace
- Pole aktywne (fokus): ramka niebieska `2px`, lekkie tło akcentu
- Pole oczekujące: ramka neutralna `1px`

### Wskaźnik wydajności:
Wyświetlany inline obok etykiety MIĘSO Z/S, obliczany na bieżąco:
- `≥ 75%` → zielony `#22c55e`
- `60–74%` → amber `#f59e0b`
- `< 60%` → czerwony `#ef4444`

### Numpad:
```
[ 7 ] [ 8 ] [ 9 ]
[ 4 ] [ 5 ] [ 6 ]
[ 1 ] [ 2 ] [ 3 ]
[ 0 · · · ] [ ⌫ ]
```
- Klawisze cyfr: `~270px × ~120px`
- Klawisz `0`: podwójna szerokość
- Klawisz `⌫`: kasuje ostatnią cyfrę; przytrzymanie 600ms = czyści pole
- Separator dziesiętny `.`

### Auto-fokus flow:
1. Tap pracownika → fokus na ĆWIARTKA (niebieska ramka)
2. Wpisanie cyfr → aktualizacja pola ĆWIARTKA
3. Tap bezpośrednio w pole MIĘSO Z/S → fokus skacze na MIĘSO (lub operator tapuje kafel MIĘSO z poziomu pola ĆWIARTKA); brak auto-przeskoku po liczbie cyfr (ryzyko błędu przy 2-cyfrowych wartościach)
4. Wpisanie cyfr → aktualizacja pola MIĘSO + obliczenie wydajności na bieżąco
5. Oba pola mają wartość > 0 → przycisk ZAPISZ zmienia się na intensywny zielony

### Przycisk ZAPISZ WPIS (90px, pełna szerokość panelu):
| Stan | Wygląd |
|------|--------|
| Niekompletny | Szary, `opacity: 0.4`, kursor: disabled |
| Gotowy | Intensywny zielony `#16a34a`, biały tekst, lekki pulse |
| Po zapisaniu | Flash zielony 300ms → reset pól → fokus na ĆWIARTKA |

---

## 7. Pasek statusu (54px, dół)

Ostatnie 4–5 wpisów bieżącej sesji jako tekst inline, monospace `13px`:

```
DZIŚ:  P4321 · Jan K.  120→95 kg  79%   ·   P4321 · Ala M.  124→98 kg  79%   ·   P4322 · Tomek K.  90→71 kg  78%
```

- Tylko do odczytu — brak interakcji
- Nowe wpisy pojawiają się z lewej strony (wypychają starsze w prawo)

---

## 8. Paleta kolorów (CSS variables)

| Zmienna | Dark | Light |
|---------|------|-------|
| `--app` | `#0a0f1a` | `#f0f4f8` |
| `--panel` | `#111827` | `#ffffff` |
| `--panel2` | `#1e2d40` | `#f8fafc` |
| `--bd` | `#1e293b` | `#e2e8f0` |
| `--ink` | `#f1f5f9` | `#0f172a` |
| `--mut` | `#64748b` | `#64748b` |
| `--accent` | `#3b82f6` | `#2563eb` |
| `--grn` | `#22c55e` | `#16a34a` |
| `--amb` | `#f59e0b` | `#d97706` |
| `--red` | `#ef4444` | `#dc2626` |

Klucz localStorage: `rozbior_hmi_v5_theme`

---

## 9. Stany globalne

### Brak sesji (start dnia):
Cały obszar roboczy (grid + panel wag) zablokowany. Wyśrodkowany przycisk `▶ ROZPOCZNIJ DZIEŃ`.

### Sesja otwarta:
Pełny layout aktywny.

### Alert wygasającej partii:
Banner amber pod paskiem partii — nie blokuje pracy.

### Blokada przycisku ZAPISZ:
Szary gdy: brak wybranego pracownika LUB brak wybranej partii LUB puste/zerowe pole wag.

### Po zapisaniu wpisu:
- Flash zielony na przycisku (300ms)
- Pola wag czyszczą się
- Fokus → ĆWIARTKA
- Wybrany pracownik pozostaje (nie resetuje się)
- Wpis pojawia się w pasku statusu

---

## 10. Integracja z istniejącym kodem

- **Dane:** `useProductionSession` + `useDeboningEntries` — bez zmian
- **API:** `rawBatchesApi`, `usersApi` — bez zmian
- **Routing:** dodać `'v5'` do `HmiMode` w `useHmiMode.ts`, dodać label `'HMI v5'`, dodać case w `RozbiorRoute.tsx`
- **Motyw:** własny klucz localStorage `rozbior_hmi_v5_theme` — niezależny od v4
- **Timer zegara:** izolowany `setInterval` w osobnym komponencie memo (nie re-renderuje gridu)
- **Anti-flash:** `useMemo` na liście pracowników i partii ze stabilnymi kluczami

---

## 11. Czego NIE ma w v5

- Brak panelu historii (zakładki, overlay)
- Brak wbudowanej kalkulacji/podpowiedzi KPI (tylko wydajność inline)
- Brak edycji wpisów z poziomu HMI
- Brak trybu pionowego (landscape only)
- Brak scrollowania gdziekolwiek
