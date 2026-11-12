# Rozrachunki — lista kontrolna wdrożenia

Krótko, po kolei. Dopóki punkty 3–4 nie są zrobione, saldo **nie drukuje się** klientom (ani na WZ, ani w papierach kursu) — to celowe.

1. **Data startu rozliczeń** — Rozrachunki → ustawienia (`app_settings.rozliczenia_start`, domyślnie 09.11.2026).
   Liczą się WZ, faktury i wpłaty z tą datą i późniejsze; wszystko wcześniej to saldo otwarcia. Ustaw ją na dzień,
   na który biuro ma stan z arkusza `PŁATNOŚCI.xlsx`.
2. **Klienci zagraniczni na EUR** — domyślnie każdy klient ma `settlement_currency = 'PLN'`.
   Na liście kontrahentów tacy klienci mają pigułkę **„sprawdź walutę”** (pozycje w innej walucie poza saldem),
   a na karcie podpowiedź „NIP wskazuje na rozliczenia w EUR” (`waluta_podpowiedz`). Zmień walutę w Ustawieniach karty.
   Listę z bazy: klienci, dla których `waluta_z_nip(nip) = 'EUR'`, a `settlement_currency = 'PLN'`
   (NIP z prefiksem kraju innym niż PL).
3. **Saldo otwarcia każdemu klientowi** — karta klienta → „Saldo otwarcia”, osobno WZ i faktury, kierunek
   „klient winien” / „nadpłata”. **0 też się zapisuje** (puste pole = 0) — klient bez długu dostaje 0.
   Bez tego wpisu karta pokazuje: „Saldo nie drukuje się jeszcze na WZ ani w papierach kursu — wprowadź saldo
   otwarcia (może być 0).”
4. **Próba generalna na kopii produkcji przed pierwszymi wydrukami salda** — na serwerze produkcyjnym:
   `KEBAB_KOD=<repo>/kebab_fixed/backend deploy/proba_generalna.sh` (kopia `kebab_proba`, produkcja nietknięta).
   Na kopii porównaj z arkuszem saldo kilku klientów (WZ, FV, łącznie; co najmniej jeden EUR, jeden z nadpłatą,
   jeden z fakturą korygującą). Dopiero gdy się zgadza — salda mogą iść do klientów.
5. **Stare tabele rozrachunków na produkcji** — sprawdź, czy są w nich dane:
   `SELECT count(*) FROM client_opening_balances; SELECT count(*) FROM client_charges; SELECT count(*) FROM client_payments;`
   oraz kolumny `clients.settlement_*`. Nowy moduł ich nie czyta. Jeśli są tam wpisy — przepisz je ręcznie
   jako saldo otwarcia (punkt 3), zanim ktoś uzna je za aktualne.

Po wdrożeniu: dokumenty z niemożliwą datą WZ (np. 30.02) nie trafiają do księgi i są zgłaszane w logu
(`rozliczenia.wz.zla_data`) — popraw datę w dokumencie WZ, saldo przeliczy się samo.
