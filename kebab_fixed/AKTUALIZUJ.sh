#!/bin/bash
# ================================================================
#  KEBAB MES — Aktualizacja VPS
#  Uruchom: bash /opt/kebab/kebab_fixed/AKTUALIZUJ.sh
# ================================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
err()  { echo -e "${RED}  ✗ BŁĄD: $1${NC}"; exit 1; }

BRANCH="claude/redesign-dashboard-ui-gNVuD"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"
TMP_DIR="/tmp/_kebab_update"

# Katalog gdzie zbudujemy i gdzie nginx szuka dist/
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}  Kebab MES — Aktualizacja${NC}"
echo -e "  Katalog aplikacji: ${BOLD}$APP_DIR${NC}"
echo -e "  Branch: ${BOLD}$BRANCH${NC}"
echo ""

# ── 1. Pobierz kod do /tmp ───────────────────────────────────────
echo "  Pobieram kod z GitHub..."
rm -rf "$TMP_DIR"
git clone --depth 1 --branch "$BRANCH" "$REPO" "$TMP_DIR" -q \
  || err "Nie można pobrać repo. Sprawdź połączenie z internetem."
ok "Kod pobrany"

# ── 2. Zachowaj .env.local i backend/.env ────────────────────────
[ -f "$APP_DIR/.env.local" ]     && cp "$APP_DIR/.env.local"     /tmp/_kebab_env_local
[ -f "$APP_DIR/backend/.env" ]   && cp "$APP_DIR/backend/.env"   /tmp/_kebab_env_backend

# ── 3. Skopiuj nowy kod do APP_DIR ──────────────────────────────
echo "  Aktualizuję pliki w $APP_DIR..."
rsync -a --delete \
  --exclude='.env.local' \
  --exclude='backend/.env' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='.venv/' \
  "$TMP_DIR/kebab_fixed/" "$APP_DIR/"
ok "Pliki zaktualizowane"

# ── 4. Przywróć .env ─────────────────────────────────────────────
[ -f /tmp/_kebab_env_local ]   && cp /tmp/_kebab_env_local   "$APP_DIR/.env.local"
[ -f /tmp/_kebab_env_backend ] && cp /tmp/_kebab_env_backend "$APP_DIR/backend/.env"
[ ! -f "$APP_DIR/.env.local" ] && echo "VITE_API_URL=" > "$APP_DIR/.env.local"

# ── 5. Build frontendu ───────────────────────────────────────────
echo "  Instaluję zależności npm..."
cd "$APP_DIR"
npm install --legacy-peer-deps -q 2>&1 | tail -3
ok "npm install gotowy"

echo "  Buduję frontend..."
npm run build 2>&1 || err "npm run build nie powiodło się — sprawdź logi wyżej"
ok "Frontend przebudowany → $APP_DIR/dist"

# ── 6. Restart backendu ──────────────────────────────────────────
echo "  Restartuję backend..."
for svc in kebab-mes.service kebab.service kebabmes.service; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl restart "$svc" && ok "Serwis $svc zrestartowany" && break
    fi
done

# ── 7. Nginx reload ──────────────────────────────────────────────
nginx -t 2>/dev/null && systemctl reload nginx && ok "Nginx przeładowany" || warn "Nginx reload pominięty"

# ── Cleanup ──────────────────────────────────────────────────────
rm -rf "$TMP_DIR" /tmp/_kebab_env_local /tmp/_kebab_env_backend

echo ""
echo -e "${GREEN}${BOLD}  ✓ Gotowe! Odśwież przeglądarkę (Ctrl+Shift+R lub tryb incognito).${NC}"
echo ""
