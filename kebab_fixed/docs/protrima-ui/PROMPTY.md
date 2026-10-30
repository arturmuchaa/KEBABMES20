# Prompty do Claude Code — próba PROTRIMA

## Jak pracować

- Start w trybie planu (Claude najpierw czyta i planuje, niczego nie zmienia):
  `cd /opt/kebab/protrima/kebab_fixed && claude --permission-mode plan`.
  W trakcie sesji tryby przełącza Shift+Tab („⏸ plan mode on” = tryb planu).
  Plan możesz poprawić w edytorze: Ctrl+G.
- Jedna faza = jedna sesja. Między fazami `/clear` (czysty kontekst; zasady wczytają się znowu).
- Przerwanie: Esc. Powrót do wcześniejszego stanu rozmowy i plików: `/rewind`
  (nie cofa bazy — od tego jest `deploy/protrima_proba.sh odswiez-baze`).
- Wznowienie po zamknięciu terminala: `claude --continue`. Nazwa sesji: `/rename faza-2`.
- Push robisz Ty albo po Twojej zgodzie: `git push -u origin protrima-ui`.
  Strażnik i tak nie wypuści niczego poza tę gałąź.

## Sesja startowa (po fazie 0, tylko odczyt)

```
Przeczytaj docs/protrima-ui/ZASADY_PROBY.md i PLAN_PROBY.md. Uruchom
deploy/protrima_proba.sh status i python3 .claude/hooks/test_straznik_proby.py.
Potem przejrzyj src/lib/api.ts, src/features/auth/AuthContext.tsx, vite.config.ts
i docs/protrima-ui/prototyp-v03/src. Napisz krótko: czy środowisko działa, co z prototypu
przeniesiesz w fazie 1 i co w repo wygląda inaczej, niż zakłada plan. Niczego nie zmieniaj.
```

## Faza N (wzór — podmień numer i nazwę)

```
Faza 1 z docs/protrima-ui/PLAN_PROBY.md: szkielet PROTRIMA.
Przeczytaj tę sekcję planu, ZASADY_PROBY.md i pliki, które wskazuje. Przygotuj plan:
pliki do utworzenia i zmiany, co bierzesz z prototypu, testy, sposób sprawdzenia na :8090.
Kodu nie pisz, dopóki nie zaakceptuję planu.
Po wykonaniu: npx tsc --noEmit, npm test, npm run build -- --mode proba, git diff main --stat,
wpis w docs/protrima-ui/ODBIOR.md, commit „PROTRIMA faza 1: szkielet”. Bez push.
Na końcu daj mi krótką listę do sprawdzenia na :8090/protrima.html (co kliknąć, co ma być widać).
```

Kolejne: `Faza 2 … Zamówienia: odczyt`, `Faza 3 … Zamówienia: akcje`, `Faza 4 … Wyrób gotowy`,
`Faza 5 … Pulpit`, `Faza 6 … aplikacja Tauri`. Faza 3 jest duża — można ją podzielić:
„Faza 3, tylko palety i kartony”, potem „Faza 3, reszta akcji”.

## Uwaga z próby → poprawka

```
Uwaga z biura (docs/protrima-ui/UWAGI.md, wpis z <data>): <co się stało, ekran, zamówienie>.
Najpierw znajdź przyczynę (logi usługi protrima-proba, odpowiedź API, kod), potem zaproponuj
poprawkę w trybie planu. Jeśli to brak w API — wpis w BRAKI_API.md, bez zmian w backendzie.
```

## Nowy instalator (po fazie 6)

```
Podbij version w src-tauri/tauri.protrima-test.conf.json (0.3.x → następna), commit
„PROTRIMA Test <wersja>”. Pokaż mi diff; push zrobię sam.
```
