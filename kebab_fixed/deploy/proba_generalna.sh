#!/usr/bin/env bash
# Próba generalna przed wdrożeniem — na KOPII produkcyjnej bazy.
#
# Zakłada świeżą kopię `kebab_proba`, przechodzi nią ścieżkę biura kodem,
# który stoi na produkcji, i kasuje kopię po sobie. Produkcja nietknięta:
# numeracja, dokumenty i stany zostają bez zmian.
#
# Po co, skoro są testy: 19.08.2026 komplet był zielony, a korekta wagi
# zostawiała rozjazd 150 kg między stanem partii a księgą ruchów. Testy
# sprawdzają reguły na wymyślonych danych — to sprawdza je na danych zakładu.
#
# Użycie (NA SERWERZE produkcyjnym):
#   deploy/proba_generalna.sh
#   KEBAB_ZOSTAW_KOPIE=1 deploy/proba_generalna.sh   # nie kasuj kopii (do debugowania)
set -uo pipefail

APP="${KEBAB_APP:-/opt/kebab/app}"
VENV="${KEBAB_VENV:-/opt/kebab/venv}"
ENVFILE="${KEBAB_ENV:-/opt/kebab/config/.env}"
KOPIA="${KEBAB_KOPIA_DB:-kebab_proba}"
PORT="${KEBAB_PG_PORT:-5433}"
SKRYPT="$(cd "$(dirname "$0")" && pwd)/proba_generalna.py"

[ -f "$ENVFILE" ] || { echo "✗ Brak $ENVFILE — uruchom na serwerze produkcyjnym" >&2; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENVFILE"; set +a
ZRODLO="$(printf '%s' "${DATABASE_URL:-}" | sed 's|.*/||')"
[ -n "$ZRODLO" ] || { echo "✗ Nie umiem odczytać nazwy bazy z DATABASE_URL" >&2; exit 1; }

echo "▶ kopia $ZRODLO → $KOPIA"
su - postgres -c "psql -p $PORT -c 'DROP DATABASE IF EXISTS $KOPIA'" >/dev/null 2>&1
su - postgres -c "createdb -p $PORT $KOPIA" || { echo "✗ Nie udało się założyć kopii" >&2; exit 1; }
su - postgres -c "pg_dump -p $PORT $ZRODLO | psql -p $PORT -q -d $KOPIA" >/dev/null 2>&1 \
  || { echo "✗ Nie udało się przenieść danych do kopii" >&2; exit 1; }

# Kod bierzemy Z WDROŻONEGO katalogu, nie z repo: sprawdzamy to, co naprawdę
# stoi na serwerze, a nie to, co dopiero miało tam trafić.
PROBA_URL="$(printf '%s' "$DATABASE_URL" | sed "s|/$ZRODLO\$|/$KOPIA|")"
DATABASE_URL="$PROBA_URL" PYTHONPATH="$APP/backend" "$VENV/bin/python" "$SKRYPT" 2>&1 \
  | grep -vE '^\s*(INFO|WARNING)|^20[0-9]{2}-'
wynik=${PIPESTATUS[0]}

if [ "${KEBAB_ZOSTAW_KOPIE:-0}" = "1" ]; then
  echo "▶ kopia $KOPIA ZOSTAWIONA (KEBAB_ZOSTAW_KOPIE=1)"
else
  su - postgres -c "psql -p $PORT -c 'DROP DATABASE $KOPIA'" >/dev/null 2>&1 \
    && echo "▶ kopia $KOPIA skasowana"
fi

exit "$wynik"
