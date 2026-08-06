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

# ─── Strażnik: wdrażamy TYLKO commit, który przeszedł CI ─────────────────────
#
# Skrypt buduje z drzewa roboczego na VPS-ie, więc bez tej kontroli na produkcję
# szło dokładnie to, co akurat leżało w katalogu — niezależnie od tego, czy
# istnieje w gicie i czy cokolwiek je sprawdziło. Trzy warunki:
#   1. brak niezapisanych zmian w kodzie,
#   2. HEAD jest na origin (da się odtworzyć, co poszło na produkcję),
#   3. CI dla tego SHA zakończone sukcesem.
#
# Furtka: KEBAB_FORCE_DEPLOY=1 pomija bramkę. Musi istnieć — o trzeciej w nocy
# przy leżącej produkcji alternatywą jest ręczny `cp`, który omija cały skrypt
# razem z backupem i weryfikacją.
guard() {
  if [ "${KEBAB_FORCE_DEPLOY:-0}" = "1" ]; then
    echo "⚠ KEBAB_FORCE_DEPLOY=1 — bramka CI POMINIĘTA (deploy awaryjny)" >&2
    logger -t kebab-deploy "FORCE deploy $(git rev-parse --short HEAD) przez ${SUDO_USER:-$USER}" 2>/dev/null || true
    return 0
  fi

  # 1. Czyste drzewo — tylko katalogi z kodem. Reszta repo (src-tauri/target,
  #    gen/, icons/) to artefakty builda, które zawsze są nieśledzone.
  local dirty
  dirty="$(git status --porcelain -- src backend deploy public index.html package.json)"
  if [ -n "$dirty" ]; then
    echo "✗ Niezapisane zmiany w kodzie — zacommituj albo cofnij:" >&2
    echo "$dirty" >&2
    echo "  (awaryjnie: KEBAB_FORCE_DEPLOY=1 $0 $TARGET)" >&2
    exit 1
  fi

  local sha; sha="$(git rev-parse HEAD)"

  # 2. HEAD musi istnieć na zdalnym — inaczej nie da się później odtworzyć,
  #    co dokładnie działa na produkcji.
  git fetch -q origin 2>/dev/null || { echo "✗ Brak łączności z origin" >&2; exit 1; }
  if ! git branch -r --contains "$sha" 2>/dev/null | grep -q .; then
    echo "✗ Commit $sha nie istnieje na origin — najpierw: git push" >&2
    echo "  (awaryjnie: KEBAB_FORCE_DEPLOY=1 $0 $TARGET)" >&2
    exit 1
  fi

  # 3. CI zielone dla TEGO commita.
  command -v gh >/dev/null 2>&1 || { echo "✗ Brak gh CLI — nie mogę sprawdzić CI" >&2; exit 1; }
  local concl
  concl="$(gh run list --commit "$sha" --limit 20 \
             --json conclusion,status --jq \
             '[.[] | select(.status=="completed")] | if length==0 then "brak" else ([.[].conclusion] | unique | join(",")) end' \
           2>/dev/null || echo "blad")"
  case "$concl" in
    success)
      echo "✓ CI zielone dla $(git rev-parse --short "$sha")" ;;
    brak)
      echo "✗ CI jeszcze nie zakończone dla $sha — poczekaj na wynik" >&2
      echo "  podgląd: gh run list --commit $sha" >&2
      exit 1 ;;
    blad)
      echo "✗ Nie udało się odpytać GitHub Actions (gh auth status?)" >&2
      exit 1 ;;
    *)
      echo "✗ CI NIE jest zielone dla $sha (wynik: $concl)" >&2
      echo "  podgląd: gh run list --commit $sha" >&2
      echo "  (awaryjnie: KEBAB_FORCE_DEPLOY=1 $0 $TARGET)" >&2
      exit 1 ;;
  esac
}

deploy_frontend() {
  echo "▶ build frontendu…"
  set -o pipefail
  VITE_API_URL= npm run build 2>&1 | tail -3
  [ -f dist/index.html ] || { echo "✗ brak dist/index.html — przerwano" >&2; exit 1; }
  ls dist/assets/main-*.js >/dev/null 2>&1 || { echo "✗ brak głównego bundla — przerwano" >&2; exit 1; }

  # Stempel wersji — bez niego jedyną odpowiedzią na „co właściwie jest na
  # produkcji" jest porównywanie hashy bundli.
  printf '%s\n%s\n%s\n' \
    "commit=$(git rev-parse HEAD)" \
    "branch=$(git rev-parse --abbrev-ref HEAD)" \
    "deployed=$TS" > dist/VERSION
  echo "▶ wersja: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

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

guard

case "$TARGET" in
  frontend) deploy_frontend ;;
  backend)  deploy_backend ;;
  all)      deploy_backend; deploy_frontend ;;
  *) echo "Użycie: deploy.sh [all|frontend|backend]" >&2; exit 2 ;;
esac

echo "✓ deploy ($TARGET) zakończony — $TS"
