#!/bin/bash
# ============================================================
# Kebab MES — Aktualizacja VPS (pobierz + restart)
# Uruchom jako root: bash update-vps.sh
# ============================================================
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!!]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

BRANCH="claude/add-traceability-system-UxumS"
APP_DIR="/opt/kebabmes"
SERVICE="kebabmes"

echo ""
echo "  Kebab MES — Aktualizacja systemu"
echo "  ================================="
echo ""

[ "$EUID" -ne 0 ] && err "Uruchom jako root: sudo bash update-vps.sh"

# 1. Pobierz najnowszy kod
log "Pobieranie aktualizacji z GitHub..."
cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"
log "Kod zaktualizowany do najnowszej wersji"

# 2. Zaktualizuj zależności Pythona (jeśli nowe)
log "Sprawdzanie zależności Python..."
pip3 install -q -r kebab_fixed/backend/requirements.txt 2>/dev/null || \
  pip3 install -q fastapi uvicorn psycopg2-binary python-dotenv

# 3. Restart serwisu
log "Restartowanie serwisu..."
systemctl restart "$SERVICE"
sleep 2

# 4. Sprawdź status
if systemctl is-active --quiet "$SERVICE"; then
  log "Serwis działa poprawnie"
  echo ""
  echo -e "  ${GREEN}✓ Aktualizacja zakończona!${NC}"
  echo ""
  IP=$(hostname -I | awk '{print $1}')
  echo "  API dostępne pod: http://${IP}:8000"
  echo "  Logi: journalctl -u $SERVICE -f"
else
  err "Serwis nie uruchomił się. Sprawdź logi: journalctl -u $SERVICE -n 50"
fi
