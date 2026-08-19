#!/usr/bin/env bash
# Smoke po wdrożeniu — sprawdza to, co naprawdę zatrzymuje zakład.
#
# POWÓD ISTNIENIA: po każdym wdrożeniu sprawdzało się to samo ręcznie —
# czy wstaje strona, czy backend odpowiada, czy przeglądarka dostaje NOWY
# bundel (deploy potrafi „przejść", a nginx dalej serwuje stary), czy baza
# odpowiada i czy dokumenty dostaw dają się przeczytać. Ręcznie zawsze
# któregoś kroku brakuje — zwłaszcza rano.
#
# Kroki są READ-ONLY: nic nie zapisują, więc można to puścić na produkcji
# o dowolnej porze.
#
# Użycie:
#   deploy/smoke.sh                       # domyślnie produkcja
#   KEBAB_URL=http://127.0.0.1:8080 deploy/smoke.sh
set -uo pipefail

URL="${KEBAB_URL:-http://91.98.105.107:8080}"
APP="${KEBAB_APP:-/opt/kebab/app}"
bledy=0

ok()   { echo "  ✓ $1"; }
zle()  { echo "  ✗ $1" >&2; bledy=$((bledy + 1)); }

echo "▶ smoke: $URL"

# 1. Backend żyje.
if [ "$(curl -s -m 10 "$URL/api/health" || true)" = "true" ]; then
  ok "backend odpowiada"
else
  zle "backend NIE odpowiada (/api/health)"
fi

# 2. Strona się serwuje.
kod="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$URL/" || true)"
[ "$kod" = "200" ] && ok "strona wstaje (HTTP $kod)" || zle "strona zwraca HTTP $kod"

# 3. Serwowany bundel = ten zbudowany. Deploy bywa „udany", a nginx trzyma
#    stary plik z cache — wtedy poprawka nie dociera do biura.
serwowany="$(curl -s -m 15 "$URL/" | grep -oE 'main-[A-Za-z0-9_-]+\.js' | head -1 || true)"
if [ -d "$APP/dist/assets" ]; then
  zbudowany="$(basename "$(ls "$APP"/dist/assets/main-*.js 2>/dev/null | head -1)" 2>/dev/null || true)"
  if [ -n "$serwowany" ] && [ "$serwowany" = "$zbudowany" ]; then
    ok "bundel zgodny ($serwowany)"
  else
    zle "bundel ROZJECHANY — serwowany: ${serwowany:-brak}, na dysku: ${zbudowany:-brak}"
  fi
else
  [ -n "$serwowany" ] && ok "bundel serwowany ($serwowany)" || zle "brak bundla w HTML"
fi

# 4. Kanał aktualizacji desktopu — biuro aktualizuje się z niego samo.
wersja="$(curl -s -m 15 "$URL/api/desktop-updates/latest.json" \
          | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
[ -n "$wersja" ] && ok "kanał aktualizacji: $wersja" || zle "kanał aktualizacji nie odpowiada"

# 5. Baza odpowiada i dokumenty dostaw dają się policzyć. To pierwszy ekran,
#    który biuro otwiera rano — jeśli tu jest błąd, zakład stoi.
if command -v psql >/dev/null 2>&1 && [ -f /opt/kebab/config/.env ]; then
  # shellcheck disable=SC1091
  set -a; . /opt/kebab/config/.env; set +a
  ile="$(psql "${DATABASE_URL:-}" -At -c \
        "SELECT COUNT(*) FROM receptions WHERE received_date >= CURRENT_DATE - 7" 2>/dev/null || true)"
  [ -n "$ile" ] && ok "baza odpowiada (przyjęć w tygodniu: $ile)" || zle "baza NIE odpowiada"
else
  echo "  – baza pominięta (uruchom na serwerze produkcyjnym)"
fi

echo
if [ "$bledy" -eq 0 ]; then
  echo "✓ SMOKE OK"
else
  echo "✗ SMOKE: $bledy błąd(ów) — rozważ deploy/rollback.sh" >&2
fi
exit "$bledy"
