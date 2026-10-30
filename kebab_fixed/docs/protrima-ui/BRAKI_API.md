# Braki API wykryte w próbie PROTRIMA

Próba nie zmienia backendu. Funkcja, której API nie daje, jest w interfejsie wyłączona
z opisem „brak w API” i trafia tutaj. Po próbie: decyzja, co dopisać w backendzie.

| Data | Ekran / akcja | Czego brakuje | Najbliższy istniejący endpoint | Co UI pokazuje teraz |
|---|---|---|---|---|
| 30.10.2026 | Wyrób gotowy — przydatność | `finished-goods` nie zwraca daty przydatności | brak | kolumna „Przydatność” = „—”, widok „Krótka data” pusty |
| 30.10.2026 | Zamówienie → Historia | dziennik zmian JEDNEGO zamówienia (kto/kiedy/co) | audyt globalny (`/api/audit`?) — do sprawdzenia | tylko „Zamówienie utworzone” + notka |
| 30.10.2026 | Zamówienie → Dokumenty | HDI i CMR na liście nie mają `order_id` (lista `/hdi`, `/cmr`) | `/wz` ma `source_id` — WZ/WM pokazujemy | tylko WZ/WM z zamówienia |
| 30.10.2026 | Zamówienie → Wysyłka | kurs (pojazd, kierowca) przypisany do zamówienia | `/pallets/zaladunki/do-wydruku` — tylko kursy po załadunku | brak karty kursu, liczba załadowanych palet |
| 30.10.2026 | Kontrahent | kraj odbiorcy (pole) | NIP z prefiksem VAT UE | kraj z prefiksu NIP; brak prefiksu = nie pokazujemy |
