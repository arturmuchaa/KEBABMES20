# Deploy — Kebab MES (instancja per klient)

Model: **single-tenant**. Każdy klient = osobny projekt docker compose = osobne
wolumeny = osobna, czysta baza. Patrz architektura w pamięci projektu.

## Nowy klient (jedna komenda)
```bash
bash deploy/nowy-klient.sh ksiezyc
```
Skrypt pyta o nazwę/NIP/port/moduły, generuje `clients/<slug>/.env` z losowymi
sekretami i stawia instancję (`docker compose -p kebab-<slug> ... up -d --build`).
Baza startuje pusta (tylko schemat z init_db + migracje przy starcie).

## Codzienna obsługa
```bash
SLUG=ksiezyc
docker compose -p kebab-$SLUG -f deploy/docker-compose.yml logs -f      # logi
docker compose -p kebab-$SLUG -f deploy/docker-compose.yml down         # stop
docker exec kebab-$SLUG-db-1 pg_dump -U kebab kebab_mes > backup.sql    # backup
```

## Aktualizacja u klienta
```bash
git pull
docker compose -p kebab-$SLUG --env-file clients/$SLUG/.env -f deploy/docker-compose.yml up -d --build
```
Migracje schematu wykonują się automatycznie przy starcie backendu.

## Moduły per klient
W `clients/<slug>/.env` ustaw `MODULES` (pusto = wszystkie), np. `MODULES=rozbior`.
Jeden kod, różne instancje — bez forków.

## ⚠️ Zasady
- **Nie buduj na maszynie klienta pod presją RAM** — obraz buduje się raz; mini-PC
  16 GB udźwignie build + runtime, ale buildy CI/dev są pewniejsze.
- `clients/` jest w .gitignore — zawiera sekrety. Backupuj osobno.
- PDF (WZ/HDI/CMR/etykiety) wymaga chromium — jest w obrazie.
