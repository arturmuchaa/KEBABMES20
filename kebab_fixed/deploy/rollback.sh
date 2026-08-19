#!/usr/bin/env bash
# Cofnięcie ostatniego wdrożenia Kebab MES — jedno polecenie, bez myślenia.
#
# POWÓD ISTNIENIA: `deploy.sh` zostawia kopie (`dist.bak-*`, `backend.bak-*`),
# ale cofnięcie trzeba było składać ręcznie z `cp`, `rm` i `systemctl`. O 5:40
# rano, gdy przy rampie stoi auto, nikt nie powinien tego wymyślać na żywo.
#
# Użycie (na SERWERZE produkcyjnym):
#   deploy/rollback.sh            # cofnij frontend i backend do ostatniej kopii
#   deploy/rollback.sh frontend   # tylko dist
#   deploy/rollback.sh backend    # tylko backend (+restart)
#   deploy/rollback.sh --lista    # pokaż dostępne kopie i nic nie rób
set -euo pipefail

APP="${KEBAB_APP:-/opt/kebab/app}"
HEALTH_URL="${KEBAB_HEALTH_URL:-http://127.0.0.1:8080/api/health}"
TARGET="${1:-all}"
TS="$(date +%Y%m%d-%H%M%S)"

ostatnia() { ls -dt "$APP"/"$1"-* 2>/dev/null | head -1; }

lista() {
  echo "▶ dostępne kopie w $APP:"
  ls -dt "$APP"/dist.bak-*    2>/dev/null | head -5 | sed 's/^/   frontend: /' || true
  ls -dt "$APP"/backend.bak-* 2>/dev/null | head -5 | sed 's/^/   backend:  /' || true
}

if [ "$TARGET" = "--lista" ]; then lista; exit 0; fi

rollback_frontend() {
  local kopia; kopia="$(ostatnia dist.bak)"
  [ -n "$kopia" ] || { echo "✗ Brak kopii dist.bak-* — nie ma czego cofać" >&2; exit 1; }
  [ -f "$kopia/index.html" ] || { echo "✗ $kopia wygląda na niekompletną (brak index.html)" >&2; exit 1; }
  echo "▶ frontend ← $kopia"
  # Ta sama atomowa podmiana co przy wdrożeniu: kopiuj obok, potem mv.
  # Bieżącą wersję zachowujemy, żeby dało się wrócić do niej z powrotem.
  rm -rf "$APP/dist.new"
  cp -r "$kopia" "$APP/dist.new"
  [ -d "$APP/dist" ] && mv "$APP/dist" "$APP/dist.przed-cofnieciem-$TS"
  mv "$APP/dist.new" "$APP/dist"
  echo "✓ frontend cofnięty (poprzedni stan: $APP/dist.przed-cofnieciem-$TS)"
}

rollback_backend() {
  local kopia; kopia="$(ostatnia backend.bak)"
  [ -n "$kopia" ] || { echo "✗ Brak kopii backend.bak-* — nie ma czego cofać" >&2; exit 1; }
  [ -f "$kopia/main.py" ] || { echo "✗ $kopia wygląda na niekompletną (brak main.py)" >&2; exit 1; }
  echo "▶ backend ← $kopia"
  [ -d "$APP/backend/app" ] && mv "$APP/backend/app" "$APP/backend.przed-cofnieciem-$TS"
  cp -r "$kopia" "$APP/backend/app"
  # RESTART, nie reload: reload po cichu serwuje stary kod i cofnięcie
  # wyglądałoby na nieudane.
  systemctl restart kebab-mes
  sleep 3
  if [ "$(curl -s -m 10 "$HEALTH_URL" || true)" = "true" ]; then
    echo "✓ backend cofnięty — health OK"
  else
    echo "✗ health FAIL po cofnięciu — sprawdź: journalctl -u kebab-mes -n 50" >&2
    exit 1
  fi
}

case "$TARGET" in
  frontend) rollback_frontend ;;
  backend)  rollback_backend ;;
  all)      rollback_frontend; rollback_backend ;;
  *) echo "Użycie: deploy/rollback.sh [all|frontend|backend|--lista]" >&2; exit 1 ;;
esac

echo "✓ cofnięcie zakończone — $TS"
echo "  Sprawdź jeszcze: deploy/smoke.sh"
