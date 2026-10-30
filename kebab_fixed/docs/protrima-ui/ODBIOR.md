# Odbiór faz próby PROTRIMA

Każda faza dopisuje sekcję: data, commit, wyniki tsc / testów / builda, rozmiar paczki
`protrima` (gzip), zrzuty, porównanie ze starym MES na tej samej kopii, otwarte sprawy.

## Faza 0 — środowisko

- [ ] `status`: usługa active, 200 na :8020 i :8090, „✓ izolacja”
- [ ] stary MES na :8090/index.html loguje się i pokazuje dane z kopii
- [ ] zmiana zrobiona na :8090 nie pojawia się na :8080
