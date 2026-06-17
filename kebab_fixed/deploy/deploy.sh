#!/usr/bin/env bash
# Deploy Kebab MES na VPS (build lokalny → /opt/kebab/app). Zastępuje ręczny `cp`.
# Bezpieczny: walidacja artefaktów, backup+retencja (koniec proliferacji dist.bak),
# atomowa podmiana dist, health-check, weryfikacja serwowanego bundla.
#
# Użycie:
#   deploy/deploy.sh            # frontend + backend (restart)
#   deploy/deploy.sh frontend   # tylko dist (bez restartu backendu)
#   deploy/deploy.sh backend    # tylko backend (+restart)
set -euo pipefail

REPO="${KEBAB_REPO:-/opt/kebab/kebab_new/kebab_fixed}"
APP="${KEBAB_APP:-/opt/kebab/app}"
KEEP_BACKUPS="${KEBAB_KEEP_BACKUPS:-5}"
TARGET="${1:-all}"
TS="$(date +%Y%m%d-%H%M%S)"

cd "$REPO"

prune() { ls -dt "$APP"/"$1"-* 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -rf; }

deploy_frontend() {
  echo "▶ build frontendu…"
  set -o pipefail
  VITE_API_URL= npm run build 2>&1 | tail -3
  [ -f dist/index.html ] || { echo "✗ brak dist/index.html — przerwano" >&2; exit 1; }
  ls dist/assets/main-*.js >/dev/null 2>&1 || { echo "✗ brak głównego bundla — przerwano" >&2; exit 1; }

  [ -d "$APP/dist" ] && cp -r "$APP/dist" "$APP/dist.bak-$TS"
  prune "dist.bak"

  # atomowa podmiana: kopiuj obok, potem mv
  rm -rf "$APP/dist.new"
  cp -r dist "$APP/dist.new"
  rm -rf "$APP/dist"
  mv "$APP/dist.new" "$APP/dist"

  local served built
  served="$(curl -s http://127.0.0.1:8080/ | grep -oE 'main-[A-Za-z0-9_-]+\.js' | head -1)"
  built="$(basename "$(ls dist/assets/main-*.js | head -1)")"
  if [ "$served" = "$built" ]; then
    echo "✓ frontend OK — serwowany: $served"
  else
    echo "✗ serwowany ($served) != zbudowany ($built) — sprawdź nginx/cache" >&2
    exit 1
  fi
}

deploy_backend() {
  echo "▶ deploy backendu…"
  [ -d "$APP/backend/app" ] && cp -r "$APP/backend/app" "$APP/backend.bak-$TS"
  prune "backend.bak"
  cp -r backend/app/. "$APP/backend/app/"
  systemctl restart kebab-mes
  sleep 3
  if curl -sf 127.0.0.1:8010/api/health | grep -q true; then
    echo "✓ backend OK — health true"
  else
    echo "✗ health FAIL po restarcie — rollback: $APP/backend.bak-$TS" >&2
    exit 1
  fi
}

case "$TARGET" in
  frontend) deploy_frontend ;;
  backend)  deploy_backend ;;
  all)      deploy_backend; deploy_frontend ;;
  *) echo "Użycie: deploy.sh [all|frontend|backend]" >&2; exit 2 ;;
esac

echo "✓ deploy ($TARGET) zakończony — $TS"
