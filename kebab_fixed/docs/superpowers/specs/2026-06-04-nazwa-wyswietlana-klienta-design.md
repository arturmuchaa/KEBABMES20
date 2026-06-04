# Projekt (F1): Nazwa wyświetlana klienta w całym MES (pełna tylko w dokumentach)

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)

## Kontekst i problem

Klient ma dwie nazwy: **pełną/prawną** (`clients.name`, np. „Okaytekin …") i **wyświetlaną**
(`clients.display_name` → `displayName`, np. „Zagros"). Dziś `displayName` **nie jest pokazywany
nigdzie** w UI — wszystkie ekrany pokazują pełną `client_name`. Użytkownik chce, by MES wszędzie
pokazywał **nazwę wyświetlaną**, a pełną tylko w **oficjalnych dokumentach**.

Decyzje (zatwierdzone):
- **Nazwa wyświetlana**: wszystkie ekrany operacyjne, wydruki zamówień, etykiety.
- **Pełna nazwa**: faktury / dokumenty księgowe oraz przyszłe **HDI/CMR/WZ** (Część C).
- **Identyfikacja/kluczowanie zostaje po PEŁNEJ nazwie** — zamówienia, sztuki, palety, wydania,
  szablony etykiet nadal przechowują i dopasowują po `client_name` (pełnej). Zmieniamy **tylko
  warstwę wyświetlania**. To krytyczne: nie ruszamy zapisów/kluczy.

### Stan zastany

- `clients`: `id, code, name, nip, regon, address, city, contact_name, phone, email, active`.
  Backend zwraca `display_name`; `clientsApi.list()` mapuje na `displayName` (`mapClient`).
- Klient w zamówieniach/sztukach/itd. trzymany jako **nazwa** (`client_name`), nie id
  (zob. „BUG 2 FIX" w `LabelTemplateSetupPage` — kluczowanie po nazwie). Nie zmieniamy tego.
- `displayName` nieużywany w UI (poza React `Component.displayName`).
- Klient pokazywany w ~17 plikach (wszystkie operacyjne + wydruki + etykiety):
  `DetailModal` (finished-goods), `RecallPage`, `OrderPrintPage`, `ClientOrdersPage`,
  `LabelTemplateSetupPage`, `PalletLabelPrintPage`, `FinishedGoodsPage`, `MobileZaladunekPage`,
  `MobileWydanieLuzemPage`, `MobileMrozniaPage`, `MobileSztukaPage`, `ProductionPlanningPage`,
  `DashboardPage`, `MobilePalletLandingPage`, `MobileProdukcjaPage`, `MobilePakowaniePage`,
  `ProductionTabletPage`. Żaden z nich to faktura/HDI/CMR/WZ — wszystkie → nazwa wyświetlana.

## Architektura

### 1. Resolver na froncie (`src/lib/clientNames.ts`)

Mapowanie pełna→wyświetlana, raz pobrane i cache'owane na całą aplikację:

```ts
// pseudo-interfejs
let _cache: Map<string, string> | null = null      // klucz: name.trim(), wartość: displayName||name
let _loading: Promise<Map<string,string>> | null = null

export async function loadClientNames(): Promise<Map<string,string>>  // z clientsApi.list(); idempotentne
export function resolveClientName(map: Map<string,string> | null, fullName: string): string
// = map?.get(fullName.trim()) || fullName  (brak dopasowania / pusty displayName → pełna)

export function useClientNames(): (fullName: string) => string
// hook: ładuje cache na mount (współdzielony), zwraca funkcję display(name);
// przed załadowaniem zwraca identyczność (pełna), po załadowaniu re-render → wyświetlana
```

- **Fallback:** brak klienta w mapie (np. „na magazyn", „STAN", klient z ulicy) → zwraca wejście.
- **Cache współdzielony** (modułowy) — pierwszy ekran pobiera, reszta (w tym mobile) reużywa.
- Dopasowanie po `name.trim()` (bez rozróżniania spacji).

### 2. Zamiana w wyświetlaniu (~17 surface'ów)

W każdym z plików, **tam gdzie pokazywana jest nazwa klienta**, owinąć w resolver:
`display(clientName)` zamiast surowego `clientName`. Wzorzec:
```tsx
const display = useClientNames()
// ...
<span>{display(order.clientName)}</span>
```

**Selecty wyboru klienta** (np. `LabelTemplateSetupPage`, `ClientOrdersPage`, `MobileWydanieLuzemPage`):
etykieta opcji = displayName, **wartość = pełna nazwa** (identyfikacja):
```tsx
<option value={c.name}>{c.displayName || c.name}</option>
```
(stan/zapis dalej trzyma `c.name`).

### 3. Bez zmian (pełna nazwa)

- Faktury / dokumenty księgowe (jeśli/gdy pokazują klienta) — pełna `name`.
- Przyszłe HDI/CMR/WZ (Część C) — pełna `name` (zaznaczyć w ich specach).
- Backend: bez zmian (klient identyfikowany pełną nazwą; `clientsApi.list` już daje `displayName`).

## Obsługa błędów / przypadki brzegowe

| Sytuacja | Zachowanie |
|---|---|
| brak dopasowania nazwy w mapie | pokaż wejściową (pełną) nazwę |
| pusty `displayName` klienta | pokaż pełną `name` |
| cache jeszcze nieładowany | pokaż pełną (po załadowaniu re-render → wyświetlana) |
| klient pseudo (`na magazyn`/`STAN`) | bez zmian (zwraca wejście) |

## Testy

Brak frontowego runnera testów w repo → weryfikacja **build + ręczna**:
- Logika `resolveClientName` trywialna (mapa + fallback) — sprawdzić ręcznie/inline.
- E2E: klient z `displayName` „Zagros" (pełna „Okaytekin") — na ekranach operacyjnych,
  wydrukach zamówień i etykietach widać „Zagros"; w fakturach/przyszłych HDI/CMR/WZ pełna nazwa;
  zapis/kluczowanie (zamówienie, sztuka, szablon) dalej po pełnej nazwie (sprawdzić, że nic się
  nie rozjechało — np. szablon etykiety dalej znajdowany).

## Poza zakresem

- Migracja na identyfikację po `client_id` zamiast nazwy (osobny, duży temat — NIE robimy).
- Backendowe dokładanie `client_display_name` do odpowiedzi (Podejście 2 — odrzucone).
- Dokumenty HDI/CMR/WZ (Część C) — tam pełna nazwa, ale same dokumenty poza tym specem.

## Otwarte kwestie

- Czy gdziekolwiek dziś istnieje ekran „faktury klienta" pokazujący nazwę — jeśli tak, zostawiamy
  pełną. (`PurchaseInvoicesPage` dotyczy dostawców, nie klientów — bez zmian.)
