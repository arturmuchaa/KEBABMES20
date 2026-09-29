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
# SPRAWDZA SERWER, NA KTÓRYM STOI (29.09.2026): dawniej domyślnie odpytywał
# publiczny adres produkcji, a porównywał go z LOKALNYM dist i LOKALNĄ bazą.
# Uruchomiony na starym serwerze (który tylko przekierowuje) dał „SMOKE OK",
# bo trafił na identyczny build — nie sprawdzając niczego na tej maszynie.
# Teraz: strażnik hosta na starcie, domyślnie lokalny nginx, a porównanie
# z dist i odczyt bazy tylko wtedy, gdy adres jest lokalny.
#
# Użycie:
#   deploy/smoke.sh                                 # na serwerze produkcyjnym
#   KEBAB_URL=http://adres:8080 deploy/smoke.sh     # zdalnie: bez dist i bazy
set -uo pipefail

KATALOG="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=deploy/straznik_hosta.sh
. "$KATALOG/straznik_hosta.sh"

URL="${KEBAB_URL:-${KEBAB_LOCAL_URL%/}}"
URL="${URL%/}"
APP="${KEBAB_APP:-/opt/kebab/app}"
ENVFILE="${KEBAB_ENV:-/opt/kebab/config/.env}"
bledy=0
pominiete=0

ok()     { echo "  ✓ $1"; }
zle()    { echo "  ✗ $1" >&2; bledy=$((bledy + 1)); }
pominac() { echo "  – $1"; pominiete=$((pominiete + 1)); }

# Pierwszy krok, przed jakimkolwiek zapytaniem do strony czy API: serwer,
# który przekierowuje, nie jest produkcją — nie ma tu czego sprawdzać.
straznik_hosta

# Lokalny = ten sam serwer, którego dist i bazę możemy porównać.
host="$(printf '%s' "$URL" | sed -E 's#^[A-Za-z]+://(\[[^]]*\]|[^/:]+).*#\1#')"
case "$host" in
  127.*|localhost|\[::1\]) lokalny=1 ;;
  *)                       lokalny=0 ;;
esac

echo "▶ smoke: $URL ($([ "$lokalny" = 1 ] && echo "lokalny, $(hostname)" || echo 'zdalny'))"

# Jedno zapytanie bez -L: kod HTTP + treść. Przekierowanie to błąd z adresem,
# nigdy „OK" z cudzej maszyny.
pobierz() {  # $1 = ścieżka; ustawia: KOD, TRESC, CEL
  local plik; plik="$(mktemp)"
  local w; w="$(curl -s -m 15 -o "$plik" -w '%{http_code} %{redirect_url}' "$URL$1" 2>/dev/null || true)"
  KOD="${w%% *}"; CEL="${w#* }"; [ "$CEL" = "$KOD" ] && CEL=""
  TRESC="$(cat "$plik")"; rm -f "$plik"
  [ -n "$KOD" ] || KOD="000"
}
opis_kodu() {
  case "$KOD" in
    000) echo "brak odpowiedzi" ;;
    3??) echo "HTTP $KOD → ${CEL:-?} (przekierowanie — to nie ten serwer)" ;;
    *)   echo "HTTP $KOD" ;;
  esac
}

# 1. Backend żyje.
pobierz /api/health
if [ "$KOD" = "200" ] && [ "$TRESC" = "true" ]; then
  ok "backend odpowiada"
else
  zle "backend NIE odpowiada (/api/health: $(opis_kodu), treść: ${TRESC:0:40})"
fi

# 2. Strona się serwuje.
pobierz /
strona_kod="$KOD"; strona="$TRESC"
if [ "$strona_kod" = "200" ]; then
  ok "strona wstaje (HTTP 200)"
else
  zle "strona NIE wstaje ($(opis_kodu))"
fi

