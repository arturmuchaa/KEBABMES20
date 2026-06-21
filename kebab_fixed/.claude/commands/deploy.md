---
description: Bezpieczny deploy na VPS z OBOWIĄZKOWYM pre-deploy diff (prod bywa PRZED gitem).
argument-hint: "[all|frontend|backend]  (domyślnie all)"
---

# /deploy — deploy z obowiązkową kontrolą prod ↔ repo

Cel: `deploy/deploy.sh` kopiuje repo → `/opt/kebab/app`, więc **każda zmiana istniejąca TYLKO na prod zostanie po cichu nadpisana**. Tak zepsuły się etykiety 2026-06-21. Dlatego najpierw diff, dopiero potem deploy.

## Krok 1 — OBOWIĄZKOWY pre-deploy diff (NIE pomijać)
```
diff -rq /opt/kebab/app/backend/app /opt/kebab/kebab_new/kebab_fixed/backend/app | grep -i differ
```
- Jeśli wynik **niepusty** (prod ma treść spoza repo): **STOP.** Pokaż userowi różnice, przenieś prod-only zmiany do repo i **scommituj do `main` NAJPIERW**. Dopiero potem wracaj do deployu.
- Jeśli **pusty**: prod == repo, idź dalej.

## Krok 2 — stan gita
- `git status` musi być czysty, gałąź wypchnięta. Deployujemy to, co jest w repo.

## Krok 3 — deploy
```
deploy/deploy.sh {{ args || "all" }}
```
Skrypt sam robi backup, atomową podmianę `dist`, health-check na **:8010** i rollback przy porażce. `frontend` NIE restartuje backendu.

## Krok 4 — smoke test (przed ogłoszeniem „done")
- Druk etykiety (Zebra/PDF), WZ/HDI/CMR — krytyczne flow.
- `curl -sf 127.0.0.1:8010/api/health` → `true`.
