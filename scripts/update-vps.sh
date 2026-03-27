#!/bin/bash
# ============================================================
# Kebab MES — Aktualizacja VPS (ręczna)
# Uruchom jako root: bash update-vps.sh
# ============================================================
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[→]${NC} $1"; }

BRANCH="claude/redesign-admin-ui-mOZG9"
APP_DIR="/opt/kebabmes"
SERVICE="kebabmes"
PORT=8000

echo ""
echo "  ██╗  ██╗███████╗██████╗  █████╗ ██████╗     ███╗   ███╗███████╗███████╗"
echo "  ██║ ██╔╝██╔════╝██╔══██╗██╔══██╗██╔══██╗    ████╗ ████║██╔════╝██╔════╝"
echo "  █████╔╝ █████╗  ██████╔╝███████║██████╔╝    ██╔████╔██║█████╗  ███████╗"
echo "  ██╔═██╗ ██╔══╝  ██╔══██╗██╔══██║██╔══██╗    ██║╚██╔╝██║██╔══╝  ╚════██║"
echo "  ██║  ██╗███████╗██████╔╝██║  ██║██████╔╝    ██║ ╚═╝ ██║███████╗███████║"
echo "  ╚═╝  ╚═╝╚══════╝╚═════╝ ╚═╝  ╚═╝╚═════╝     ╚═╝     ╚═╝╚══════╝╚══════╝"
echo ""
echo "  Aktualizacja systemu MES — $(date '+%Y-%m-%d %H:%M:%S')"
echo "  =========================================================="
echo ""

[ "$EUID" -ne 0 ] && err "Uruchom jako root: sudo bash update-vps.sh"
[ ! -d "$APP_DIR" ] && err "Katalog $APP_DIR nie istnieje. Uruchom najpierw INSTALUJ_VPS.sh"

# ── 1. Aktualizacja kodu ──────────────────────────────────────
info "Pobieranie aktualizacji z GitHub (branch: $BRANCH)..."
cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
COMMIT=$(git log --oneline -1)
log "Kod zaktualizowany: $COMMIT"

# ── 2. Aktualizacja zależności Python ────────────────────────
info "Aktualizacja zależności Python..."
REQS="$APP_DIR/kebab_fixed/backend/requirements_pg.txt"
if [ -f "$REQS" ]; then
  pip3 install -q -r "$REQS"
  log "Zależności zainstalowane"
else
  pip3 install -q fastapi uvicorn psycopg2-binary python-dotenv asyncpg pydantic
  log "Zależności podstawowe zainstalowane"
fi

# ── 3. Restart serwisu ────────────────────────────────────────
info "Restartowanie serwisu $SERVICE..."
systemctl restart "$SERVICE"
sleep 3

# ── 4. Weryfikacja ────────────────────────────────────────────
if systemctl is-active --quiet "$SERVICE"; then
  log "Serwis $SERVICE działa poprawnie"
else
  err "Serwis nie uruchomił się! Logi: journalctl -u $SERVICE -n 50"
fi

# ── 5. Health check ──────────────────────────────────────────
sleep 1
HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/health" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  log "Health check OK (HTTP $HTTP)"
else
  warn "Health check zwrócił HTTP $HTTP — API może potrzebować chwili"
fi

# ── Podsumowanie ─────────────────────────────────────────────
IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║         AKTUALIZACJA ZAKOŃCZONA POMYŚLNIE            ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Branch:  $BRANCH"
echo "  Commit:  $COMMIT"
echo "  API:     http://${IP}:${PORT}"
echo "  Logi:    journalctl -fu $SERVICE"
echo ""
