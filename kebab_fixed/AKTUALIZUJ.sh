#!/bin/bash
# ================================================================
#  KEBAB MES — Aktualizacja VPS
#  Nginx serwuje z: /opt/kebab/kebab_fixed/dist
#  Uruchom: bash /opt/kebab/kebab_fixed/AKTUALIZUJ.sh
# ================================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }

BRANCH="claude/redesign-dashboard-ui-gNVuD"
REPO="https://github.com/arturmuchaa/KEBABMES20.git"

# Katalog z kodem źródłowym = /opt/kebab/kebab_fixed
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Korzeń repozytorium = /opt/kebab
REPO_DIR="$(dirname "$APP_DIR")"

echo ""
echo -e "${BOLD}  Kebab MES — Aktualizacja${NC}"
echo -e "  Katalog aplikacji: $APP_DIR"
echo ""

# ── 1. Git pull ──────────────────────────────────────────────────
echo "  Pobieram kod z GitHub..."
cd "$REPO_DIR"
[ ! -d .git ] && git init -q && git remote add origin "$REPO" 2>/dev/null
git remote set-url origin "$REPO" 2>/dev/null || true
git fetch origin "$BRANCH" -q
git reset --hard "origin/$BRANCH" -q
ok "Kod pobrany (branch: $BRANCH)"

# ── 2. Zachowaj .env.local jeśli istnieje ────────────────────────
if [ ! -f "$APP_DIR/.env.local" ]; then
    echo "VITE_API_URL=" > "$APP_DIR/.env.local"
fi

# Zachowaj backend/.env
if [ -f "$APP_DIR/backend/.env" ]; then
    cp "$APP_DIR/backend/.env" /tmp/_kebab_env_bkp
    ok "Backup .env zachowany"
fi
[ -f /tmp/_kebab_env_bkp ] && cp /tmp/_kebab_env_bkp "$APP_DIR/backend/.env"

# ── 3. Build frontendu w /opt/kebab/kebab_fixed ──────────────────
echo "  Buduję frontend w $APP_DIR..."
cd "$APP_DIR"
npm install --legacy-peer-deps -q 2>/dev/null || npm install -q
npm run build
ok "Frontend przebudowany (dist: $APP_DIR/dist)"

# ── 4. Restart backendu ──────────────────────────────────────────
echo "  Restartuję backend..."
for svc in kebab-mes.service kebab.service kebabmes.service; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl restart "$svc" && ok "Serwis $svc zrestartowany" && break
    fi
done

# ── 5. Nginx reload ──────────────────────────────────────────────
systemctl reload nginx 2>/dev/null && ok "Nginx przeładowany" || true

echo ""
echo -e "${GREEN}${BOLD}  ✓ Gotowe! Odśwież przeglądarkę (tryb incognito).${NC}"
echo ""
