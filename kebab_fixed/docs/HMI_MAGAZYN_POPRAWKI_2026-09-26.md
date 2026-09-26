# HMI magazynu — pakowanie i wydania, 26.09.2026

## Zmiany

- Karton magazynowy zachowuje etykietę `SCARTON` od pakowania przez mroźnię do załadunku i kursu. Przed załadunkiem biuro musi powiązać karton z zamówieniem; operator dodaje zamówienie do auta.
- Załadunek, cofnięcie skanu, zdjęcie zamówienia i zakończenie kursu synchronizują się przez blokadę pojazdu. Towar, kurs i zwolnienie listy auta zapisują się w jednej transakcji.
- HMI wysyła identyfikator próby i zatwierdzoną listę kartonów/palet. Zmiana zawartości auta wymaga ponownego potwierdzenia. Ponowienie po utracie odpowiedzi nie tworzy drugiego kursu; identyfikator pozostaje również w pamięci sesji przeglądarki po przeładowaniu strony.
- Wspólny kurs może zawierać kartony ze sztukami QR i palety rozliczane z rozpisu.
- Pakowanie rozróżnia tuleję, także gdy receptura i waga są identyczne. Liczniki rozdzielają sztuki pomiędzy pasujące pozycje.
- Historia skanów umożliwia wyjęcie błędnie spakowanej sztuki. Korekta wymaga potwierdzenia, zapisuje zalogowanego operatora i jest zablokowana po przeniesieniu kartonu do mroźni, na auto lub wydanie.
- Ekrany pokazują utratę aktualności danych i czas ostatniego odczytu. Ostatni błąd pozostaje dostępny po zniknięciu alarmu pełnoekranowego.
- Większe numery kartonów, przewijanie składu na 1024×768, zestawienie częściowego wydania, automatyczne odświeżanie zamówień i ponawianie odczytu aut.
- Dialog zakończenia blokuje skaner w tle. Nie ogłasza sukcesu bez utworzonego kursu; osobno pokazuje pominięte zamówienia i rozbieżności dokumentów. Kod QR nie może zostać zapisany jako rejestracja.
- Mobilna lista auta pokazuje kartony magazynowe i cofa je właściwym kodem, a nie fikcyjnym numerem palety 0.

## Weryfikacja

Testy backendu uruchamiano wyłącznie na izolowanej bazie `kebab_mes_test_hmi` na porcie 55439, nie na danych produkcyjnych. Zestaw obejmuje pakowanie, kartony wielopozycyjne, korekty, załadunek, wydania, równoległe ponowienie kursu i rollback przy błędzie zapisu kursu.

Frontend: testy Vitest modułów `magazyn`, `loading` i strony `magazynHmiPage`, `npm run typecheck`, `npm run build`.

Chromium na pozorowanych odpowiedziach API: 1366×768 i 1024×768, dostępność ostatniej pozycji kartonu, ostrzeżenie offline, brak żądań skanowania spod dialogu, widoczność przycisków dialogu. To nie zastępuje próby na fizycznym czytniku.

## Wdrożenie

Zmiany źródeł nie oznaczają aktualizacji działających stanowisk. Wymagane są razem: backend z migracjami oraz nowy frontend/HMI. Migracje dodają pola załadunku i wydania kartonów, historię korekt, poprzednie przypisanie sztuki oraz identyfikator i odpowiedź zapisu kursu. Nie usuwają danych.

Przed wdrożeniem wykonać standardową kopię bazy. Po wdrożeniu sprawdzić na testowym towarze: spakowanie → korekta → ponowne spakowanie → mroźnia → załadunek → cofnięcie → załadunek → kurs widoczny dla biura. Sprawdzić także skaner z Enter i bez Enter oraz utratę połączenia podczas zatwierdzania.

W tym zadaniu nie publikowano instalatora Windows, nie restartowano produkcji i nie wykonywano migracji na bazie produkcyjnej.