# 3. Serwowany bundel = ten zbudowany. Deploy bywa „udany", a nginx trzyma
#    stary plik z cache — wtedy poprawka nie dociera do biura. „Zbudowany"
#    to bundel, na który wskazuje index.html w dist — nie pierwszy plik
#    z katalogu assets, w którym mogą leżeć stare.
serwowany=""
[ "$strona_kod" = "200" ] && serwowany="$(printf '%s' "$strona" | grep -oE 'main-[A-Za-z0-9_-]+\.js' | head -1 || true)"
if [ "$strona_kod" != "200" ]; then
  zle "bundel niesprawdzony — strona nie wstała"
elif [ -z "$serwowany" ]; then
  zle "w HTML strony nie ma odwołania do main-*.js"
elif [ "$lokalny" = 0 ]; then
  pominac "bundel serwowany: $serwowany — BEZ porównania: adres zdalny, lokalny dist to inna maszyna"
elif [ ! -f "$APP/dist/index.html" ]; then
  zle "brak $APP/dist/index.html — nie ma z czym porównać bundla"
else
  zbudowany="$(grep -oE 'main-[A-Za-z0-9_-]+\.js' "$APP/dist/index.html" | head -1 || true)"
  if [ -z "$zbudowany" ]; then
    zle "$APP/dist/index.html nie wskazuje żadnego main-*.js"
  elif [ ! -f "$APP/dist/assets/$zbudowany" ]; then
    zle "dist/index.html wskazuje $zbudowany, ale pliku nie ma w $APP/dist/assets"
  elif [ "$serwowany" = "$zbudowany" ]; then
    ok "bundel zgodny ($serwowany)"
  else
    zle "bundel ROZJECHANY — serwowany: $serwowany, w dist: $zbudowany (nginx/cache?)"
  fi
fi

# 4. Kanał aktualizacji desktopu — biuro aktualizuje się z niego samo.
pobierz /api/desktop-updates/latest.json
wersja=""
[ "$KOD" = "200" ] && wersja="$(printf '%s' "$TRESC" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("version",""))' 2>/dev/null || true)"
if [ -n "$wersja" ]; then
  ok "kanał aktualizacji: $wersja"
else
  zle "kanał aktualizacji bez wersji ($(opis_kodu))"
fi

# 5. Baza odpowiada i dokumenty dostaw dają się policzyć. To pierwszy ekran,
#    który biuro otwiera rano — jeśli tu jest błąd, zakład stoi.
#    Tylko dla adresu lokalnego: lokalne .env opisuje bazę TEJ maszyny.
#    Z .env bierzemy wyłącznie DATABASE_URL — reszta (sekrety) nie jest
#    potrzebna i nie powinna nadpisywać zmiennych skryptu.
if [ "$lokalny" = 0 ]; then
  pominac "baza pominięta — adres zdalny, lokalne .env opisuje bazę innej maszyny"
elif ! command -v psql >/dev/null 2>&1; then
  pominac "baza pominięta — brak psql na tej maszynie"
elif [ ! -f "$ENVFILE" ]; then
  pominac "baza pominięta — brak $ENVFILE"
else
  db_url="$(sed -n -E 's/^DATABASE_URL=["'\'']?([^"'\'']*)["'\'']?$/\1/p' "$ENVFILE" | tail -1)"
  if [ -z "$db_url" ]; then
    zle "brak DATABASE_URL w $ENVFILE"
  else
    ile="$(psql "$db_url" -At -c \
          "SELECT COUNT(*) FROM receptions WHERE received_date >= CURRENT_DATE - 7" 2>/dev/null || true)"
    if [[ "$ile" =~ ^[0-9]+$ ]]; then
      ok "baza odpowiada (przyjęć w tygodniu: $ile)"
    else
      zle "baza NIE odpowiada albo zwróciła coś innego niż liczbę (${ile:0:60})"
    fi
  fi
fi

echo
if [ "$bledy" -gt 0 ]; then
  echo "✗ SMOKE: $bledy błąd(ów) — rozważ deploy/rollback.sh" >&2
  exit 1
elif [ "$pominiete" -gt 0 ]; then
  echo "✓ SMOKE OK — ale $pominiete krok(ów) POMINIĘTO (linie „–\" wyżej); to nie jest pełne potwierdzenie"
else
  echo "✓ SMOKE OK"
fi
exit 0
