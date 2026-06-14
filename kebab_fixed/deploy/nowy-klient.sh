#!/usr/bin/env bash
# Stawia NOWĄ, czystą instancję Kebab MES dla jednego klienta.
# Każdy klient = osobny projekt compose (kebab-<slug>) = osobne wolumeny = czysta baza.
#
# Użycie:  bash deploy/nowy-klient.sh [slug]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null || { echo "Brak docker. Zainstaluj Docker + compose."; exit 1; }

SLUG="${1:-}"
[ -z "$SLUG" ] && read -rp "Slug klienta (np. ksiezyc): " SLUG
SLUG="$(printf '%s' "$SLUG" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')"
[ -n "$SLUG" ] || { echo "Pusty slug."; exit 1; }

CLIENT_DIR="clients/$SLUG"
ENV_FILE="$CLIENT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo "Klient '$SLUG' już istnieje ($ENV_FILE)."
  echo "Start:  docker compose -p kebab-$SLUG --env-file $ENV_FILE -f deploy/docker-compose.yml up -d"
  exit 1
fi

read -rp "Pełna nazwa klienta: " CLIENT_NAME
read -rp "NIP: " CLIENT_NIP
read -rp "Port na hoście [8080]: " APP_PORT; APP_PORT="${APP_PORT:-8080}"
read -rp "Moduły (pusto=wszystkie, np. 'rozbior'): " MODULES

PASS="$(openssl rand -hex 24)"
ADMIN="$(openssl rand -hex 24)"

mkdir -p "$CLIENT_DIR"
cat > "$ENV_FILE" <<EOF
COMPOSE_PROJECT_NAME=kebab-$SLUG
CLIENT_NAME="$CLIENT_NAME"
CLIENT_NIP=$CLIENT_NIP
APP_PORT=$APP_PORT
POSTGRES_DB=kebab_mes
POSTGRES_USER=kebab
POSTGRES_PASSWORD=$PASS
DATABASE_URL=postgresql://kebab:$PASS@db:5432/kebab_mes
MODULES=$MODULES
CORS_ORIGINS=*
DATAPORT_API_KEY=
ADMIN_TOKEN=$ADMIN
EOF
chmod 600 "$ENV_FILE"
echo "Zapisano $ENV_FILE (sekrety wygenerowane losowo — TRZYMAJ POZA GITEM)."

echo "Buduję i uruchamiam instancję (czysta baza)…"
docker compose -p "kebab-$SLUG" --env-file "$ENV_FILE" -f deploy/docker-compose.yml up -d --build

cat <<EOF

✅ GOTOWE — klient '$SLUG'
   UI/API:   http://<host>:$APP_PORT
   Projekt:  kebab-$SLUG
   Logi:     docker compose -p kebab-$SLUG -f deploy/docker-compose.yml logs -f
   Backup:   docker exec kebab-$SLUG-db-1 pg_dump -U kebab kebab_mes > backup-$SLUG.sql
   Stop:     docker compose -p kebab-$SLUG -f deploy/docker-compose.yml down
   Update:   git pull && docker compose -p kebab-$SLUG --env-file $ENV_FILE -f deploy/docker-compose.yml up -d --build
EOF
