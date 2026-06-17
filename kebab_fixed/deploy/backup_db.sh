#!/usr/bin/env bash
# Automatyczny backup bazy Kebab MES + retencja. Wołany przez systemd timer
# (kebab-backup.timer). Bezpieczny: atomowy zapis, walidacja gzip, retencja
# usuwa TYLKO auto-backupy (ręczne nazwane zostają).
set -euo pipefail

ENV_FILE="${KEBAB_ENV_FILE:-/opt/kebab/config/.env}"
BACKUP_DIR="${KEBAB_BACKUP_DIR:-/opt/kebab/app/backups}"
RETENTION_DAYS="${KEBAB_BACKUP_RETENTION_DAYS:-14}"

# DATABASE_URL z konfiguracji środowiska
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
: "${DATABASE_URL:?DATABASE_URL nie ustawiony w $ENV_FILE}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/auto-kebab_mes-$TS.sql.gz"

# dump → gzip do pliku częściowego; atomowy mv po sukcesie (pipefail łapie błąd pg_dump)
if pg_dump "$DATABASE_URL" | gzip -c > "$OUT.partial"; then
  mv "$OUT.partial" "$OUT"
else
  rm -f "$OUT.partial"
  echo "BŁĄD: pg_dump nie powiódł się" >&2
  exit 1
fi

# walidacja: niepusty + poprawny gzip
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  echo "BŁĄD: backup pusty lub uszkodzony: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

# retencja — tylko auto-backupy starsze niż N dni
find "$BACKUP_DIR" -maxdepth 1 -name 'auto-kebab_mes-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "backup OK: $OUT ($(du -h "$OUT" | cut -f1)); retencja ${RETENTION_DAYS} dni"
